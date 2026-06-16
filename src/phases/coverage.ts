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
// Diff section parsing
// ---------------------------------------------------------------------------

interface DiffSection {
  path: string;
  content: string;
}

/**
 * Split a unified diff into per-file sections.
 * Mirrors the parser in diff-filter.ts — kept local to avoid coupling.
 */
function parseDiffSections(diff: string): DiffSection[] {
  if (!diff) return [];

  const sections: DiffSection[] = [];
  const parts = diff.split(/(?=^diff --git )/m);

  for (const part of parts) {
    if (!part.startsWith("diff --git ")) continue;
    const headerMatch = part.match(/^diff --git a\/.+ b\/(.+)$/m);
    const path = headerMatch?.[1]?.trimEnd() ?? "";
    if (path) {
      sections.push({ path, content: part });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a character budget to a diff.
 *
 * Files are evaluated in git diff --stat order (file order) and included greedily:
 * each section that still fits within `budget` characters is kept, so a smaller
 * later section may be included after a larger earlier one is excluded.
 * Any excluded sections are recorded in `excluded` and named in the warning.
 *
 * - Under budget: `{ diff, excluded: [], warning: undefined }` — no change.
 * - Over budget: `{ diff: truncatedDiff, excluded, warning }` where warning is
 *   a Finding with id `<phaseId>.partial-coverage`, severity "warning", confidence "high".
 */
export function applyBudget(diff: string, budget: number, phaseId: string): BudgetResult {
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

  const trimmedDiff = includedParts.join("");

  const warning: Finding = {
    id: `${phaseId}.partial-coverage`,
    phase: phaseId,
    severity: "warning",
    confidence: "high",
    message: `diff exceeds context budget (${budget.toLocaleString()} chars); ${excluded.length} file(s) excluded from analysis: ${excluded.join(", ")}`,
  };

  return { diff: trimmedDiff, excluded, warning };
}
