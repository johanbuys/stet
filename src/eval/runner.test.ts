/**
 * Tests for runner.ts — eval pipeline: fixture → CassetteRunner → grade → metrics.
 *
 * Run: vp test runner
 *
 * All tests use CassetteRunner.fromStore with synthetic submissions (no creds, no network).
 * The fake embedder returns identical vectors for all texts → cosine = 1.0 → any finding
 * within the location gate becomes a HIT.
 *
 * Coverage:
 *   - buildFixturePrompt: diff-only, with baseFiles
 *   - runEval: HIT, VALID, NOISE, cassette miss → empty findings
 *   - runEval gate check: pass and fail against provided baseline
 *   - runEval error accounting: runnerErrors, parseFailures
 *   - runEval cosine threshold: below-threshold finding is VALID/NOISE, not HIT
 */

import { describe, expect, it } from "vite-plus/test";
import { CassetteRunner } from "../agent/cassette-runner.js";
import { computeCassetteKey } from "../agent/cassette-runner.js";
import type { CassetteStore } from "../agent/cassette-runner.js";
import type { Finding } from "../schema/finding.js";
import type { Fixture } from "./fixture.js";
import type { EmbedFn } from "./grader.js";
import type { EvalBaseline } from "./metrics.js";
import { buildFixturePrompt, runEval, EVAL_RUBRIC } from "./runner.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fake embedder: returns the same unit vector for every text (cosine = 1.0 for all pairs). */
const UNIT_VEC = [1, 0, 0, 0];
const sameVecEmbed: EmbedFn = async (_text: string) => UNIT_VEC;

/** Build the cassette key for a fixture (matches what runEval uses internally). */
function keyForFixture(fixture: Fixture, rubric = EVAL_RUBRIC): string {
  return computeCassetteKey({ rubric, userPrompt: buildFixturePrompt(fixture) });
}

/** Minimal valid Finding (all required fields). */
function makeFinding(opts: { message: string; file?: string; line?: number }): Finding {
  return {
    id: "review.bug",
    phase: "review",
    severity: "error",
    confidence: "high",
    message: opts.message,
    ...(opts.file !== undefined
      ? { location: { file: opts.file, ...(opts.line !== undefined ? { line: opts.line } : {}) } }
      : {}),
  };
}

/** Simple non-clean in-diff fixture with one expected finding. */
const SIMPLE_FIXTURE: Fixture = {
  id: "test-off-by-one",
  tier: "in-diff",
  clean: false,
  diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-old\n+new line1\n+new line2\n",
  expected: [
    {
      id: "review.bug",
      severity: "error",
      location: { file: "src/a.ts", line: 5 },
      gist: "off-by-one: arr[arr.length] always undefined",
    },
  ],
};

/** Simple clean fixture with no expected findings. */
const CLEAN_FIXTURE: Fixture = {
  id: "test-clean",
  tier: "in-diff",
  clean: true,
  diff: "diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-x\n+y\n",
  expected: [],
};

// ── buildFixturePrompt ────────────────────────────────────────────────────────

describe("buildFixturePrompt", () => {
  it("returns diff section for a fixture without baseFiles", () => {
    const prompt = buildFixturePrompt(SIMPLE_FIXTURE);
    expect(prompt).toBe(`diff:\n${SIMPLE_FIXTURE.diff}`);
  });

  it("includes baseFiles content after the diff", () => {
    const fixture: Fixture = {
      ...SIMPLE_FIXTURE,
      baseFiles: { "src/format.ts": "export function fmt() {}" },
    };
    const prompt = buildFixturePrompt(fixture);
    expect(prompt).toContain(`diff:\n${SIMPLE_FIXTURE.diff}`);
    expect(prompt).toContain("file: src/format.ts\nexport function fmt() {}");
  });

  it("separates diff and file sections with at least one blank line", () => {
    const fixture: Fixture = {
      ...SIMPLE_FIXTURE,
      baseFiles: { "a.ts": "content" },
    };
    const prompt = buildFixturePrompt(fixture);
    // The diff section must come before the file section with a blank-line separator
    const diffIdx = prompt.indexOf("diff:\n");
    const fileIdx = prompt.indexOf("file: a.ts\n");
    expect(diffIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThan(diffIdx);
    // Blank-line gap between the two sections
    const gap = prompt.slice(diffIdx + "diff:\n".length, fileIdx);
    expect(gap).toMatch(/\n\n/);
  });

  it("includes all baseFiles entries", () => {
    const fixture: Fixture = {
      ...SIMPLE_FIXTURE,
      baseFiles: { "a.ts": "aContent", "b.ts": "bContent" },
    };
    const prompt = buildFixturePrompt(fixture);
    expect(prompt).toContain("file: a.ts\naContent");
    expect(prompt).toContain("file: b.ts\nbContent");
  });

  it("produces a deterministic output (same for same input)", () => {
    expect(buildFixturePrompt(SIMPLE_FIXTURE)).toBe(buildFixturePrompt(SIMPLE_FIXTURE));
  });
});

// ── runEval — HIT scenario ────────────────────────────────────────────────────

describe("runEval — HIT", () => {
  it("produces a HIT when finding is on the same file/line as expected", async () => {
    // Finding is on line 5 of src/a.ts — matches expected in SIMPLE_FIXTURE
    const finding = makeFinding({ message: "off-by-one bug", file: "src/a.ts", line: 5 });
    const submission = { findings: [finding] };
    const key = keyForFixture(SIMPLE_FIXTURE);
    const store: CassetteStore = { [key]: { submission, cost: { durationMs: 50 } } };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE], runner, { embed: sameVecEmbed });

    expect(result.fixtureResults).toHaveLength(1);
    const fr = result.fixtureResults[0]!;
    expect(fr.gradeResult.graded).toHaveLength(1);
    expect(fr.gradeResult.graded[0]!.bucket).toBe("HIT");
    expect(fr.gradeResult.missed).toHaveLength(0);
    expect(result.metrics.counts.hit).toBe(1);
    expect(result.metrics.counts.noise).toBe(0);
    expect(result.metrics.counts.missed).toBe(0);
  });
});

