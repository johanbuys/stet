/**
 * Metrics computation and regression gate for the code-review eval (TDD C·3).
 *
 * Headline metric: SNR = (HIT + VALID) / NOISE
 * Per-tier: precision = HIT / (HIT + NOISE), recall = HIT / (HIT + missed)
 * Clean FPR: NOISE / total_emitted on clean fixtures
 *
 * Regression gate: fails when precision or SNR drops below baseline by more
 * than epsilon, or when cleanFpr rises above baseline by more than epsilon.
 *
 * Cohen's kappa: utility for grader-vs-human agreement on a golden subset.
 */

import type { GradeResult } from "./grader.js";
import type { Fixture, FixtureTier } from "./fixture.js";

export const ALL_TIERS: readonly FixtureTier[] = ["in-diff", "needs-context", "cross-file"];

/** Default gate tolerance: a drop of more than 5% triggers a failure. */
export const DEFAULT_GATE_EPSILON = 0.05;

/** Default kappa threshold for grader validation (PRD #13). */
export const DEFAULT_KAPPA_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

/** Aggregate stats for one visibility tier (non-clean fixtures only). */
export interface TierMetrics {
  /** Non-clean fixtures counted in this tier. */
  fixtureCount: number;
  hitCount: number;
  noiseCount: number;
  validCount: number;
  missedCount: number;
  /**
   * HIT / (HIT + NOISE). 0 when no emitted findings exist in this tier.
   * Skipping VALID: VALID findings are real bugs, not errors, so they don't
   * penalise precision.
   */
  precision: number;
  /** HIT / (HIT + missed). 0 when no expected findings exist in this tier. */
  recall: number;
}

/** Aggregate eval metrics across all fixtures. */
export interface EvalMetrics {
  /** (HIT + VALID) / NOISE. 0 when all three are 0; capped at 999 when NOISE=0 and signal>0. */
  snr: number;
  perTier: Record<FixtureTier, TierMetrics>;
  /** NOISE / total_emitted on clean fixtures. 0 when no clean findings emitted. */
  cleanFpr: number;
  counts: {
    hit: number;
    valid: number;
    noise: number;
    missed: number;
  };
  fixtureCount: number;
  cleanFixtureCount: number;
}

/** EvalBaseline is the same shape as EvalMetrics; committed to eval-baseline.json. */
export type EvalBaseline = EvalMetrics;

// ---------------------------------------------------------------------------
// Regression gate types
// ---------------------------------------------------------------------------

export interface GateViolation {
  metric: string;
  baseline: number;
  current: number;
  epsilon: number;
  /** Magnitude of degradation (always positive for a violation). */
  degradation: number;
}

export interface GateCheck {
  passed: boolean;
  violations: GateViolation[];
}

// ---------------------------------------------------------------------------
// Graded result per fixture (consumed by computeMetrics)
// ---------------------------------------------------------------------------

export interface FixtureGradeResult {
  fixture: Fixture;
  gradeResult: GradeResult;
}

// ---------------------------------------------------------------------------
// computeMetrics
// ---------------------------------------------------------------------------

/**
 * Aggregate a list of per-fixture grade results into EvalMetrics.
 *
 * Clean fixtures contribute to cleanFpr only.
 * Non-clean fixtures contribute to SNR, per-tier P/R, and total counts.
 */
