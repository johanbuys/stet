/**
 * review phase — full specialist panel (M5 full panel, T15) + risk classification (M6 T17)
 * + config-slice validator (M6 T18).
 *
 * Implements plan §M4 steps 2,3 + M5 · TDD D · code-review-rubric-draft.md.
 * M4 shipped `bugs` only; M5 (T15) adds `security`, `quality`, and `coverage-gaps`.
 * M6 T17 adds riskRules + riskLevels: trivial→bugs-only, standard→bugs+quality+coverage,
 * full→all four + security (security-always on sensitive paths, PRD R4/#9).
 * M6 T18 adds the phases.review config-slice validator: specialist enable/disable, maxFindings,
 * verify.voters, coordinator on/off — parsed from ctx.config at run time (TDD F · PRD R10).
 *
 * PRD refs: §R1 (activation), §R3 (specialist panel), §R4/#9 (security-always), §R5 (verify),
 *           §R7 (conventions), §R8 (noise control), §R10 (config slice).
 * TDD refs: D (specialist wiring), A·2 (verify lenses), E (risk classifier rules), F (config slice).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { SpecialistSubmission } from "../../schema/finding.js";
import { SUBMIT_TOOL_NAME } from "../../agent/submit-tool.js";
import { FIVE_MINUTE_BUDGETS } from "../../agent/budgets.js";
import type { AgentRunner } from "../../agent/runner.js";
import type { PhaseConfiguration, PhaseContext, ActivationContext } from "../types.js";
import { makeCompositePhase, type SpecialistConfig, type RiskLevel } from "../composite.js";
import type { VerifyConfig } from "../verify.js";
import type { RiskRule } from "../../risk/classify.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-specialist finding cap (R8 — config-overridable in M6). Substituted into rubric text. */
export const MAX_FINDINGS = 5;

// ---------------------------------------------------------------------------
// Risk classification (TDD E · PRD R4/#9)
// ---------------------------------------------------------------------------

/**
 * Line-count thresholds for review risk classification (plan §M6 step 1, TDD E).
 * Placeholder values — config-overridable and eval-tuned in later iterations.
 *
 *  ≤ TRIVIAL_LINES  → "trivial" (small, low-risk diffs)
 *  > FULL_LINES     → "full"    (large diffs; same panel as sensitive paths)
 *  otherwise        → "standard"
 */
const TRIVIAL_LINES = 200;
const FULL_LINES = 500;

/**
 * Directory names that make any touching path "sensitive" (TDD E · PRD R4/#9).
 * A path segment that exactly matches one of these triggers the "full" level —
 * ensuring security always runs even on small diffs that touch these directories.
 */
const SENSITIVE_DIRS = new Set(["auth", "migrations", "certs", "keys", "secrets", "credentials"]);

/**
 * Substrings that make a path component sensitive when present.
 * Catches names like "crypto.ts", "cryptography/", "session-store.ts", "token-manager.ts".
 */
const SENSITIVE_SUBSTRINGS = ["crypto", "crypt", "session", "token", "private", "credential"];

/** Returns true if any segment of the path touches a security-sensitive area. */
function isSensitivePath(path: string): boolean {
  return path
    .toLowerCase()
    .split("/")
    .some(
      (part) => SENSITIVE_DIRS.has(part) || SENSITIVE_SUBSTRINGS.some((sub) => part.includes(sub)),
    );
}

/**
 * Risk rules for the review phase (TDD E · PRD R4/#9).
 * Evaluated in order by classify(); first match wins.
 *
 * Level semantics (see REVIEW_RISK_LEVELS):
 *   trivial  — bugs only, coordinator off (small safe diffs)
 *   standard — bugs + quality + coverage-gaps, coordinator on
 *   full     — all four specialists including security, coordinator on
 *
 * PRD R4: security always runs on sensitive paths.
 * Encoded as the FIRST rule: any sensitive path immediately resolves to "full",
 * regardless of diff size. This is the "security-always override" the TDD calls
 * "a per-level override, not a threshold."
 */
export const REVIEW_RISK_RULES: RiskRule[] = [
  // 1. Sensitive paths always → full (security-always, PRD R4/#9)
  {
    predicate: (_diff, paths) => paths.some(isSensitivePath),
    level: "full",
  },
  // 2. Large diff → full (all specialists)
  {
    predicate: (diff) => diff.split("\n").length > FULL_LINES,
    level: "full",
  },
  // 3. Medium diff → standard
  {
    predicate: (diff) => diff.split("\n").length > TRIVIAL_LINES,
    level: "standard",
  },
  // 4. Small diff with no sensitive paths → trivial (catch-all)
  {
    predicate: () => true,
    level: "trivial",
  },
];

