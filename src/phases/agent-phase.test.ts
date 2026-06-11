/**
 * Tests for makeAgentPhase — the phase wrapper that turns an AgentRunner into a
 * PhaseConfiguration-compatible run, mapping runner Results to PhaseReport.
 *
 * T7 acceptance:
 *   - FakeAgentRunner scripted to "submit once with N findings" → PhaseReport
 *     { status: "completed", findings (carrying through), audit, cost }.
 *   - Err(AgentError) for each variant → PhaseReport { status: "error", reason }.
 *   - Wrapper never throws, never rejects.
 *
 * PRD refs: §4.1 (PhaseConfiguration), §4.4 (PhaseReport).
 * Plan refs: §2a M2 step 1, decisions P1/P10.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, test } from "vite-plus/test";
import { BudgetError, CancelledError, ModelError, NoSubmitError } from "../errors.js";
import { PhaseReport } from "../schema/report.js";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { makeAgentPhase } from "./agent-phase.js";
import { SUBMIT_SCHEMA, DEFAULT_BUDGETS, makeCtx } from "../test-support/agent-fixtures.js";
import type { PhaseContext } from "./types.js";

/** Minimal valid Finding payload. */
function makeFinding(id = "test.finding") {
  return {
    id,
    phase: "test-agent",
    severity: "info" as const,
    confidence: "low" as const,
    message: "test finding",
  };
}

// ---------------------------------------------------------------------------
// Phase identity
// ---------------------------------------------------------------------------

describe("makeAgentPhase — identity", () => {
  test("id matches config id", () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    expect(phase.id).toBe("test-agent");
  });

  test("kind is 'agent'", () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    expect(phase.kind).toBe("agent");
  });

  test("activation defaults to always-true", () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const ctx = { scope: { kind: "staged" as const, files: [] } };
    expect(phase.activation(ctx)).toBe(true);
  });

  test("custom activation predicate is used", () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
      activation: () => false,
    });
    const ctx = { scope: { kind: "staged" as const, files: ["a.ts"] } };
    expect(phase.activation(ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Happy path — the T7 acceptance test
// ---------------------------------------------------------------------------

describe("makeAgentPhase — happy path (Ok runner)", () => {
  const findings = [makeFinding("test.finding-1"), makeFinding("test.finding-2")];
  const audit = {
    examined: ["src/foo.ts"],
    claims: { derived: ["x"], proven: ["x"], unproven: [] },
  };
  const cost = { model: "fake/model", inputTokens: 10, outputTokens: 5, durationMs: 42 };

  function makeHappyRunner() {
    return new FakeAgentRunner({
      kind: "ok",
      submission: { findings, audit },
      cost,
    });
  }

  test('status is "completed" on Ok submission', async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.status).toBe("completed");
  });

  test("findings carry through from submission (N findings)", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.findings).toHaveLength(2);
    expect(report.findings[0]?.id).toBe("test.finding-1");
    expect(report.findings[1]?.id).toBe("test.finding-2");
  });

  test("audit carries through from submission", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.audit.examined).toEqual(["src/foo.ts"]);
  });

  test("cost fields carry through (model, inputTokens, outputTokens)", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.cost.model).toBe("fake/model");
    expect(report.cost.inputTokens).toBe(10);
    expect(report.cost.outputTokens).toBe(5);
  });

  test("cost.durationMs is a non-negative number", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("phase is the configured id", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
      id: "my-phase",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.phase).toBe("my-phase");
  });

  test("report validates against the TypeBox PhaseReport schema", async () => {
    const phase = makeAgentPhase(makeHappyRunner(), {
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

  test("zero findings submission → completed with empty findings array", async () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 1 },
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
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error path — one test per AgentError variant
// ---------------------------------------------------------------------------

describe("makeAgentPhase — error path (NoSubmitError)", () => {
  test('NoSubmitError → status "error"', async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({
        message: "agent finished without submitting",
        cost: { durationMs: 50 },
      }),
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

  test("NoSubmitError reason contains the error message", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({
        message: "agent finished without submitting",
        cost: { durationMs: 50 },
      }),
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
    expect(report.reason).toContain("agent finished without submitting");
  });

  // T8: NoSubmitError synthesizes a <phase>.no-result warning Finding.
  test("NoSubmitError → findings contains exactly one no-result warning finding", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "no submit", cost: { durationMs: 50 } }),
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
    expect(report.findings).toHaveLength(1);
  });

  test("NoSubmitError report validates against TypeBox PhaseReport schema", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "no submit", cost: { durationMs: 50 } }),
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
});

// ---------------------------------------------------------------------------
// Guard 3: no-submit fallback — T8 additions
// ---------------------------------------------------------------------------

