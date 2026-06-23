/**
 * Tests for metrics.ts — SNR, per-tier P/R, cleanFpr, regression gate, Cohen's kappa.
 *
 * Run: vp test metrics
 *
 * Coverage:
 *   - computeMetrics: SNR, per-tier precision/recall, cleanFpr, total counts
 *   - computeMetrics edge cases: no data tiers, all-clean, empty
 *   - checkGate: pass, precision-drop failure, SNR-drop failure, FPR-rise failure
 *   - cohensKappa: perfect agreement, random agreement, edge cases
 */

import { describe, expect, it } from "vite-plus/test";
import type { GradeResult } from "./grader.js";
import type { Fixture, ExpectedFinding } from "./fixture.js";
import type { Finding } from "../schema/finding.js";
import {
  computeMetrics,
  checkGate,
  cohensKappa,
  DEFAULT_GATE_EPSILON,
  DEFAULT_KAPPA_THRESHOLD,
  DEFAULT_SNR_RELATIVE_EPSILON,
} from "./metrics.js";
import type { FixtureGradeResult, EvalBaseline } from "./metrics.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFixture(tier: Fixture["tier"], clean = false): Fixture {
  return {
    id: `${tier}-${clean ? "clean" : "buggy"}`,
    tier,
    clean,
    diff: "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    expected: clean ? [] : [{ id: "review.bug", severity: "error" as const, gist: "some bug" }],
  };
}

function makeGradeResult(
  opts: {
    hits?: number;
    valids?: number;
    noises?: number;
    missed?: ExpectedFinding[];
  } = {},
): GradeResult {
  const { hits = 0, valids = 0, noises = 0, missed = [] } = opts;
  const graded = [
    ...Array.from({ length: hits }, () => ({
      finding: {} as Finding,
      bucket: "HIT" as const,
      matched: {} as ExpectedFinding,
    })),
    ...Array.from({ length: valids }, () => ({ finding: {} as Finding, bucket: "VALID" as const })),
    ...Array.from({ length: noises }, () => ({ finding: {} as Finding, bucket: "NOISE" as const })),
  ];
  return { graded, missed };
}

function makeResult(
  tier: Fixture["tier"],
  clean: boolean,
  gradeOpts: Parameters<typeof makeGradeResult>[0],
): FixtureGradeResult {
  return { fixture: makeFixture(tier, clean), gradeResult: makeGradeResult(gradeOpts) };
}

// ── computeMetrics ────────────────────────────────────────────────────────────

describe("computeMetrics — SNR", () => {
  it("computes SNR = (HIT + VALID) / NOISE", () => {
    const results = [makeResult("in-diff", false, { hits: 3, valids: 2, noises: 1 })];
    const { snr } = computeMetrics(results);
    expect(snr).toBeCloseTo(5);
  });

  it("SNR is 0 when all counts are 0", () => {
    const results = [makeResult("in-diff", false, {})];
    expect(computeMetrics(results).snr).toBe(0);
  });

  it("SNR is capped at 999 when signal exists but NOISE is 0", () => {
    const results = [makeResult("in-diff", false, { hits: 2, noises: 0 })];
    expect(computeMetrics(results).snr).toBe(999);
  });
});

