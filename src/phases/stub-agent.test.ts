/**
 * Tests for stub-agent — the agent-backed stub phase (PRD §3.9).
 *
 * Fake-driven: the phase is driven by a FakeAgentRunner scripted to submit the
 * two TODO findings that a real agent would produce against
 * fixtures/stub-repo/src/main.ts (line 9 and line 14).
 *
 * No network, no SDK — pure deterministic seam testing.
 *
 * PRD refs: §3.9 (stub phases), §4.1 (PhaseConfiguration), §4.2 (Finding),
 * §4.4 (PhaseReport), §4.6 (confidence rules).
 * Plan refs: §2a M2 step 2 (T9), decision P1 (AgentRunner seam).
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, test } from "vite-plus/test";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import type { Finding } from "../schema/finding.js";
import { PhaseReport } from "../schema/report.js";
import { makeStubAgent } from "./stub-agent.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PhaseContext pointing at the fixture repo with main.ts in scope. */
function ctx() {
  return {
    cwd: "/home/johan/projects/stet/fixtures/stub-repo",
    scope: { kind: "staged" as const, files: ["src/main.ts"] },
    config: {},
  };
}

/**
 * The two canonical TODO findings a real agent would submit against
 * fixtures/stub-repo/src/main.ts (lines 9 and 14).
 */
const TODO_A: Finding = {
  id: "stub-agent.todo",
  phase: "stub-agent",
  severity: "info",
  confidence: "high",
  message: "TODO: implement feature A",
  location: { file: "src/main.ts", line: 9 },
};

const TODO_B: Finding = {
  id: "stub-agent.todo",
  phase: "stub-agent",
  severity: "info",
  confidence: "high",
  message: "TODO: implement feature B",
  location: { file: "src/main.ts", line: 14 },
};

/** Build a FakeAgentRunner scripted to submit the two canonical TODO findings. */
function fakeWithTodos() {
  return new FakeAgentRunner({
    kind: "ok",
    submission: {
      findings: [TODO_A, TODO_B],
      audit: {
        examined: ["src/main.ts"],
      },
    },
    cost: {
      model: "fake-model",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 10,
    },
  });
}

// ---------------------------------------------------------------------------
// Phase identity
// ---------------------------------------------------------------------------

describe("stub-agent identity", () => {
  test('id is "stub-agent"', () => {
    const phase = makeStubAgent(fakeWithTodos());
    expect(phase.id).toBe("stub-agent");
  });

  test('kind is "agent"', () => {
    const phase = makeStubAgent(fakeWithTodos());
    expect(phase.kind).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe("stub-agent activation", () => {
  test("activation is always true — regardless of scope content", () => {
    const phase = makeStubAgent(fakeWithTodos());
    const emptyScope = { scope: { kind: "staged" as const, files: [] } };
    const nonEmptyScope = { scope: { kind: "working" as const, files: ["a.ts", "b.ts"] } };
    expect(phase.activation(emptyScope)).toBe(true);
    expect(phase.activation(nonEmptyScope)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Happy path — two TODO findings submitted
// ---------------------------------------------------------------------------

describe("stub-agent — happy path (fake submits two TODO findings)", () => {
  test('status is "completed"', async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    expect(report.status).toBe("completed");
  });

  test("phase name on the report is stub-agent", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    expect(report.phase).toBe("stub-agent");
  });

  test("exactly two findings are returned", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    expect(report.findings).toHaveLength(2);
  });

  test("both findings have severity info", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    for (const f of report.findings) {
      expect(f.severity).toBe("info");
    }
  });

  test("first finding carries the feature-A TODO at src/main.ts line 9", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    const f = report.findings[0];
    expect(f?.message).toBe("TODO: implement feature A");
    expect(f?.location?.file).toBe("src/main.ts");
    expect(f?.location?.line).toBe(9);
  });

  test("second finding carries the feature-B TODO at src/main.ts line 14", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    const f = report.findings[1];
    expect(f?.message).toBe("TODO: implement feature B");
    expect(f?.location?.file).toBe("src/main.ts");
    expect(f?.location?.line).toBe(14);
  });

  test("both findings have phase stub-agent", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    for (const f of report.findings) {
      expect(f.phase).toBe("stub-agent");
    }
  });

  test("cost.durationMs is present and non-negative", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("report validates against the TypeBox PhaseReport schema", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Infallible contract — never throws
// ---------------------------------------------------------------------------

describe("stub-agent — infallible contract", () => {
  test("the returned promise always resolves, never rejects", async () => {
    const phase = makeStubAgent(fakeWithTodos());
    // Must resolve; the test itself would throw/timeout on rejection
    const report = await phase.run(ctx());
    expect(["completed", "error"]).toContain(report.status);
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});
