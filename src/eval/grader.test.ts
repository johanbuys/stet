/**
 * Tests for grader.ts — LLM-judge HIT/VALID/NOISE bucketing (TDD C·2).
 *
 * Run: vp test grader
 *
 * All tests inject a FakeEmbedder (lookup table of text → vector) so no API
 * keys or network access are needed. This models the "runs against synthetic
 * cassettes" requirement from the accept criteria.
 *
 * Coverage:
 *   - cosineSimilarity: identical, orthogonal, general case, zero vectors, mismatched length
 *   - inLocationGate: same-file ±N pass/fail, different file, no location, file-level match
 *   - gradeFindings: HIT, VALID, NOISE, 1-to-1 constraint, empty inputs, multi-finding
 *   - Pinned constants: EMBEDDING_MODEL, COSINE_THRESHOLD, LOCATION_GATE
 */

import { describe, expect, it } from "vite-plus/test";
import type { Finding } from "../schema/finding.js";
import type { ExpectedFinding } from "./fixture.js";
import type { EmbedFn } from "./grader.js";
import {
  COSINE_THRESHOLD,
  EMBEDDING_MODEL,
  LOCATION_GATE,
  cosineSimilarity,
  extractEmbedding,
  gradeFindings,
  inLocationGate,
} from "./grader.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A fake EmbedFn backed by an explicit text→vector lookup table. */
function makeFakeEmbedder(lookup: Record<string, number[]>): EmbedFn {
  return async (text: string): Promise<number[]> => {
    if (Object.prototype.hasOwnProperty.call(lookup, text)) return lookup[text]!;
    throw new Error(`FakeEmbedder: unknown text "${text}"`);
  };
}

/** Minimal valid Finding for test use. */
function makeFinding(
  message: string,
  opts?: {
    file?: string;
    line?: number;
    id?: string;
  },
): Finding {
  return {
    id: opts?.id ?? "review.bug",
    phase: "review",
    severity: "error",
    confidence: "high",
    message,
    ...(opts?.file !== undefined
      ? { location: { file: opts.file, ...(opts.line !== undefined ? { line: opts.line } : {}) } }
      : {}),
  };
}

/** Minimal valid ExpectedFinding. */
function makeExpected(
  gist: string,
  opts?: {
    file?: string;
    line?: number;
  },
): ExpectedFinding {
  return {
    id: "review.bug",
    severity: "error",
    gist,
    ...(opts?.file !== undefined
      ? { location: { file: opts.file, ...(opts.line !== undefined ? { line: opts.line } : {}) } }
      : {}),
  };
}

// Orthonormal 4-D unit vectors for deterministic cosine tests
const V0 = [1, 0, 0, 0]; // "axis 0"
const V1 = [0, 1, 0, 0]; // "axis 1"
const V01 = [0.707, 0.707, 0, 0]; // 45° between V0 and V1

// ── cosineSimilarity ──────────────────────────────────────────────────────────

