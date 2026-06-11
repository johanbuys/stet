/**
 * Tests for runPhases (scheduler).
 *
 * TDD vertical slices — verifying behavior through the public interface.
 */

import { describe, expect, it } from "vite-plus/test";
import type { PhaseReport } from "./schema/report.js";
import type { Scope } from "./scope.js";
import { runPhases } from "./scheduler.js";
import type { PhaseConfiguration, PhaseContext } from "./phases/index.js";
import { makeAgentPhase } from "./phases/agent-phase.js";
import { FakeAgentRunner } from "./agent/fake-runner.js";
import { SUBMIT_TOOL_NAME } from "./agent/submit-tool.js";
import { Type } from "@sinclair/typebox";
import { SUBMIT_SCHEMA, DEFAULT_BUDGETS } from "./test-support/agent-fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeScope: Scope = { kind: "staged", files: ["src/foo.ts"] };

function makePhase(
  id: string,
  opts: {
    activated?: boolean;
    report?: Partial<PhaseReport>;
  } = {},
): PhaseConfiguration {
  const activated = opts.activated ?? true;
  return {
    id,
    kind: "deterministic",
    activation: () => activated,
    async run(_ctx) {
      return {
        phase: id,
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 5 },
        ...opts.report,
      };
    },
  };
}

