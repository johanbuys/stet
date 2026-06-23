/**
 * Report schemas: Check, Audit, Cost, PhaseReport, RunReport, and parseRunReport.
 *
 * Implements the contracts from harness PRD §4.3 (Check, Audit), §4.4 (Cost, PhaseReport),
 * and §4.5 (RunReport). All top-level objects enforce additionalProperties: false — the
 * RunReport is a versioned wire contract. parseRunReport returns Result<RunReport, SchemaError>
 * and never throws.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { SchemaError } from "../errors.js";
import { Finding, PhaseId, Severity } from "./finding.js";
import { Scope } from "./scope.js";
import { collectSchemaErrors } from "./validation.js";

// ---------------------------------------------------------------------------
// Check (PRD §4.3)
// ---------------------------------------------------------------------------

/**
 * A concrete command run during a phase, part of the audit trail.
 * PRD §4.3.
 */
export const Check = Type.Object(
  {
    name: Type.String(),
    type: Type.String(),
    command: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Literal("blocked"),
      Type.Literal("skipped"),
    ]),
    evidence: Type.String(),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Audit (PRD §4.3)
// ---------------------------------------------------------------------------

/**
 * A single voter verdict from the agreement-verify stage (TDD A·2).
 * Emitted via the submit_verdict tool; recorded in VerifyAudit.dropped entries.
 */
