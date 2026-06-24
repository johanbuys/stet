/**
 * Tests for the coordinator judge pass (T27–T28 · M7.5 · PRD §3.3a).
 *
 * Fake-driven: the coordinator is a FakeAgentRunner scripted to merge two duplicate
 * findings and drop a planted nitpick, exercising the acceptance criterion from T27.
 *
 * T27 verifies:
 *   - Coordinator submission replaces the raw specialist roll-up.
 *   - Survivors keep their originating specialist.
 *   - cost.coordinator is populated.
 *   - audit.coordinator.received and .dropped are computed by the harness.
 *   - A coordinator-raised finding (no specialist) has no specialist field.
 *   - Judge failures (NoSubmitError / BudgetError / ModelError) fall back to the raw
 *     roll-up + a <phase>.coordinator-failed warning (decision #29).
 *   - A composite phase with no coordinator keeps the plain roll-up unchanged.
 *
 * T28 adds (PRD §3.3a, §4.2, §4.3, §4.6/§4.8, decisions #30, #31):
 *   - Constrained authority: a deterministic/evidence-backed finding (evidence.command)
 *     survives a coordinator scripted to drop it — reinstated in findings, recorded in
 *     audit.coordinator.reinstated, absent from audit.coordinator.dropped (PRD #30).
 *   - Constrained authority: a coordinator-downgraded evidence-backed finding is
 *     reinstated at its original severity (the coordinator cannot lower it).
 *   - AI-judgment findings (no evidence.command) accept re-ranking: a coordinator
 *     downgrade flows through to findings, and with failOn=error the downgraded finding
 *     no longer gates (PRD §4.6/§4.8 — gating interaction).
 *
 * PRD refs: §3.3a, §4.1–4.4, §4.6, §4.8; decisions #25, #29, #30, #31; plan M7.5 steps 1–4.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vite-plus/test";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import type { OkScript } from "../agent/fake-runner.js";
import { BudgetError, ModelError, NoSubmitError } from "../errors.js";
import { deriveExit } from "../exit-codes.js";
import type {
  Finding,
  SpecialistSubmission as SpecialistSubmissionType,
} from "../schema/finding.js";
import { PhaseReport } from "../schema/report.js";
import { makeCompositePhase } from "./composite.js";
import type { CoordinatorConfig } from "./coordinator.js";
import type { VerifyConfig } from "./verify.js";

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

// A specialist submission (SpecialistSubmission shape — no phase/specialist/confidence;
// the composite roll-up stamps those and validates against SpecialistSubmission).
function fakeFinding(overrides: Partial<SpecialistSubmissionType> = {}): SpecialistSubmissionType {
  return {
    id: "coordinator-test.default",
    severity: "warning",
    message: "default test finding",
    ...overrides,
  };
}

// A full Finding the COORDINATOR runner re-emits (validated against the default full-Finding
// schema — the coordinator ingests already-stamped findings).
function fakeCoordFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "coordinator-test.default",
    phase: "coordinator-test-phase",
    severity: "warning",
    confidence: "high",
    message: "default test finding",
    ...overrides,
  };
}

function okRunner(findings: unknown[], model = "fake/model") {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model, inputTokens: 10, outputTokens: 5, durationMs: 1 },
  });
}

// --- Agreement-verify scaffolding (REVIEW_VERIFY_CONFIG shape: 3 voters, high=3, medium=2). ---
// Confidence is verify-derived, never self-reported (PRD R5): a protected finding only earns
// gating-eligible "high" by passing a real verify pass (3/3 upholds). These tests therefore route
// the protected finding through `runners["verify"]` so the coordinator's downgrade is reconciled
// against a genuinely high-confidence candidate.
const TEST_VERIFY_CONFIG: VerifyConfig = {
  voters: 3,
  lenses: ["lens-a", "lens-b", "lens-c"],
  agreementForHigh: 3,
  agreementForMedium: 2,
  budgets: { wallClockMs: 60_000, turns: 30, bashTimeoutMs: 10_000, bashOutputCap: 4096 },
};

const UPHOLD_SCRIPT: OkScript = {
  kind: "ok",
  submission: { verdict: "uphold", reason: "reproduced" },
  cost: { durationMs: 0 },
};

/** A verify runner whose queue yields `count` uphold verdicts, one per voter call (in order). */
function upholdVerifyRunner(count: number) {
  return new FakeAgentRunner(Array.from({ length: count }, () => UPHOLD_SCRIPT));
}

