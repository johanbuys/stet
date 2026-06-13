/**
 * Tests for stub-composite — specialist parallel execution + roll-up (T21 · M7 · PRD §3.3).
 *
 * Fake-driven: each specialist is driven by an independently-scripted FakeAgentRunner.
 * Verifies:
 *   - All specialists run and their findings are rolled up to one PhaseReport.
 *   - Each finding is tagged with its originating specialist and the composite phase id.
 *   - Per-specialist cost appears in cost.specialists.
 *   - One specialist failing never loses the other specialists' findings.
 *   - A specialist with a false activation predicate is skipped (no findings, no cost entry).
 *   - Report validates against the TypeBox PhaseReport schema.
 *
 * PRD refs: §3.3, §3.9, §4.4; plan M7.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vite-plus/test";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { ModelError, BudgetError } from "../errors.js";
import type { Finding } from "../schema/finding.js";
import { PhaseReport } from "../schema/report.js";
import { makeStubComposite, STUB_COMPOSITE_SPECIALISTS } from "./stub-composite.js";
import { makeCompositePhase } from "./composite.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx() {
  return {
    cwd: "/tmp/stet-test",
    scope: { kind: "staged" as const, files: ["src/main.ts"] },
    config: {},
  };
}

/** A valid Finding that a fake runner can submit (phase will be overwritten by composite). */
function fakeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "stub-composite.test.finding",
    phase: "stub-composite",
    severity: "info",
    confidence: "high",
    message: "test finding",
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

function errRunner(
  error = new ModelError({ message: "model unavailable", cost: { durationMs: 0 } }),
) {
  return new FakeAgentRunner({ kind: "err", error });
}

/** Default set of runners: alpha and beta succeed, gamma fails. */
function threeRunners() {
  return {
    alpha: okRunner(
      [fakeFinding({ id: "stub-composite.alpha.finding", message: "alpha result" })],
      "fake/alpha",
    ),
    beta: okRunner(
      [fakeFinding({ id: "stub-composite.beta.finding", message: "beta result" })],
      "fake/beta",
    ),
    gamma: errRunner(),
  };
}

// ---------------------------------------------------------------------------
// Phase identity
// ---------------------------------------------------------------------------

describe("stub-composite identity", () => {
  it('id is "stub-composite"', () => {
    const phase = makeStubComposite(threeRunners());
    expect(phase.id).toBe("stub-composite");
  });

  it('kind is "agent"', () => {
    const phase = makeStubComposite(threeRunners());
    expect(phase.kind).toBe("agent");
  });

  it("activation is always true", () => {
    const phase = makeStubComposite(threeRunners());
    expect(phase.activation({ scope: { kind: "staged", files: [] } })).toBe(true);
    expect(phase.activation({ scope: { kind: "working", files: ["a.ts"] } })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// All specialists succeed — happy-path roll-up
// ---------------------------------------------------------------------------

describe("stub-composite — all specialists succeed (roll-up)", () => {
  it("report status is completed", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "alpha" })]),
      beta: okRunner([fakeFinding({ message: "beta" })]),
      gamma: okRunner([fakeFinding({ message: "gamma" })]),
    });
    const report = await phase.run(ctx());
    expect(report.status).toBe("completed");
  });

  it("phase field on the report matches the composite id", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    expect(report.phase).toBe("stub-composite");
  });

  it("findings from all three specialists are combined (3 findings total)", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "alpha" })]),
      beta: okRunner([fakeFinding({ message: "beta" })]),
      gamma: okRunner([fakeFinding({ message: "gamma" })]),
    });
    const report = await phase.run(ctx());
    expect(report.findings).toHaveLength(3);
  });

  it("each finding carries phase: stub-composite (overwritten from submission)", async () => {
    const submitted = fakeFinding({ phase: "some-other-phase" }); // will be overwritten
    const phase = makeStubComposite({
      alpha: okRunner([submitted]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    for (const f of report.findings) {
      expect(f.phase).toBe("stub-composite");
    }
  });

  it("each finding carries its originating specialist name", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "alpha" })]),
      beta: okRunner([fakeFinding({ message: "beta" })]),
      gamma: okRunner([fakeFinding({ message: "gamma" })]),
    });
    const report = await phase.run(ctx());
    const specialists = report.findings.map((f) => f.specialist);
    expect(specialists).toContain("alpha");
    expect(specialists).toContain("beta");
    expect(specialists).toContain("gamma");
  });

  it("specialist tag maps correctly to each finding's content", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "from alpha" })]),
      beta: okRunner([fakeFinding({ message: "from beta" })]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    const alphaFinding = report.findings.find((f) => f.message === "from alpha");
    const betaFinding = report.findings.find((f) => f.message === "from beta");
    expect(alphaFinding?.specialist).toBe("alpha");
    expect(betaFinding?.specialist).toBe("beta");
  });
});

