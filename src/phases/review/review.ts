/**
 * review phase — bugs specialist + phase factory (M4 thin slice, T13).
 *
 * Implements plan §M4 steps 2,3 · TDD D · code-review-rubric-draft.md.
 * M4 ships the `bugs` specialist only; `security`, `quality`, and `coverage-gaps`
 * are added in M5 (T15).
 *
 * PRD refs: §R1 (activation), §R3 (specialist panel), §R5 (verify), §R8 (noise control).
 * TDD refs: D (specialist wiring), A·2 (verify lenses).
 */

import { SpecialistSubmission } from "../../schema/finding.js";
import { SUBMIT_TOOL_NAME } from "../../agent/submit-tool.js";
import { FIVE_MINUTE_BUDGETS } from "../../agent/budgets.js";
import type { AgentRunner } from "../../agent/runner.js";
import type { PhaseConfiguration, PhaseContext, ActivationContext } from "../types.js";
import { makeCompositePhase, type SpecialistConfig } from "../composite.js";
import type { VerifyConfig } from "../verify.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-specialist finding cap (R8 — config-overridable in M6). Substituted into rubric text. */
export const MAX_FINDINGS = 5;

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

// ---------------------------------------------------------------------------
// Specialist configs
// ---------------------------------------------------------------------------

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
  buildUserPrompt: (ctx) => {
    const files = ctx.scope.files.join("\n  - ");
    const parts: string[] = [`Changed files:\n  - ${files}`, `Working directory: ${ctx.cwd}`];
    if (ctx.diff) parts.push(`Diff:\n${ctx.diff}`);
    return parts.join("\n\n");
  },
};

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
 * Build the review phase configuration.
 *
 * M4 thin slice: bugs specialist only. M5 (T15) adds security, quality, coverage-gaps.
 *
 * `runners` must contain an entry for "bugs".
 * When verify is configured, `runners["verify"]` must also be present.
 * When coordinator is configured, `runners["coordinator"]` must be present.
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

  return makeCompositePhase(runners, {
    id: "review",
    specialists: [{ ...BUGS_SPECIALIST, model }],
    verify: { ...REVIEW_VERIFY_CONFIG, model },
    activation: reviewActivation,
  });
}