describe("computeMetrics — per-tier precision and recall", () => {
  it("computes precision = HIT / (HIT + NOISE) per tier", () => {
    const results = [makeResult("in-diff", false, { hits: 2, noises: 1 })];
    const m = computeMetrics(results);
    expect(m.perTier["in-diff"].precision).toBeCloseTo(2 / 3);
  });

  it("computes recall = HIT / (HIT + missed) per tier", () => {
    const missed = [{ id: "review.bug", severity: "error" as const, gist: "missed bug" }];
    const results = [makeResult("in-diff", false, { hits: 2, missed })];
    const m = computeMetrics(results);
    expect(m.perTier["in-diff"].recall).toBeCloseTo(2 / 3);
  });

  it("precision is 0 when no findings emitted in tier", () => {
    const results = [makeResult("in-diff", false, {})];
    expect(computeMetrics(results).perTier["in-diff"].precision).toBe(0);
  });

  it("recall is 0 when no expected and no hits in tier", () => {
    const results = [makeResult("in-diff", false, {})];
    expect(computeMetrics(results).perTier["in-diff"].recall).toBe(0);
  });

  it("VALID findings do NOT penalise precision (not noise)", () => {
    // 1 HIT + 2 VALID + 0 NOISE → precision = 1/(1+0) = 1.0
    const results = [makeResult("in-diff", false, { hits: 1, valids: 2, noises: 0 })];
    expect(computeMetrics(results).perTier["in-diff"].precision).toBeCloseTo(1.0);
  });

  it("cross-file and needs-context tiers counted independently", () => {
    const results = [
      makeResult("in-diff", false, { hits: 1, noises: 0 }),
      makeResult("needs-context", false, { hits: 0, noises: 2 }),
      makeResult("cross-file", false, { hits: 1, noises: 1 }),
    ];
    const m = computeMetrics(results);
    expect(m.perTier["in-diff"].precision).toBeCloseTo(1.0);
    expect(m.perTier["needs-context"].precision).toBe(0);
    expect(m.perTier["cross-file"].precision).toBeCloseTo(0.5);
  });
});

describe("computeMetrics — cleanFpr", () => {
  it("computes NOISE / total_emitted on clean fixtures", () => {
    // 2 noises out of 3 emitted on clean fixture
    const results = [makeResult("in-diff", true, { noises: 2, valids: 1 })];
    expect(computeMetrics(results).cleanFpr).toBeCloseTo(2 / 3);
  });

  it("cleanFpr is 0 when no findings emitted on clean fixtures", () => {
    const results = [makeResult("in-diff", true, {})];
    expect(computeMetrics(results).cleanFpr).toBe(0);
  });

  it("clean fixtures do NOT contribute to tier metrics", () => {
    const results = [makeResult("in-diff", true, { noises: 3 })];
    const m = computeMetrics(results);
    expect(m.perTier["in-diff"].noiseCount).toBe(0);
    expect(m.perTier["in-diff"].fixtureCount).toBe(0);
  });
});

describe("computeMetrics — total counts", () => {
  it("sums HITs, VALIDs, NOISEs, missed across all fixtures", () => {
    const results = [
      makeResult("in-diff", false, {
        hits: 2,
        valids: 1,
        noises: 3,
        missed: [{ id: "x", severity: "error" as const, gist: "m1" }],
      }),
      makeResult("needs-context", false, { hits: 1, noises: 1 }),
    ];
    const { counts } = computeMetrics(results);
    expect(counts.hit).toBe(3);
    expect(counts.valid).toBe(1);
    expect(counts.noise).toBe(4);
    expect(counts.missed).toBe(1);
  });

  it("tracks fixtureCount and cleanFixtureCount", () => {
    const results = [
      makeResult("in-diff", false, {}),
      makeResult("in-diff", true, {}),
      makeResult("needs-context", false, {}),
    ];
    const m = computeMetrics(results);
    expect(m.fixtureCount).toBe(3);
    expect(m.cleanFixtureCount).toBe(1);
  });

  it("returns zeros for empty results", () => {
    const m = computeMetrics([]);
    expect(m.snr).toBe(0);
    expect(m.counts.hit).toBe(0);
    expect(m.cleanFpr).toBe(0);
  });
});

// ── checkGate ─────────────────────────────────────────────────────────────────

function makeBaseline(overrides: Partial<EvalBaseline> = {}): EvalBaseline {
  const zeroTier = {
    fixtureCount: 1,
    hitCount: 0,
    noiseCount: 0,
    validCount: 0,
    missedCount: 0,
    precision: 0.8,
    recall: 0.7,
  };
  return {
    snr: 5,
    perTier: {
      "in-diff": { ...zeroTier },
      "needs-context": { ...zeroTier },
      "cross-file": { ...zeroTier },
    },
    cleanFpr: 0.1,
    counts: { hit: 4, valid: 1, noise: 1, missed: 0 },
    fixtureCount: 3,
    cleanFixtureCount: 1,
    ...overrides,
  };
}