// ---------------------------------------------------------------------------
// Per-specialist cost
// ---------------------------------------------------------------------------

describe("stub-composite — per-specialist cost in cost.specialists", () => {
  it("cost.specialists exists on a completed report", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    expect(report.cost.specialists).toBeDefined();
  });

  it("cost.specialists has an entry for each active specialist", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([], "fake/alpha"),
      beta: okRunner([], "fake/beta"),
      gamma: okRunner([], "fake/gamma"),
    });
    const report = await phase.run(ctx());
    const s = report.cost.specialists!;
    expect(Object.keys(s)).toContain("alpha");
    expect(Object.keys(s)).toContain("beta");
    expect(Object.keys(s)).toContain("gamma");
  });

  it("each specialist cost entry has durationMs", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([], "fake/alpha"),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    const s = report.cost.specialists!;
    for (const entry of Object.values(s)) {
      expect(typeof entry.durationMs).toBe("number");
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("each specialist cost entry carries the model from the runner", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([], "fake/alpha"),
      beta: okRunner([], "fake/beta"),
      gamma: okRunner([], "fake/gamma"),
    });
    const report = await phase.run(ctx());
    const s = report.cost.specialists!;
    expect(s["alpha"]?.model).toBe("fake/alpha");
    expect(s["beta"]?.model).toBe("fake/beta");
    expect(s["gamma"]?.model).toBe("fake/gamma");
  });

  it("top-level cost.durationMs is present and non-negative", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// One specialist fails — others' findings are preserved
// ---------------------------------------------------------------------------

describe("stub-composite — partial failure isolation", () => {
  it("two survivors' findings are present when gamma errors", async () => {
    const phase = makeStubComposite(threeRunners()); // gamma = err
    const report = await phase.run(ctx());
    expect(report.findings).toHaveLength(2);
    expect(report.findings.some((f) => f.specialist === "alpha")).toBe(true);
    expect(report.findings.some((f) => f.specialist === "beta")).toBe(true);
    expect(report.findings.some((f) => f.specialist === "gamma")).toBe(false);
  });

  it("composite status is still completed when one specialist errors", async () => {
    const phase = makeStubComposite(threeRunners());
    const report = await phase.run(ctx());
    expect(report.status).toBe("completed");
  });

  it("failed specialist still appears in cost.specialists", async () => {
    const phase = makeStubComposite(threeRunners());
    const report = await phase.run(ctx());
    expect(report.cost.specialists).toBeDefined();
    expect(Object.keys(report.cost.specialists!)).toContain("gamma");
  });

  it("failed specialist cost entry has durationMs", async () => {
    const phase = makeStubComposite(threeRunners());
    const report = await phase.run(ctx());
    const gammaCost = report.cost.specialists!["gamma"];
    expect(gammaCost).toBeDefined();
    expect(typeof gammaCost!.durationMs).toBe("number");
  });

  it("BudgetError specialist: surviving findings still present, cost entry exists", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "alpha" })], "fake/alpha"),
      beta: okRunner([fakeFinding({ message: "beta" })], "fake/beta"),
      gamma: new FakeAgentRunner({
        kind: "err",
        error: new BudgetError({ limit: "wallClockMs", message: "budget exceeded" }),
      }),
    });
    const report = await phase.run(ctx());
    expect(report.findings).toHaveLength(2);
    expect(report.cost.specialists!["gamma"]).toBeDefined();
  });

  it("all three specialists fail: composite completes with empty findings", async () => {
    const phase = makeStubComposite({
      alpha: errRunner(),
      beta: errRunner(),
      gamma: errRunner(),
    });
    const report = await phase.run(ctx());
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(0);
    expect(Object.keys(report.cost.specialists ?? {})).toHaveLength(3);
  });

  // T22 acceptance: one specialist ModelError + one BudgetError + one survives.
  it("T22: survivor findings preserved when one specialist errors and one hits budget breach", async () => {
    const phase = makeStubComposite({
      alpha: okRunner(
        [fakeFinding({ id: "stub-composite.alpha.survivor", message: "alpha survives" })],
        "fake/alpha",
      ),
      beta: new FakeAgentRunner({
        kind: "err",
        error: new ModelError({ message: "model unavailable", cost: { durationMs: 0 } }),
      }),
      gamma: new FakeAgentRunner({
        kind: "err",
        error: new BudgetError({ limit: "wallClockMs", message: "budget exceeded" }),
      }),
    });
    const report = await phase.run(ctx());
    // Composite completes — never blocked by individual failures.
    expect(report.status).toBe("completed");
    // Survivor's findings are preserved.
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.specialist).toBe("alpha");
    expect(report.findings[0]!.phase).toBe("stub-composite");
    // Both failing specialists appear in cost.specialists.
    expect(report.cost.specialists!["beta"]).toBeDefined();
    expect(report.cost.specialists!["gamma"]).toBeDefined();
    // No findings from failed specialists.
    expect(report.findings.some((f) => f.specialist === "beta")).toBe(false);
    expect(report.findings.some((f) => f.specialist === "gamma")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Specialist activation — skipped specialists are excluded
// ---------------------------------------------------------------------------

describe("stub-composite — specialist activation", () => {
  it("a specialist with false activation is skipped — no findings, no cost entry", async () => {
    // Build a composite with a custom specialist that is always inactive.
    const runner = okRunner([fakeFinding({ message: "should not appear" })]);
    const phase = makeCompositePhase(
      { always: runner, never: okRunner([fakeFinding({ message: "never activated" })]) },
      {
        id: "stub-composite",
        specialists: [
          {
            ...STUB_COMPOSITE_SPECIALISTS[0]!, // alpha config as base
            name: "always",
            activation: () => true,
          },
          {
            ...STUB_COMPOSITE_SPECIALISTS[1]!, // beta config as base
            name: "never",
            activation: () => false,
          },
        ],
      },
    );
    const report = await phase.run(ctx());
    // "always" runs, "never" is skipped.
    expect(report.findings.some((f) => f.specialist === "always")).toBe(true);
    expect(report.findings.some((f) => f.specialist === "never")).toBe(false);
    expect(report.cost.specialists!["always"]).toBeDefined();
    expect(report.cost.specialists!["never"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Schema compliance
// ---------------------------------------------------------------------------

describe("stub-composite — schema compliance", () => {
  it("happy-path report validates against TypeBox PhaseReport schema", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([fakeFinding({ message: "alpha" })]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("partial-failure report validates against TypeBox PhaseReport schema", async () => {
    const phase = makeStubComposite(threeRunners());
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("all-error report validates against TypeBox PhaseReport schema", async () => {
    const phase = makeStubComposite({
      alpha: errRunner(),
      beta: errRunner(),
      gamma: errRunner(),
    });
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Infallible contract
// ---------------------------------------------------------------------------

describe("stub-composite — infallible contract", () => {
  it("run() always resolves, never rejects — happy path", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([]),
      beta: okRunner([]),
      gamma: okRunner([]),
    });
    const report = await phase.run(ctx());
    expect(["completed", "error", "cancelled"]).toContain(report.status);
  });

  it("run() returns error status (not rejection) when a runner is missing", async () => {
    const phase = makeStubComposite({
      alpha: okRunner([]),
      beta: okRunner([]),
      // gamma runner intentionally missing
    });
    const report = await phase.run(ctx());
    expect(report.status).toBe("error");
    expect(report.reason).toContain("gamma");
  });
});
