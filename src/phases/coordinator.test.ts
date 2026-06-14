/**
 * Tests for the coordinator judge pass (T27 · M7.5 · PRD §3.3a).
 *
 * Fake-driven: the coordinator is a FakeAgentRunner scripted to merge two duplicate
 * findings and drop a planted nitpick, exercising the acceptance criterion from T27.
 *
 * Verifies:
 *   - Coordinator submission replaces the raw specialist roll-up.
 *   - Survivors keep their originating specialist.
 *   - cost.coordinator is populated.
 *   - audit.coordinator.received and .dropped are computed by the harness.
 *   - A coordinator-raised finding (no specialist) has no specialist field.
 *   - Judge failures (NoSubmitError / BudgetError / ModelError) fall back to the raw
 *     roll-up + a <phase>.coordinator-failed warning (decision #29).
 *   - A composite phase with no coordinator keeps the plain roll-up unchanged.
 *
 * PRD refs: §3.3a, §4.4, decisions #25, #29; plan M7.5 steps 1–3.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vite-plus/test";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { BudgetError, ModelError, NoSubmitError } from "../errors.js";
import type { Finding } from "../schema/finding.js";
import { PhaseReport } from "../schema/report.js";
import { makeCompositePhase } from "./composite.js";
import type { CoordinatorConfig } from "./coordinator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx() {
  return {
    cwd: "/tmp/stet-coordinator-test",
    scope: { kind: "staged" as const, files: ["src/main.ts"] },
    config: {},
  };
}

function fakeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "coordinator-test.default",
    phase: "coordinator-test-phase",
    severity: "warning",
    confidence: "high",
    message: "default test finding",
    ...overrides,
  };
}

function okRunner(findings: Finding[], model = "fake/model") {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model, inputTokens: 10, outputTokens: 5, durationMs: 1 },
  });
}

/** Two-specialist composite with a coordinator, used across multiple tests. */
function makePhaseWithCoordinator(
  coordRunner: FakeAgentRunner,
  opts: { alphaFindings?: Finding[]; betaFindings?: Finding[] } = {},
) {
  const alphaFindings = opts.alphaFindings ?? [
    fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
  ];
  const betaFindings = opts.betaFindings ?? [
    fakeFinding({
      id: "ct.beta.duplicate",
      message: "beta: same bug (duplicate)",
      specialist: "beta",
    }),
    fakeFinding({
      id: "ct.beta.nitpick",
      severity: "info",
      message: "beta: minor style nitpick",
      specialist: "beta",
    }),
  ];

  const coordConfig: CoordinatorConfig = {
    rubric: "Merge duplicates, drop nitpicks.",
    model: "fake/coordinator",
  };

  return makeCompositePhase(
    {
      alpha: okRunner(alphaFindings, "fake/alpha"),
      beta: okRunner(betaFindings, "fake/beta"),
      coordinator: coordRunner,
    },
    {
      id: "coordinator-test-phase",
      specialists: [
        {
          name: "alpha",
          rubric: "Find bugs.",
          toolset: ["read"],
          submitSchema: PhaseReport, // any schema — FakeAgentRunner bypasses validation
          budgets: { wallClockMs: 60_000, turns: 10, bashTimeoutMs: 10_000, bashOutputCap: 8_192 },
          buildUserPrompt: () => "find bugs",
        },
        {
          name: "beta",
          rubric: "Find style issues.",
          toolset: ["read"],
          submitSchema: PhaseReport,
          budgets: { wallClockMs: 60_000, turns: 10, bashTimeoutMs: 10_000, bashOutputCap: 8_192 },
          buildUserPrompt: () => "find style",
        },
      ],
      coordinator: coordConfig,
    },
  );
}

// ---------------------------------------------------------------------------
// Happy path — coordinator replaces roll-up
// ---------------------------------------------------------------------------