/**
 * Risk level → specialist subset + coordinator on/off for the review phase (TDD E).
 *
 * trivial  — bugs only, coordinator false.
 *   Cheapest review for small, low-risk diffs. Coordinator is skipped because a
 *   single specialist produces no cross-specialist duplicates to dedup/rerank.
 *
 * standard — bugs + quality + coverage-gaps, coordinator on (when configured).
 *   Security absent: sensitive paths already upgrade to full via the first risk rule.
 *
 * full     — all four specialists, coordinator on.
 *   Triggered by large diffs OR any sensitive path. "security-always" is encoded
 *   here: full specialists = undefined (all run), and the first rule fires on
 *   sensitive paths to guarantee full is always the resolved level for them.
 */
export const REVIEW_RISK_LEVELS: Record<string, RiskLevel> = {
  trivial: {
    specialists: ["bugs"],
    coordinator: false,
  },
  standard: {
    specialists: ["bugs", "quality", "coverage-gaps"],
  },
  full: {
    // No specialist restriction — all four run (undefined = full panel).
    // Security is included here, which is the "security-always on sensitive paths" guarantee.
  },
};

// ---------------------------------------------------------------------------
// Config slice (TDD F · PRD R10 · T18)
// ---------------------------------------------------------------------------

const ReviewSpecialistEntry = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    maxFindings: Type.Optional(Type.Number({ minimum: 1 })),
    model: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

/**
 * TypeBox schema for the `phases.review` config slice (TDD F · PRD R10).
 *
 * The `phases` record in StetConfig is `Type.Unknown()` at the seam — each phase
 * validates its own slice here. This schema is permissive (additionalProperties: true)
 * for forward-compat; unknown keys pass through without error.
 *
 * specialists.<name>.enabled = false → specialist is dropped from the panel.
 * coordinator = false → coordinator is forced off at every risk level.
 * verify.voters and maxFindings are parsed for future use (not yet wired to behavior
 * because voters must match lenses count, which is resolved in a later milestone).
 */
