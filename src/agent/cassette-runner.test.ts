/**
 * Tests for CassetteRunner — record/replay at the AgentRunner seam (TDD C·1).
 *
 * Run: vp test cassette-runner
 *
 * Coverage:
 *   - computeCassetteKey: determinism, field isolation, model-undefined normalisation
 *   - CassetteRunner.fromStore: replay hit, replay miss, miss message
 *   - CassetteRunner.fromFile: hit from file, miss from missing file
 *   - CassetteRunner.record: ok run recorded, err run not recorded, accumulation
 *   - Integration: record then fromFile replay reproduces the same result
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { CassetteRunner, computeCassetteKey } from "./cassette-runner.js";
import type { CassetteStore } from "./cassette-runner.js";
import { FakeAgentRunner } from "./fake-runner.js";
import { ModelError } from "../errors.js";
import { makeInputs } from "../test-support/agent-fixtures.js";
import { useTempDir } from "../test-support/temp-dir.js";

// ── helpers ──────────────────────────────────────────────────────────────────

const SUBMISSION = { findings: [{ id: "r.bug", severity: "error", message: "x" }] };
const COST = { model: "fake/model", inputTokens: 10, outputTokens: 5, durationMs: 42 };
const ZERO_COST = { durationMs: 0 };

// ── computeCassetteKey ───────────────────────────────────────────────────────

describe("computeCassetteKey", () => {
  it("same inputs → same key (deterministic)", () => {
    const inputs = makeInputs({ rubric: "rubric A", userPrompt: "prompt B", model: "m/m1" });
    expect(computeCassetteKey(inputs)).toBe(computeCassetteKey(inputs));
  });

  it("different rubric → different key", () => {
    const a = makeInputs({ rubric: "rubric A", userPrompt: "same", model: undefined });
    const b = makeInputs({ rubric: "rubric B", userPrompt: "same", model: undefined });
    expect(computeCassetteKey(a)).not.toBe(computeCassetteKey(b));
  });

  it("different userPrompt → different key", () => {
    const a = makeInputs({ rubric: "same", userPrompt: "prompt A", model: undefined });
    const b = makeInputs({ rubric: "same", userPrompt: "prompt B", model: undefined });
    expect(computeCassetteKey(a)).not.toBe(computeCassetteKey(b));
  });

  it("different model → different key", () => {
    const a = makeInputs({ rubric: "same", userPrompt: "same", model: "fast/model" });
    const b = makeInputs({ rubric: "same", userPrompt: "same", model: "robust/model" });
    expect(computeCassetteKey(a)).not.toBe(computeCassetteKey(b));
  });

  it("model=undefined treated identically to model absent (normalised to null)", () => {
    const withUndefined = makeInputs({ model: undefined });
    // makeInputs does not set model by default, so this tests the ?? null path
    const keyA = computeCassetteKey(withUndefined);
    const keyB = computeCassetteKey({ ...withUndefined, model: undefined });
    expect(keyA).toBe(keyB);
  });

  it("model=undefined and model=null produce the same key", () => {
    const a = makeInputs({ rubric: "r", userPrompt: "u", model: undefined });
    const b = makeInputs({ rubric: "r", userPrompt: "u", model: undefined });
    // Both normalise to null → identical SHA-256
    expect(computeCassetteKey(a)).toBe(computeCassetteKey(b));
  });

  it("key is a 64-character lowercase hex string (SHA-256)", () => {
    const key = computeCassetteKey(makeInputs());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("toolset, budgets, cwd, onTool changes do NOT affect key", () => {
    const base = { rubric: "r", userPrompt: "u", model: undefined };
    const a = makeInputs({ ...base, toolset: ["bash"], cwd: "/a" });
    const b = makeInputs({ ...base, toolset: ["read", "grep"], cwd: "/different" });
    expect(computeCassetteKey(a)).toBe(computeCassetteKey(b));
  });
});

// ── CassetteRunner.fromStore — replay ────────────────────────────────────────

describe("CassetteRunner.fromStore — replay", () => {
  it("key hit → Ok with recorded submission", async () => {
    const inputs = makeInputs({ rubric: "r", userPrompt: "u" });
    const key = computeCassetteKey(inputs);
    const store: CassetteStore = { [key]: { submission: SUBMISSION, cost: COST } };

    const runner = CassetteRunner.fromStore(store);
    const result = await runner.run(inputs);

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.submission).toEqual(SUBMISSION);
  });

  it("key hit → Ok with recorded cost", async () => {
    const inputs = makeInputs({ rubric: "r", userPrompt: "u" });
    const key = computeCassetteKey(inputs);
    const store: CassetteStore = { [key]: { submission: SUBMISSION, cost: COST } };

    const runner = CassetteRunner.fromStore(store);
    const result = await runner.run(inputs);

    expect(result.isOk() && result.value.cost).toEqual(COST);
  });

  it("key miss → Err(NoSubmitError)", async () => {
    const runner = CassetteRunner.fromStore({});
    const result = await runner.run(makeInputs());

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error._tag).toBe("NoSubmitError");
  });

  it("key miss → error message contains 'cassette miss'", async () => {
    const runner = CassetteRunner.fromStore({});
    const result = await runner.run(makeInputs());

    expect(result.isErr() && result.error.message).toMatch(/cassette miss/);
  });

  it("key miss → error message contains key prefix", async () => {
    const inputs = makeInputs();
    const key = computeCassetteKey(inputs);
    const runner = CassetteRunner.fromStore({});
    const result = await runner.run(inputs);

    expect(result.isErr() && result.error.message).toContain(key.slice(0, 16));
  });

  it("multiple entries in store — only the matching entry is returned", async () => {
    const inputsA = makeInputs({ rubric: "rubric A", userPrompt: "u" });
    const inputsB = makeInputs({ rubric: "rubric B", userPrompt: "u" });
    const keyA = computeCassetteKey(inputsA);
    const keyB = computeCassetteKey(inputsB);
    const submissionA = { findings: [{ id: "a" }] };
    const submissionB = { findings: [{ id: "b" }] };
    const store: CassetteStore = {
      [keyA]: { submission: submissionA, cost: ZERO_COST },
      [keyB]: { submission: submissionB, cost: ZERO_COST },
    };

    const runner = CassetteRunner.fromStore(store);
    const resultA = await runner.run(inputsA);
    const resultB = await runner.run(inputsB);

    expect(resultA.isOk() && resultA.value.submission).toEqual(submissionA);
    expect(resultB.isOk() && resultB.value.submission).toEqual(submissionB);
  });

  it("empty store → Err on every run()", async () => {
    const runner = CassetteRunner.fromStore({});
    const r1 = await runner.run(makeInputs());
    const r2 = await runner.run(makeInputs());
    expect(r1.isErr()).toBe(true);
    expect(r2.isErr()).toBe(true);
  });

  it("run() always resolves — never rejects (infallible contract)", async () => {
    const runner = CassetteRunner.fromStore({});
    await expect(runner.run(makeInputs())).resolves.toBeDefined();
  });
});

// ── CassetteRunner.fromFile — replay from file ───────────────────────────────

describe("CassetteRunner.fromFile — replay", () => {
  const tmpDir = useTempDir("stet-cassette-");

  it("file with matching entry → Ok on hit", async () => {
    const inputs = makeInputs({ rubric: "r", userPrompt: "u" });
    const key = computeCassetteKey(inputs);
    const store: CassetteStore = { [key]: { submission: SUBMISSION, cost: COST } };
    const cassettePath = join(tmpDir(), "cassette.json");
    require("node:fs").writeFileSync(cassettePath, JSON.stringify(store, null, 2));

    const runner = CassetteRunner.fromFile(cassettePath);
    const result = await runner.run(inputs);

    expect(result.isOk() && result.value.submission).toEqual(SUBMISSION);
  });

  it("file missing → Err(NoSubmitError) on miss", async () => {
    const cassettePath = join(tmpDir(), "missing.json");
    const runner = CassetteRunner.fromFile(cassettePath);
    const result = await runner.run(makeInputs());

    expect(result.isErr() && result.error._tag).toBe("NoSubmitError");
  });

  it("file present but key absent → Err(NoSubmitError)", async () => {
    const cassettePath = join(tmpDir(), "cassette.json");
    require("node:fs").writeFileSync(cassettePath, JSON.stringify({}));

    const runner = CassetteRunner.fromFile(cassettePath);
    const result = await runner.run(makeInputs());

    expect(result.isErr()).toBe(true);
  });
});

// ── CassetteRunner.record — record mode ──────────────────────────────────────

describe("CassetteRunner.record — record mode", () => {
  const tmpDir = useTempDir("stet-cassette-");

  it("Ok run → writes entry to cassette file", async () => {
    const inputs = makeInputs({ rubric: "r", userPrompt: "u" });
    const key = computeCassetteKey(inputs);
    const cassettePath = join(tmpDir(), "cassette.json");
    const wrapped = new FakeAgentRunner({ kind: "ok", submission: SUBMISSION, cost: COST });

    const runner = CassetteRunner.record(cassettePath, wrapped);
    await runner.run(inputs);

    const written = JSON.parse(readFileSync(cassettePath, "utf8")) as CassetteStore;
    expect(written[key]).toBeDefined();
    expect(written[key]!.submission).toEqual(SUBMISSION);
  });

  it("Ok run → returns the Ok result from the wrapped runner", async () => {
    const inputs = makeInputs();
    const cassettePath = join(tmpDir(), "cassette.json");
    const wrapped = new FakeAgentRunner({ kind: "ok", submission: SUBMISSION, cost: COST });

    const runner = CassetteRunner.record(cassettePath, wrapped);
    const result = await runner.run(inputs);

    expect(result.isOk()).toBe(true);
    expect(result.isOk() && result.value.submission).toEqual(SUBMISSION);
  });

  it("Err run → cassette file NOT written", async () => {
    const cassettePath = join(tmpDir(), "cassette.json");
    const error = new ModelError({ message: "model failed", cost: ZERO_COST });
    const wrapped = new FakeAgentRunner({ kind: "err", error });

    const runner = CassetteRunner.record(cassettePath, wrapped);
    await runner.run(makeInputs());

    expect(require("node:fs").existsSync(cassettePath)).toBe(false);
  });

  it("Err run → returns the Err result from the wrapped runner", async () => {
    const cassettePath = join(tmpDir(), "cassette.json");
    const error = new ModelError({ message: "model failed", cost: ZERO_COST });
    const wrapped = new FakeAgentRunner({ kind: "err", error });

    const runner = CassetteRunner.record(cassettePath, wrapped);
    const result = await runner.run(makeInputs());

    expect(result.isErr() && result.error._tag).toBe("ModelError");
  });

  it("two different inputs → both entries written to the same file", async () => {
    const inputsA = makeInputs({ rubric: "A", userPrompt: "u" });
    const inputsB = makeInputs({ rubric: "B", userPrompt: "u" });
    const keyA = computeCassetteKey(inputsA);
    const keyB = computeCassetteKey(inputsB);
    const cassettePath = join(tmpDir(), "cassette.json");
    const subA = { findings: [{ id: "a" }] };
    const subB = { findings: [{ id: "b" }] };

    const runner = CassetteRunner.record(
      cassettePath,
      new FakeAgentRunner([
        { kind: "ok", submission: subA, cost: ZERO_COST },
        { kind: "ok", submission: subB, cost: ZERO_COST },
      ]),
    );

    await runner.run(inputsA);
    await runner.run(inputsB);

    const written = JSON.parse(readFileSync(cassettePath, "utf8")) as CassetteStore;
    expect(written[keyA]!.submission).toEqual(subA);
    expect(written[keyB]!.submission).toEqual(subB);
  });

  it("re-recording the same key overwrites the previous entry", async () => {
    const inputs = makeInputs({ rubric: "r", userPrompt: "u" });
    const key = computeCassetteKey(inputs);
    const cassettePath = join(tmpDir(), "cassette.json");
    const subFirst = { findings: [{ id: "first" }] };
    const subSecond = { findings: [{ id: "second" }] };

    const runner = CassetteRunner.record(
      cassettePath,
      new FakeAgentRunner([
        { kind: "ok", submission: subFirst, cost: ZERO_COST },
        { kind: "ok", submission: subSecond, cost: ZERO_COST },
      ]),
    );

    await runner.run(inputs);
    await runner.run(inputs);

    const written = JSON.parse(readFileSync(cassettePath, "utf8")) as CassetteStore;
    expect(written[key]!.submission).toEqual(subSecond);
  });

  it("existing file entries at different keys are preserved", async () => {
    const existingInputs = makeInputs({ rubric: "existing", userPrompt: "u" });
    const existingKey = computeCassetteKey(existingInputs);
    const existingEntry: CassetteStore = {
      [existingKey]: { submission: { id: "existing" }, cost: ZERO_COST },
    };
    const cassettePath = join(tmpDir(), "cassette.json");
    require("node:fs").writeFileSync(cassettePath, JSON.stringify(existingEntry, null, 2));

    const newInputs = makeInputs({ rubric: "new", userPrompt: "u" });
    const newKey = computeCassetteKey(newInputs);
    const runner = CassetteRunner.record(
      cassettePath,
      new FakeAgentRunner({ kind: "ok", submission: SUBMISSION, cost: ZERO_COST }),
    );
    await runner.run(newInputs);

    const written = JSON.parse(readFileSync(cassettePath, "utf8")) as CassetteStore;
    expect(written[existingKey]).toBeDefined();
    expect(written[newKey]).toBeDefined();
  });
});

// ── Integration: record → fromFile replay ────────────────────────────────────

describe("CassetteRunner — record then fromFile replay", () => {
  const tmpDir = useTempDir("stet-cassette-");

  it("recorded entry replays correctly from the same file", async () => {
    const inputs = makeInputs({ rubric: "integration rubric", userPrompt: "integration prompt" });
    const cassettePath = join(tmpDir(), "cassette.json");

    // Record
    const recorder = CassetteRunner.record(
      cassettePath,
      new FakeAgentRunner({ kind: "ok", submission: SUBMISSION, cost: COST }),
    );
    await recorder.run(inputs);

    // Replay
    const replayer = CassetteRunner.fromFile(cassettePath);
    const replayResult = await replayer.run(inputs);

    expect(replayResult.isOk()).toBe(true);
    expect(replayResult.isOk() && replayResult.value.submission).toEqual(SUBMISSION);
    expect(replayResult.isOk() && replayResult.value.cost).toEqual(COST);
  });

  it("replay with different inputs → Err (not the recorded entry)", async () => {
    const recordedInputs = makeInputs({ rubric: "recorded", userPrompt: "u" });
    const differentInputs = makeInputs({ rubric: "different", userPrompt: "u" });
    const cassettePath = join(tmpDir(), "cassette.json");

    const recorder = CassetteRunner.record(
      cassettePath,
      new FakeAgentRunner({ kind: "ok", submission: SUBMISSION, cost: COST }),
    );
    await recorder.run(recordedInputs);

    const replayer = CassetteRunner.fromFile(cassettePath);
    const result = await replayer.run(differentInputs);

    expect(result.isErr() && result.error._tag).toBe("NoSubmitError");
  });
});
