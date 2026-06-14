/**
 * Deterministic risk classifier (PRD §3.4.1a, decisions #26, #32).
 *
 * `classify(diff, paths, rules)` evaluates the phase's declared `riskRules` in order
 * and returns the level of the first matching rule. If no rule matches, "full" is
 * returned — safe/conservative default so the full specialist panel runs.
 *
 * The classifier is pure (no I/O, no state) so it can be exhaustively table-tested
 * and is cheap to invoke once per declaring phase before fan-out (PRD #32).
 */

/**
 * A single risk rule: a predicate over diff text and changed paths, mapped to a level.
 * Rules are evaluated in order; the first match wins.
 */
export interface RiskRule {
  /** Pure predicate over the (pre-filtered) diff text and changed file paths. */
  predicate: (diff: string, paths: string[]) => boolean;
  /** The risk level returned when this rule fires (e.g. "trivial", "standard", "full"). */
  level: string;
}

/**
 * Evaluate `rules` in order and return the first matching level.
 * Returns `"full"` if no rule matches — conservative default, full panel runs.
 *
 * @param diff   The (pre-filtered) diff text. Until M8 lands, callers may pass `""` for
 *               path-only rules; M8 will populate this from the semantic pre-filter (PRD #32).
 * @param paths  Changed file paths after pre-filtering.
 * @param rules  The phase's declared risk rules (from `CompositePhaseConfig.riskRules`).
 */
export function classify(diff: string, paths: string[], rules: RiskRule[]): string {
  for (const rule of rules) {
    if (rule.predicate(diff, paths)) {
      return rule.level;
    }
  }
  return "full";
}
