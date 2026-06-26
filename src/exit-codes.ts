/**
 * Exit-code derivation — pure, no I/O.
 *
 * Implements the gating rule from harness PRD §4.8 + TDD G:
 *   A finding gates iff severity ≥ failOn AND confidence === "high"
 *                    AND meta.preexisting !== true.
 *
 * Severity order: error > warning > info.
 * Phase status (completed/skipped/cancelled/error) is irrelevant — only findings gate.
 * Exit 2 is never produced here; that is the CLI shell's domain (error taxonomy).
 */

import { PREEXISTING_META_KEY, severityAtLeast, type Severity } from "./schema/finding.js";
import type { PhaseReport } from "./schema/report.js";

/** Result of exit-code derivation. Feeds into RunReport.result (assembled in T6). */
export interface ExitResult {
  exitCode: 0 | 1;
  /** Every finding that caused exit 1, in phases[]/findings[] order. */
  gating: { phase: string; id: string; message: string }[];
}

/**
 * Derive the exit code and gating list from a set of phase reports.
 *
 * PRD §4.8 + TDD G: exitCode is 1 iff ≥1 gating finding exists; a finding gates iff:
 *   severityAtLeast(severity, failOn) ∧ confidence === "high" ∧ meta.preexisting !== true
 *
 * The preexisting check is a runtime read on the open meta field (no TypeScript narrowing —
 * TDD G / code-review-tdd.md Area G). Traversal is phases[] order, findings[] order.
 *
 * @param phases - All PhaseReports for the run (skipped/cancelled phases included).
 * @param failOn - The severity threshold from --fail-on (default "error").
 */
export function deriveExit(phases: PhaseReport[], failOn: Severity): ExitResult {
  const gating: ExitResult["gating"] = [];

  for (const phaseReport of phases) {
    for (const finding of phaseReport.findings) {
      const isPreexisting =
        (finding.meta as Record<string, unknown> | undefined)?.[PREEXISTING_META_KEY] === true;
      if (
        finding.confidence === "high" &&
        severityAtLeast(finding.severity, failOn) &&
        !isPreexisting
      ) {
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

/**
 * Human-readable label for an exit code.
 *
 *   0 → "ok"            (clean run)
 *   1 → "findings gate" (≥1 gating finding)
 *   else → "interrupted" (CLI shell error / signal, exit ≥ 2)
 *
 * Exit-code domain knowledge — kept here, not in the renderer.
 */
export function exitLabel(code: number): string {
  return code === 0 ? "ok" : code === 1 ? "findings gate" : "interrupted";
}
