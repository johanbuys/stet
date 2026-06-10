/**
 * Report assembly — pure function, no I/O.
 *
 * Assembles a RunReport from the scheduler's phase reports, scope, and config.
 * Pure: the function is deterministic given its inputs. startedAt is passed in
 * (not computed inside) so the function stays testable and the pipeline owns timing.
 *
 * Self-check contract: the assembled report MUST validate via parseRunReport.
 * An invalid self-produced report is a stet bug → the caller surfaces it as Err(SchemaError).
 * "Nothing passes silently" applies to stet itself (PRD §4.5, plan §2a).
 *
 * PRD refs: §4.4 (PhaseReport / Cost), §4.5 (RunReport), §4.8 (exit codes).
 */

import type { Severity } from "./schema/finding.js";
import type { PhaseReport, RunReport } from "./schema/report.js";
import type { Scope } from "./schema/scope.js";
import { deriveExit } from "./exit-codes.js";

// ---------------------------------------------------------------------------
// Public input type
// ---------------------------------------------------------------------------

export interface AssembleInput {
  /** The binary's semver — from package.json at the CLI entry point. */
  stetVersion: string;
  /** ISO-8601 UTC run start timestamp — passed in, not computed here (keep function pure). */
  startedAt: string;
  scope: Scope;
  /** All PhaseReports from the scheduler, in registration order. */
  phases: PhaseReport[];
  /** Effective failOn: flag > config > default("error"). */
  failOn: Severity;
  /**
   * Wall-clock elapsed time for the whole run, in milliseconds — measured by the caller
   * around runPhases. Phases run concurrently, so summing their individual durationMs
   * diverges from real elapsed time (PRD §4.10 worked example: phase durations sum to
   * 76,122ms, total is 66,120ms). This field is the authoritative wall-clock measure.
   */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Cost aggregation
// ---------------------------------------------------------------------------

/**
 * Sum token costs across all phase reports.
 * Duration is NOT summed — phases run concurrently so summing diverges from wall-clock.
 * The caller supplies wall-clock durationMs from AssembleInput.
 */
function sumTokens(phases: PhaseReport[]): { totalInputTokens: number; totalOutputTokens: number } {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const phase of phases) {
    totalInputTokens += phase.cost.inputTokens ?? 0;
    totalOutputTokens += phase.cost.outputTokens ?? 0;
  }

  return { totalInputTokens, totalOutputTokens };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble the final RunReport from all pipeline outputs.
 *
 * Pure function — no I/O, no time calls, fully deterministic.
 *
 * The caller is responsible for the self-check:
 *   const { report } = assembleReport(input);
 *   const valid = parseRunReport(report);
 *   if (valid.isErr()) return Result.err(valid.error); // SchemaError → exit 2
 *
 * exitCode is returned alongside the report so the caller does not need to
 * re-read it through the schema-typed report (which widens 0|1 to 0|1|2).
 *
 * spec: M8 (--prd/--task) — for M1 we always set provided:false with empty sources.
 */
export function assembleReport(input: AssembleInput): { report: RunReport; exitCode: 0 | 1 } {
  const { stetVersion, startedAt, scope, phases, failOn, durationMs } = input;

  const { exitCode, gating } = deriveExit(phases, failOn);
  const { totalInputTokens, totalOutputTokens } = sumTokens(phases);

  const report: RunReport = {
    version: 1,
    stet: stetVersion,
    startedAt,
    // Pass scope straight through — no re-projection (which would silently drop
    // M8's `stripped` field). Single source of truth: src/schema/scope.ts (finding F10).
    scope,
    // M8 (--prd/--task/--issue) provides spec context; not implemented until M8.
    spec: { provided: false, sources: [] },
    phases,
    result: {
      exitCode,
      failOn,
      gating,
    },
    cost: { totalInputTokens, totalOutputTokens, durationMs },
  };

  return { report, exitCode };
}