// ── runEval — VALID scenario (non-clean, no location match) ──────────────────

describe("runEval — VALID", () => {
  it("classifies unmatched finding on a non-clean fixture as VALID", async () => {
    // Finding is in a different file → no candidate → VALID on non-clean
    const finding = makeFinding({ message: "some real bug", file: "src/other.ts", line: 1 });
    const submission = { findings: [finding] };
    const key = keyForFixture(SIMPLE_FIXTURE);
    const store: CassetteStore = { [key]: { submission, cost: { durationMs: 50 } } };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE], runner, { embed: sameVecEmbed });

    const fr = result.fixtureResults[0]!;
    expect(fr.gradeResult.graded[0]!.bucket).toBe("VALID");
    expect(result.metrics.counts.valid).toBe(1);
    expect(result.metrics.counts.hit).toBe(0);
    // The expected finding was not matched → missed
    expect(result.metrics.counts.missed).toBe(1);
  });
});

// ── runEval — NOISE scenario (clean fixture) ──────────────────────────────────

describe("runEval — NOISE", () => {
  it("classifies any finding on a clean fixture as NOISE", async () => {
    const finding = makeFinding({ message: "false positive", file: "src/b.ts", line: 1 });
    const submission = { findings: [finding] };
    const key = keyForFixture(CLEAN_FIXTURE);
    const store: CassetteStore = { [key]: { submission, cost: { durationMs: 50 } } };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([CLEAN_FIXTURE], runner, { embed: sameVecEmbed });

    const fr = result.fixtureResults[0]!;
    expect(fr.gradeResult.graded[0]!.bucket).toBe("NOISE");
    expect(result.metrics.counts.noise).toBe(1);
    expect(result.metrics.cleanFpr).toBe(1); // 1/1 emitted on clean
  });
});

// ── runEval — cassette miss ───────────────────────────────────────────────────

describe("runEval — cassette miss", () => {
  it("produces empty findings (no crash) when cassette has no entry for fixture", async () => {
    const runner = CassetteRunner.fromStore({}); // empty store → always miss

    const result = await runEval([SIMPLE_FIXTURE], runner, { embed: sameVecEmbed });

    const fr = result.fixtureResults[0]!;
    expect(fr.findings).toHaveLength(0);
    expect(fr.gradeResult.graded).toHaveLength(0);
    expect(fr.gradeResult.missed).toHaveLength(1); // expected finding was missed
    expect(result.metrics.counts.hit).toBe(0);
    expect(result.metrics.counts.missed).toBe(1);
  });

  it("processes multiple fixtures even when some are missed", async () => {
    const key = keyForFixture(SIMPLE_FIXTURE);
    const finding = makeFinding({ message: "off-by-one", file: "src/a.ts", line: 5 });
    const store: CassetteStore = {
      [key]: { submission: { findings: [finding] }, cost: { durationMs: 50 } },
      // CLEAN_FIXTURE has no entry → miss
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE, CLEAN_FIXTURE], runner, { embed: sameVecEmbed });

    expect(result.fixtureResults).toHaveLength(2);
    expect(result.fixtureResults[0]!.findings).toHaveLength(1);
    expect(result.fixtureResults[1]!.findings).toHaveLength(0);
  });

  it("counts all cassette misses as runnerErrors", async () => {
    // Empty store → every fixture is a cassette miss → Err from CassetteRunner
    const runner = CassetteRunner.fromStore({});

    const result = await runEval([SIMPLE_FIXTURE, CLEAN_FIXTURE], runner, { embed: sameVecEmbed });

    // Both fixtures miss → 2 runner errors
    expect(result.runnerErrors).toBe(2);
    expect(result.parseFailures).toBe(0);
  });
});

