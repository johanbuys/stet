/**
 * Tests for FakeAgentRunner — the scripted AgentRunner seam.
 *
 * Verifies: Ok script → Ok result; Err scripts → typed Err variants;
 * onTool called on success; never throws; script extensibility contract.
 *
 * Plan §2a M2 step 1, decision P1 (mock at the boundary you own).
 */

import { describe, expect, test, vi } from "vite-plus/test";
import { BudgetError, CancelledError, ModelError, NoSubmitError } from "../errors.js";
import { FakeAgentRunner } from "./fake-runner.js";
import { makeInputs } from "../test-support/agent-fixtures.js";

// ---------------------------------------------------------------------------
// Happy path (Ok script)
// ---------------------------------------------------------------------------

describe("FakeAgentRunner — Ok script", () => {
  const submission = {
    findings: [
      { id: "test.finding", phase: "test", severity: "info", confidence: "low", message: "x" },
    ],
    audit: { examined: ["src/foo.ts"] },
  };
  const cost = { model: "fake/model", inputTokens: 10, outputTokens: 5, durationMs: 42 };

  test("Ok script → isOk() true", async () => {
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const result = await runner.run(makeInputs());
    expect(result.isOk()).toBe(true);
  });

  test("Ok script → submission is the scripted value", async () => {
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const result = await runner.run(makeInputs());
    expect(result.isOk() && result.value.submission).toEqual(submission);
  });

  test("Ok script → cost is the scripted value", async () => {
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const result = await runner.run(makeInputs());
    expect(result.isOk() && result.value.cost).toEqual(cost);
  });

  test("Ok script → onTool called with 'submit_findings'", async () => {
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    const onTool = vi.fn();
    await runner.run(makeInputs({ onTool }));
    expect(onTool).toHaveBeenCalledWith("submit_findings");
  });

  test("Ok script without onTool → run() resolves without throwing", async () => {
    const runner = new FakeAgentRunner({ kind: "ok", submission, cost });
    // No onTool provided — must not throw
    await expect(runner.run(makeInputs())).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Error scripts (one for each AgentError variant)
// ---------------------------------------------------------------------------

describe("FakeAgentRunner — Err script (NoSubmitError)", () => {
  const errCost = { durationMs: 100 };

  test("NoSubmitError script → isErr() true", async () => {
    const error = new NoSubmitError({ message: "no submit", cost: errCost });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const result = await runner.run(makeInputs());
    expect(result.isErr()).toBe(true);
  });

  test("NoSubmitError script → error._tag is 'NoSubmitError'", async () => {
    const error = new NoSubmitError({ message: "no submit", cost: errCost });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const result = await runner.run(makeInputs());
    expect(result.isErr() && result.error._tag).toBe("NoSubmitError");
  });

  test("NoSubmitError script → onTool NOT called", async () => {
    const error = new NoSubmitError({ message: "no submit", cost: errCost });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const onTool = vi.fn();
    await runner.run(makeInputs({ onTool }));
    expect(onTool).not.toHaveBeenCalled();
  });
});

describe("FakeAgentRunner — Err script (BudgetError)", () => {
  test("BudgetError script → _tag is 'BudgetError'", async () => {
    const error = new BudgetError({ limit: "turns", message: "exceeded" });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const result = await runner.run(makeInputs());
    expect(result.isErr() && result.error._tag).toBe("BudgetError");
  });
});

describe("FakeAgentRunner — Err script (CancelledError)", () => {
  test("CancelledError script → _tag is 'CancelledError'", async () => {
    const error = new CancelledError({ message: "cancelled", cost: { durationMs: 50 } });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const result = await runner.run(makeInputs());
    expect(result.isErr() && result.error._tag).toBe("CancelledError");
  });
});

describe("FakeAgentRunner — Err script (ModelError)", () => {
  test("ModelError script → _tag is 'ModelError'", async () => {
    const error = new ModelError({ message: "model failed", cost: { durationMs: 200 } });
    const runner = new FakeAgentRunner({ kind: "err", error });
    const result = await runner.run(makeInputs());
    expect(result.isErr() && result.error._tag).toBe("ModelError");
  });
});

// ---------------------------------------------------------------------------
// Infallible contract — the fake never throws, never rejects
// ---------------------------------------------------------------------------

describe("FakeAgentRunner — infallible contract", () => {
  test("Ok script → run() always resolves, never rejects", async () => {
    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: {},
      cost: { durationMs: 0 },
    });
    await expect(runner.run(makeInputs())).resolves.toBeDefined();
  });

  test("Err script → run() always resolves (Err, not rejection)", async () => {
    const runner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "x", cost: { durationMs: 0 } }),
    });
    await expect(runner.run(makeInputs())).resolves.toBeDefined();
  });
});