describe("cosineSimilarity", () => {
  it("returns 1 for identical unit vectors", () => {
    expect(cosineSimilarity(V0, V0)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity(V0, V1)).toBeCloseTo(0);
  });

  it("returns ~0.707 for 45° vectors", () => {
    expect(cosineSimilarity(V0, V01)).toBeCloseTo(Math.SQRT2 / 2, 3);
  });

  it("returns 0 for a zero vector", () => {
    expect(cosineSimilarity([0, 0, 0, 0], V0)).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("handles scaled vectors (not unit-normalized)", () => {
    // [2, 0] and [3, 0] are parallel → cosine 1
    expect(cosineSimilarity([2, 0], [3, 0])).toBeCloseTo(1);
  });
});

// ── extractEmbedding ──────────────────────────────────────────────────────────

describe("extractEmbedding", () => {
  it("returns the embedding vector from a valid response", () => {
    const res = { data: [{ embedding: [0.1, 0.2, 0.3] }] };
    expect(extractEmbedding(res)).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws a descriptive error when data array is empty", () => {
    const res = { data: [] };
    expect(() => extractEmbedding(res)).toThrow(/openai embeddings returned no data/);
  });

  it("throws a descriptive error when data is missing", () => {
    const res = {};
    expect(() => extractEmbedding(res as { data?: { embedding: number[] }[] })).toThrow(
      /openai embeddings returned no data/,
    );
  });
});

// ── inLocationGate ────────────────────────────────────────────────────────────

describe("inLocationGate", () => {
  const GATE = 3;

  it("matches when same file and line difference exactly 0", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist", { file: "src/a.ts", line: 10 });
    expect(inLocationGate(f, x, GATE)).toBe(true);
  });

  it("matches when line difference equals the gate", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist", { file: "src/a.ts", line: 13 });
    expect(inLocationGate(f, x, GATE)).toBe(true);
  });

  it("does not match when line difference exceeds the gate", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist", { file: "src/a.ts", line: 14 });
    expect(inLocationGate(f, x, GATE)).toBe(false);
  });

  it("does not match for different files", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist", { file: "src/b.ts", line: 10 });
    expect(inLocationGate(f, x, GATE)).toBe(false);
  });

  it("returns false when finding has no location", () => {
    const f = makeFinding("msg"); // no location
    const x = makeExpected("gist", { file: "src/a.ts", line: 10 });
    expect(inLocationGate(f, x, GATE)).toBe(false);
  });

  it("returns false when expected has no location", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist"); // no location
    expect(inLocationGate(f, x, GATE)).toBe(false);
  });

  it("file-level match when finding has file but no line", () => {
    const f = makeFinding("msg", { file: "src/a.ts" }); // file, no line
    const x = makeExpected("gist", { file: "src/a.ts", line: 10 });
    expect(inLocationGate(f, x, GATE)).toBe(true);
  });

  it("file-level match when expected has file but no line", () => {
    const f = makeFinding("msg", { file: "src/a.ts", line: 10 });
    const x = makeExpected("gist", { file: "src/a.ts" }); // file, no line
    expect(inLocationGate(f, x, GATE)).toBe(true);
  });

  it("file-level expected (no line) matches a finding far from line 1, same file", () => {
    // A line-less expected is a file-level expectation; the embedding threshold
    // is the only remaining filter.  A finding at line 500 is still a candidate.
    const f = makeFinding("msg", { file: "src/a.ts", line: 500 });
    const x = makeExpected("gist", { file: "src/a.ts" }); // no line → file-level
    expect(inLocationGate(f, x, GATE)).toBe(true);
  });
});

// ── gradeFindings ─────────────────────────────────────────────────────────────

describe("gradeFindings — HIT", () => {
  it("classifies a finding as HIT when location and cosine both match", async () => {
    const finding = makeFinding("null dereference at arr[arr.length]", {
      file: "src/utils.ts",
      line: 5,
    });
    const expected = makeExpected("off-by-one: arr[arr.length] is always undefined", {
      file: "src/utils.ts",
      line: 5,
    });
    const embed = makeFakeEmbedder({
      [finding.message]: V0,
      [expected.gist]: V0, // identical vectors → cosine 1.0
    });

    const { graded, missed } = await gradeFindings([finding], [expected], false, embed);

    expect(graded).toHaveLength(1);
    expect(graded[0]!.bucket).toBe("HIT");
    expect(graded[0]!.matched).toBe(expected);
    expect(missed).toHaveLength(0);
  });

  it("HIT when line difference is exactly at the gate boundary", async () => {
    const finding = makeFinding("divide by zero", { file: "src/math.ts", line: 11 });
    const expected = makeExpected("divide by zero when array empty", {
      file: "src/math.ts",
      line: 11 + LOCATION_GATE, // exactly at the boundary
    });
    const embed = makeFakeEmbedder({ [finding.message]: V0, [expected.gist]: V0 });

    const { graded } = await gradeFindings([finding], [expected], false, embed);
    expect(graded[0]!.bucket).toBe("HIT");
  });

  it("sets matched to the correct ExpectedFinding", async () => {
    const finding = makeFinding("wrong arg order", { file: "src/invoice.ts", line: 11 });
    const exp1 = makeExpected("first expected", { file: "src/invoice.ts", line: 11 });
    const exp2 = makeExpected("second expected", { file: "src/invoice.ts", line: 11 });
    // finding is similar to exp1 but not exp2
    const embed = makeFakeEmbedder({
      [finding.message]: V0,
      [exp1.gist]: V0,
      [exp2.gist]: V1, // orthogonal → cosine 0
    });

    const { graded } = await gradeFindings([finding], [exp1, exp2], false, embed);
    expect(graded[0]!.bucket).toBe("HIT");
    expect(graded[0]!.matched).toBe(exp1);
  });
});

