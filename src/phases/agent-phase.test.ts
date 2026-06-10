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
import { Type } from "@sinclair/typebox";
import { describe, expect, test } from "vite-plus/test";
import { BudgetError, CancelledError, ModelError, NoSubmitError } from "../errors.js";
import { PhaseReport } from "../schema/report.js";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { makeAgentPhase } from "./agent-phase.js";
import type { PhaseContext } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBMIT_SCHEMA = Type.Object({
  findings: Type.Array(Type.Unknown()),
  audit: Type.Optional(Type.Unknown()),
});

const DEFAULT_BUDGETS = {
  wallClockMs: 60_000,
  turns: 30,
  bashTimeoutMs: 10_000,
  bashOutputCap: 4096,
};

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    cwd: "/tmp/repo",
    scope: { kind: "staged" as const, files: ["src/foo.ts"] },
    config: {},
    ...overrides,
  };
}

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
