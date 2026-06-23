/**
 * eval:live — run the code-review eval with real OpenAI embeddings and update baseline.json
 *
 * Usage:    vp run eval:live
 * Requires: OPENAI_API_KEY env var set to a valid OpenAI key
 *
 * What it does (M3 scaffold):
 *   1. Loads ALL synthetic fixtures from src/eval/fixtures/.
 *   2. Builds a CassetteRunner from src/eval/cassettes/live.json (empty at M3 — misses
 *      produce empty findings for every fixture; specialist will be wired in M5).
 *   3. Runs the eval pipeline with the real OpenAI embedder for semantic grading.
 *   4. Prints metrics to stdout.
 *   5. Checks regression gate against the committed src/eval/baseline.json (if present).
 *   6. Updates src/eval/baseline.json with the freshly computed metrics.
 *
 * In M5, this script will be extended to call real specialist models via a live
 * AgentRunner that populates (and re-records) the cassette from live model calls.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CassetteRunner } from "../agent/cassette-runner.js";
import { ALL_FIXTURES } from "./fixtures/index.js";
import { makeOpenAIEmbedder } from "./grader.js";
import { runEval, EVAL_RUBRIC } from "./runner.js";
import type { EvalBaseline } from "./metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "baseline.json");
const CASSETTE_PATH = resolve(__dirname, "cassettes", "live.json");

// ---------------------------------------------------------------------------
// 1. Check creds
// ---------------------------------------------------------------------------

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(
    "Error: OPENAI_API_KEY is not set.\n" +
      "Set it with:  export OPENAI_API_KEY=sk-...\n" +
      "Then re-run:  vp run eval:live",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Load existing baseline for regression gate
// ---------------------------------------------------------------------------

let baseline: EvalBaseline | undefined;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as EvalBaseline;
  console.log(`Baseline loaded from ${BASELINE_PATH}`);
} catch {
  console.log("No baseline found — this run will establish the initial baseline.");
}

// ---------------------------------------------------------------------------
// 3. Build embedder + runner
// ---------------------------------------------------------------------------

const embed = makeOpenAIEmbedder(apiKey);

// Ensure the cassettes directory exists before CassetteRunner tries to read it
mkdirSync(dirname(CASSETTE_PATH), { recursive: true });

// At M3: replay mode; specialist cassette is empty so findings are {} → empty for all fixtures.
// At M5: switch to CassetteRunner.record(CASSETTE_PATH, liveRunner) to populate real findings.
const runner = CassetteRunner.fromFile(CASSETTE_PATH);

// ---------------------------------------------------------------------------
// 4. Run eval
// ---------------------------------------------------------------------------

console.log(`\nRunning eval against ${ALL_FIXTURES.length} fixtures…`);

const result = await runEval(ALL_FIXTURES, runner, {
  rubric: EVAL_RUBRIC,
  embed,
  baseline,
});

// ---------------------------------------------------------------------------
// 5. Print metrics
// ---------------------------------------------------------------------------

console.log("\n── Metrics ────────────────────────────────────────────────");
console.log(`  SNR:       ${result.metrics.snr.toFixed(3)}`);
console.log(`  Clean FPR: ${result.metrics.cleanFpr.toFixed(3)}`);
console.log(
  `  Counts:    HIT=${result.metrics.counts.hit}  VALID=${result.metrics.counts.valid}  NOISE=${result.metrics.counts.noise}  missed=${result.metrics.counts.missed}`,
);
for (const tier of ["in-diff", "needs-context", "cross-file"] as const) {
  const t = result.metrics.perTier[tier];
  if (t.fixtureCount === 0) continue;
  console.log(
    `  ${tier}: precision=${t.precision.toFixed(3)}  recall=${t.recall.toFixed(3)}  (${t.fixtureCount} fixtures)`,
  );
}

// ---------------------------------------------------------------------------
// 6. Gate check
// ---------------------------------------------------------------------------

if (result.gateCheck) {
  if (result.gateCheck.passed) {
    console.log("\nRegression gate: PASSED ✓");
  } else {
    console.error("\nRegression gate: FAILED ✗");
    for (const v of result.gateCheck.violations) {
      console.error(
        `  ${v.metric}: current=${v.current.toFixed(4)}, baseline=${v.baseline.toFixed(4)}, degradation=${v.degradation.toFixed(4)} > epsilon=${v.epsilon}`,
      );
    }
    // Update baseline before exiting so the failure is recorded
    writeFileSync(BASELINE_PATH, JSON.stringify(result.metrics, null, 2) + "\n");
    console.error(`\nBaseline updated: ${BASELINE_PATH}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 7. Update baseline
// ---------------------------------------------------------------------------

writeFileSync(BASELINE_PATH, JSON.stringify(result.metrics, null, 2) + "\n");
console.log(`\nBaseline updated: ${BASELINE_PATH}`);
