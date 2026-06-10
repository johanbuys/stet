/**
 * Exit-code derivation — pure, no I/O.
 *
 * Implements the gating rule from harness PRD §4.8:
 *   A finding gates iff severity ≥ failOn AND confidence === "high".
 *
 * Severity order: error > warning > info.
 * Phase status (completed/skipped/cancelled/error) is irrelevant — only findings gate.
 * Exit 2 is never produced here; that is the CLI shell's domain (error taxonomy).
 */

import type { Severity } from "./schema/finding.js";
import type { PhaseReport } from "./schema/report.js";

/** Numeric rank for severity comparison. Higher = more severe. */
const SEVERITY_RANK: Record<Severity, number> = {
  error: 2,
  warning: 1,
  info: 0,
};

/** Result of exit-code derivation. Feeds into RunReport.result (assembled in T6). */
export interface ExitResult {
  exitCode: 0 | 1;
  /** Every finding that caused exit 1, in phases[]/findings[] order. */
  gating: { phase: string; id: string; message: string }[];
}

/**
 * Derive the exit code and gating list from a set of phase reports.
 *
 * PRD §4.8: exitCode is 1 iff ≥1 gating finding exists; gating lists exactly
 * those findings. Traversal is phases[] order, findings[] order within each phase.
 *
 * @param phases - All PhaseReports for the run (skipped/cancelled phases included).
 * @param failOn - The severity threshold from --fail-on (default "error").
 */
export function deriveExit(phases: PhaseReport[], failOn: Severity): ExitResult {
  const threshold = SEVERITY_RANK[failOn];
  const gating: ExitResult["gating"] = [];

  for (const phaseReport of phases) {
    for (const finding of phaseReport.findings) {
      if (finding.confidence === "high" && SEVERITY_RANK[finding.severity] >= threshold) {
        gating.push({
          phase: finding.phase,
          id: finding.id,
          message: finding.message,
        });
      }
    }
  }

  return {
    exitCode: gating.length > 0 ? 1 : 0,
    gating,
  };
}