describe("checkGate", () => {
  it("passes when current equals baseline", () => {
    const baseline = makeBaseline();
    const { passed } = checkGate(baseline, baseline);
    expect(passed).toBe(true);
  });

  it("passes when current is better than baseline", () => {
    const baseline = makeBaseline({ snr: 5 });
    const better: EvalBaseline = { ...baseline, snr: 8 };
    expect(checkGate(better, baseline).passed).toBe(true);
  });

  it("fails when SNR drops below baseline by more than the relative epsilon (10% relative)", () => {
    // SNR 10.0 → 5.0: relative drop = 50% → violation (> 10%)
    const baseline = makeBaseline({ snr: 10 });
    const worse: EvalBaseline = { ...baseline, snr: 5 };
    const { passed, violations } = checkGate(worse, baseline);
    expect(passed).toBe(false);
    expect(violations.some((v) => v.metric === "snr")).toBe(true);
  });

  it("passes when SNR drops by less than the relative epsilon (10% relative)", () => {
    // SNR 10.0 → 9.9: relative drop = 1% → no violation
    const baseline = makeBaseline({ snr: 10 });
    const slightlyWorse: EvalBaseline = { ...baseline, snr: 9.9 };
    expect(checkGate(slightlyWorse, baseline).passed).toBe(true);
  });

  it("passes when SNR drops by exactly snrRelativeEpsilon (boundary is exclusive)", () => {
    // SNR 10.0 → 9.0: relative drop = exactly 10% → no violation (boundary exclusive)
    const baseline = makeBaseline({ snr: 10 });
    const onBoundary: EvalBaseline = { ...baseline, snr: 9 };
    expect(checkGate(onBoundary, baseline).passed).toBe(true);
  });

  it("skips SNR gate when baseline.snr is 0 (nothing to regress from)", () => {
    const baseline = makeBaseline({ snr: 0 });
    const current: EvalBaseline = { ...baseline, snr: 0 };
    expect(checkGate(current, baseline).passed).toBe(true);
  });

  it("fails when precision drops beyond epsilon", () => {
    const baseline = makeBaseline();
    const worse = JSON.parse(JSON.stringify(baseline)) as EvalBaseline;
    worse.perTier["in-diff"].precision = 0.8 - DEFAULT_GATE_EPSILON - 0.01;
    const { violations } = checkGate(worse, baseline);
    expect(violations.some((v) => v.metric === "precision.in-diff")).toBe(true);
  });

  it("fails when cleanFpr rises beyond epsilon", () => {
    const baseline = makeBaseline({ cleanFpr: 0.1 });
    const worse: EvalBaseline = { ...baseline, cleanFpr: 0.1 + DEFAULT_GATE_EPSILON + 0.01 };
    const { violations } = checkGate(worse, baseline);
    expect(violations.some((v) => v.metric === "cleanFpr")).toBe(true);
  });

  it("passes when cleanFpr drops (fewer false positives is fine)", () => {
    const baseline = makeBaseline({ cleanFpr: 0.1 });
    const better: EvalBaseline = { ...baseline, cleanFpr: 0 };
    expect(checkGate(better, baseline).passed).toBe(true);
  });

  it("does NOT throw when baseline perTier is missing a tier (skips that tier)", () => {
    // Simulate a hand-edited or older-shape baseline.json that only has "in-diff"
    const baseline = makeBaseline();
    const partialBaseline = {
      ...baseline,
      perTier: {
        "in-diff": baseline.perTier["in-diff"],
        // "needs-context" and "cross-file" are absent
      },
    } as unknown as EvalBaseline;
    const current = makeBaseline();
    // Must return a GateCheck without throwing
    expect(() => checkGate(current, partialBaseline)).not.toThrow();
    const result = checkGate(current, partialBaseline);
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("violations");
    expect(Array.isArray(result.violations)).toBe(true);
  });

  it("violation records metric, baseline, current, epsilon, and degradation (relative drop for snr)", () => {
    // SNR 10 → 5: relative drop = 0.5 (50%), which exceeds the 10% relative epsilon
    const baseline = makeBaseline({ snr: 10 });
    const worse: EvalBaseline = { ...baseline, snr: 5 };
    const { violations } = checkGate(worse, baseline);
    const v = violations.find((x) => x.metric === "snr")!;
    expect(v.baseline).toBe(10);
    expect(v.current).toBe(5);
    expect(v.epsilon).toBe(DEFAULT_SNR_RELATIVE_EPSILON);
    expect(v.degradation).toBeCloseTo(0.5); // relative drop: (10-5)/10
  });

  it("accepts a custom absolute epsilon for precision/recall/cleanFpr", () => {
    const baseline = makeBaseline();
    const worse = JSON.parse(JSON.stringify(baseline)) as EvalBaseline;
    // precision drop of 0.06 on in-diff tier
    worse.perTier["in-diff"].precision = 0.8 - 0.06;
    // With default epsilon (0.05): violation (drop 0.06 > 0.05)
    expect(
      checkGate(worse, baseline, 0.05).violations.some((v) => v.metric === "precision.in-diff"),
    ).toBe(true);
    // With epsilon = 0.1: no violation (drop 0.06 ≤ 0.1)
    expect(
      checkGate(worse, baseline, 0.1).violations.some((v) => v.metric === "precision.in-diff"),
    ).toBe(false);
  });

  it("accepts a custom snrRelativeEpsilon as fourth argument", () => {
    // SNR 10 → 8.5: relative drop = 15%
    const baseline = makeBaseline({ snr: 10 });
    const worse: EvalBaseline = { ...baseline, snr: 8.5 };
    // Default 10% relative epsilon → violation (15% > 10%)
    expect(checkGate(worse, baseline).violations.some((v) => v.metric === "snr")).toBe(true);
    // Custom 20% relative epsilon → no violation (15% ≤ 20%)
    expect(
      checkGate(worse, baseline, DEFAULT_GATE_EPSILON, 0.2).violations.some(
        (v) => v.metric === "snr",
      ),
    ).toBe(false);
  });
});