export const VoterVerdict = Type.Object(
  {
    verdict: Type.Union([Type.Literal("uphold"), Type.Literal("refute"), Type.Literal("abstain")]),
    reason: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * Harness-computed verify summary for composite phases that ran agreement-verify (TDD A·4).
 * Separate from CoordinatorAudit so mechanical agreement-drops read distinctly from judgment-drops.
 */
export const VerifyAudit = Type.Object(
  {
    /** Number of candidate findings submitted to verify. */
    received: Type.Number(),
    /** Candidates dropped by the agreement threshold (upholds ≤ 1/3); each records per-voter verdicts. */
    dropped: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          specialist: Type.Optional(Type.String()),
          /** Count of uphold verdicts across N voters. */
          upholds: Type.Number(),
          verdicts: Type.Array(VoterVerdict),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/**
 * Audit trail for a phase — the anti-silent-green mechanism.
 * PRD §4.3. coordinator sub-object is harness-computed, never judge-self-reported.
 */
export const Audit = Type.Object(
  {
    examined: Type.Optional(Type.Array(Type.String())),
    checks: Type.Optional(Type.Array(Check)),
    claims: Type.Optional(
      Type.Object(
        {
          derived: Type.Array(Type.String()),
          proven: Type.Array(Type.String()),
          unproven: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
    /** Harness-computed agreement-verify summary (TDD A·4); separate from coordinator audit. */
    verify: Type.Optional(VerifyAudit),
    /** Harness-computed coordinator summary for composite phases that ran a judge (PRD §3.3a, #31). */
    coordinator: Type.Optional(
      Type.Object(
        {
          /** Number of findings in the raw specialist roll-up before the judge ran. */
          received: Type.Number(),
          /** Roll-up minus survivors — findings the coordinator dropped (#31). */
          dropped: Type.Array(
            Type.Object(
              {
                id: Type.String(),
                specialist: Type.Optional(Type.String()),
                message: Type.String(),
              },
              { additionalProperties: false },
            ),
          ),
          /** Protected findings the judge tried to drop/downgrade, reinstated by the harness (#30). */
          reinstated: Type.Array(
            Type.Object(
              {
                id: Type.String(),
                specialist: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Cost (PRD §4.4)
// ---------------------------------------------------------------------------

/**
 * Token and duration cost for a model run.
 * PRD §4.4. Used for both top-level and per-specialist/coordinator sub-entries.
 */
export const Cost = Type.Object(
  {
    model: Type.Optional(Type.String()),
    inputTokens: Type.Optional(Type.Number()),
    outputTokens: Type.Optional(Type.Number()),
    durationMs: Type.Number(),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// PhaseReport (PRD §4.4)
// ---------------------------------------------------------------------------

/**
 * Cost for a phase — implements `Cost & { specialists?, coordinator? }` from PRD §4.4.
 *
 * NOTE on TypeBox Intersect vs Object: TypeBox's `Type.Intersect` with `additionalProperties: false`
 * on each member is mutually exclusive at runtime — the second member rejects all properties from
 * the first as "unexpected". The PRD expresses PhaseCost as a type intersection (`Cost & {...}`),
 * and TypeBox models this faithfully with a flat Object that merges all properties under one
 * `additionalProperties: false`. The TypeScript static type is identical to the intersected form.
 */
export const PhaseCost = Type.Object(
  {
    model: Type.Optional(Type.String()),
    inputTokens: Type.Optional(Type.Number()),
    outputTokens: Type.Optional(Type.Number()),
    durationMs: Type.Number(),
    /** Composite phases: per-specialist cost breakdown. */
    specialists: Type.Optional(Type.Record(Type.String(), Cost)),
    /** Coordinator judge pass cost (§3.3a), when one ran. */
    coordinator: Type.Optional(Cost),
  },
  { additionalProperties: false },
);

/**
 * Report from a single phase. Always present in RunReport.phases — skipped and cancelled
 * phases are included with reason named.
 * PRD §4.4.
 */
export const PhaseReport = Type.Object(
  {
    phase: PhaseId,
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("skipped"),
      Type.Literal("cancelled"),
      Type.Literal("error"),
    ]),
    /** Required for skipped | cancelled | error. */
    reason: Type.Optional(Type.String()),
    /** Risk level resolved by the classifier (§3.4.1a). Present when riskRules are declared. */
    level: Type.Optional(Type.String()),
    findings: Type.Array(Finding),
    audit: Audit,
    cost: PhaseCost,
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// RunReport (PRD §4.5)
// ---------------------------------------------------------------------------

/**
 * The aggregate run report — the versioned wire contract.
 * PRD §4.5. additionalProperties: false at top level.
 */
export const RunReport = Type.Object(
  {
    /** Schema version. Bumped on breaking change. */
    version: Type.Literal(1),
    /** Semver of the producing binary (decision #23). */
    stet: Type.String(),
    /** Run start, ISO-8601 UTC (decision #23). */
    startedAt: Type.String(),
    /** Single source of truth: src/schema/scope.ts (PRD §4.5, decision #33). */
    scope: Scope,
    spec: Type.Object(
      {
        provided: Type.Boolean(),
        sources: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
    /** One entry per configured phase, always — skipped/cancelled phases included with reasons. */
    phases: Type.Array(PhaseReport),
    result: Type.Object(
      {
        exitCode: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
        failOn: Severity,
        /** Exactly which findings caused exit 1. */
        gating: Type.Array(
          Type.Object(
            {
              phase: PhaseId,
              id: Type.String(),
              message: Type.String(),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    cost: Type.Object(
      {
        totalInputTokens: Type.Number(),
        totalOutputTokens: Type.Number(),
        durationMs: Type.Number(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

// Same-name value+type merging (idiomatic TypeBox): the schema object and its
// static type share the PRD's name, so code reads like the contract.
export type Check = Static<typeof Check>;
export type VoterVerdict = Static<typeof VoterVerdict>;
export type VerifyAudit = Static<typeof VerifyAudit>;
export type Audit = Static<typeof Audit>;
export type Cost = Static<typeof Cost>;
export type PhaseCost = Static<typeof PhaseCost>;
export type PhaseReport = Static<typeof PhaseReport>;
export type RunReport = Static<typeof RunReport>;

// ---------------------------------------------------------------------------
// Validation function — never throws (better-result discipline)
// ---------------------------------------------------------------------------

/**
 * Validate and parse an unknown value as a RunReport.
 *
 * Returns Ok<RunReport> on success, Err<SchemaError> on failure.
 * Never throws. Uses TypeBox Value.Check / Value.Errors for runtime validation.
 *
 * PRD §4.5; error handling: CLAUDE.md better-result discipline.
 */
export function parseRunReport(value: unknown): Result<RunReport, SchemaError> {
  if (!Value.Check(RunReport, value)) {
    const { details, errors } = collectSchemaErrors(RunReport, value, 5);
    return Result.err(
      new SchemaError({
        message: `RunReport validation failed — ${details}`,
        errors,
      }),
    );
  }
  return Result.ok(value);
}

// ---------------------------------------------------------------------------
// Synthetic phase reports
// ---------------------------------------------------------------------------

/**
 * Build a PhaseReport for a phase that did not actually run: scheduler-synthesized
 * skipped/cancelled entries and the harness's own config-warning entry. One factory
 * so every synthesizer tracks the PhaseReport contract together — a new required
 * field is added here once, not hunted across inline literals.
 */
export function syntheticPhaseReport(
  phase: PhaseId,
  status: PhaseReport["status"],
  opts: { reason?: string; findings?: Finding[] } = {},
): PhaseReport {
  const report: PhaseReport = {
    phase,
    status,
    findings: opts.findings ?? [],
    audit: {},
    cost: { durationMs: 0 },
  };
  if (opts.reason !== undefined) report.reason = opts.reason;
  return report;
}
