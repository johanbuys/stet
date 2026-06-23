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
// Voter toolset — read-only; no mutation tools (PRD §3.2)
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
 * Run one voter call with one retry on AgentError (TDD A·3 partial failure).
 *
 * Returns the VoterVerdict on success, or null if both attempts fail (= abstain).
 * An Ok result with an invalid VoterVerdict submission is treated as abstain
 * immediately (not retried — invalid schema is not a transient error).
 */
async function callVoter(
  runner: AgentRunner,
  candidate: Finding,
  lens: string,
  cfg: VerifyConfig,
  ctx: { cwd: string; diff?: string; signal?: AbortSignal },
): Promise<VoterVerdict | null> {
  const budgets = cfg.budgets ?? FIVE_MINUTE_BUDGETS;
  const inputs: AgentRunInputs = {
    rubric: lens,
    userPrompt: buildVoterPrompt(candidate, lens, ctx.diff),
    toolset: VOTER_TOOLSET,
    submitSchema: VoterVerdictSchema,
    budgets,
    model: cfg.model,
    cwd: ctx.cwd,
  };

  // First attempt — fresh AbortController per call (plan M1 step 2: "never reuse")
  const ctrl1 = new AbortController();
  const result1 = await runWithWallClock(runner, inputs, ctrl1, ctx.signal);
  if (result1.isOk()) {
    // Valid runner result; accept if submission matches VoterVerdict schema
    return parseVoterVerdict(result1.value.submission);
  }

  // AgentError on first attempt → retry once (TDD A·3: "retry once, then abstain")
  const ctrl2 = new AbortController();
  const result2 = await runWithWallClock(runner, inputs, ctrl2, ctx.signal);
  if (result2.isOk()) {
    return parseVoterVerdict(result2.value.submission);
  }

  // Both attempts failed → caller counts this voter as abstain
  return null;
}

// ---------------------------------------------------------------------------
// runAgreementVerify
// ---------------------------------------------------------------------------

/**
 * Agreement-verify stage: per candidate, run N voters with distinct lenses and
 * aggregate upholds to derive confidence.
 *
 * Tier rules (TDD A·2 — absolute thresholds, not fractions of N):
 *   upholds ≥ agreementForHigh   → confidence "high"
 *   upholds ≥ agreementForMedium → confidence "medium"
 *   else                         → dropped (recorded in audit.verify.dropped)
 *
 * Failure (TDD A·3 partial): a voter returning AgentError on both attempts is
 * counted as abstain. The absolute threshold is preserved — a partial failure
 * lowers the *maximum* achievable agreement, never the bar for "high".
 *
 * Returns the passing findings (with harness-stamped confidence) and the
 * VerifyAudit block for PhaseReport.audit.verify (TDD A·4).
 */
export async function runAgreementVerify(
  runner: AgentRunner,
  candidates: Finding[],
  cfg: VerifyConfig,
  ctx: { cwd: string; diff?: string; signal?: AbortSignal },
): Promise<{ verified: Finding[]; audit: VerifyAudit }> {
  const verified: Finding[] = [];
  const dropped: VerifyAudit["dropped"] = [];

  for (const candidate of candidates) {
    const verdicts: VoterVerdict[] = [];
    let upholds = 0;

    for (let i = 0; i < cfg.voters; i++) {
      const lens = cfg.lenses[i] ?? cfg.lenses[cfg.lenses.length - 1] ?? "";
      const voterResult = await callVoter(runner, candidate, lens, cfg, ctx);

      // null = voter errored on both attempts → synthesize an abstain (TDD A·3)
      const verdict: VoterVerdict = voterResult ?? {
        verdict: "abstain",
        reason: "voter errored on both attempts",
      };
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

  return {
    verified,
    audit: {
      received: candidates.length,
      dropped,
    },
  };
}