const baseCtx = {
  cwd: "/tmp/repo",
  scope: fakeScope,
  config: { phases: {} },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPhases", () => {
  // ── Slice 1: activated phase runs and appears in output ──────────────────

  it("activated phase appears with status completed", async () => {
    const phase = makePhase("stub-det");
    const reports = await runPhases([phase], baseCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("stub-det");
    expect(reports[0]?.status).toBe("completed");
  });

  // ── Slice 2: non-activated phase → skipped with reason naming the rule ────

  it("non-activated phase → skipped with activation reason", async () => {
    const phase = makePhase("stub-det", { activated: false });
    const reports = await runPhases([phase], baseCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("stub-det");
    expect(reports[0]?.status).toBe("skipped");
    expect(reports[0]?.reason).toMatch(/activation/i);
    expect(reports[0]?.findings).toEqual([]);
    expect(reports[0]?.cost).toEqual({ durationMs: 0 });
  });

  // ── Slice 3: every configured phase appears exactly once ─────────────────

  it("every configured phase appears exactly once in registration order", async () => {
    const phases = [makePhase("a"), makePhase("b", { activated: false }), makePhase("c")];
    const reports = await runPhases(phases, baseCtx);
    expect(reports).toHaveLength(3);
    expect(reports.map((r) => r.phase)).toEqual(["a", "b", "c"]);
  });

  // ── Slice 4: config slice is passed to each phase ─────────────────────────

  it("passes config slice to each phase", async () => {
    const received: unknown[] = [];
    const phase: PhaseConfiguration = {
      id: "spy-phase",
      kind: "deterministic",
      activation: () => true,
      async run(ctx) {
        received.push(ctx.config);
        return {
          phase: "spy-phase",
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 1 },
        };
      },
    };
    const ctx = {
      ...baseCtx,
      config: { phases: { "spy-phase": { command: "echo hi" } } },
    };
    await runPhases([phase], ctx);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ command: "echo hi" });
  });

  // ── Slice 5: phase with no config slice gets undefined ───────────────────

  it("phase with no config slice receives undefined", async () => {
    const received: unknown[] = [];
    const phase: PhaseConfiguration = {
      id: "no-config-phase",
      kind: "deterministic",
      activation: () => true,
      async run(ctx) {
        received.push(ctx.config);
        return {
          phase: "no-config-phase",
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 1 },
        };
      },
    };
    await runPhases([phase], baseCtx);
    expect(received[0]).toBeUndefined();
  });

  // ── Slice 6: zero phases → empty array ──────────────────────────────────

  it("zero phases → empty reports array", async () => {
    const reports = await runPhases([], baseCtx);
    expect(reports).toEqual([]);
  });

  // ── Slice 7: skipped phase has empty findings and zero-cost ──────────────

  it("skipped phase has empty findings and cost.durationMs === 0", async () => {
    const phase = makePhase("stub-det", { activated: false });
    const reports = await runPhases([phase], baseCtx);
    const report = reports[0]!;
    expect(report.findings).toEqual([]);
    expect(report.audit).toEqual({});
    expect(report.cost.durationMs).toBe(0);
  });

  // ── Slice 8: phase whose run() throws synchronously → status "error" ────

  it("phase that throws synchronously lands as status error with contract reason", async () => {
    const throwingPhase: PhaseConfiguration = {
      id: "throws-sync",
      kind: "deterministic",
      activation: () => true,
      async run(_ctx) {
        throw new Error("sync kaboom");
      },
    };
    const reports = await runPhases([throwingPhase], baseCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("throws-sync");
    expect(reports[0]?.status).toBe("error");
    expect(reports[0]?.reason).toContain("phase violated its contract");
    expect(reports[0]?.reason).toContain("sync kaboom");
    expect(reports[0]?.findings).toEqual([]);
  });

  // ── Slice 9: phase whose run() rejects → status "error" ─────────────────

  it("phase that rejects (async throw) lands as status error with contract reason", async () => {
    const rejectingPhase: PhaseConfiguration = {
      id: "rejects-async",
      kind: "deterministic",
      activation: () => true,
      run(_ctx) {
        return Promise.reject(new Error("async kaboom"));
      },
    };
    const reports = await runPhases([rejectingPhase], baseCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("rejects-async");
    expect(reports[0]?.status).toBe("error");
    expect(reports[0]?.reason).toContain("phase violated its contract");
    expect(reports[0]?.reason).toContain("async kaboom");
  });

  // ── Slice 10: misbehaving phase does not affect healthy sibling ──────────

  it("throwing phase does not corrupt a healthy sibling phase report", async () => {
    const healthyPhase = makePhase("healthy", {
      report: { status: "completed", findings: [] },
    });
    const throwingPhase: PhaseConfiguration = {
      id: "bad-actor",
      kind: "deterministic",
      activation: () => true,
      async run(_ctx) {
        throw new Error("I violated my contract");
      },
    };
    const reports = await runPhases([healthyPhase, throwingPhase], baseCtx);
    expect(reports).toHaveLength(2);
    const healthy = reports.find((r) => r.phase === "healthy");
    const bad = reports.find((r) => r.phase === "bad-actor");
    expect(healthy?.status).toBe("completed");
    expect(bad?.status).toBe("error");
  });

  // ── Slice 11: throwing activation → error report, siblings unaffected ────

  it("phase whose activation() throws lands as status error with contract reason", async () => {
    const throwingActivation: PhaseConfiguration = {
      id: "throws-activation",
      kind: "deterministic",
      activation: () => {
        throw new Error("activation kaboom");
      },
      async run(_ctx) {
        return {
          phase: "throws-activation",
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 1 },
        };
      },
    };
    const reports = await runPhases([throwingActivation], baseCtx);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.phase).toBe("throws-activation");
    expect(reports[0]?.status).toBe("error");
    expect(reports[0]?.reason).toContain("phase violated its contract: activation threw");
    expect(reports[0]?.reason).toContain("activation kaboom");
    expect(reports[0]?.findings).toEqual([]);
  });

  it("throwing activation does not affect a healthy sibling phase", async () => {
    const healthyPhase = makePhase("healthy-sibling");
    const throwingActivation: PhaseConfiguration = {
      id: "bad-activation",
      kind: "deterministic",
      activation: () => {
        throw new Error("activation exploded");
      },
      async run(_ctx) {
        return {
          phase: "bad-activation",
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 1 },
        };
      },
    };
    const reports = await runPhases([healthyPhase, throwingActivation], baseCtx);
    expect(reports).toHaveLength(2);
    const healthy = reports.find((r) => r.phase === "healthy-sibling");
    const bad = reports.find((r) => r.phase === "bad-activation");
    expect(healthy?.status).toBe("completed");
    expect(bad?.status).toBe("error");
    expect(bad?.reason).toContain("activation threw");
  });

  // ── Slice 12: onTool progress is forwarded end-to-end ────────────────────
  //
  // Fix A (#7): prove the chain SchedulerContext.onTool → PhaseContext.onTool →
  // AgentRunner.run(inputs.onTool) → FakeAgentRunner calls onTool("submit_findings")
  // is live and not dead code. Registers a stub-agent backed by FakeAgentRunner,
  // runs it through runPhases with a collecting onTool sink, and asserts the sink
  // received ["stub-agent", SUBMIT_TOOL_NAME].

  it("onTool progress callback is forwarded: scheduler → phase → runner (Fix A)", async () => {
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

    const runner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [] },
      cost: { durationMs: 1 },
    });

    const agentPhase = makeAgentPhase(runner, {
      id: "stub-agent",
      rubric: "rubric",
      toolset: ["bash", SUBMIT_TOOL_NAME],
      submitSchema: SUBMIT_SCHEMA,
      budgets: DEFAULT_BUDGETS,
      buildUserPrompt: () => "prompt",
    });

    const received: [string, string][] = [];
    const ctx = {
      ...baseCtx,
      onTool: (phaseId: string, toolName: string) => {
        received.push([phaseId, toolName]);
      },
    };

    await runPhases([agentPhase], ctx);

    // FakeAgentRunner calls onTool(SUBMIT_TOOL_NAME) on the ok path.
    // The scheduler scopes the phase id in, so the sink gets ["stub-agent", "submit_findings"].
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(["stub-agent", SUBMIT_TOOL_NAME]);
  });
});