describe("gradeFindings — VALID", () => {
  it("classifies an unmatched finding as VALID on a non-clean fixture", async () => {
    const finding = makeFinding("something real but unseeded", {
      file: "src/a.ts",
      line: 100,
    });
    const expected = makeExpected("a different bug entirely", {
      file: "src/b.ts", // different file → location gate fails
      line: 100,
    });
    const embed = makeFakeEmbedder({}); // no embed calls expected (no candidates)

    const { graded, missed } = await gradeFindings([finding], [expected], false, embed);

    expect(graded[0]!.bucket).toBe("VALID");
    expect(graded[0]!.matched).toBeUndefined();
    expect(missed).toHaveLength(1);
  });

  it("classifies as VALID when location gate passes but cosine is below threshold", async () => {
    const finding = makeFinding("unrelated message", { file: "src/a.ts", line: 5 });
    const expected = makeExpected("completely different gist", { file: "src/a.ts", line: 5 });
    const embed = makeFakeEmbedder({
      [finding.message]: V0,
      [expected.gist]: V1, // orthogonal → cosine 0, below threshold
    });

    const { graded } = await gradeFindings([finding], [expected], false, embed);
    expect(graded[0]!.bucket).toBe("VALID");
  });

  it("classifies finding with no location as VALID on a non-clean fixture", async () => {
    const finding = makeFinding("cross-cutting concern with no location");
    const expected = makeExpected("expected defect", { file: "src/a.ts", line: 5 });
    const embed = makeFakeEmbedder({}); // no location → no candidates → no embed calls

    const { graded } = await gradeFindings([finding], [expected], false, embed);
    expect(graded[0]!.bucket).toBe("VALID");
  });
});

describe("gradeFindings — NOISE", () => {
  it("classifies an unmatched finding as NOISE on a clean fixture", async () => {
    const finding = makeFinding("false positive", { file: "src/a.ts", line: 5 });
    const embed = makeFakeEmbedder({});

    // clean fixture: expected = [] (no ground-truth defects)
    const { graded, missed } = await gradeFindings([finding], [], true, embed);

    expect(graded[0]!.bucket).toBe("NOISE");
    expect(missed).toHaveLength(0);
  });

  it("classifies all findings as NOISE on clean fixture regardless of location", async () => {
    const f1 = makeFinding("msg1", { file: "src/a.ts", line: 1 });
    const f2 = makeFinding("msg2"); // no location
    const embed = makeFakeEmbedder({});

    const { graded } = await gradeFindings([f1, f2], [], true, embed);
    expect(graded.every((g) => g.bucket === "NOISE")).toBe(true);
  });
});

// Vectors for mutual-exclusion test: both f1 and f2 must score ≥ 0.80 vs expected.
// expected gist → VA (unit vector along axis 0).
// f1 embeds to VA itself → cosine ≈ 1.0 (wins).
// f2 embeds to VB which is close-but-not-identical to VA → cosine ≈ 0.95 (also clears 0.80).
// Both clear the threshold, but only one expected slot → the winner is f1; f2 is VALID
// because matchedExpected.has(xIdx) blocks it, NOT because it's below threshold.
const VA = [1, 0, 0, 0]; // "axis 0" — f1 & expected gist
// VB: [cos(18°), sin(18°), 0, 0] ≈ [0.951, 0.309, 0, 0] → cosine(VB, VA) ≈ 0.951 ≥ 0.80
const VB = [0.951, 0.309, 0, 0];

