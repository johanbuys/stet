/**
 * Grader — LLM-judge HIT/VALID/NOISE bucketing (TDD C·2 / plan §M3b spike).
 *
 * Classifies each emitted finding against the ground-truth expected set:
 *   HIT   — finding matches a seeded expected defect (location gate + embedding ≥ threshold, 1-to-1)
 *   VALID  — finding is unmatched but the fixture is non-clean (real-but-unseeded; counts toward SNR)
 *   NOISE  — finding is unmatched on a clean fixture (false positive; counts against SNR / FPR)
 *
 * The location gate (±N lines, same file) filters candidates; embedding cosine similarity
 * (≥ threshold) confirms semantic match. Greedy 1-to-1 assignment: sort candidate pairs by
 * cosine desc and assign the best still-unmatched pair above the threshold.
 *
 * Pinned embedding: `openai` package · `text-embedding-3-small` · OpenAI endpoint.
 * Cosine threshold: 0.80. Location gate: ±3 lines. Both overridable in GraderConfig.
 *
 * Tests inject a fake EmbedFn; the production embedder is provided by makeOpenAIEmbedder.
 */

import type { Finding } from "../schema/finding.js";
import type { ExpectedFinding } from "./fixture.js";

// ---------------------------------------------------------------------------
// Pinned constants — the spike commitment (no hand-wave; TDD C·2)
// ---------------------------------------------------------------------------

/** npm package used for production embedding. Pinned at version ^6.x. */
export const EMBEDDING_PACKAGE = "openai";

/** Embedding model id — pinned (changing it invalidates existing cassettes). */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Default API base URL for the pinned embedding endpoint. */
export const EMBEDDING_ENDPOINT = "https://api.openai.com/v1";

/** Cosine similarity threshold above which a candidate pair is classified as a HIT. */
export const COSINE_THRESHOLD = 0.8;

/** Lines of tolerance for the location gate (±N). */
export const LOCATION_GATE = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Async function that embeds a single text string into a float vector. */
export type EmbedFn = (text: string) => Promise<number[]>;

/** Grader classification for a single emitted finding. */
export type Bucket = "HIT" | "VALID" | "NOISE";

/** Per-emitted-finding result. */
export interface GradedFinding {
  finding: Finding;
  bucket: Bucket;
  /** The expected finding this was matched to. Present when bucket === "HIT". */
  matched?: ExpectedFinding;
}

/** Return value of gradeFindings. */
export interface GradeResult {
  graded: GradedFinding[];
  /** Expected findings that no emitted finding matched. Used to compute recall. */
  missed: ExpectedFinding[];
}

/** Optional overrides for the grader algorithm. */
export interface GraderConfig {
  /** Override the default LOCATION_GATE (±N lines). */
  locationGate?: number;
  /** Override the default COSINE_THRESHOLD. */
  threshold?: number;
}

// ---------------------------------------------------------------------------
// Cosine similarity — pure utility
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two equal-length float vectors.
 * Returns 0 for zero vectors or mismatched / empty lengths.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Location gate — internal helper
// ---------------------------------------------------------------------------

/**
 * True when `finding` is within the location gate of `expected`.
 *
 * Rules:
 * - finding has no location → never in gate (no spatial anchor)
 * - expected has no location → never in gate (no target to match against)
 * - different files → never in gate
 * - both have lines → gate passes if |diff| ≤ gate
 * - one or both have no line → file-level match: gate passes (line info unavailable)
 */
export function inLocationGate(finding: Finding, expected: ExpectedFinding, gate: number): boolean {
  if (!finding.location || !expected.location) return false;
  if (finding.location.file !== expected.location.file) return false;
  const fLine = finding.location.line;
  const eLine = expected.location.line;
  if (fLine === undefined || eLine === undefined) return true;
  return Math.abs(fLine - eLine) <= gate;
}

// ---------------------------------------------------------------------------
// Main grader
// ---------------------------------------------------------------------------

/**
 * Grade each emitted finding as HIT / VALID / NOISE against the ground-truth set.
 *
 * The algorithm:
 * 1. Build candidate pairs (emitted ↔ expected) via the location gate.
 * 2. Embed emitted messages and expected gists (deduped; async parallel).
 * 3. Score each candidate pair by cosine similarity.
 * 4. Greedy 1-to-1 assignment: highest cosine ≥ threshold → HIT; both sides locked.
 * 5. Unmatched emitted findings → VALID (non-clean fixture) or NOISE (clean fixture).
 *
 * @param emitted  findings emitted by the specialist under eval
 * @param expected ground-truth defects from the fixture
 * @param clean    true when the fixture has no defects (any finding is a false positive)
 * @param embed    embedding function (injectable — tests supply a fake)
 * @param cfg      optional gate/threshold overrides
 */
