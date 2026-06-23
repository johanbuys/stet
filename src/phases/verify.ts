/**
 * runAgreementVerify — agreement-verify stage for composite phases.
 *
 * For each candidate finding, runs N sequential voter calls (each with a distinct
 * lens), aggregates upholds, stamps confidence (high/medium), and drops candidates
 * that fail the agreement threshold.
 *
 * TDD A·2/A·3/A·4. Called by composite.run() between roll-up (②) and coordinator (④).
 * Plan refs: M1 steps 2–4.
 */

import { Result } from "better-result";
import { Value } from "@sinclair/typebox/value";
import type { Finding } from "../schema/finding.js";
import type { AgentRunner, AgentRunInputs } from "../agent/runner.js";
import { runWithWallClock, FIVE_MINUTE_BUDGETS } from "../agent/budgets.js";
import {
  VoterVerdict as VoterVerdictSchema,
  type VoterVerdict,
  type VerifyAudit,
} from "../schema/report.js";
import { VERDICT_TOOL_NAME } from "../agent/submit-verdict.js";
import { ConfigError } from "../errors.js";

// ---------------------------------------------------------------------------
// VerifyConfig
// ---------------------------------------------------------------------------

/**
 * Configuration for a single runAgreementVerify call.
 * Thresholds (agreementForHigh, agreementForMedium) are absolute — not derived
 * from N — so changing voters doesn't silently lower the bar for "high" (TDD A·2).
 */
export interface VerifyConfig {
  /** Number of voters per candidate (N). */
  voters: number;
  /** Per-voter lens strings — one per voter position; carry the refutation angle (TDD A·2). */
  lenses: string[];
  /** Minimum upholds required for confidence "high" (PRD C1; default 3). */
  agreementForHigh: number;
  /** Minimum upholds required for confidence "medium" (PRD C1; default 2). */
  agreementForMedium: number;
  /** Resolved model id for voter calls (TDD A·2 — v1 = robust tier). */
  model?: string;
  /** Safety budgets per voter call; defaults to FIVE_MINUTE_BUDGETS. */
  budgets?: AgentRunInputs["budgets"];
}

// ---------------------------------------------------------------------------
// Voter toolset — inspection-only by intent (no edit/write tools, per PRD §3.2 /
// TDD A·2). `bash` is included for inspection but remains the tracked
// unrestricted-write residual of decision #34 — not a hard read-only guarantee.
// ---------------------------------------------------------------------------

const VOTER_TOOLSET = ["read", "grep", "find", "ls", "bash", VERDICT_TOOL_NAME];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVoterVerdict(submission: unknown): VoterVerdict | null {
  if (Value.Check(VoterVerdictSchema, submission)) {
    return submission as VoterVerdict;
  }
  return null;
}

function buildVoterPrompt(candidate: Finding, lens: string, diff: string | undefined): string {
  const parts: string[] = [
    `Finding to evaluate (id: ${candidate.id}):`,
    `  message: ${candidate.message}`,
    `  severity: ${candidate.severity}`,
  ];
  if (candidate.location) {
    const { file, line } = candidate.location;
    parts.push(`  location: ${file}${line !== undefined ? `:${line}` : ""}`);
  }
  parts.push("", `Evaluate this finding through the following lens: ${lens}`);
  if (diff) {
    parts.push("", "Diff context:", diff);
  }
  return parts.join("\n");
}

/**
 * Run one voter call with a transient-only retry policy (TDD A·3 partial failure).
 *
 * Always returns a VoterVerdict — abstain is synthesized with an accurate reason when
 * the voter cannot produce a valid verdict:
 *   - Ok + valid verdict → that verdict.
 *   - Ok + submission fails schema → abstain("voter returned an unparseable verdict").
 *   - Err (BudgetError, CancelledError, or signal already aborted) → abstain immediately,
 *     no retry ("voter errored on its only attempt").
 *   - Err (other transient AgentError) → retry once; if retry also fails →
 *     abstain("voter errored on both attempts").
 *
 * Non-transient errors (BudgetError, CancelledError, aborted signal) are never retried:
 * a BudgetError means the wall-clock window is exhausted (retrying wastes a full new
 * window for nothing); CancelledError / aborted signal means the parent has cancelled
 * and the next attempt will also fail immediately (TDD A·3 / Finding #1).
 */
