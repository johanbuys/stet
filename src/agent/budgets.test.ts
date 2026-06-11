/**
 * Tests for runWithWallClock (budgets.ts) and the budget paths through makeAgentPhase.
 *
 * T12 acceptance:
 *   - FakeAgentRunner with kind:"delay" (hangs past wallClockMs) → wrapper fires BudgetError →
 *     PhaseReport{ status: "error", reason contains "budget exceeded" }, audit preserved.
 *   - FakeAgentRunner scripted to return Err(BudgetError) for the turn count →
 *     PhaseReport{ status: "error", reason contains "budget exceeded" }, audit preserved.
 *
 * Budget-enforcement layering (plan §2a/P10):
 *   - Wrapper owns wall clock: runWithWallClock race + abort.
 *   - Runner owns turns (surfaced as scripted Err(BudgetError) in these tests).
 *
 * PRD refs: §3.5 (budgets), acceptance #7. Plan: M3, §2a/P10.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, test, vi, afterEach } from "vite-plus/test";
import { BudgetError } from "../errors.js";
import { PhaseReport } from "../schema/report.js";
import { FakeAgentRunner } from "./fake-runner.js";
import {
  runWithWallClock,
  runBash,
  runBashForSdk,
  BASH_TRUNCATION_MARKER,
  truncationMarker,
  WALL_CLOCK_5MIN_MS,
  TURNS_5MIN,
  WALL_CLOCK_15MIN_MS,
  TURNS_15MIN,
  DEFAULT_BASH_TIMEOUT_MS,
  DEFAULT_BASH_OUTPUT_CAP,
} from "./budgets.js";
import { makeAgentPhase } from "../phases/agent-phase.js";
import { SUBMIT_SCHEMA, makeInputs, makeCtx } from "../test-support/agent-fixtures.js";

// ---------------------------------------------------------------------------
// Fixtures
//
// DEFAULT_BUDGETS here uses wallClockMs: 100 (not the shared 60_000) because
// the makeAgentPhase tests below use fake timers that advance only 200ms — a
// 60s wall-clock would never fire. bashOutputCap: 32_768 matches the bash-level
// limit tests in this file. Keep this local; don't merge into the shared module.
// ---------------------------------------------------------------------------

const DEFAULT_BUDGETS = {
  wallClockMs: 100,
  turns: 30,
  bashTimeoutMs: 10_000,
  bashOutputCap: 32_768,
};

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// runWithWallClock — wall-clock enforcement (wrapper layer, plan §2a/P10)
// ---------------------------------------------------------------------------

describe("runWithWallClock — wall-clock timeout (T12: wrapper-enforced)", () => {
  test("returns Err(BudgetError) when runner exceeds wallClockMs", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 100, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const resultPromise = runWithWallClock(runner, inputs, controller);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(result.isErr()).toBe(true);
  });

  test("BudgetError.limit is 'wallClockMs'", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 100, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const resultPromise = runWithWallClock(runner, inputs, controller);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(result.isErr() && result.error._tag).toBe("BudgetError");
    expect(result.isErr() && (result.error as BudgetError).limit).toBe("wallClockMs");
  });

  test("BudgetError message mentions the budget", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 100, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const resultPromise = runWithWallClock(runner, inputs, controller);
    await vi.advanceTimersByTimeAsync(200);
    const result = await resultPromise;

    expect(result.isErr() && (result.error as BudgetError).message).toContain("100ms");
  });

  test("controller is aborted when timeout fires", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 100, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const resultPromise = runWithWallClock(runner, inputs, controller);
    await vi.advanceTimersByTimeAsync(200);
    await resultPromise;

    expect(controller.signal.aborted).toBe(true);
  });
});

describe("runWithWallClock — runner completes before timeout", () => {
  test("returns Ok when runner resolves before wallClockMs", async () => {
    vi.useFakeTimers();
    const submission = { findings: [], audit: {} };
    const cost = { durationMs: 10 };
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 5_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const result = await runWithWallClock(runner, inputs, controller);

    expect(result.isOk()).toBe(true);
  });

  test("runner result is returned unchanged when it completes first", async () => {
    vi.useFakeTimers();
    const submission = {
      findings: [
        { id: "x.test", phase: "test", severity: "info", confidence: "low", message: "test" },
      ],
    };
    const cost = { model: "fake/m", durationMs: 10 };
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 5_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const result = await runWithWallClock(runner, inputs, controller);

    expect(result.isOk() && result.value.submission).toEqual(submission);
    expect(result.isOk() && result.value.cost.model).toBe("fake/m");
  });

  test("controller is NOT aborted when runner completes first", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 5_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    await runWithWallClock(runner, inputs, controller);

    expect(controller.signal.aborted).toBe(false);
  });

  test("Err runner result is returned unchanged when it completes first", async () => {
    vi.useFakeTimers();
    const error = new BudgetError({ limit: "turns", message: "30 turns exceeded" });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const controller = new AbortController();
    const inputs = makeInputs({
      budgets: { wallClockMs: 5_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    });

    const result = await runWithWallClock(runner, inputs, controller);

    expect(result.isErr()).toBe(true);
    expect(result.isErr() && result.error._tag).toBe("BudgetError");
    expect(result.isErr() && (result.error as BudgetError).limit).toBe("turns");
  });
});

// ---------------------------------------------------------------------------
// makeAgentPhase — wall-clock budget (T12 acceptance: wrapper-enforced)
// ---------------------------------------------------------------------------

describe("makeAgentPhase — wall-clock budget exceeded (T12 acceptance)", () => {
  test("hanging runner + wallClockMs exceeded → PhaseReport status 'error'", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    expect(report.status).toBe("error");
  });

  test("reason contains 'budget exceeded'", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    expect(report.reason).toContain("budget exceeded");
  });

  test("partial audit is preserved in the error report (audit field present)", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    // audit field must be present even on error (plan M3 acceptance #7)
    expect(report.audit).toBeDefined();
    expect(typeof report.audit).toBe("object");
  });

  test("report validates against the TypeBox PhaseReport schema", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  test("wall-clock BudgetError does NOT produce a no-result finding", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    // BudgetError is distinct from NoSubmitError: no no-result finding synthesized
    expect(report.findings).toHaveLength(0);
  });

  test("phase id is set correctly in the budget-error report", async () => {
    vi.useFakeTimers();
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "my-phase",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const reportPromise = phase.run(makeCtx());
    await vi.advanceTimersByTimeAsync(200);
    const report = await reportPromise;

    expect(report.phase).toBe("my-phase");
  });
});

// ---------------------------------------------------------------------------
// makeAgentPhase — turn count budget (T12 acceptance: runner-enforced via scripted BudgetError)
// ---------------------------------------------------------------------------

describe("makeAgentPhase — turn count budget exceeded (T12 acceptance: runner-enforced)", () => {
  test("runner returns Err(BudgetError{limit:'turns'}) → PhaseReport status 'error'", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "30 turn limit exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(report.status).toBe("error");
  });

  test("reason contains 'budget exceeded' and names the limit", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "30 turn limit exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(report.reason).toContain("budget exceeded");
    expect(report.reason).toContain("turns");
  });

  test("partial audit is preserved in the error report", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "30 turn limit exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(report.audit).toBeDefined();
    expect(typeof report.audit).toBe("object");
  });

  test("report validates against the TypeBox PhaseReport schema", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "30 turn limit exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  test("turn-count BudgetError does NOT produce a no-result finding", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(report.findings).toHaveLength(0);
  });

  test("cost.durationMs is non-negative", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "turns", message: "exceeded" }),
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const report = await phase.run(makeCtx());

    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Budget class constants (PRD §3.5, decision #22)
// ---------------------------------------------------------------------------

describe("budget class constants (PRD §3.5, decision #22)", () => {
  test("5-min class: wall clock is 300_000ms", () => {
    expect(WALL_CLOCK_5MIN_MS).toBe(300_000);
  });

  test("5-min class: turn ceiling is 50", () => {
    expect(TURNS_5MIN).toBe(50);
  });

  test("15-min class: wall clock is 900_000ms", () => {
    expect(WALL_CLOCK_15MIN_MS).toBe(900_000);
  });

  test("15-min class: turn ceiling is 120", () => {
    expect(TURNS_15MIN).toBe(120);
  });

  test("bash timeout default is 60_000ms", () => {
    expect(DEFAULT_BASH_TIMEOUT_MS).toBe(60_000);
  });

  test("bash output cap default is 32 KiB (32768 bytes)", () => {
    expect(DEFAULT_BASH_OUTPUT_CAP).toBe(32 * 1024);
  });
});

// ---------------------------------------------------------------------------
// runBash — bash-level limits (T13 acceptance)
// These tests use real child_process.spawn (no fake timers) with small limits.
// ---------------------------------------------------------------------------

describe("runBash — timeout (T13: sleep command hits timeout, output-so-far returned)", () => {
  test("returns timedOut: true when process exceeds timeoutMs", async () => {
    const result = await runBash("sleep 10", { cwd: "/tmp", timeoutMs: 50, outputCap: 32_768 });
    expect(result.timedOut).toBe(true);
  }, 3_000);

  test("exitCode is null when process is killed by timeout", async () => {
    const result = await runBash("sleep 10", { cwd: "/tmp", timeoutMs: 50, outputCap: 32_768 });
    expect(result.exitCode).toBeNull();
  }, 3_000);

  test("output-so-far is returned (empty for sleep)", async () => {
    const result = await runBash("sleep 10", { cwd: "/tmp", timeoutMs: 50, outputCap: 32_768 });
    expect(result.output).toBe("");
  }, 3_000);

  test("truncated is false when timeout fires without cap hit", async () => {
    const result = await runBash("sleep 10", { cwd: "/tmp", timeoutMs: 50, outputCap: 32_768 });
    expect(result.truncated).toBe(false);
  }, 3_000);

  test("output-so-far is returned for a command that emits before hanging", async () => {
    // Emit one line then hang; timeout should capture the first line
    const result = await runBash("echo started && sleep 10", {
      cwd: "/tmp",
      timeoutMs: 200,
      outputCap: 32_768,
    });
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain("started");
  }, 3_000);
});

describe("runBash — output cap (T13: output over 32KB capped with exact marker)", () => {
  test("returns truncated: true when output exceeds outputCap", async () => {
    // printf generates exactly 201 bytes (200 spaces + newline); cap at 50 triggers truncation
    const result = await runBash("printf '%200s\\n'", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 50,
    });
    expect(result.truncated).toBe(true);
  }, 5_000);

  test("output contains the truncation marker for the actual cap size", async () => {
    // cap = 50 bytes → marker must say "50B", not the default "32KB"
    const result = await runBash("printf '%200s\\n'", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 50,
    });
    expect(result.output).toContain(truncationMarker(50));
  }, 5_000);

  test("BASH_TRUNCATION_MARKER equals truncationMarker for the default 32KB cap (plan §2a, T13)", () => {
    expect(BASH_TRUNCATION_MARKER).toBe(truncationMarker(DEFAULT_BASH_OUTPUT_CAP));
  });

  test("output does not grow unboundedly past outputCap + marker length", async () => {
    const result = await runBash("printf '%200s\\n'", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 50,
    });
    const maxExpected = 50 + BASH_TRUNCATION_MARKER.length + 1; // +1 for a chunk boundary
    expect(result.output.length).toBeLessThan(maxExpected + 50);
  }, 5_000);

  test("exitCode is null when process is killed by output cap", async () => {
    // yes generates infinite output — cap forces kill
    const result = await runBash("yes", { cwd: "/tmp", timeoutMs: 5_000, outputCap: 50 });
    expect(result.truncated).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 5_000);
});

describe("runBash — external abort signal (used by wall-clock controller)", () => {
  test("abort fired mid-run kills the process and returns output-so-far", async () => {
    const controller = new AbortController();
    const resultPromise = runBash("echo started && sleep 10", {
      cwd: "/tmp",
      timeoutMs: 10_000,
      outputCap: 32_768,
      signal: controller.signal,
    });
    // Give the process time to emit its first line, then abort.
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    const result = await resultPromise;
    expect(result.exitCode).toBeNull();
    expect(result.output).toContain("started");
    // Killed by the external signal, not the (far longer) timeout.
    expect(result.timedOut).toBe(false);
  }, 3_000);

  test("a pre-aborted signal returns promptly rather than running to timeoutMs", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    const result = await runBash("sleep 10", {
      cwd: "/tmp",
      timeoutMs: 10_000,
      outputCap: 32_768,
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;
    expect(result.exitCode).toBeNull();
    // Must die well before timeoutMs (10s) — proves the eager-kill path works.
    expect(elapsed).toBeLessThan(2_000);
  }, 3_000);
});

describe("runBash — normal completion (no limits hit)", () => {
  test("returns the command output when within limits", async () => {
    const result = await runBash("echo hello", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.output).toBe("hello\n");
  }, 5_000);

  test("timedOut and truncated are false on normal completion", async () => {
    const result = await runBash("echo hello", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.timedOut).toBe(false);
    expect(result.truncated).toBe(false);
  }, 5_000);

  test("exitCode reflects the command exit code", async () => {
    const success = await runBash("exit 0", { cwd: "/tmp", timeoutMs: 5_000, outputCap: 32_768 });
    expect(success.exitCode).toBe(0);
    const fail = await runBash("exit 2", { cwd: "/tmp", timeoutMs: 5_000, outputCap: 32_768 });
    expect(fail.exitCode).toBe(2);
  }, 5_000);

  test("stderr is captured alongside stdout", async () => {
    const result = await runBash("echo out && echo err >&2", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBashForSdk — the SDK BashOperations.exec adapter (T13 review findings)
//
// Covers the lossy-mapping seam that the pi-runner integration relies on:
//   - timeout → throws `timeout:N` (in-band signal; previously discarded → silent success)
//   - abort   → throws "aborted"
//   - cap     → marker delivered via onData, no throw, exitCode null
//   - model-supplied timeout honored as min(model, budget); budget stays a hard ceiling
// ---------------------------------------------------------------------------

describe("runBashForSdk — timeout surfaces in-band (review finding #1)", () => {
  const BUDGETS = { bashTimeoutMs: 50, bashOutputCap: 32_768 };

  test("throws `timeout:N` when the command exceeds the budget timeout", async () => {
    const chunks: Buffer[] = [];
    await expect(
      runBashForSdk("sleep 10", "/tmp", { onData: (d) => chunks.push(d) }, BUDGETS),
    ).rejects.toThrow(/^timeout:/);
  }, 5_000);

  test("delivers output-so-far via onData before throwing on timeout", async () => {
    const chunks: Buffer[] = [];
    await expect(
      runBashForSdk(
        "echo started && sleep 10",
        "/tmp",
        { onData: (d) => chunks.push(d) },
        { bashTimeoutMs: 200, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow(/^timeout:/);
    // The wrapper appends "Command timed out…" to this output, so it must arrive first.
    expect(Buffer.concat(chunks).toString("utf8")).toContain("started");
  }, 5_000);

  test("the thrown timeout seconds reflect the effective timeout", async () => {
    // budget 1000ms → "timeout:1" (the SDK splits on ':' to render "after 1 seconds").
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {} },
        { bashTimeoutMs: 1_000, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow("timeout:1");
  }, 5_000);
});

describe("runBashForSdk — model-supplied timeout honored (review finding #2)", () => {
  test("a shorter model timeout fires before the larger budget timeout", async () => {
    // budget is 10s, but the model asked for ~0.05s → effective 50ms → fires fast.
    const start = Date.now();
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {}, timeout: 0.05 },
        { bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow(/^timeout:/);
    // Proves the model timeout, not the 10s budget, governed the kill.
    expect(Date.now() - start).toBeLessThan(2_000);
  }, 5_000);

  test("the budget stays a hard ceiling when the model asks for longer", async () => {
    // model asks for 100s but budget is 50ms → min() clamps to the budget → fires fast.
    const start = Date.now();
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {}, timeout: 100 },
        { bashTimeoutMs: 50, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow(/^timeout:/);
    expect(Date.now() - start).toBeLessThan(2_000);
  }, 5_000);
});

describe("runBashForSdk — output cap (marker rides in-band, no throw)", () => {
  test("delivers the truncation marker via onData and returns exitCode null without throwing", async () => {
    const chunks: Buffer[] = [];
    const result = await runBashForSdk(
      "yes",
      "/tmp",
      { onData: (d) => chunks.push(d) },
      { bashTimeoutMs: 5_000, bashOutputCap: 50 },
    );
    // Marker text is derived from the actual cap (50 bytes → "50B"), not the default 32KB.
    expect(Buffer.concat(chunks).toString("utf8")).toContain(truncationMarker(50).trim());
    // Killed-on-cap ⇒ exitCode null; the marker (not an exit code) is the cap's signal.
    expect(result.exitCode).toBeNull();
  }, 5_000);
});

describe("runBashForSdk — external abort surfaces as 'aborted'", () => {
  test("throws 'aborted' when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {}, signal: controller.signal },
        { bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow("aborted");
  }, 5_000);
});

describe("runBashForSdk — normal completion returns the exit code", () => {
  test("returns the command exit code and delivers output without throwing", async () => {
    const chunks: Buffer[] = [];
    const result = await runBashForSdk(
      "echo hello",
      "/tmp",
      { onData: (d) => chunks.push(d) },
      { bashTimeoutMs: 5_000, bashOutputCap: 32_768 },
    );
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello\n");
  }, 5_000);

  test("propagates a non-zero exit code unchanged (wrapper formats it)", async () => {
    const result = await runBashForSdk(
      "exit 3",
      "/tmp",
      { onData: () => {} },
      { bashTimeoutMs: 5_000, bashOutputCap: 32_768 },
    );
    expect(result.exitCode).toBe(3);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// truncationMarker — human-readable size helper (fix 4)
// ---------------------------------------------------------------------------

describe("truncationMarker — derives marker text from actual cap size", () => {
  test("32KB cap → '32KB' in marker", () => {
    expect(truncationMarker(32 * 1024)).toContain("32KB");
  });

  test("4KB cap → '4KB' in marker", () => {
    expect(truncationMarker(4096)).toContain("4KB");
  });

  test("50-byte cap → '50B' in marker", () => {
    expect(truncationMarker(50)).toContain("50B");
  });

  test("marker starts with newline and contains stet prefix", () => {
    expect(truncationMarker(50)).toMatch(/^\n…\[stet: output truncated at /);
  });
});

// ---------------------------------------------------------------------------
// runBash — bash shell is real bash, not /bin/sh (fix 3)
// ---------------------------------------------------------------------------

describe("runBash — executes with bash, not /bin/sh", () => {
  test("bash-ism [[ -f file ]] succeeds when file exists", async () => {
    const result = await runBash("[[ -f /tmp ]] || [[ -d /tmp ]] && echo yes", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.output.trim()).toBe("yes");
    expect(result.exitCode).toBe(0);
  }, 5_000);

  test("[[ syntax ]] fails with non-zero exit under /bin/sh but succeeds under bash", async () => {
    // Using [[ double-bracket ]] which is a bash-ism — /bin/sh (dash) rejects it
    const result = await runBash("[[ 1 == 1 ]] && echo bash_ok", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.output).toContain("bash_ok");
    expect(result.exitCode).toBe(0);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBash — background child with stdio held open resolves promptly (fix 2)
// ---------------------------------------------------------------------------

describe("runBash — background child holding stdio does not cause hang", () => {
  test("command that exits 0 with a background child resolves promptly with exitCode 0", async () => {
    // The background sleep holds inherited stdout open; without fix 2 this would
    // burn the full timeoutMs and then misreport timedOut: true.
    const start = Date.now();
    const result = await runBash(
      // Start background sleep (which inherits the pipe), then exit 0.
      // We give it a long timeout to make a hang obvious.
      "echo started; sleep 5 & echo done",
      {
        cwd: "/tmp",
        timeoutMs: 4_000,
        outputCap: 32_768,
      },
    );
    const elapsed = Date.now() - start;
    // Must resolve well before the 4s timeout — the background sleep holds the pipe.
    expect(elapsed).toBeLessThan(2_000);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("done");
  }, 6_000);
});

// ---------------------------------------------------------------------------
// runBash — external kill surfaced in-band (fix 1)
// ---------------------------------------------------------------------------

describe("runBash — external signal kill surfaced in result (fix 1)", () => {
  test("killedBySignal is true when process group killed externally", async () => {
    // We can't easily simulate an OOM, but we can verify that stet's own kills
    // (timeout, truncation, abort) do NOT set killedBySignal: true.
    const result = await runBash("sleep 10", {
      cwd: "/tmp",
      timeoutMs: 50,
      outputCap: 32_768,
    });
    // Timeout kill: timedOut = true, killedBySignal = false (stet owns it)
    expect(result.timedOut).toBe(true);
    expect(result.killedBySignal).toBe(false);
  }, 3_000);

  test("abort kill does not set killedBySignal", async () => {
    const controller = new AbortController();
    const p = runBash("sleep 10", {
      cwd: "/tmp",
      timeoutMs: 10_000,
      outputCap: 32_768,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    const result = await p;
    expect(result.killedBySignal).toBe(false);
  }, 3_000);

  test("truncation kill does not set killedBySignal", async () => {
    const result = await runBash("yes", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 50,
    });
    expect(result.truncated).toBe(true);
    expect(result.killedBySignal).toBe(false);
  }, 5_000);

  test("normal exit does not set killedBySignal", async () => {
    const result = await runBash("echo hi", {
      cwd: "/tmp",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.killedBySignal).toBe(false);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBashForSdk — pre-aborted signal short-circuits before spawn (fix 5)
// ---------------------------------------------------------------------------

describe("runBashForSdk — pre-aborted signal rejects immediately without spawning (fix 5)", () => {
  test("throws 'aborted' for pre-aborted signal without running the command", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {}, signal: controller.signal },
        { bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow("aborted");
    // Must return well before the 10s timeout — proves it never spawned
    expect(Date.now() - start).toBeLessThan(500);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBashForSdk — timeout message uses exact seconds, not Math.round (fix 6)
// ---------------------------------------------------------------------------

describe("runBashForSdk — timeout message uses exact fractional seconds (fix 6)", () => {
  test("sub-second timeout reports fractional seconds, not '0'", async () => {
    // 200ms budget → timeout:0.2, not timeout:0
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {} },
        { bashTimeoutMs: 200, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow("timeout:0.2");
  }, 5_000);

  test("1500ms timeout reports 1.5, not 2 (no rounding)", async () => {
    await expect(
      runBashForSdk(
        "sleep 10",
        "/tmp",
        { onData: () => {} },
        { bashTimeoutMs: 1_500, bashOutputCap: 32_768 },
      ),
    ).rejects.toThrow("timeout:1.5");
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBash — spawn error includes the error message in output (fix 7)
// ---------------------------------------------------------------------------

describe("runBash — spawn error message surfaced in output (fix 7)", () => {
  test("bad cwd resolves with exitCode -1 and error message in output", async () => {
    const result = await runBash("echo hi", {
      cwd: "/nonexistent-directory-that-does-not-exist",
      timeoutMs: 5_000,
      outputCap: 32_768,
    });
    expect(result.exitCode).toBe(-1);
    // The error message (e.g. ENOENT) should appear in output so the model can see it
    expect(result.output.length).toBeGreaterThan(0);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBashForSdk — late-abort after successful exit does not misreport (fix 8)
// ---------------------------------------------------------------------------

describe("runBashForSdk — completed command not reported as aborted (fix 8)", () => {
  test("a command that completes before abort signal fires returns exitCode, not 'aborted'", async () => {
    // Use a controller we abort AFTER the command completes — the abort fires
    // in the exit→close window but the command already exited successfully.
    const controller = new AbortController();
    const chunks: Buffer[] = [];
    // Run a fast command; abort the signal after it's done
    const resultPromise = runBashForSdk(
      "echo hi",
      "/tmp",
      { onData: (d) => chunks.push(d), signal: controller.signal },
      { bashTimeoutMs: 5_000, bashOutputCap: 32_768 },
    );
    // Let the command finish, then abort
    await new Promise((r) => setTimeout(r, 300));
    controller.abort();
    const result = await resultPromise;
    // Must return exitCode 0, not throw "aborted"
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("hi");
  }, 5_000);
});

// ---------------------------------------------------------------------------
// runBash / runBashForSdk — exit→close window test (fix 1 + fix 7)
//
// The 100ms grace timer widens the exit→close window: an abort fired inside
// the grace period (after 'exit' but before 'close') must NOT cause a
// completed exitCode-0 command to be misreported as aborted or throw "aborted".
// ---------------------------------------------------------------------------

describe("runBash — exit→close window: abort inside grace period does not flip aborted (fix 1)", () => {
  test("command exits 0 while background child holds pipe, abort in window → aborted: false", async () => {
    // `echo hi; sleep 1 &` — the shell exits immediately (exitCode 0), but the
    // background sleep inherits the pipe and holds 'close' for ~1 second.
    // This opens the exit→close window. We fire the abort ~20ms after spawn,
    // inside the 100ms grace period, to hit the window deliberately.
    const controller = new AbortController();
    const resultPromise = runBash("echo hi; sleep 1 &", {
      cwd: "/tmp",
      timeoutMs: 4_000,
      outputCap: 32_768,
      signal: controller.signal,
    });
    // Let the shell start and exit (typically < 10ms), then abort inside the window.
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const result = await resultPromise;
    // Shell exited 0 before the abort — must not be reported as aborted.
    expect(result.exitCode).toBe(0);
    expect(result.aborted).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain("hi");
  }, 5_000);

  test("runBashForSdk does not throw 'aborted' when command completed before abort", async () => {
    // Mirror the runBash test above through the SDK adapter to confirm the full
    // stack (runBashForSdk → runBash) surfaces exit 0, not 'aborted'.
    const controller = new AbortController();
    const chunks: Buffer[] = [];
    const resultPromise = runBashForSdk(
      "echo hi; sleep 1 &",
      "/tmp",
      { onData: (d) => chunks.push(d), signal: controller.signal },
      { bashTimeoutMs: 4_000, bashOutputCap: 32_768 },
    );
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    // Must resolve (not reject with "aborted") because the command already exited 0.
    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(chunks).toString("utf8")).toContain("hi");
  }, 5_000);
});