describe("makeAgentPhase — guard 3: no-submit fallback (NoSubmitError → no-result finding)", () => {
  /** Helper: run the phase with a NoSubmitError and return the report. */
  async function runNoSubmit(phaseId = "test-agent") {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({
        message: "agent finished without submitting",
        cost: { durationMs: 50 },
      }),
    });
    const phase = makeAgentPhase(runner, {
      id: phaseId,
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    return phase.run(makeCtx());
  }

  test('status is "error"', async () => {
    const report = await runNoSubmit();
    expect(report.status).toBe("error");
  });

  test("reason names the no-submit condition", async () => {
    const report = await runNoSubmit();
    expect(report.reason).toContain("agent finished without submitting");
  });

  test("findings has exactly one entry", async () => {
    const report = await runNoSubmit();
    expect(report.findings).toHaveLength(1);
  });

  test("finding id is <phase>.no-result", async () => {
    const report = await runNoSubmit("my-phase");
    expect(report.findings[0]?.id).toBe("my-phase.no-result");
  });

  test("finding phase matches the phase id", async () => {
    const report = await runNoSubmit("my-phase");
    expect(report.findings[0]?.phase).toBe("my-phase");
  });

  test('finding severity is "warning"', async () => {
    const report = await runNoSubmit();
    expect(report.findings[0]?.severity).toBe("warning");
  });

  test('finding confidence is "high"', async () => {
    // We KNOW the agent didn't submit — this is a structural fact, not a judgment (PRD §4.6).
    const report = await runNoSubmit();
    expect(report.findings[0]?.confidence).toBe("high");
  });

  test("finding message describes the problem", async () => {
    const report = await runNoSubmit();
    expect(report.findings[0]?.message).toContain("agent finished without submitting");
  });

  test("report validates against the TypeBox PhaseReport schema", async () => {
    const report = await runNoSubmit();
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  test("BudgetError does NOT get a no-result finding", async () => {
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
    expect(report.findings).toHaveLength(0);
  });

  test("CancelledError does NOT get a no-result finding", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new CancelledError({ message: "cancelled", cost: { durationMs: 200 } }),
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

  test("ModelError does NOT get a no-result finding", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new ModelError({ message: "context window exceeded", cost: { durationMs: 300 } }),
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
});

describe("makeAgentPhase — error path (BudgetError)", () => {
  test('BudgetError → status "error" with reason naming the limit', async () => {
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
    expect(report.reason).toContain("budget exceeded");
    expect(report.reason).toContain("turns");
  });

  test("BudgetError report validates against TypeBox PhaseReport schema", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "wallClockMs", message: "timed out" }),
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
});

describe("makeAgentPhase — error path (CancelledError)", () => {
  test('CancelledError → status "error" with reason containing "cancel"', async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new CancelledError({ message: "cancelled", cost: { durationMs: 200 } }),
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
    expect(report.reason).toContain("cancel");
  });

  test("CancelledError cost fields preserved (durationMs non-negative)", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new CancelledError({ message: "cancelled", cost: { durationMs: 200 } }),
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

describe("makeAgentPhase — error path (ModelError)", () => {
  test("ModelError → status 'error' with the model error message", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new ModelError({ message: "context window exceeded", cost: { durationMs: 300 } }),
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
    expect(report.reason).toContain("context window exceeded");
  });
});

// ---------------------------------------------------------------------------
// Infallible contract — wrapper never throws, never rejects
// ---------------------------------------------------------------------------

describe("makeAgentPhase — infallible contract", () => {
  test("Ok runner → run() always resolves, never rejects", async () => {
    const phase = makeAgentPhase(
      new FakeAgentRunner({ kind: "ok", submission: { findings: [] }, cost: { durationMs: 0 } }),
      {
        id: "test-agent",
        rubric: "rubric",
        toolset: ["bash"],
        submitSchema: SUBMIT_SCHEMA,
        budgets: DEFAULT_BUDGETS,
        buildUserPrompt: () => "prompt",
      },
    );
    await expect(phase.run(makeCtx())).resolves.toBeDefined();
  });

  test("Err runner → run() resolves to error PhaseReport, never rejects", async () => {
    const phase = makeAgentPhase(
      new FakeAgentRunner({
        kind: "err",
        error: new NoSubmitError({ message: "x", cost: { durationMs: 0 } }),
      }),
      {
        id: "test-agent",
        rubric: "rubric",
        toolset: ["bash"],
        submitSchema: SUBMIT_SCHEMA,
        budgets: DEFAULT_BUDGETS,
        buildUserPrompt: () => "prompt",
      },
    );
    const report = await phase.run(makeCtx());
    expect(report.status).toBe("error");
  });

  test("submission missing 'findings' → error report (not a throw)", async () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { /* no findings field */ message: "oops" },
      cost: { durationMs: 0 },
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
    expect(report.reason).toContain("findings");
  });

  test("submission findings array with invalid Finding shape → error report", async () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [{ id: 123, phase: "bad" }] }, // id should be string
      cost: { durationMs: 0 },
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
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt — receives PhaseContext
// ---------------------------------------------------------------------------

describe("makeAgentPhase — buildUserPrompt receives context", () => {
  test("buildUserPrompt is called with the PhaseContext", async () => {
    let capturedCtx: PhaseContext | undefined;
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: (ctx) => {
        capturedCtx = ctx;
        return "prompt";
      },
    });
    const ctx = makeCtx({ cwd: "/my/repo" });
    await phase.run(ctx);
    expect(capturedCtx?.cwd).toBe("/my/repo");
  });
});

// ---------------------------------------------------------------------------
// Fix B (#8): phase attribution — finding.phase is harness-controlled
// ---------------------------------------------------------------------------
//
// After validation, the harness overwrites each finding's `phase` with cfg.id
// so a model cannot attribute a finding to a phase that never ran.

describe("makeAgentPhase — phase attribution (Fix B)", () => {
  test("finding.phase is overwritten with cfg.id even when model submits a different phase", async () => {
    // Model submits a finding attributed to "wrong-phase" — a valid PhaseId but a phase
    // that never ran. The harness must overwrite it with the running phase's id (cfg.id).
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: {
        findings: [
          {
            id: "test-finding",
            phase: "wrong-phase", // model-controlled, must be overwritten by harness
            severity: "info" as const,
            confidence: "low" as const,
            message: "sneaky attribution",
          },
        ],
      },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "my-actual-phase",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(1);
    // The harness must have overwritten the model-supplied "wrong-phase" with cfg.id.
    expect(report.findings[0]?.phase).toBe("my-actual-phase");
  });

  test("finding.phase is the running phase id even when model submits the correct phase", async () => {
    // When the model happens to supply the right phase id, the harness still overwrites
    // it (the invariant is unconditional — correctness doesn't depend on model behavior).
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: {
        findings: [makeFinding("test.ok")],
      },
      cost: { durationMs: 0 },
    });
    const phase = makeAgentPhase(runner, {
      id: "my-actual-phase",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });
    const report = await phase.run(makeCtx());
    expect(report.findings[0]?.phase).toBe("my-actual-phase");
  });
});

// ---------------------------------------------------------------------------
// T14: scheduler signal forwarded to the runner (M4 seam, PRD §3.4.2)
//
// When the scheduler's AbortSignal fires, the agent phase must abort its work.
// The phase wires ctx.signal into the wall-clock controller so either a budget
// expiry or a scheduler cancel can terminate the runner.
//
// T15 update: scheduler-signal cancellation now produces status "cancelled"
// (not "error") — distinct from a budget expiry which stays "error". The
// signal.reason carries context (e.g. "gates failed: stub-det" from T15, or
// "cancelled by scheduler" when no string reason was set).
// ---------------------------------------------------------------------------

describe("makeAgentPhase — scheduler signal wiring (T14, M4 seam)", () => {
  test("a pre-aborted ctx.signal causes the phase to return a cancelled report promptly", async () => {
    // Fake runner hangs for 10 seconds — if the signal isn't respected, the test times out.
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: { ...DEFAULT_BUDGETS, wallClockMs: 30_000 },
      buildUserPrompt: () => "prompt",
    });

    const controller = new AbortController();
    controller.abort(); // pre-aborted: signal was already fired before run()

    const start = Date.now();
    const report = await phase.run(makeCtx({ signal: controller.signal }));
    const elapsed = Date.now() - start;

    // Must not hang for the 10s runner delay or the 30s wall clock.
    expect(elapsed).toBeLessThan(2_000);
    // T15: scheduler signal → cancelled status (not error).
    expect(report.status).toBe("cancelled");
    expect(report.reason).toBeTruthy();
  }, 5_000);

  test("ctx.signal fired mid-run aborts the phase before the runner completes", async () => {
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: { ...DEFAULT_BUDGETS, wallClockMs: 30_000 },
      buildUserPrompt: () => "prompt",
    });

    const controller = new AbortController();

    // Fire the signal shortly after the phase starts.
    const abortTimer = setTimeout(() => controller.abort(), 100);

    const start = Date.now();
    const report = await phase.run(makeCtx({ signal: controller.signal }));
    const elapsed = Date.now() - start;

    clearTimeout(abortTimer);

    // Must terminate well before the 10s runner delay.
    expect(elapsed).toBeLessThan(2_000);
    // T15: scheduler signal → cancelled status (not error).
    expect(report.status).toBe("cancelled");
    expect(report.reason).toBeTruthy();
  }, 5_000);

  test("scheduler signal reason is propagated to the cancelled report", async () => {
    const runner = new FakeAgentRunner({ kind: "delay", delayMs: 10_000 });
    const phase = makeAgentPhase(runner, {
      id: "test-agent",
      rubric: "rubric",
      toolset: ["bash"],
      submitSchema: SUBMIT_SCHEMA,
      budgets: { ...DEFAULT_BUDGETS, wallClockMs: 30_000 },
      buildUserPrompt: () => "prompt",
    });

    const controller = new AbortController();
    controller.abort("gates failed: stub-det");

    const report = await phase.run(makeCtx({ signal: controller.signal }));

    expect(report.status).toBe("cancelled");
    expect(report.reason).toBe("gates failed: stub-det");
  }, 5_000);
});