async function callVoter(
  runner: AgentRunner,
  candidate: Finding,
  lens: string,
  cfg: VerifyConfig,
  ctx: { cwd: string; diff?: string; signal?: AbortSignal },
): Promise<VoterVerdict> {
  const budgets = cfg.budgets ?? FIVE_MINUTE_BUDGETS;
  const inputs: AgentRunInputs = {
    rubric: lens,
    userPrompt: buildVoterPrompt(candidate, lens, ctx.diff),
    toolset: VOTER_TOOLSET,
    submitSchema: VoterVerdictSchema,
    submitToolName: VERDICT_TOOL_NAME,
    budgets,
    model: cfg.model,
    cwd: ctx.cwd,
  };

  // First attempt — fresh AbortController per call (plan M1 step 2: "never reuse")
  const ctrl1 = new AbortController();
  const result1 = await runWithWallClock(runner, inputs, ctrl1, ctx.signal);
  if (result1.isOk()) {
    // Valid runner result; accept if submission matches VoterVerdict schema
    const parsed = parseVoterVerdict(result1.value.submission);
    if (parsed !== null) {
      return parsed;
    }
    // Ok but schema mismatch — not a transient error; do not retry (Finding #5)
    return { verdict: "abstain", reason: "voter returned an unparseable verdict" };
  }

  // Non-transient errors: skip retry entirely (Finding #1)
  const errTag = result1.error._tag;
  if (ctx.signal?.aborted || errTag === "BudgetError" || errTag === "CancelledError") {
    return { verdict: "abstain", reason: "voter errored on its only attempt" };
  }

  // Transient AgentError on first attempt → retry once (TDD A·3: "retry once, then abstain")
  const ctrl2 = new AbortController();
  const result2 = await runWithWallClock(runner, inputs, ctrl2, ctx.signal);
  if (result2.isOk()) {
    const parsed = parseVoterVerdict(result2.value.submission);
    if (parsed !== null) {
      return parsed;
    }
    return { verdict: "abstain", reason: "voter returned an unparseable verdict" };
  }

  // Both attempts failed → abstain
  return { verdict: "abstain", reason: "voter errored on both attempts" };
}

// ---------------------------------------------------------------------------
// runAgreementVerify
// ---------------------------------------------------------------------------

/**
 * Agreement-verify stage: per candidate, run N voters with distinct lenses and
 * aggregate upholds to derive confidence.
 *
 * Returns Err(ConfigError) immediately if cfg is invalid:
 *   - cfg.voters < 1 (need at least one voter)
 *   - cfg.lenses.length !== cfg.voters (exactly one lens per voter is required; TDD A·2)
 *
 * Tier rules (TDD A·2 — absolute thresholds, not fractions of N):
 *   upholds ≥ agreementForHigh   → confidence "high"
 *   upholds ≥ agreementForMedium → confidence "medium"
 *   else                         → dropped (recorded in audit.verify.dropped)
 *
 * Failure (TDD A·3 partial): a voter abstaining (for any reason — error, schema
 * mismatch, cancellation) does not count as an uphold. The absolute threshold is
 * preserved — a partial failure lowers the *maximum* achievable agreement, never
 * the bar for "high".
 *
 * Returns the passing findings (with harness-stamped confidence) and the
 * VerifyAudit block for PhaseReport.audit.verify (TDD A·4).
 */
export async function runAgreementVerify(
  runner: AgentRunner,
  candidates: Finding[],
  cfg: VerifyConfig,
  ctx: { cwd: string; diff?: string; signal?: AbortSignal },
): Promise<Result<{ verified: Finding[]; audit: VerifyAudit }, ConfigError>> {
  // Validate config — fail loudly rather than silently reusing wrong lenses (Finding #3)
  if (cfg.voters < 1) {
    return Result.err(
      new ConfigError({
        path: "<agreement-verify>",
        message: `agreement-verify: voters must be ≥ 1, got ${cfg.voters}`,
      }),
    );
  }
  if (cfg.lenses.length !== cfg.voters) {
    return Result.err(
      new ConfigError({
        path: "<agreement-verify>",
        message: `agreement-verify: expected ${cfg.voters} lenses (one per voter), got ${cfg.lenses.length}`,
      }),
    );
  }

  const verified: Finding[] = [];
  const dropped: VerifyAudit["dropped"] = [];

  for (const candidate of candidates) {
    const verdicts: VoterVerdict[] = [];
    let upholds = 0;

    for (let i = 0; i < cfg.voters; i++) {
      const lens = cfg.lenses[i]!; // guaranteed present: lenses.length === voters (validated above)
      const verdict = await callVoter(runner, candidate, lens, cfg, ctx);
      verdicts.push(verdict);
      if (verdict.verdict === "uphold") {
        upholds++;
      }
    }

    // Stamp confidence (harness-owned — TDD A·4) and route to verified or dropped
    if (upholds >= cfg.agreementForHigh) {
      verified.push({ ...candidate, confidence: "high" });
    } else if (upholds >= cfg.agreementForMedium) {
      verified.push({ ...candidate, confidence: "medium" });
    } else {
      dropped.push({
        id: candidate.id,
        specialist: candidate.specialist,
        upholds,
        verdicts,
      });
    }
  }

  return Result.ok({
    verified,
    audit: {
      received: candidates.length,
      dropped,
    },
  });
}