// ---------------------------------------------------------------------------
// T14: Real parallel execution (PRD §3.4.2, acceptance #4)
//
// Proves all activated phases launch concurrently: total wall-clock ≈ slowest
// phase, not the sum. Phases are real async operations with controlled-duration
// setTimeout delays (no fakes needed — behavior is timing).
// ---------------------------------------------------------------------------

describe("T14: parallel execution (PRD §3.4.2, acceptance #4)", () => {
  // ── Slice 1: total wall-clock ≈ slowest, not sum ─────────────────────────

  it("all-pass run: wall-clock within 10% of slowest phase, not sum", async () => {
    // Three phases with staggered durations. Sequential sum = 80+120+60 = 260ms.
    // Parallel wall-clock ≈ 120ms (the slowest). The 10% tolerance (132ms) is
    // well under half the sequential time, proving concurrency is real.
    const durations = [80, 120, 60];
    const slowest = Math.max(...durations);

    const phases = durations.map(
      (ms, i): PhaseConfiguration => ({
        id: `timed-${i}`,
        kind: "deterministic",
        activation: () => true,
        async run(_ctx: PhaseContext): Promise<PhaseReport> {
          await new Promise<void>((resolve) => setTimeout(resolve, ms));
          return {
            phase: `timed-${i}`,
            status: "completed",
            findings: [],
            audit: {},
            cost: { durationMs: ms },
          };
        },
      }),
    );

    const start = Date.now();
    const reports = await runPhases(phases, baseCtx);
    const elapsed = Date.now() - start;

    expect(reports).toHaveLength(3);
    expect(reports.every((r) => r.status === "completed")).toBe(true);
    // Within 10% of the slowest phase (PRD acceptance #4).
    expect(elapsed).toBeLessThan(slowest * 1.1);
  }, 3_000);

  // ── Slice 2: scheduler passes a signal down to each phase ────────────────
  //
  // T15 update: the scheduler merges the external signal (ctx.signal) with an
  // internal gate-cancellation signal via AbortSignal.any. Phases receive the
  // combined signal, not the original reference. The invariant is that when the
  // external signal fires, the combined signal also fires.

  it("a signal derived from ctx.signal is forwarded to each phase's run context", async () => {
    const controller = new AbortController();
    const receivedSignals: (AbortSignal | undefined)[] = [];

    const phases = [0, 1].map(
      (i): PhaseConfiguration => ({
        id: `spy-${i}`,
        kind: "deterministic",
        activation: () => true,
        async run(ctx: PhaseContext): Promise<PhaseReport> {
          receivedSignals.push(ctx.signal);
          return {
            phase: `spy-${i}`,
            status: "completed",
            findings: [],
            audit: {},
            cost: { durationMs: 0 },
          };
        },
      }),
    );

    await runPhases(phases, { ...baseCtx, signal: controller.signal });

    expect(receivedSignals).toHaveLength(2);
    // Phases receive the combined signal (not the original reference — T15 merges
    // ctx.signal with the internal gate-cancel signal via AbortSignal.any).
    expect(receivedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(receivedSignals[1]).toBeInstanceOf(AbortSignal);
    // When the external signal fires, the combined signal must also be aborted.
    controller.abort("test-reason");
    expect(receivedSignals[0]?.aborted).toBe(true);
    expect(receivedSignals[1]?.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T15: Cancellation classes (PRD §3.4.3, acceptance #5)
//
// Cancel-class gate failure (cancelClass: true) cancels in-flight agent phases →
// status "cancelled" + gate named in reason. Report-only gate failure (cancelClass
// absent/false) cancels nothing. A gate timeout (status "error") is always
// report-only regardless of cancelClass.
// ---------------------------------------------------------------------------

/** Make a slow agent phase that hangs until aborted (delayMs longer than any test). */
function makeSlowAgentPhase(id: string): PhaseConfiguration {
  return makeAgentPhase(new FakeAgentRunner({ kind: "delay", delayMs: 30_000 }), {
    id,
    rubric: "rubric",
    toolset: ["bash"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: { ...DEFAULT_BUDGETS, wallClockMs: 60_000 },
    buildUserPrompt: () => "prompt",
  });
}

/**
 * Make a short-delay agent phase that resolves naturally after delayMs (well under
 * the wall-clock budget). This is the discriminating fake for the negative-path
 * slices: a `delay` runner is the ONLY FakeAgentRunner script that reads inputs.signal.
 *
 * - Correct behavior (no cancellation): the timer expires → NoSubmitError → status "error".
 * - Wrong behavior (scheduler aborts when it shouldn't): the signal fires → the runner
 *   resolves CancelledError + aborted signal → agent-phase returns status "cancelled".
 *
 * So asserting `status !== "cancelled"` actually has the power to fail a broken scheduler
 * that cancels on a report-only failure, a gate timeout, or a passing gate. The 50ms delay
 * gives any erroneous gate abort (which fires within a microtask of the gate completing)
 * ample time to land before the natural expiry.
 */
function makeProbeAgentPhase(id: string): PhaseConfiguration {
  return makeAgentPhase(new FakeAgentRunner({ kind: "delay", delayMs: 50 }), {
    id,
    rubric: "rubric",
    toolset: ["bash"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: { ...DEFAULT_BUDGETS, wallClockMs: 60_000 },
    buildUserPrompt: () => "prompt",
  });
}

/** Make a gate phase that immediately completes with one error-severity finding. */
function makeFailingGate(id: string, cancelClass: boolean): PhaseConfiguration {
  return {
    id,
    kind: "deterministic",
    cancelClass,
    activation: () => true,
    async run(): Promise<PhaseReport> {
      return {
        phase: id,
        status: "completed",
        findings: [
          {
            id: `${id}.failed`,
            phase: id,
            severity: "error",
            confidence: "high",
            message: `${id} failed`,
          },
        ],
        audit: {},
        cost: { durationMs: 5 },
      };
    },
  };
}

/** Make a gate phase that immediately completes with no findings (passes). */
function makePassingGate(id: string, cancelClass: boolean): PhaseConfiguration {
  return {
    id,
    kind: "deterministic",
    cancelClass,
    activation: () => true,
    async run(): Promise<PhaseReport> {
      return {
        phase: id,
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 5 },
      };
    },
  };
}

describe("T15: cancellation classes (PRD §3.4.3, acceptance #5)", () => {
  // ── Slice 1: cancel-class gate failure → in-flight agent phase cancelled ──

  it("cancel-class gate failure cancels an in-flight agent phase with gate named", async () => {
    // Gate completes quickly with an error finding; agent phase hangs for 30s.
    // Without cancellation the test would time out.
    const gate = makeFailingGate("stub-det", true); // cancelClass: true
    const agent = makeSlowAgentPhase("slow-agent");

    const reports = await runPhases([gate, agent], baseCtx);

    expect(reports).toHaveLength(2);

    const gateReport = reports.find((r) => r.phase === "stub-det");
    const agentReport = reports.find((r) => r.phase === "slow-agent");

    // Gate itself completed (with error findings — that's how it signals failure).
    expect(gateReport?.status).toBe("completed");
    expect(gateReport?.findings).toHaveLength(1);

    // In-flight agent phase is cancelled, reason names the gate.
    expect(agentReport?.status).toBe("cancelled");
    expect(agentReport?.reason).toMatch(/gates failed/i);
    expect(agentReport?.reason).toContain("stub-det");
  }, 5_000);

  // ── Slice 2: report-only gate failure → agent phase NOT cancelled ─────────

  it("report-only gate failure (cancelClass absent) does not cancel in-flight agent phases", async () => {
    const gate = makeFailingGate("lint", false); // cancelClass: false → report-only
    // A `delay` probe agent is the discriminating fake: it reads inputs.signal, so a
    // wrongful cancellation would surface as status "cancelled" instead of "error".
    const agent = makeProbeAgentPhase("review");

    const reports = await runPhases([gate, agent], baseCtx);

    expect(reports).toHaveLength(2);
    const gateReport = reports.find((r) => r.phase === "lint");
    const agentReport = reports.find((r) => r.phase === "review");

    // Gate reports its failure as findings (report-only).
    expect(gateReport?.status).toBe("completed");
    expect(gateReport?.findings).toHaveLength(1);

    // Agent phase was NOT cancelled — the report-only gate triggers no abort. It ran to
    // its natural NoSubmitError expiry (status "error"), proving the signal never fired.
    expect(agentReport?.status).not.toBe("cancelled");
    expect(agentReport?.status).toBe("error");
  }, 5_000);

  // ── Slice 3: gate timeout (status "error") is always report-only ──────────
  //
  // PRD §3.4.3: "A gate timeout is always report-only regardless of class — a
  // merely-slow suite must not nuke the AI phases."

  it("cancel-class gate with status error (timeout) does not cancel agent phases", async () => {
    // A gate that errors instead of completing (simulates timeout / spawn failure).
    const timedOutGate: PhaseConfiguration = {
      id: "tests",
      kind: "deterministic",
      cancelClass: true, // would cancel if it FAILED, but it timed out (status: error)
      activation: () => true,
      async run(): Promise<PhaseReport> {
        return {
          phase: "tests",
          status: "error", // timed out / errored internally — not a "failure"
          reason: "budget exceeded: wallClockMs — wall-clock budget of 300000ms exceeded",
          findings: [],
          audit: {},
          cost: { durationMs: 5 },
        };
      },
    };
    // Discriminating `delay` probe — surfaces a wrongful cancel as status "cancelled".
    const agent = makeProbeAgentPhase("review");

    const reports = await runPhases([timedOutGate, agent], baseCtx);

    const gateReport = reports.find((r) => r.phase === "tests");
    const agentReport = reports.find((r) => r.phase === "review");

    // Gate errored (timeout/error).
    expect(gateReport?.status).toBe("error");

    // Agent was NOT cancelled — gate timeout is always report-only. It ran to its natural
    // NoSubmitError expiry (status "error"), proving the gate's status "error" fired no abort.
    expect(agentReport?.status).not.toBe("cancelled");
    expect(agentReport?.status).toBe("error");
  }, 5_000);

  // ── Slice 4: passing cancel-class gate → no cancellation ─────────────────

  it("a passing cancel-class gate does not cancel other phases", async () => {
    const gate = makePassingGate("tests", true); // cancelClass: true but passes
    // Discriminating `delay` probe — surfaces a wrongful cancel as status "cancelled".
    const agent = makeProbeAgentPhase("review");

    const reports = await runPhases([gate, agent], baseCtx);

    const gateReport = reports.find((r) => r.phase === "tests");
    const agentReport = reports.find((r) => r.phase === "review");

    expect(gateReport?.status).toBe("completed");
    expect(gateReport?.findings).toHaveLength(0);
    // Agent was NOT cancelled — a passing cancel-class gate fires no abort. It ran to its
    // natural NoSubmitError expiry (status "error"), proving isGateFailure stayed false.
    expect(agentReport?.status).not.toBe("cancelled");
    expect(agentReport?.status).toBe("error");
  }, 5_000);

  // ── Slice 5: multiple agent phases — all cancelled on gate failure ────────

  it("all in-flight agent phases are cancelled when a cancel-class gate fails", async () => {
    const gate = makeFailingGate("tests", true);
    const agent1 = makeSlowAgentPhase("review");
    const agent2 = makeSlowAgentPhase("spec");

    const reports = await runPhases([gate, agent1, agent2], baseCtx);

    expect(reports).toHaveLength(3);
    const agentReports = reports.filter((r) => r.phase !== "tests");
    // Both slow agent phases are cancelled.
    expect(agentReports.every((r) => r.status === "cancelled")).toBe(true);
    expect(agentReports.every((r) => r.reason?.includes("gates failed"))).toBe(true);
  }, 5_000);
});