describe("coordinator — happy path (roll-up replaced)", () => {
  // T27 acceptance scenario: coordinator merges two duplicate findings and drops a planted nitpick.
  it("coordinator submission replaces the raw roll-up", async () => {
    // Raw roll-up: [alpha.bug, beta.duplicate, beta.nitpick]
    // Coordinator keeps only alpha.bug (merged the duplicate, dropped the nitpick).
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.id).toBe("ct.alpha.bug");
  });

  it("survivors keep their originating specialist", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.findings[0]!.specialist).toBe("alpha");
  });

  it("harness controls phase field on coordinator findings", async () => {
    const coordOutput = [
      // Coordinator submits with wrong phase — harness overrides it.
      fakeFinding({ id: "ct.alpha.bug", phase: "wrong-phase", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.findings[0]!.phase).toBe("coordinator-test-phase");
  });

  it("cost.coordinator is populated with model and durationMs", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.cost.coordinator).toBeDefined();
    expect(report.cost.coordinator!.model).toBe("fake/coordinator");
    expect(typeof report.cost.coordinator!.durationMs).toBe("number");
    expect(report.cost.coordinator!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("audit.coordinator.received equals the raw roll-up count", async () => {
    // Raw roll-up has 3 findings (1 alpha + 2 beta).
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.audit.coordinator).toBeDefined();
    expect(report.audit.coordinator!.received).toBe(3);
  });

  it("audit.coordinator.dropped records the two dropped findings", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    const dropped = report.audit.coordinator!.dropped;
    expect(dropped).toHaveLength(2);
    const droppedIds = dropped.map((d) => d.id);
    expect(droppedIds).toContain("ct.beta.duplicate");
    expect(droppedIds).toContain("ct.beta.nitpick");
  });

  it("dropped entries carry the specialist from the raw roll-up finding", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    for (const entry of report.audit.coordinator!.dropped) {
      expect(entry.specialist).toBe("beta");
    }
  });

  it("coordinator-raised finding (no specialist) has no specialist field", async () => {
    const crossCuttingFinding: Finding = {
      id: "ct.cross-cutting.issue",
      phase: "coordinator-test-phase",
      severity: "error",
      confidence: "high",
      message: "Cross-cutting issue no single specialist owned",
      // No specialist field
    };
    const phase = makePhaseWithCoordinator(okRunner([crossCuttingFinding], "fake/coordinator"));
    const report = await phase.run(ctx());

    const crossCutting = report.findings.find((f) => f.id === "ct.cross-cutting.issue");
    expect(crossCutting).toBeDefined();
    expect(crossCutting!.specialist).toBeUndefined();
  });

  it("audit.coordinator.reinstated is empty (T28 populates this)", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.audit.coordinator!.reinstated).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Judge failure — fall back to raw roll-up (decision #29)
// ---------------------------------------------------------------------------

describe("coordinator — judge failure (raw roll-up preserved, decision #29)", () => {
  it("NoSubmitError: raw roll-up preserved in findings", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "agent never submitted", cost: { durationMs: 0 } }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    // Raw roll-up: 3 specialist findings + 1 coordinator-failed warning.
    const specialistFindings = report.findings.filter(
      (f) => f.id !== "coordinator-test-phase.coordinator-failed",
    );
    expect(specialistFindings).toHaveLength(3);
  });

  it("BudgetError: raw roll-up preserved in findings", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "wallClockMs", message: "wall-clock budget exceeded" }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    const specialistFindings = report.findings.filter(
      (f) => f.id !== "coordinator-test-phase.coordinator-failed",
    );
    expect(specialistFindings).toHaveLength(3);
  });

  it("ModelError: raw roll-up preserved in findings", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new ModelError({ message: "model unavailable", cost: { durationMs: 0 } }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    const specialistFindings = report.findings.filter(
      (f) => f.id !== "coordinator-test-phase.coordinator-failed",
    );
    expect(specialistFindings).toHaveLength(3);
  });

  it("coordinator-failed warning has id <phase>.coordinator-failed", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "no submit", cost: { durationMs: 0 } }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    const warning = report.findings.find(
      (f) => f.id === "coordinator-test-phase.coordinator-failed",
    );
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe("warning");
  });

  it("coordinator-failed warning names the error tag and reason", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new ModelError({ message: "provider auth failed", cost: { durationMs: 0 } }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    const warning = report.findings.find(
      (f) => f.id === "coordinator-test-phase.coordinator-failed",
    );
    expect(warning!.message).toContain("ModelError");
    expect(warning!.message).toContain("provider auth failed");
  });

  it("no cost.coordinator on coordinator failure", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new BudgetError({ limit: "wallClockMs", message: "timed out" }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    expect(report.cost.coordinator).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No coordinator — plain roll-up unchanged
// ---------------------------------------------------------------------------

describe("coordinator — no coordinator configured (plain roll-up)", () => {
  it("plain roll-up is returned unchanged when no coordinator is declared", async () => {
    const phase = makeCompositePhase(
      {
        alpha: okRunner([fakeFinding({ id: "ct.alpha.finding", message: "alpha finding" })]),
        beta: okRunner([fakeFinding({ id: "ct.beta.finding", message: "beta finding" })]),
      },
      {
        id: "no-coordinator-phase",
        specialists: [
          {
            name: "alpha",
            rubric: "Find bugs.",
            toolset: ["read"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "find bugs",
          },
          {
            name: "beta",
            rubric: "Find style.",
            toolset: ["read"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "find style",
          },
        ],
        // No coordinator field.
      },
    );

    const report = await phase.run(ctx());
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(2);
  });

  it("cost.coordinator is absent on plain roll-up report", async () => {
    const phase = makeCompositePhase(
      {
        alpha: okRunner([fakeFinding({ id: "ct.alpha.finding" })]),
      },
      {
        id: "no-coordinator-phase",
        specialists: [
          {
            name: "alpha",
            rubric: "Find bugs.",
            toolset: ["read"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "find bugs",
          },
        ],
      },
    );

    const report = await phase.run(ctx());
    expect(report.cost.coordinator).toBeUndefined();
  });

  it("audit.coordinator is absent on plain roll-up report", async () => {
    const phase = makeCompositePhase(
      { alpha: okRunner([]) },
      {
        id: "no-coordinator-phase",
        specialists: [
          {
            name: "alpha",
            rubric: "Find bugs.",
            toolset: ["read"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "find bugs",
          },
        ],
      },
    );

    const report = await phase.run(ctx());
    expect(report.audit.coordinator).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Schema compliance
// ---------------------------------------------------------------------------

describe("coordinator — schema compliance", () => {
  it("coordinator success report validates against TypeBox PhaseReport schema", async () => {
    const coordOutput = [
      fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("coordinator-failed fallback report validates against TypeBox PhaseReport schema", async () => {
    const failRunner = new FakeAgentRunner({
      kind: "err",
      error: new NoSubmitError({ message: "no submit", cost: { durationMs: 0 } }),
    });
    const phase = makePhaseWithCoordinator(failRunner);
    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("plain roll-up (no coordinator) validates against TypeBox PhaseReport schema", async () => {
    const phase = makeCompositePhase(
      { alpha: okRunner([fakeFinding({ id: "ct.alpha.finding" })]) },
      {
        id: "no-coordinator-phase",
        specialists: [
          {
            name: "alpha",
            rubric: "Find bugs.",
            toolset: ["read"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "find bugs",
          },
        ],
      },
    );
    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});