describe("gradeFindings — 1-to-1 constraint", () => {
  it("mutual exclusion: when two findings both clear the threshold for one expected, only the best wins", async () => {
    const f1 = makeFinding("strong match", { file: "src/a.ts", line: 5 });
    const f2 = makeFinding("close-but-second match", { file: "src/a.ts", line: 5 });
    const expected = makeExpected("expected defect", { file: "src/a.ts", line: 5 });

    // cosine(f1, expected) = cosine(VA, VA) = 1.0  ≥ 0.80 ✓
    // cosine(f2, expected) = cosine(VB, VA) ≈ 0.951 ≥ 0.80 ✓  (both clear threshold)
    // f1 wins the slot; f2 is blocked by matchedExpected.has(xIdx) → VALID
    const embed = makeFakeEmbedder({
      [f1.message]: VA,
      [f2.message]: VB,
      [expected.gist]: VA,
    });

    const { graded } = await gradeFindings([f1, f2], [expected], false, embed);

    const f1Grade = graded.find((g) => g.finding === f1)!;
    const f2Grade = graded.find((g) => g.finding === f2)!;

    // f1 wins the expected slot (highest cosine)
    expect(f1Grade.bucket).toBe("HIT");
    // f2 is blocked by mutual exclusion (the slot is taken), NOT by falling below threshold
    expect(f2Grade.bucket).toBe("VALID");
  });

  it("each expected finding matched at most once", async () => {
    const f1 = makeFinding("msg1", { file: "src/a.ts", line: 5 });
    const f2 = makeFinding("msg2", { file: "src/a.ts", line: 5 });
    const exp1 = makeExpected("gist1", { file: "src/a.ts", line: 5 });
    const exp2 = makeExpected("gist2", { file: "src/a.ts", line: 5 });

    const embed = makeFakeEmbedder({
      [f1.message]: V0,
      [f2.message]: V1,
      [exp1.gist]: V0, // f1 matches exp1 (cosine 1.0)
      [exp2.gist]: V1, // f2 matches exp2 (cosine 1.0)
    });

    const { graded, missed } = await gradeFindings([f1, f2], [exp1, exp2], false, embed);

    expect(graded.every((g) => g.bucket === "HIT")).toBe(true);
    expect(missed).toHaveLength(0);
  });
});

describe("gradeFindings — empty inputs", () => {
  it("empty emitted: all expected are missed, graded is empty", async () => {
    const expected = makeExpected("bug", { file: "src/a.ts", line: 5 });
    const embed = makeFakeEmbedder({});

    const { graded, missed } = await gradeFindings([], [expected], false, embed);

    expect(graded).toHaveLength(0);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toBe(expected);
  });

  it("empty expected: all emitted are VALID/NOISE, missed is empty", async () => {
    const finding = makeFinding("some finding", { file: "src/a.ts", line: 5 });
    const embed = makeFakeEmbedder({});

    const { graded: gradedNonClean, missed: missedNonClean } = await gradeFindings(
      [finding],
      [],
      false,
      embed,
    );
    expect(gradedNonClean[0]!.bucket).toBe("VALID");
    expect(missedNonClean).toHaveLength(0);

    const { graded: gradedClean } = await gradeFindings([finding], [], true, embed);
    expect(gradedClean[0]!.bucket).toBe("NOISE");
  });

  it("both empty: empty result", async () => {
    const embed = makeFakeEmbedder({});
    const { graded, missed } = await gradeFindings([], [], false, embed);
    expect(graded).toHaveLength(0);
    expect(missed).toHaveLength(0);
  });
});

describe("gradeFindings — multi-finding scenarios", () => {
  it("mix of HIT and VALID on a non-clean fixture", async () => {
    const hitFinding = makeFinding("off by one at arr.length", { file: "src/a.ts", line: 5 });
    const validFinding = makeFinding("unrelated real bug in a different file");
    const expected = makeExpected("arr[arr.length] always undefined", {
      file: "src/a.ts",
      line: 5,
    });

    const embed = makeFakeEmbedder({
      [hitFinding.message]: V0,
      [expected.gist]: V0,
    });

    const { graded, missed } = await gradeFindings(
      [hitFinding, validFinding],
      [expected],
      false,
      embed,
    );

    expect(graded.find((g) => g.finding === hitFinding)!.bucket).toBe("HIT");
    expect(graded.find((g) => g.finding === validFinding)!.bucket).toBe("VALID");
    expect(missed).toHaveLength(0);
  });
});

// ── Pinned constants ──────────────────────────────────────────────────────────

describe("pinned constants", () => {
  it("EMBEDDING_MODEL is pinned to text-embedding-3-small", () => {
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  it("COSINE_THRESHOLD is pinned to 0.80", () => {
    expect(COSINE_THRESHOLD).toBe(0.8);
  });

  it("LOCATION_GATE is pinned to 3", () => {
    expect(LOCATION_GATE).toBe(3);
  });
});