export const ReviewConfigSchema = Type.Object(
  {
    specialists: Type.Optional(Type.Record(Type.String(), ReviewSpecialistEntry)),
    maxFindings: Type.Optional(Type.Number({ minimum: 1 })),
    verify: Type.Optional(
      Type.Object(
        { voters: Type.Optional(Type.Number({ minimum: 1 })) },
        { additionalProperties: true },
      ),
    ),
    coordinator: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

export type ReviewConfig = Static<typeof ReviewConfigSchema>;

/**
 * Parse the `phases.review` config slice from an unknown ctx.config value.
 * Returns an empty ReviewConfig (all defaults) when the slice is absent or invalid.
 * Validation is permissive — an invalid shape falls back to defaults rather than erroring,
 * because the CLI already reports ConfigError for schema-invalid config files.
 */
export function parseReviewConfig(config: unknown): ReviewConfig {
  if (Value.Check(ReviewConfigSchema, config)) return config;
  return {};
}

// ---------------------------------------------------------------------------
// Rubric text (data — tuned against the eval in M5, not design-perfected here)
// ---------------------------------------------------------------------------

/**
 * Shared preamble prepended to every specialist rubric.
 * Source: code-review-rubric-draft.md §Shared preamble.
 */
const SHARED_PREAMBLE = `\
You are an INDEPENDENT code reviewer inside stet, a change-validation tool. You do not trust the
author's claims; you judge the change yourself. You are READ-ONLY: you report findings, you never
fix, edit, or write. You have no write tools by design.

SCOPE
- Review only the change introduced by THIS diff (the net diff against the merge base).
- Do not flag pre-existing code that this diff did not touch — UNLESS it is directly re-exposed by
  the change, in which case tag it severity-appropriately and note it is pre-existing, not
  introduced here.

EVIDENCE BAR (the most important rule)
- Flag something only if you can explain why it is a problem with a CONCRETE failure scenario:
  a specific input, state, timing, or platform that produces a wrong outcome.
- If you cannot construct that scenario, DO NOT flag it. Prefer not reporting over guessing.
- Be thorough on bugs and security. For lower-severity issues, be certain before flagging.

PARTIAL-CONTEXT HONESTY (you are often shown a budget-trimmed diff)
- Symbols may be defined outside what you can see. Do not flag "undefined", "missing import", or
  "unused" for things that may exist elsewhere — read the surrounding files to check before flagging.
- If the shown code ends mid-construct (e.g. an open brace), do not treat it as incomplete.
- Do not claim this change breaks other code unless you can identify the specific affected call site.

DO NOT FLAG (these are noise — never report them):
- package/dependency version changes; adding or removing imports; declaring or removing unused variables
- "use a more specific exception type"; adding docstrings, type hints, or comments
- pure style, formatting, or naming preferences
- restating a change the diff already makes
- generic "add input validation" without a proven, reachable impact path
- denial-of-service / rate-limiting / resource-exhaustion concerns (out of scope unless told otherwise)

CONVENTIONS
- Respect the repo's CLAUDE.md / convention files. When you flag a convention violation, quote the
  exact rule and the exact line that breaks it. No "spirit of the doc" inferences.

OUTPUT
- Submit findings via the submit tool in the stet Finding schema. An EMPTY list is a valid, good result.
- Fewer, higher-confidence findings beat an exhaustive list. Cap: <= ${MAX_FINDINGS} findings.
- Set severity (error|warning|info) honestly; every finding must carry its concrete failure scenario
  in the message (and a reproducing command in evidence when you have one).`;

/**
 * Bugs-specialist focus rubric.
 * Source: code-review-rubric-draft.md §Specialist: correctness / bugs.
 * Severity ceiling: error (bugs may emit up to error severity — PRD §R3, TDD D).
 */
const BUGS_FOCUS = `\
FOCUS: correctness defects only. Inverted/wrong conditions, off-by-one, null/undefined deref,
missing await / unhandled promise, falsy-zero checks, wrong-variable copy-paste, swallowed errors,
race conditions, unhandled edge cases (empty input, root commit, oversize/over-budget input, unusual
formats), regex pitfalls (unescaped metachars, lost anchors, catastrophic backtracking).

For each hunk, also read the enclosing function — a bug in an unchanged line of a touched function
is in scope. State the input/state -> wrong outcome explicitly.
Default severity: error for a crash/wrong result on a reachable path; warning for a narrow edge;
info for a latent risk.`;

/**
 * Security-specialist focus rubric.
 * Source: code-review-rubric-draft.md §Specialist: security.
 * Severity ceiling: error (security may emit up to error severity — PRD §R3, TDD D).
 */
const SECURITY_FOCUS = `\
FOCUS: security defects with a concrete, reachable exploit path. Injection (shell/SQL/command), git/CLI
option injection (args beginning with "-" reaching a subprocess), path traversal, prototype pollution,
unsafe deserialization, secret leakage, SSRF.

KEY PRECEDENTS (do not flag these as vulns):
- Framework escaping is on by default (e.g. React/Angular safe from XSS unless dangerouslySetInnerHTML).
- Environment variables and CLI flags are trusted input.
- Findings in test files / fixtures / markdown are not production vulnerabilities.
Require an attacker-input -> impact scenario. If reachability depends on a caller passing untrusted
input, say so in the finding's explanation.
Default severity: error for a reachable exploit; warning for a defensive/hardening gap with no
current reachable path.`;

/**
 * Quality/maintainability-specialist focus rubric.
 * Source: code-review-rubric-draft.md §Specialist: performance & quality / maintainability.
 * Severity ceiling: warning (quality NEVER emits error — PRD §R3, TDD D).
 */
const QUALITY_FOCUS = `\
FOCUS: concrete, costly maintainability or efficiency problems introduced by THIS change.
Re-implementing an existing helper (grep the repo to confirm it exists, name it), redundant or
derivable state, copy-paste with slight variation, dead code, wrong-altitude abstractions (special
cases bolted onto shared infra), wasted work added to a hot path or startup, closures that retain
large scopes.

State the concrete cost (what is duplicated/wasted/harder to change) and the simpler form.
NOT taste: no naming/formatting opinions. This specialist NEVER emits error — warning is the maximum.
Default severity: warning at most; info for minor.`;

/**
 * Coverage-gaps-specialist focus rubric.
 * Source: code-review-rubric-draft.md §Specialist: coverage-gaps.
 * Severity ceiling: warning (coverage-gaps NEVER emits error — PRD §R3, TDD D).
 */
const COVERAGE_FOCUS = `\
FOCUS: new or changed BEHAVIOR/branches that this diff's tests do not exercise, risk-weighted.
Especially error paths, edge cases, and boundaries. Also judge whether added tests would actually
FAIL if the code were wrong, or merely mirror the implementation (tautological/mock-only assertions).

Only flag genuine gaps — do not demand tests for trivial/obvious code. Name the specific untested
branch and the regression risk if it changes. This specialist NEVER emits error — warning is the
maximum.
Default severity: warning for an untested error/edge path in risky code; info otherwise.`;

// ---------------------------------------------------------------------------
// Specialist configs
// ---------------------------------------------------------------------------

/** Shared user-prompt builder used by all four specialists. */
function buildReviewUserPrompt(ctx: Parameters<SpecialistConfig["buildUserPrompt"]>[0]): string {
  const files = ctx.scope.files.join("\n  - ");
  const parts: string[] = [`Changed files:\n  - ${files}`, `Working directory: ${ctx.cwd}`];
  if (ctx.diff) parts.push(`Diff:\n${ctx.diff}`);
  return parts.join("\n\n");
}

/**
 * `bugs` SpecialistConfig (plan M4 step 2 · TDD D).
 *
 * - submitSchema = SpecialistSubmission: no confidence/specialist/phase — all harness-stamped
 *   (TDD B·1). When wired to a real model, the agent submits without confidence; verify stamps it.
 * - severityCeiling = "error": may emit up to error severity (TDD D).
 * - maxFindings = 5: per-specialist cap communicated via the rubric (R8).
 * - 3 verify lenses supplied via REVIEW_VERIFY_CONFIG (plan M4 step 2).
 */
export const BUGS_SPECIALIST: SpecialistConfig = {
  name: "bugs",
  rubric: `${SHARED_PREAMBLE}\n\n${BUGS_FOCUS}`,
  toolset: ["read", "grep", "find", "ls", "bash", SUBMIT_TOOL_NAME],
  submitSchema: SpecialistSubmission,
  budgets: FIVE_MINUTE_BUDGETS,
  severityCeiling: "error",
  maxFindings: MAX_FINDINGS,
  buildUserPrompt: buildReviewUserPrompt,
};

/**
 * `security` SpecialistConfig (plan M5 · TDD D · PRD R3).
 *
 * - severityCeiling = "error": security exploits may be gating (PRD §R3, TDD D).
 * - Same read+bash toolset as bugs — security needs to trace code paths.
 */
export const SECURITY_SPECIALIST: SpecialistConfig = {
  name: "security",
  rubric: `${SHARED_PREAMBLE}\n\n${SECURITY_FOCUS}`,
  toolset: ["read", "grep", "find", "ls", "bash", SUBMIT_TOOL_NAME],
  submitSchema: SpecialistSubmission,
  budgets: FIVE_MINUTE_BUDGETS,
  severityCeiling: "error",
  maxFindings: MAX_FINDINGS,
  buildUserPrompt: buildReviewUserPrompt,
};

/**
 * `quality` SpecialistConfig (plan M5 · TDD D · PRD R3).
 *
 * - severityCeiling = "warning": quality/maintainability issues never gate on error (TDD D).
 * - Read-only toolset (no bash): quality analysis is syntactic, no subprocess needed.
 */
export const QUALITY_SPECIALIST: SpecialistConfig = {
  name: "quality",
  rubric: `${SHARED_PREAMBLE}\n\n${QUALITY_FOCUS}`,
  toolset: ["read", "grep", "find", "ls", SUBMIT_TOOL_NAME],
  submitSchema: SpecialistSubmission,
  budgets: FIVE_MINUTE_BUDGETS,
  severityCeiling: "warning",
  maxFindings: MAX_FINDINGS,
  buildUserPrompt: buildReviewUserPrompt,
};

/**
 * `coverage-gaps` SpecialistConfig (plan M5 · TDD D · PRD R3).
 *
 * - severityCeiling = "warning": missing tests never gate on error (TDD D).
 * - Read-only toolset (no bash): gap analysis reads existing tests, no subprocess needed.
 */
export const COVERAGE_SPECIALIST: SpecialistConfig = {
  name: "coverage-gaps",
  rubric: `${SHARED_PREAMBLE}\n\n${COVERAGE_FOCUS}`,
  toolset: ["read", "grep", "find", "ls", SUBMIT_TOOL_NAME],
  submitSchema: SpecialistSubmission,
  budgets: FIVE_MINUTE_BUDGETS,
  severityCeiling: "warning",
  maxFindings: MAX_FINDINGS,
  buildUserPrompt: buildReviewUserPrompt,
};

/**
 * The full review specialist panel (M5 T15) — the single source of truth for which
 * specialists the review phase fans out to. `makeReviewPhase` fans these out and
 * `makeReviewRunners` builds one runner per name, so the two can never drift.
 */
export const REVIEW_SPECIALISTS: readonly SpecialistConfig[] = [
  BUGS_SPECIALIST,
  SECURITY_SPECIALIST,
  QUALITY_SPECIALIST,
  COVERAGE_SPECIALIST,
];

/**
 * Build the runner map `makeReviewPhase` requires: one runner per panel specialist
 * (keyed by specialist name, which is how the composite looks runners up) plus the
 * "verify" voter. Derived from REVIEW_SPECIALISTS, so adding a specialist there
 * automatically extends the map — the CLI and tests both build through here, which is
 * what guarantees the map can never miss a specialist the phase fans out to (the M5
 * regression where the CLI supplied only "bugs"+"verify" and the composite threw
 * `No runner provided for specialist "security"`).
 */
export function makeReviewRunners(make: () => AgentRunner): Record<string, AgentRunner> {
  const runners: Record<string, AgentRunner> = { verify: make() };
  for (const s of REVIEW_SPECIALISTS) runners[s.name] = make();
  return runners;
}

// ---------------------------------------------------------------------------
// Verify config
// ---------------------------------------------------------------------------

/**
 * Agreement-verify config for the review phase (plan M4 step 2 · TDD A·2 / PRD R5).
 *
 * 3 independent refutation lenses (1 per voter), each probing a distinct failure mode:
 *   1. Reproduction/soundness — can you construct the concrete scenario?
 *   2. Partial-context skepticism — could the cited code be guarded elsewhere?
 *   3. Scope/blocklist — does this fall into a DO-NOT-FLAG category?
 *
 * agreementForHigh = 3 (all 3 uphold → high confidence, PRD C1 / R5).
 * agreementForMedium = 2 (2 of 3 uphold → medium).
 * ≤1 uphold → dropped.
 */
export const REVIEW_VERIFY_CONFIG: VerifyConfig = {
  voters: 3,
  lenses: [
    "Reproduction/soundness: Can you construct a concrete failing input, state, or timing for " +
      "this exact finding? If the scenario is hypothetical, requires unusual conditions, or you " +
      "cannot construct it from what is shown, refute.",
    "Partial-context skepticism: Could the cited symbol, behavior, or guard be defined or handled " +
      "in code not shown (imported module, helper function, later file, or test fixture)? If you " +
      "cannot rule this out without reading those files, refute — unless the finding cites the " +
      "specific missing call site.",
    "Scope/blocklist check: Does this finding fall into one of the DO-NOT-FLAG categories — " +
      "package/dependency version changes, adding or removing imports, unused variable declarations, " +
      '"use a more specific exception type", docstrings/type hints/comments, pure style/formatting/' +
      "naming preferences, restating the diff, generic add-validation without a reachable path, " +
      "or DoS/rate-limiting/resource-exhaustion? If yes, refute.",
  ],
  agreementForHigh: 3,
  agreementForMedium: 2,
};

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Review phase activates when the scope contains ≥1 reviewable file (PRD R1).
 * After M8 pre-filtering, scope.files excludes stripped lockfiles/vendored/generated,
 * so any non-empty files array means reviewable code exists.
 */
function reviewActivation(ctx: ActivationContext): boolean {
  return ctx.scope.files.length > 0;
}

// ---------------------------------------------------------------------------
// Phase factory
// ---------------------------------------------------------------------------

/**
 * Build the review phase configuration (full panel — M5 T15 · config slice — M6 T18).
 *
 * All 4 specialists (bugs, security, quality, coverage-gaps) fan out in parallel.
 * `runners` must contain entries for "bugs", "security", "quality", and "coverage-gaps".
 * When verify is configured, `runners["verify"]` must also be present.
 *
 * Per-run config (T18): ctx.config is parsed as a `phases.review` slice on each run.
 * specialists.<name>.enabled = false → specialist is dropped from that run's panel.
 * coordinator = false → coordinator is forced off at every risk level for that run.
 *
 * `model` is the pre-M6 stopgap (plan §2a/P10): the CLI passes `process.env.PI_TEST_MODEL`.
 * When falsy (undefined or empty string) → creds gate fires: the phase immediately reports
 * status "error" / "no model available", never completed+empty (AC#8 / plan M4 step 5 F3).
 * M6 routing will replace this parameter with a resolved model from the routing layer.
 *
 * For unit tests, pass FakeAgentRunners scripted to return { findings: Finding[] } and
 * any non-undefined string as `model` (FakeAgentRunner ignores the model field).
 */
export function makeReviewPhase(
  runners: Record<string, AgentRunner>,
  model?: string,
): PhaseConfiguration {
  // Creds gate (AC#8 / plan M4 step 5 F3): no model → immediate error phase.
  // The composite phase rolls up specialist failures as "completed" (it never forfeits
  // other specialists' findings); that would yield completed+empty when all specialists
  // fail with ModelError. This wrapper short-circuits before the composite runs.
  // Gate on falsiness, not strict-undefined: an empty PI_TEST_MODEL (e.g. `PI_TEST_MODEL=`
  // or CI expanding an unset variable) is just as much "no model" — it would otherwise reach
  // the specialist runner, fail with ModelError, and roll up as the forbidden completed+empty.
  if (!model) {
    return {
      id: "review",
      kind: "agent",
      toolset: BUGS_SPECIALIST.toolset,
      activation: reviewActivation,
      async run(_ctx: PhaseContext) {
        return {
          phase: "review",
          status: "error" as const,
          reason:
            "no model available — set PI_TEST_MODEL (pre-M6 stopgap) or configure model routing (M6)",
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        };
      },
    };
  }

  // Pre-compute the full toolset across all specialists. toolset is declared at
  // construction time (before per-run config is known), so it must be the union of
  // all possible specialists — the mutation-free invariant is on the declared set,
  // not the dynamically-filtered subset.
  const fullToolset = [...new Set(REVIEW_SPECIALISTS.flatMap((s) => s.toolset))];

  return {
    id: "review",
    kind: "agent",
    toolset: fullToolset,
    activation: reviewActivation,
    // The scheduler trims the diff to DIFF_BUDGET and emits a review.partial-coverage
    // warning naming excluded files before this phase runs (no silent truncation).
    // Caveat: the inner risk classifier (composite.ts, finding 6) reads ctx.diff and so
    // sees the trimmed diff. Safe today — review's risk rules are path/line-count based,
    // not content-pattern based — but a future content-scanning review risk rule would
    // need the untrimmed diff and must not rely on the classifier seeing it here.
    consumesDiff: true,

    async run(ctx: PhaseContext) {
      const reviewCfg = parseReviewConfig(ctx.config);

      // Filter specialists: specialists.<name>.enabled === false → drop from panel.
      const enabledSpecialists = REVIEW_SPECIALISTS.filter(
        (s) => reviewCfg.specialists?.[s.name]?.enabled !== false,
      );

      // Adjust risk level specialist subsets to only reference enabled specialists.
      // This keeps validateRiskConfig inside makeCompositePhase from throwing when a
      // subset entry names a specialist that the config has disabled.
      const enabledNames = new Set(enabledSpecialists.map((s) => s.name));
      const adjustedRiskLevels: Record<string, RiskLevel> = {};
      for (const [level, levelCfg] of Object.entries(REVIEW_RISK_LEVELS)) {
        const adjusted: RiskLevel = {
          ...levelCfg,
          specialists: levelCfg.specialists?.filter((name) => enabledNames.has(name)),
        };
        // coordinator: false in user config → force coordinator off at every risk level.
        if (reviewCfg.coordinator === false) {
          adjusted.coordinator = false;
        }
        adjustedRiskLevels[level] = adjusted;
      }

      let composite: PhaseConfiguration;
      try {
        composite = makeCompositePhase(runners, {
          id: "review",
          specialists: enabledSpecialists.map((s) => ({ ...s, model })),
          verify: { ...REVIEW_VERIFY_CONFIG, model },
          riskRules: REVIEW_RISK_RULES,
          riskLevels: adjustedRiskLevels,
          activation: reviewActivation,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          phase: "review" as const,
          status: "error" as const,
          reason: `review config error: ${reason}`,
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        };
      }

      return composite.run(ctx);
    },
  };
}