// ── runEval — parse failures ──────────────────────────────────────────────────

describe("runEval — parse failures", () => {
  it("counts parseFailures when cassette returns a malformed submission (parseFindings → null)", async () => {
    // The cassette returns an Ok result, but the submission is malformed:
    // `findings` contains an object missing required fields → parseFindings returns null.
    const malformedSubmission = { findings: [{ not_a_valid_finding: true }] };
    const key = keyForFixture(SIMPLE_FIXTURE);
    const store: CassetteStore = {
      [key]: { submission: malformedSubmission, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE], runner, { embed: sameVecEmbed });

    // Runner returned Ok, but parseFindings returned null → parseFailures = 1
    expect(result.runnerErrors).toBe(0);
    expect(result.parseFailures).toBe(1);
    // Malformed submission contributes no findings → graded as all-missed
    expect(result.fixtureResults[0]!.findings).toHaveLength(0);
  });

  it("distinguishes parse-null from a valid empty findings array", async () => {
    // A valid submission with an empty findings array (not malformed — [] is Ok).
    const emptySubmission = { findings: [] };
    const key = keyForFixture(CLEAN_FIXTURE);
    const store: CassetteStore = {
      [key]: { submission: emptySubmission, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([CLEAN_FIXTURE], runner, { embed: sameVecEmbed });

    // Empty array is a valid parse result — not a parseFailure
    expect(result.runnerErrors).toBe(0);
    expect(result.parseFailures).toBe(0);
    expect(result.fixtureResults[0]!.findings).toHaveLength(0);
  });
});

// ── runEval — gate check ──────────────────────────────────────────────────────

describe("runEval — gate check", () => {
  it("gateCheck is absent when no baseline is provided", async () => {
    const runner = CassetteRunner.fromStore({});
    const result = await runEval([CLEAN_FIXTURE], runner, { embed: sameVecEmbed });
    expect(result.gateCheck).toBeUndefined();
  });

  it("gateCheck passes when current metrics are at or above baseline", async () => {
    const runner = CassetteRunner.fromStore({});
    const zeroMetrics: EvalBaseline = {
      snr: 0,
      perTier: {
        "in-diff": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
        "needs-context": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
        "cross-file": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
      },
      cleanFpr: 0,
      counts: { hit: 0, valid: 0, noise: 0, missed: 0 },
      fixtureCount: 0,
      cleanFixtureCount: 0,
    };
    const result = await runEval([CLEAN_FIXTURE], runner, {
      embed: sameVecEmbed,
      baseline: zeroMetrics,
    });
    expect(result.gateCheck).toBeDefined();
    expect(result.gateCheck!.passed).toBe(true);
  });

  it("gateCheck fails when current cleanFpr rises above baseline", async () => {
    // Clean fixture with a false positive → FPR = 1
    const finding = makeFinding({ message: "false positive" });
    const key = keyForFixture(CLEAN_FIXTURE);
    const store: CassetteStore = {
      [key]: { submission: { findings: [finding] }, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const baselineWithLowFpr: EvalBaseline = {
      snr: 0,
      perTier: {
        "in-diff": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
        "needs-context": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
        "cross-file": {
          fixtureCount: 0,
          hitCount: 0,
          noiseCount: 0,
          validCount: 0,
          missedCount: 0,
          precision: 0,
          recall: 0,
        },
      },
      cleanFpr: 0, // baseline: zero false positives
      counts: { hit: 0, valid: 0, noise: 0, missed: 0 },
      fixtureCount: 1,
      cleanFixtureCount: 1,
    };

    const result = await runEval([CLEAN_FIXTURE], runner, {
      embed: sameVecEmbed,
      baseline: baselineWithLowFpr,
      epsilon: 0.05,
    });

    expect(result.gateCheck!.passed).toBe(false);
    expect(result.gateCheck!.violations.some((v) => v.metric === "cleanFpr")).toBe(true);
  });
});

// ── runEval — multi-fixture metrics ──────────────────────────────────────────

describe("runEval — multi-fixture metrics", () => {
  it("aggregates metrics across multiple fixtures", async () => {
    // SIMPLE_FIXTURE: 1 HIT (finding on line 5, expected on line 5)
    // CLEAN_FIXTURE: 1 NOISE (finding on clean)
    const hitFinding = makeFinding({ message: "off by one", file: "src/a.ts", line: 5 });
    const noiseFinding = makeFinding({ message: "false positive", file: "src/b.ts", line: 1 });

    const key1 = keyForFixture(SIMPLE_FIXTURE);
    const key2 = keyForFixture(CLEAN_FIXTURE);
    const store: CassetteStore = {
      [key1]: { submission: { findings: [hitFinding] }, cost: { durationMs: 50 } },
      [key2]: { submission: { findings: [noiseFinding] }, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE, CLEAN_FIXTURE], runner, { embed: sameVecEmbed });

    expect(result.metrics.counts.hit).toBe(1);
    expect(result.metrics.counts.noise).toBe(1);
    expect(result.metrics.counts.missed).toBe(0);
    // cleanFpr = 1 NOISE / 1 total emitted on clean = 1
    expect(result.metrics.cleanFpr).toBe(1);
    // SNR: (1 HIT + 0 VALID) / 1 NOISE = 1
    expect(result.metrics.snr).toBeCloseTo(1);
  });

  it("uses the custom rubric from cfg for cassette key derivation", async () => {
    const CUSTOM_RUBRIC = "custom rubric";
    const customKey = computeCassetteKey({
      rubric: CUSTOM_RUBRIC,
      userPrompt: buildFixturePrompt(SIMPLE_FIXTURE),
    });
    const finding = makeFinding({ message: "bug", file: "src/a.ts", line: 5 });
    const store: CassetteStore = {
      [customKey]: { submission: { findings: [finding] }, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([SIMPLE_FIXTURE], runner, {
      embed: sameVecEmbed,
      rubric: CUSTOM_RUBRIC,
    });

    expect(result.fixtureResults[0]!.findings).toHaveLength(1);
    expect(result.metrics.counts.hit).toBe(1);
  });
});

// ── runEval — cosine threshold (Finding #9b) ──────────────────────────────────

describe("runEval — cosine threshold", () => {
  it("buckets a within-gate finding as VALID/NOISE (not HIT) when cosine is below threshold", async () => {
    // The finding is on src/a.ts line 5 — inside the location gate of SIMPLE_FIXTURE's expected.
    // But the embedder returns DIFFERENT vectors for the emitted message vs the expected gist,
    // producing a cosine well below 0.80 → the grader must NOT classify it as HIT.
    //
    // Vectors: emitted message → [1, 0, 0, 0], expected gist → [0, 1, 0, 0]
    // cosine([1,0,0,0], [0,1,0,0]) = 0.0 < 0.80 → should NOT become a HIT.

    const emittedMessage = "completely unrelated message text";
    const expectedGist = "off-by-one: arr[arr.length] always undefined";

    // Assign orthogonal vectors: emitted → [1,0,0,0], everything else → [0,1,0,0]
    const lowCosineEmbed: EmbedFn = async (text: string) => {
      if (text === emittedMessage) return [1, 0, 0, 0];
      return [0, 1, 0, 0]; // expectedGist and any other text
    };

    // Fixture with the expected gist matching the expected in SIMPLE_FIXTURE
    const fixture: Fixture = {
      ...SIMPLE_FIXTURE,
      expected: [
        {
          id: "review.bug",
          severity: "error",
          location: { file: "src/a.ts", line: 5 }, // same file/line → inside location gate
          gist: expectedGist,
        },
      ],
    };

    const finding = makeFinding({ message: emittedMessage, file: "src/a.ts", line: 5 });
    const key = keyForFixture(fixture);
    const store: CassetteStore = {
      [key]: { submission: { findings: [finding] }, cost: { durationMs: 50 } },
    };
    const runner = CassetteRunner.fromStore(store);

    const result = await runEval([fixture], runner, {
      embed: lowCosineEmbed,
      // Use default threshold (0.80); cosine = 0.0 → well below it
    });

    const fr = result.fixtureResults[0]!;
    expect(fr.gradeResult.graded).toHaveLength(1);
    // Finding is inside the location gate but cosine < 0.80 → NOT a HIT
    expect(fr.gradeResult.graded[0]!.bucket).not.toBe("HIT");
    // Non-clean fixture → unmatched finding is VALID
    expect(fr.gradeResult.graded[0]!.bucket).toBe("VALID");
    // The expected finding was not matched → missed
    expect(fr.gradeResult.missed).toHaveLength(1);
    expect(result.metrics.counts.hit).toBe(0);
    expect(result.metrics.counts.valid).toBe(1);
  });
});
