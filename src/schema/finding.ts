/**
 * Finding and supporting schemas.
 *
 * Implements the Finding contract from the harness PRD §4.2.
 * PhaseId is an open identifier per decision #28 — a kebab-case pattern,
 * NOT a closed enum, so that adding a new phase never requires a schema edit.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** Open phase identifier — kebab-case, not a closed enum (decision #28, PRD §4.1). */
export const PhaseId = Type.String({
  pattern: "^[a-z][a-z0-9-]*$",
  description:
    "Open kebab-case phase identifier. Built-in set: gates, spec, review, test-quality, behavioral. " +
    '"harness" is reserved for harness-emitted findings and cannot name a real phase.',
});

/**
 * Reserved phase id for findings the harness itself emits (config-load warnings,
 * and future harness-level sources like partial-coverage). The CLI injects a
 * synthetic PhaseReport under this id and rejects any real phase that claims it —
 * the RunReport contract is "one entry per configured phase" (PRD §4.5).
 */
export const HARNESS_PHASE_ID = "harness";

/** The gating severity vocabulary (PRD §4.2, decision #1). */
export const Severity = Type.Union([
  Type.Literal("error"),
  Type.Literal("warning"),
  Type.Literal("info"),
]);

/** AI judgment confidence level (PRD §4.6). */
export const Confidence = Type.Union([
  Type.Literal("high"),
  Type.Literal("medium"),
  Type.Literal("low"),
]);

/**
 * A single finding emitted by a phase or the harness.
 * PRD §4.2. additionalProperties: false at top level (versioned wire contract);
 * meta is open by design (§4.2 — phase-specific extension).
 */
export const Finding = Type.Object(
  {
    /** Stable rule id, phase-namespaced: e.g. "gates.test-failed", "review.bug". */
    id: Type.String(),
    /** The phase this finding belongs to. */
    phase: PhaseId,
    /** Composite phases: which specialist emitted this finding. */
    specialist: Type.Optional(Type.String()),
    severity: Severity,
    confidence: Confidence,
    /** What is wrong, stated against what it violates. */
    message: Type.String(),
    /** Source location. */
    location: Type.Optional(
      Type.Object(
        {
          file: Type.String(),
          line: Type.Optional(Type.Number()),
          endLine: Type.Optional(Type.Number()),
        },
        { additionalProperties: false },
      ),
    ),
    /** Executable evidence. A Phase 5 failed finding MUST carry the reproducing command here. */
    evidence: Type.Optional(
      Type.Object(
        {
          command: Type.Optional(Type.String()),
          output: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    /** Suggested next action (from the POC: suggested_next_action). */
    suggestion: Type.Optional(Type.String()),
    /**
     * Phase-specific extension. Open by design (PRD §4.2) — e.g. Phase 5 carries
     * meta.priority: "critical"|"high"|"medium"|"low" for finer granularity without
     * a second gating vocabulary.
     */
    meta: Type.Optional(Type.Object({}, { additionalProperties: true })),
  },
  { additionalProperties: false },
);

// Same-name value+type merging (idiomatic TypeBox): the schema object and its
// static type share the PRD's name, so code reads like the contract.
export type PhaseId = Static<typeof PhaseId>;
export type Severity = Static<typeof Severity>;
export type Confidence = Static<typeof Confidence>;
export type Finding = Static<typeof Finding>;

/**
 * Parse and validate the `findings` array out of an agent submission payload.
 *
 * Returns the typed `Finding[]` when the submission is an object whose `findings`
 * property is an array of values that each satisfy the {@link Finding} schema.
 *
 * Returns `null` on ANY validation failure — a non-object submission, a missing or
 * non-array `findings`, or any element that fails `Value.Check(Finding, …)`. Callers
 * treat a `null` as "invalid submission contributes no findings" (typically via
 * `parseFindings(submission) ?? []`) so a malformed payload is silently skipped
 * rather than aborting the roll-up.
 */
export function parseFindings(submission: unknown): Finding[] | null {
  if (
    typeof submission !== "object" ||
    submission === null ||
    !Array.isArray((submission as Record<string, unknown>).findings)
  ) {
    return null;
  }
  const raw = (submission as Record<string, unknown>).findings as unknown[];
  const result: Finding[] = [];
  for (const item of raw) {
    if (!Value.Check(Finding, item)) return null;
    result.push(item as Finding);
  }
  return result;
}
