/**
 * Tests for runPhases (scheduler).
 *
 * TDD vertical slices — verifying behavior through the public interface.
 */

import { describe, expect, it } from "vite-plus/test";
import type { PhaseReport } from "./schema/report.js";
import type { Scope } from "./scope.js";
import { runPhases } from "./scheduler.js";
import type { PhaseConfiguration } from "./phases/index.js";

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
});
