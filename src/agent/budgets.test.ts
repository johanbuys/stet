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

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, test, vi, afterEach } from "vite-plus/test";
import { BudgetError } from "../errors.js";
import { PhaseReport } from "../schema/report.js";
import { FakeAgentRunner } from "./fake-runner.js";
import { runWithWallClock } from "./budgets.js";
import { makeAgentPhase } from "../phases/agent-phase.js";
import type { AgentRunInputs } from "./runner.js";
import type { PhaseContext } from "../phases/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBMIT_SCHEMA = Type.Object({
  findings: Type.Array(Type.Unknown()),
  audit: Type.Optional(Type.Unknown()),
});

function makeInputs(overrides: Partial<AgentRunInputs> = {}): AgentRunInputs {
  return {
    rubric: "test rubric",
    userPrompt: "test prompt",
    toolset: ["bash", "submit_findings"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: { wallClockMs: 100, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 32_768 },
    cwd: "/tmp",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    cwd: "/tmp/repo",
    scope: { kind: "staged" as const, files: ["src/foo.ts"] },
    config: {},
    ...overrides,
  };
}

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