// ── cohensKappa ───────────────────────────────────────────────────────────────

describe("cohensKappa", () => {
  it("returns 1 for perfect agreement", () => {
    // All predictions match human labels: 10 HITs + 10 NOTs, no mismatches
    expect(cohensKappa(10, 0, 0, 10)).toBeCloseTo(1);
  });

  it("returns 0 when agreement is purely by chance", () => {
    // 50% of items are HIT for both raters → chance agreement = 0.5
    // Observed agreement = 0.5 → kappa = 0
    // n11=25, n10=25, n01=25, n00=25 → kappa = 0
    expect(cohensKappa(25, 25, 25, 25)).toBeCloseTo(0);
  });

  it("returns negative kappa when agreement is worse than chance", () => {
    // Grader says NOT-HIT for every human-HIT → systematic disagreement
    expect(cohensKappa(0, 10, 10, 0)).toBeLessThan(0);
  });

  it("returns NaN when n is 0", () => {
    expect(cohensKappa(0, 0, 0, 0)).toBeNaN();
  });

  it("returns NaN when expected agreement is 1 (degenerate)", () => {
    // n11=0, n10=0, n01=0, n00=10 → both always say NOT-HIT → pExp = 1
    expect(cohensKappa(0, 0, 0, 10)).toBeNaN();
  });

  it("threshold constant is 0.75", () => {
    expect(DEFAULT_KAPPA_THRESHOLD).toBe(0.75);
  });

  it("a typical good classifier (κ ≥ 0.75) is recognized", () => {
    // 80% accuracy with balanced classes → κ ≈ 0.6; tweak for higher
    // 9 HITs + 1 miss + 1 FA + 9 TNs → accuracy = 18/20 = 0.9, κ ≈ 0.8
    const kappa = cohensKappa(9, 1, 1, 9);
    expect(kappa).toBeGreaterThanOrEqual(DEFAULT_KAPPA_THRESHOLD);
  });
});
