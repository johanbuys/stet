/**
 * Diff context budget enforcement (M8, T24, PRD §3.6, decision #14).
 *
 * When a (pre-filtered) diff exceeds a phase's context budget, it is reduced
 * to the largest set of complete file sections that fits within the budget,
 * filled greedily in git diff --stat order (a smaller later section may be
 * included after a larger earlier one is excluded). Churn ranking is deferred
 * to a future milestone — plan M8 §4.
 *
 * The harness emits `<phase>.partial-coverage` (warning) naming what was
 * excluded — no silent truncation (PRD decision #14, same ethos as hygiene
 * findings). The warning Finding is prepended to the phase's findings.
 *
 * PRD refs: §3.6 (large diffs), decision #14, decision #20 (harness-emitted
 * findings attach to the phase they concern).
 */

import { parseDiffSections } from "../diff-sections.js";
import type { Finding } from "../schema/finding.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default per-phase context budget for diff text: 200 000 characters. */
export const DIFF_BUDGET = 200_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetResult {
  /** Diff text trimmed to fit within the budget (unchanged when under budget). */
  diff: string;
  /** File paths excluded due to budget overflow (empty when under budget). */
  excluded: string[];
  /** Warning Finding to prepend to the phase's findings; absent when under budget. */
  warning?: Finding;
}

// ---------------------------------------------------------------------------
// Public API — phase-independent pieces
// ---------------------------------------------------------------------------

/**
 * Trim a diff to fit a character budget — the phase-independent core (M8/T24, finding 9).
 *
 * Parses the diff into file sections once and includes them greedily in git diff --stat
 * order (file order): each section that still fits within `budget` characters is kept, so
 * a smaller later section may be included after a larger earlier one is excluded.
 *
 * This is `ctx.diff`- and budget-dependent only — NOT phase-dependent — so the scheduler
 * computes it ONCE per run and reuses the result across every diff-consuming phase. Only
 * the per-phase partial-coverage warning (which embeds the phase id) varies; build it with
 * `partialCoverageWarning`.
 *
 * - Under budget: `{ diff, excluded: [] }` — diff returned unchanged.
 * - Over budget: `{ diff: trimmedDiff, excluded }` naming the excluded file paths.
 */
export function budgetDiff(diff: string, budget: number): { diff: string; excluded: string[] } {
  if (diff.length <= budget) {
    return { diff, excluded: [] };
  }

  const sections = parseDiffSections(diff);
  const includedParts: string[] = [];
  const excluded: string[] = [];
  let accumulated = 0;

  for (const section of sections) {
    if (accumulated + section.content.length <= budget) {
      includedParts.push(section.content);
      accumulated += section.content.length;
    } else {
      excluded.push(section.path);
    }
  }

  return { diff: includedParts.join(""), excluded };
}

/**
 * Build the per-phase partial-coverage warning Finding (M8/T24, decision #20).
 *
 * Phase-dependent half of the budget mechanism: same id/severity/confidence/message format
 * as before — id `<phaseId>.partial-coverage`, severity "warning", confidence "high".
 * Call once per diff-consuming phase when `excluded.length > 0`.
 */
export function partialCoverageWarning(
  phaseId: string,
  excluded: string[],
  budget: number,
): Finding {
  return {
    id: `${phaseId}.partial-coverage`,
    phase: phaseId,
    severity: "warning",
    confidence: "high",
    message: `diff exceeds context budget (${budget.toLocaleString()} chars); ${excluded.length} file(s) excluded from analysis: ${excluded.join(", ")}`,
  };
}

/**
 * Apply a character budget to a diff for a single phase.
 *
 * Thin wrapper composing `budgetDiff` (phase-independent trim) and
 * `partialCoverageWarning` (phase-specific warning). Retained for callers/tests that want
 * the combined result in one call; the scheduler uses the two pieces directly so the trim
 * runs once per run rather than once per phase (finding 9).
 *
 * - Under budget: `{ diff, excluded: [], warning: undefined }` — no change.
 * - Over budget: `{ diff: truncatedDiff, excluded, warning }`.
 */
export function applyBudget(diff: string, budget: number, phaseId: string): BudgetResult {
  const { diff: trimmedDiff, excluded } = budgetDiff(diff, budget);
  if (excluded.length === 0) {
    return { diff: trimmedDiff, excluded };
  }
  return {
    diff: trimmedDiff,
    excluded,
    warning: partialCoverageWarning(phaseId, excluded, budget),
  };
}