export async function gradeFindings(
  emitted: Finding[],
  expected: ExpectedFinding[],
  clean: boolean,
  embed: EmbedFn,
  cfg?: GraderConfig,
): Promise<GradeResult> {
  const gate = cfg?.locationGate ?? LOCATION_GATE;
  const threshold = cfg?.threshold ?? COSINE_THRESHOLD;

  // Step 1 — find all (emitted idx, expected idx) pairs that pass the location gate
  const candidates: { eIdx: number; xIdx: number }[] = [];
  for (let eIdx = 0; eIdx < emitted.length; eIdx++) {
    for (let xIdx = 0; xIdx < expected.length; xIdx++) {
      if (inLocationGate(emitted[eIdx]!, expected[xIdx]!, gate)) {
        candidates.push({ eIdx, xIdx });
      }
    }
  }

  // Step 2 — embed unique texts in parallel (avoid re-embedding duplicate messages)
  const scoredCandidates: { eIdx: number; xIdx: number; cosine: number }[] = [];

  if (candidates.length > 0) {
    const emitTexts = [...new Set(candidates.map((c) => emitted[c.eIdx]!.message))];
    const expTexts = [...new Set(candidates.map((c) => expected[c.xIdx]!.gist))];

    const emitVecs = new Map<string, number[]>();
    const expVecs = new Map<string, number[]>();

    await Promise.all([
      ...emitTexts.map(async (t) => emitVecs.set(t, await embed(t))),
      ...expTexts.map(async (t) => expVecs.set(t, await embed(t))),
    ]);

    // Step 3 — score each candidate pair
    for (const { eIdx, xIdx } of candidates) {
      const ev = emitVecs.get(emitted[eIdx]!.message);
      const xv = expVecs.get(expected[xIdx]!.gist);
      if (ev && xv) {
        scoredCandidates.push({ eIdx, xIdx, cosine: cosineSimilarity(ev, xv) });
      }
    }
  }

  // Step 4 — greedy 1-to-1 assignment (highest cosine first)
  scoredCandidates.sort((a, b) => b.cosine - a.cosine);

  const matchedEmit = new Set<number>();
  const matchedExpected = new Set<number>();
  const hitMap = new Map<number, number>(); // eIdx → xIdx

  for (const { eIdx, xIdx, cosine } of scoredCandidates) {
    if (cosine < threshold) break; // sorted desc; remaining all below threshold
    if (matchedEmit.has(eIdx) || matchedExpected.has(xIdx)) continue;
    matchedEmit.add(eIdx);
    matchedExpected.add(xIdx);
    hitMap.set(eIdx, xIdx);
  }

  // Step 5 — build result
  const graded: GradedFinding[] = emitted.map((finding, eIdx) => {
    const xIdx = hitMap.get(eIdx);
    if (xIdx !== undefined) {
      return { finding, bucket: "HIT", matched: expected[xIdx] };
    }
    return { finding, bucket: clean ? "NOISE" : "VALID" };
  });

  const missed = expected.filter((_, xIdx) => !matchedExpected.has(xIdx));

  return { graded, missed };
}

// ---------------------------------------------------------------------------
// Production embedder — pinned to openai + text-embedding-3-small
// ---------------------------------------------------------------------------

/**
 * Create the pinned production EmbedFn.
 *
 * Embedding: `openai` package · model `text-embedding-3-small` · endpoint EMBEDDING_ENDPOINT.
 * Each call makes one HTTP request; callers that need batching should wrap this in a cache.
 *
 * For testing, use a fake EmbedFn instead of this constructor (no API key needed).
 *
 * @param apiKey  OpenAI API key
 * @param baseURL override the endpoint (e.g. for a local proxy or Azure deployment)
 */
export function makeOpenAIEmbedder(apiKey: string, baseURL?: string): EmbedFn {
  // Lazy import so tests that never call this function don't pay the openai import cost.
  // The `openai` package is a runtime dep — available in production.
  return async (text: string): Promise<number[]> => {
    // Dynamic require keeps openai out of the module-level import graph so
    // test files that inject a fake EmbedFn never need an OPENAI_API_KEY env var.
    const { default: OpenAI } = (await import("openai")) as typeof import("openai");
    const client = new OpenAI({ apiKey, baseURL: baseURL ?? EMBEDDING_ENDPOINT });
    const res = await client.embeddings.create({ model: EMBEDDING_MODEL, input: text });
    return res.data[0]!.embedding;
  };
}