/** Two-specialist composite with a coordinator, used across multiple tests. */
function makePhaseWithCoordinator(
  coordRunner: FakeAgentRunner,
  opts: {
    alphaFindings?: SpecialistSubmissionType[];
    betaFindings?: SpecialistSubmissionType[];
  } = {},
) {
  // Specialist submissions carry no `specialist` field — the harness stamps it from the
  // runner key ("alpha"/"beta"). Provenance is asserted on the harness output, not the input.
  const alphaFindings = opts.alphaFindings ?? [
    fakeFinding({ id: "ct.alpha.bug", message: "alpha: real bug" }),
  ];
  const betaFindings = opts.betaFindings ?? [
    fakeFinding({
      id: "ct.beta.duplicate",
      message: "beta: same bug (duplicate)",
    }),
    fakeFinding({
      id: "ct.beta.nitpick",
      severity: "info",
      message: "beta: minor style nitpick",
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
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.id).toBe("ct.alpha.bug");
  });

  it("survivors keep their originating specialist", async () => {
    const coordOutput = [
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.findings[0]!.specialist).toBe("alpha");
  });

  it("harness re-derives specialist from the roll-up, ignoring a misbehaving judge's value", async () => {
    const coordOutput = [
      // Judge echoes a fabricated specialist not among the configured specialists —
      // harness re-derives it from the originating finding (ct.alpha.bug → alpha).
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "ghost" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.findings[0]!.specialist).toBe("alpha");
  });

  it("ambiguous shared id across distinct specialists is not mis-attributed (#48)", async () => {
    // alpha and beta both emit a finding under the SAME id and the coordinator keeps both.
    // The harness sees roll-up findings only by id, so this id is genuinely ambiguous —
    // provenance must be undefined for both, never last-in-roll-up wins (would mis-attribute
    // both to "beta").
    const shared = "ct.shared.id";
    const coordOutput = [
      fakeCoordFinding({ id: shared, message: "alpha's view", specialist: "alpha" }),
      fakeCoordFinding({ id: shared, message: "beta's view", specialist: "beta" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"), {
      alphaFindings: [fakeFinding({ id: shared, message: "alpha's view" })],
      betaFindings: [fakeFinding({ id: shared, message: "beta's view" })],
    });
    const report = await phase.run(ctx());

    expect(report.findings).toHaveLength(2);
    for (const f of report.findings) {
      expect(f.specialist).toBeUndefined();
    }
  });

  it("unambiguous duplicate id from a single specialist keeps its provenance", async () => {
    // One specialist legitimately emits one finding per match, all sharing an id. That id is
    // NOT ambiguous — every copy belongs to alpha, so survivors must keep specialist "alpha".
    const dup = "ct.alpha.dup";
    const coordOutput = [
      fakeCoordFinding({ id: dup, message: "match A", specialist: "alpha" }),
      fakeCoordFinding({ id: dup, message: "match B", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"), {
      alphaFindings: [
        fakeFinding({ id: dup, message: "match A" }),
        fakeFinding({ id: dup, message: "match B" }),
      ],
      betaFindings: [],
    });
    const report = await phase.run(ctx());

    expect(report.findings).toHaveLength(2);
    for (const f of report.findings) {
      expect(f.specialist).toBe("alpha");
    }
  });

  it("harness controls phase field on coordinator findings", async () => {
    const coordOutput = [
      // Coordinator submits with wrong phase — harness overrides it.
      fakeCoordFinding({ id: "ct.alpha.bug", phase: "wrong-phase", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.findings[0]!.phase).toBe("coordinator-test-phase");
  });

  it("cost.coordinator is populated with model and durationMs", async () => {
    const coordOutput = [
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
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
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
    ];
    const phase = makePhaseWithCoordinator(okRunner(coordOutput, "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.audit.coordinator).toBeDefined();
    expect(report.audit.coordinator!.received).toBe(3);
  });

  it("audit.coordinator.dropped records the two dropped findings", async () => {
    const coordOutput = [
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
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
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
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
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
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
      fakeCoordFinding({ id: "ct.alpha.bug", message: "alpha: real bug", specialist: "alpha" }),
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

// ---------------------------------------------------------------------------
// T28 — Constrained authority (PRD #30)
// A deterministic/evidence-backed finding (evidence.command) survives coordinator
// drops or severity downgrades; the harness reinstates it and records it in
// audit.coordinator.reinstated (but NOT in audit.coordinator.dropped).
// ---------------------------------------------------------------------------

describe("coordinator — constrained authority (T28, PRD #30)", () => {
  /** Build a 2-specialist phase with one protected finding (evidence.command) from alpha. */
  function makePhaseWithProtectedFinding(
    coordRunner: FakeAgentRunner,
    opts: {
      protectedSeverity?: Finding["severity"];
      coordKeepsWith?: Partial<Finding>;
      /**
       * Optional verify runner. When provided, the composite runs agreement-verify
       * (TEST_VERIFY_CONFIG) over the roll-up before the coordinator, so confidence is
       * verify-derived rather than self-reported (PRD R5). The queue must script every
       * voter call in roll-up order: alpha (3 voters), then beta (3 voters).
       */
      verifyRunner?: FakeAgentRunner;
    } = {},
  ) {
    const protectedFinding: SpecialistSubmissionType = {
      id: "ct.alpha.deterministic",
      severity: opts.protectedSeverity ?? "error",
      message: "test failure: command exited 1",
      evidence: { command: "npm test", output: "FAIL: 2 tests failed" },
    };
    const aiJudgmentFinding: SpecialistSubmissionType = {
      id: "ct.beta.style",
      severity: "warning",
      message: "beta: style suggestion",
    };

    const coordConfig: CoordinatorConfig = {
      rubric: "Judge findings.",
      model: "fake/coordinator",
    };

    return {
      phase: makeCompositePhase(
        {
          alpha: okRunner([protectedFinding], "fake/alpha"),
          beta: okRunner([aiJudgmentFinding], "fake/beta"),
          coordinator: coordRunner,
          ...(opts.verifyRunner ? { verify: opts.verifyRunner } : {}),
        },
        {
          id: "coordinator-test-phase",
          ...(opts.verifyRunner ? { verify: TEST_VERIFY_CONFIG } : {}),
          specialists: [
            {
              name: "alpha",
              rubric: "Run tests.",
              toolset: ["bash"],
              submitSchema: PhaseReport,
              budgets: {
                wallClockMs: 60_000,
                turns: 10,
                bashTimeoutMs: 10_000,
                bashOutputCap: 8_192,
              },
              buildUserPrompt: () => "run tests",
            },
            {
              name: "beta",
              rubric: "Check style.",
              toolset: ["read"],
              submitSchema: PhaseReport,
              budgets: {
                wallClockMs: 60_000,
                turns: 10,
                bashTimeoutMs: 10_000,
                bashOutputCap: 8_192,
              },
              buildUserPrompt: () => "check style",
            },
          ],
          coordinator: coordConfig,
        },
      ),
      protectedFinding,
    };
  }

  it("coordinator-dropped evidence-backed finding is reinstated in findings", async () => {
    // Coordinator drops the protected finding entirely — only returns the beta style finding.
    const betaOnly: Finding = {
      id: "ct.beta.style",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "beta: style suggestion",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([betaOnly], "fake/coordinator"),
    );
    const report = await phase.run(ctx());

    const reinstatedInFindings = report.findings.find((f) => f.id === protectedFinding.id);
    expect(reinstatedInFindings).toBeDefined();
    expect(reinstatedInFindings!.severity).toBe(protectedFinding.severity);
    expect(reinstatedInFindings!.evidence?.command).toBe("npm test");
  });

  it("reinstated finding is recorded in audit.coordinator.reinstated", async () => {
    const betaOnly: Finding = {
      id: "ct.beta.style",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "beta: style suggestion",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([betaOnly], "fake/coordinator"),
    );
    const report = await phase.run(ctx());

    const reinstated = report.audit.coordinator!.reinstated;
    expect(reinstated).toHaveLength(1);
    expect(reinstated[0]!.id).toBe(protectedFinding.id);
    expect(reinstated[0]!.specialist).toBe("alpha");
  });

  it("reinstated finding is NOT in audit.coordinator.dropped", async () => {
    const betaOnly: Finding = {
      id: "ct.beta.style",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "beta: style suggestion",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([betaOnly], "fake/coordinator"),
    );
    const report = await phase.run(ctx());

    const droppedIds = report.audit.coordinator!.dropped.map((d) => d.id);
    expect(droppedIds).not.toContain(protectedFinding.id);
  });

  it("coordinator-downgraded evidence-backed finding is reinstated at original severity", async () => {
    // Coordinator includes the protected finding but downgrades it from error → warning.
    const downgraded: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "warning", // coordinator lowered severity
      confidence: "high",
      message: "test failure: command exited 1",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([downgraded], "fake/coordinator"),
      { protectedSeverity: "error" },
    );
    const report = await phase.run(ctx());

    const inFindings = report.findings.find((f) => f.id === protectedFinding.id);
    expect(inFindings).toBeDefined();
    expect(inFindings!.severity).toBe("error"); // original severity, not coordinator's "warning"
  });

  it("downgraded evidence-backed finding is recorded in reinstated", async () => {
    const downgraded: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "test failure: command exited 1",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([downgraded], "fake/coordinator"),
      { protectedSeverity: "error" },
    );
    const report = await phase.run(ctx());

    const reinstated = report.audit.coordinator!.reinstated;
    expect(reinstated.map((r) => r.id)).toContain(protectedFinding.id);
  });

  // Confidence is verify-derived (PRD R5): the protected finding earns "high" only by passing a
  // real agreement-verify pass (3/3 upholds), so this test routes it through a scripted verify
  // runner. The coordinator then lowers confidence high → low; the harness re-stamps the verify-
  // derived "high" back over the coordinator's value, so the surviving finding keeps "high".
  it("coordinator-lowered-confidence evidence-backed finding keeps verify-derived confidence", async () => {
    // Coordinator keeps severity but lowers confidence high → low. Confidence is
    // harness-owned (PRD §4.6 / #30 / TDD A·4): the coordinator cannot lower it.
    const downgraded: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "error",
      confidence: "low", // coordinator lowered confidence
      message: "test failure: command exited 1",
    };
    const { phase, protectedFinding } = makePhaseWithProtectedFinding(
      okRunner([downgraded], "fake/coordinator"),
      // verify roll-up order: alpha (3 upholds → high), beta (3 upholds → high).
      { protectedSeverity: "error", verifyRunner: upholdVerifyRunner(6) },
    );
    const report = await phase.run(ctx());

    const inFindings = report.findings.find((f) => f.id === protectedFinding.id);
    expect(inFindings).toBeDefined();
    expect(inFindings!.confidence).toBe("high"); // verify-derived confidence, not coordinator's "low"
    expect(inFindings!.severity).toBe("error");

    // And it gates at failOn=error (severity error + confidence high).
    const { gating } = deriveExit([report], "error");
    expect(gating.map((g) => g.id)).toContain(protectedFinding.id);
  });

  it("non-protected finding is not reinstated when coordinator drops it", async () => {
    // Coordinator drops the beta style finding (no evidence.command) → that drop stands.
    const alphaOnly: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "error",
      confidence: "high",
      message: "test failure: command exited 1",
      evidence: { command: "npm test", output: "FAIL: 2 tests failed" },
    };
    const { phase } = makePhaseWithProtectedFinding(okRunner([alphaOnly], "fake/coordinator"));
    const report = await phase.run(ctx());

    // Beta style finding should be absent (coordinator dropped it, no protection).
    const betaInFindings = report.findings.find((f) => f.id === "ct.beta.style");
    expect(betaInFindings).toBeUndefined();
    // It should be in dropped.
    const droppedIds = report.audit.coordinator!.dropped.map((d) => d.id);
    expect(droppedIds).toContain("ct.beta.style");
  });

  it("reinstated finding validates against TypeBox PhaseReport schema", async () => {
    const betaOnly: Finding = {
      id: "ct.beta.style",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "beta: style suggestion",
    };
    const { phase } = makePhaseWithProtectedFinding(okRunner([betaOnly], "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T28 — Gating interaction (PRD §4.6, §4.8)
// Re-ranked severity/confidence flows into result.gating correctly:
//   - A coordinator can downgrade an AI-judgment finding (no evidence.command) →
//     the downgraded finding is what appears in findings → deriveExit sees it.
//   - A downgraded error → warning finding no longer gates when failOn=error.
// ---------------------------------------------------------------------------

describe("coordinator — gating interaction (T28, PRD §4.6/§4.8)", () => {
  it("coordinator-downgraded AI-judgment finding (error→warning) stops gating at failOn=error", async () => {
    // Specialist emits an AI-judgment error finding (no evidence.command).
    const errorFinding: SpecialistSubmissionType = {
      id: "ct.alpha.ai-judgment",
      severity: "error",
      message: "potential bug: off-by-one",
    };
    // Coordinator downgrades it to warning — downgrade is accepted (no evidence.command).
    const downgraded: Finding = {
      id: "ct.alpha.ai-judgment",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "potential bug: off-by-one",
    };

    const phase = makeCompositePhase(
      {
        alpha: okRunner([errorFinding], "fake/alpha"),
        coordinator: okRunner([downgraded], "fake/coordinator"),
      },
      {
        id: "coordinator-test-phase",
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
        coordinator: { rubric: "Judge findings.", model: "fake/coordinator" },
      },
    );

    const report = await phase.run(ctx());

    // The downgraded finding appears in findings at warning severity.
    const finding = report.findings.find((f) => f.id === "ct.alpha.ai-judgment");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("warning");

    // With failOn=error, the warning-severity finding does NOT gate.
    const { gating } = deriveExit([report], "error");
    const gatingIds = gating.map((g) => g.id);
    expect(gatingIds).not.toContain("ct.alpha.ai-judgment");
  });

  it("coordinator-downgraded AI-judgment finding gates when failOn=warning", async () => {
    const errorFinding: SpecialistSubmissionType = {
      id: "ct.alpha.ai-judgment",
      severity: "error",
      message: "potential bug",
    };
    const downgraded: Finding = {
      id: "ct.alpha.ai-judgment",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "potential bug",
    };

    const phase = makeCompositePhase(
      {
        alpha: okRunner([errorFinding], "fake/alpha"),
        coordinator: okRunner([downgraded], "fake/coordinator"),
      },
      {
        id: "coordinator-test-phase",
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
        coordinator: { rubric: "Judge findings.", model: "fake/coordinator" },
      },
    );

    const report = await phase.run(ctx());

    // With failOn=warning, the downgraded warning finding still gates.
    const { gating } = deriveExit([report], "warning");
    const gatingIds = gating.map((g) => g.id);
    expect(gatingIds).toContain("ct.alpha.ai-judgment");
  });

  // Confidence is verify-derived (PRD R5): a single scripted verify pass (3/3 upholds) earns the
  // protected finding gating-eligible "high". The coordinator then downgrades its severity; the
  // harness reinstates the original error severity, and the finding gates at failOn=error.
  it("protected finding (evidence.command) keeps original error severity and gates at failOn=error", async () => {
    // Protected finding: error severity with evidence.command.
    const protectedFinding: SpecialistSubmissionType = {
      id: "ct.alpha.deterministic",
      severity: "error",
      message: "test failed",
      evidence: { command: "npm test", output: "FAIL" },
    };
    // Coordinator tries to downgrade it — harness reinstates original.
    const downgraded: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "test failed",
    };

    const phase = makeCompositePhase(
      {
        alpha: okRunner([protectedFinding], "fake/alpha"),
        // One candidate in the roll-up → 3 voter calls (3 upholds → high).
        verify: upholdVerifyRunner(3),
        coordinator: okRunner([downgraded], "fake/coordinator"),
      },
      {
        id: "coordinator-test-phase",
        verify: TEST_VERIFY_CONFIG,
        specialists: [
          {
            name: "alpha",
            rubric: "Run tests.",
            toolset: ["bash"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "run tests",
          },
        ],
        coordinator: { rubric: "Judge findings.", model: "fake/coordinator" },
      },
    );

    const report = await phase.run(ctx());

    // Harness reinstated the original error severity.
    const finding = report.findings.find((f) => f.id === "ct.alpha.deterministic");
    expect(finding!.severity).toBe("error");

    // Protected finding still gates at failOn=error.
    const { gating } = deriveExit([report], "error");
    const gatingIds = gating.map((g) => g.id);
    expect(gatingIds).toContain("ct.alpha.deterministic");
  });

  // Confidence is verify-derived (PRD R5): a single scripted verify pass (3/3 upholds) earns the
  // protected finding gating-eligible "high". The coordinator then lowers confidence high → low;
  // the harness re-stamps the verify-derived "high" back over it, so the finding keeps "high" and
  // still gates at failOn=error.
  it("protected finding keeps verify-derived high confidence and still gates when coordinator lowers confidence", async () => {
    // Protected finding: error/high with evidence.command. Gating requires
    // confidence === "high" AND severity >= failOn — a confidence downgrade would
    // otherwise neutralize it (PRD §4.6 / #30 / TDD A·4).
    const protectedFinding: SpecialistSubmissionType = {
      id: "ct.alpha.deterministic",
      severity: "error",
      message: "test failed",
      evidence: { command: "npm test", output: "FAIL" },
    };
    // Coordinator keeps severity error but lowers confidence high → low.
    const downgraded: Finding = {
      id: "ct.alpha.deterministic",
      phase: "coordinator-test-phase",
      severity: "error",
      confidence: "low",
      message: "test failed",
    };

    const phase = makeCompositePhase(
      {
        alpha: okRunner([protectedFinding], "fake/alpha"),
        // One candidate in the roll-up → 3 voter calls (3 upholds → high).
        verify: upholdVerifyRunner(3),
        coordinator: okRunner([downgraded], "fake/coordinator"),
      },
      {
        id: "coordinator-test-phase",
        verify: TEST_VERIFY_CONFIG,
        specialists: [
          {
            name: "alpha",
            rubric: "Run tests.",
            toolset: ["bash"],
            submitSchema: PhaseReport,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "run tests",
          },
        ],
        coordinator: { rubric: "Judge findings.", model: "fake/coordinator" },
      },
    );

    const report = await phase.run(ctx());

    // Harness re-stamped the verify-derived high confidence over the coordinator's "low".
    const finding = report.findings.find((f) => f.id === "ct.alpha.deterministic");
    expect(finding!.confidence).toBe("high");

    // Protected finding still gates at failOn=error.
    const { gating } = deriveExit([report], "error");
    const gatingIds = gating.map((g) => g.id);
    expect(gatingIds).toContain("ct.alpha.deterministic");
  });
});

// ---------------------------------------------------------------------------
// Duplicate finding ids — reconcile by multiplicity, not by id alone.
//
// A single rule id can legitimately appear N>1 times in one roll-up (a specialist
// emits one finding per match, all sharing an id). The coordinator reconciliation
// must account for each copy individually:
//   - every dropped protected (evidence-backed) copy is reinstated (#30), and
//   - the dropped audit counts each dropped copy (#31),
// rather than collapsing duplicates by id (which loses all-but-one copy).
// ---------------------------------------------------------------------------

describe("coordinator — duplicate finding ids (reconcile by multiplicity)", () => {
  /** Single-specialist composite whose specialist emits the given findings, plus a coordinator. */
  function makePhase(alphaFindings: SpecialistSubmissionType[], coordRunner: FakeAgentRunner) {
    return makeCompositePhase(
      {
        alpha: okRunner(alphaFindings, "fake/alpha"),
        coordinator: coordRunner,
      },
      {
        id: "coordinator-test-phase",
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
        coordinator: { rubric: "Judge findings.", model: "fake/coordinator" },
      },
    );
  }

  it("reinstates EVERY protected copy when N>1 share an id and the judge drops them all", async () => {
    const protectedA: SpecialistSubmissionType = {
      id: "ct.alpha.fixme",
      severity: "error",
      message: "FIXME at line 10",
      evidence: { command: "npm test", output: "x" },
    };
    const protectedB: SpecialistSubmissionType = { ...protectedA, message: "FIXME at line 20" };

    // Coordinator drops both protected findings (returns nothing).
    const phase = makePhase([protectedA, protectedB], okRunner([], "fake/coordinator"));
    const report = await phase.run(ctx());

    const reinstatedFindings = report.findings.filter((f) => f.id === "ct.alpha.fixme");
    expect(reinstatedFindings).toHaveLength(2);
    expect(reinstatedFindings.map((f) => f.message).sort()).toEqual([
      "FIXME at line 10",
      "FIXME at line 20",
    ]);
    // Both copies recorded as reinstated, neither reported dropped.
    expect(
      report.audit.coordinator!.reinstated.filter((r) => r.id === "ct.alpha.fixme"),
    ).toHaveLength(2);
    expect(report.audit.coordinator!.dropped.map((d) => d.id)).not.toContain("ct.alpha.fixme");
  });

  it("counts each dropped duplicate when the judge keeps one of N findings sharing an id", async () => {
    const dupA: SpecialistSubmissionType = {
      id: "ct.alpha.dup",
      severity: "warning",
      message: "dup at line 10",
    };
    const dupB: SpecialistSubmissionType = { ...dupA, message: "dup at line 20" };

    // Coordinator keeps a single finding with that id (merges the rest).
    const kept: Finding = {
      id: "ct.alpha.dup",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "merged",
    };
    const phase = makePhase([dupA, dupB], okRunner([kept], "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(report.audit.coordinator!.received).toBe(2);
    // Exactly one of the two duplicates is reported dropped (not zero).
    const droppedDup = report.audit.coordinator!.dropped.filter((d) => d.id === "ct.alpha.dup");
    expect(droppedDup).toHaveLength(1);
  });

  it("reinstates the dropped protected copy even when one copy survives at full severity", async () => {
    const protectedA: SpecialistSubmissionType = {
      id: "ct.alpha.fixme",
      severity: "error",
      message: "FIXME at line 10",
      evidence: { command: "npm test", output: "x" },
    };
    const protectedB: SpecialistSubmissionType = { ...protectedA, message: "FIXME at line 20" };

    // Coordinator keeps only ONE of the two protected copies.
    const survivor: Finding = {
      id: "ct.alpha.fixme",
      phase: "coordinator-test-phase",
      severity: "error",
      confidence: "high",
      message: "FIXME at line 10",
    };
    const phase = makePhase([protectedA, protectedB], okRunner([survivor], "fake/coordinator"));
    const report = await phase.run(ctx());

    // Both protected copies are present: the surviving one + the reinstated dropped one.
    expect(report.findings.filter((f) => f.id === "ct.alpha.fixme")).toHaveLength(2);
    expect(
      report.audit.coordinator!.reinstated.filter((r) => r.id === "ct.alpha.fixme"),
    ).toHaveLength(1);
  });

  it("report with reconciled duplicates validates against the PhaseReport schema", async () => {
    const a: SpecialistSubmissionType = {
      id: "ct.alpha.dup",
      severity: "warning",
      message: "dup at line 10",
    };
    const b: SpecialistSubmissionType = { ...a, message: "dup at line 20" };
    const phase = makePhase([a, b], okRunner([], "fake/coordinator"));
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extended protected class: verify-stamped confidence "high" (T11, TDD A·4).
//
// Agreement-verified high confidence joins the protected class alongside
// evidence.command — the coordinator cannot silently drop or downgrade a 3/3
// corroborated finding. Only verify-stamped high is protected: model-supplied
// high (without verify) is NOT, so existing AI-judgment downgrade tests stay green.
// ---------------------------------------------------------------------------

/** 1-voter verify config: 1 uphold → high, 0 upholds → dropped. */
const VERIFY_1V: VerifyConfig = {
  voters: 1,
  lenses: ["Is this finding real?"],
  agreementForHigh: 1,
  agreementForMedium: 1,
};

/** Always-uphold voter FakeAgentRunner. */
function upholdVoter() {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { verdict: "uphold", reason: "confirmed" },
    cost: { model: "fake/voter", durationMs: 1 },
  });
}

/**
 * Build a single-specialist composite with verify + coordinator.
 * The specialist emits `alphaFindings`; the verify voter always upholds;
 * the coordinator runner is scripted by the caller.
 */
function makeVerifiedPhase(
  alphaFindings: SpecialistSubmissionType[],
  coordRunner: FakeAgentRunner,
) {
  return makeCompositePhase(
    {
      alpha: okRunner(alphaFindings, "fake/alpha"),
      verify: upholdVoter(),
      coordinator: coordRunner,
    },
    {
      id: "coordinator-test-phase",
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
          buildUserPrompt: () => "diff",
        },
      ],
      verify: VERIFY_1V,
      coordinator: { rubric: "Judge.", model: "fake/coordinator" },
    },
  );
}

describe("coordinator — verify-stamped confidence 'high' (T11, TDD A·4)", () => {
  it("high+no-evidence dropped by coordinator → reinstated (matrix row 1)", async () => {
    // Verify stamps "high". Coordinator drops the finding (returns empty).
    const finding: SpecialistSubmissionType = {
      id: "ct.alpha.high-no-evidence",
      severity: "error",
      message: "off-by-one",
    };

    const phase = makeVerifiedPhase([finding], okRunner([], "fake/coordinator"));
    const report = await phase.run(ctx());

    // Harness reinstated the finding with verify-stamped confidence.
    const f = report.findings.find((f) => f.id === "ct.alpha.high-no-evidence");
    expect(f).toBeDefined();
    expect(f!.confidence).toBe("high");
    expect(
      report.audit.coordinator!.reinstated.some((r) => r.id === "ct.alpha.high-no-evidence"),
    ).toBe(true);
    expect(report.audit.coordinator!.dropped.map((d) => d.id)).not.toContain(
      "ct.alpha.high-no-evidence",
    );
  });

  it("high downgraded by coordinator → reinstated-in-place (matrix row 2)", async () => {
    // Verify stamps "high". Coordinator keeps the id but downgrades severity error→warning.
    const finding: SpecialistSubmissionType = {
      id: "ct.alpha.high-downgraded",
      severity: "error",
      message: "real bug",
    };
    const downgraded: Finding = {
      id: "ct.alpha.high-downgraded",
      phase: "coordinator-test-phase",
      severity: "warning", // downgraded
      confidence: "high",
      message: "real bug",
    };

    const phase = makeVerifiedPhase([finding], okRunner([downgraded], "fake/coordinator"));
    const report = await phase.run(ctx());

    // Harness reinstated the original error severity in place.
    const f = report.findings.find((f) => f.id === "ct.alpha.high-downgraded");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.confidence).toBe("high");
    expect(
      report.audit.coordinator!.reinstated.some((r) => r.id === "ct.alpha.high-downgraded"),
    ).toBe(true);
  });

  it("high+evidence dropped → ONE reinstatement not two (matrix row 3)", async () => {
    // Both predicates true (evidence.command AND verify-stamped high).
    // Must not produce a double reinstatement.
    const finding: SpecialistSubmissionType = {
      id: "ct.alpha.high-evidence",
      severity: "error",
      message: "test failed",
      evidence: { command: "npm test", output: "FAIL" },
    };

    const phase = makeVerifiedPhase([finding], okRunner([], "fake/coordinator"));
    const report = await phase.run(ctx());

    const reinstated = report.findings.filter((f) => f.id === "ct.alpha.high-evidence");
    expect(reinstated).toHaveLength(1);
    expect(
      report.audit.coordinator!.reinstated.filter((r) => r.id === "ct.alpha.high-evidence"),
    ).toHaveLength(1);
  });

  it("report validates against PhaseReport schema after verify-stamped reinstatement", async () => {
    const finding: SpecialistSubmissionType = {
      id: "ct.alpha.reinstated",
      severity: "error",
      message: "real bug",
    };

    const phase = makeVerifiedPhase([finding], okRunner([], "fake/coordinator"));
    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("model-supplied high (no verify) is NOT protected — existing AI-judgment downgrade still accepted", async () => {
    // This is the regression guard: without verify configured, a high-confidence
    // AI-judgment finding can still be downgraded by the coordinator.
    const aiJudgment: SpecialistSubmissionType = {
      id: "ct.alpha.ai-judgment",
      severity: "error",
      message: "potential bug",
    };
    const downgraded: Finding = {
      id: "ct.alpha.ai-judgment",
      phase: "coordinator-test-phase",
      severity: "warning",
      confidence: "high",
      message: "potential bug",
    };

    // No verify in config — model-supplied high is not protected.
    const phase = makeCompositePhase(
      {
        alpha: okRunner([aiJudgment], "fake/alpha"),
        coordinator: okRunner([downgraded], "fake/coordinator"),
      },
      {
        id: "coordinator-test-phase",
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
            buildUserPrompt: () => "diff",
          },
        ],
        coordinator: { rubric: "Judge.", model: "fake/coordinator" },
        // No verify: confidenceById is empty → high is not protected
      },
    );

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "ct.alpha.ai-judgment");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning"); // downgrade accepted (no verify)
  });
});