export function computeMetrics(results: FixtureGradeResult[]): EvalMetrics {
  let totalHit = 0;
  let totalValid = 0;
  let totalNoise = 0;
  let totalMissed = 0;
  let cleanEmitted = 0;
  let cleanNoise = 0;
  let cleanFixtureCount = 0;

  type TierAcc = { hit: number; noise: number; valid: number; missed: number; fixtures: number };
  const tierAcc: Record<FixtureTier, TierAcc> = {
    "in-diff": { hit: 0, noise: 0, valid: 0, missed: 0, fixtures: 0 },
    "needs-context": { hit: 0, noise: 0, valid: 0, missed: 0, fixtures: 0 },
    "cross-file": { hit: 0, noise: 0, valid: 0, missed: 0, fixtures: 0 },
  };

  for (const { fixture, gradeResult } of results) {
    const { graded, missed } = gradeResult;
    const hit = graded.filter((g) => g.bucket === "HIT").length;
    const valid = graded.filter((g) => g.bucket === "VALID").length;
    const noise = graded.filter((g) => g.bucket === "NOISE").length;

    totalHit += hit;
    totalValid += valid;
    totalNoise += noise;
    totalMissed += missed.length;

    if (fixture.clean) {
      cleanFixtureCount++;
      cleanEmitted += graded.length;
      cleanNoise += noise;
    } else {
      const t = tierAcc[fixture.tier];
      t.hit += hit;
      t.noise += noise;
      t.valid += valid;
      t.missed += missed.length;
      t.fixtures++;
    }
  }

  // SNR: cap at 999 when signal exists but noise is 0 (to keep JSON-serializable)
  let snr: number;
  if (totalNoise === 0) {
    snr = totalHit + totalValid > 0 ? 999 : 0;
  } else {
    snr = (totalHit + totalValid) / totalNoise;
  }

  const cleanFpr = cleanEmitted === 0 ? 0 : cleanNoise / cleanEmitted;

  const perTier = {} as Record<FixtureTier, TierMetrics>;
  for (const tier of ALL_TIERS) {
    const t = tierAcc[tier];
    perTier[tier] = {
      fixtureCount: t.fixtures,
      hitCount: t.hit,
      noiseCount: t.noise,
      validCount: t.valid,
      missedCount: t.missed,
      precision: t.hit + t.noise === 0 ? 0 : t.hit / (t.hit + t.noise),
      recall: t.hit + t.missed === 0 ? 0 : t.hit / (t.hit + t.missed),
    };
  }

  return {
    snr,
    perTier,
    cleanFpr,
    counts: { hit: totalHit, valid: totalValid, noise: totalNoise, missed: totalMissed },
    fixtureCount: results.length,
    cleanFixtureCount,
  };
}

// ---------------------------------------------------------------------------
// Regression gate
// ---------------------------------------------------------------------------

/**
 * Check whether `current` metrics have regressed beyond `epsilon` from the
 * committed `baseline`.
 *
 * Fails when:
 *   - precision (any tier) drops by > epsilon
 *   - recall (any tier) drops by > epsilon
 *   - SNR drops by > epsilon
 *   - cleanFpr rises by > epsilon  (more false positives is a regression)
 *
 * Non-finite values in either side are skipped (no data ⇒ no gate).
 */
export function checkGate(
  current: EvalMetrics,
  baseline: EvalBaseline,
  epsilon = DEFAULT_GATE_EPSILON,
): GateCheck {
  const violations: GateViolation[] = [];

  function checkDrop(metric: string, cur: number, base: number) {
    if (!isFinite(cur) || !isFinite(base)) return;
    const drop = base - cur;
    if (drop > epsilon)
      violations.push({ metric, baseline: base, current: cur, epsilon, degradation: drop });
  }

  function checkRise(metric: string, cur: number, base: number) {
    if (!isFinite(cur) || !isFinite(base)) return;
    const rise = cur - base;
    if (rise > epsilon)
      violations.push({ metric, baseline: base, current: cur, epsilon, degradation: rise });
  }

  checkDrop("snr", current.snr, baseline.snr);

  for (const tier of ALL_TIERS) {
    const cur = current.perTier[tier];
    const base = baseline.perTier[tier];
    checkDrop(`precision.${tier}`, cur.precision, base.precision);
    checkDrop(`recall.${tier}`, cur.recall, base.recall);
  }

  checkRise("cleanFpr", current.cleanFpr, baseline.cleanFpr);

  return { passed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Cohen's kappa — grader validation utility
// ---------------------------------------------------------------------------

/**
 * Cohen's kappa for binary classification (grader vs. human-labeled golden subset).
 *
 * Confusion matrix:
 *   n11: grader=HIT, human=HIT  (true positives)
 *   n10: grader=HIT, human=NOT  (false positives)
 *   n01: grader=NOT, human=HIT  (false negatives)
 *   n00: grader=NOT, human=NOT  (true negatives)
 *
 * Returns NaN when n=0 or expected agreement = 1.
 */
export function cohensKappa(n11: number, n10: number, n01: number, n00: number): number {
  const n = n11 + n10 + n01 + n00;
  if (n === 0) return NaN;
  const pObs = (n11 + n00) / n;
  const pHitHit = ((n11 + n10) / n) * ((n11 + n01) / n);
  const pNotNot = ((n01 + n00) / n) * ((n10 + n00) / n);
  const pExp = pHitHit + pNotNot;
  if (pExp === 1) return NaN;
  return (pObs - pExp) / (1 - pExp);
}
