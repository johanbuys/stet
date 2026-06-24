/**
 * Tests for the agreement-verify wiring in composite.run (T11 · M4 · plan step 1).
 *
 * Fake-driven: specialists and verify voters are scripted FakeAgentRunners.
 * Verifies:
 *   - verify runs when cfg.verify is set; audit.verify is populated.
 *   - Findings dropped by verify don't reach the coordinator or the output.
 *   - Verify-stamped confidence survives coordinator re-attribution.
 *   - No verify runner → all findings stamped confidence: low + verify-degraded warning.
 *   - Verify ConfigError (bad config) → same total-failure fallback.
 *
 * TDD refs: A·1, A·3, A·4. Plan: M4 step 1 (S3/S4/F4).
 */

import { describe, expect, it } from "vite-plus/test";
import { Value } from "@sinclair/typebox/value";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { deriveExit } from "../exit-codes.js";
import {
  type Finding,
  SpecialistSubmission,
  type SpecialistSubmission as SpecialistSubmissionType,
} from "../schema/finding.js";
import { PhaseReport } from "../schema/report.js";
import { makeCompositePhase } from "./composite.js";
import type { VerifyConfig } from "./verify.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx() {
  return {
    cwd: "/tmp/composite-test",
    scope: { kind: "staged" as const, files: ["src/a.ts"] },
    config: {},
    diff: "diff --git a/src/a.ts b/src/a.ts\n+new line\n",
  };
}

// Specialist submissions are SpecialistSubmission shape: no phase/specialist/confidence
// (those are harness-stamped by the roll-up). Matching that shape is what lets the fake
// survive ingestion, which now validates against SpecialistSubmission, not full Finding.
function fakeFinding(overrides: Partial<SpecialistSubmissionType> = {}): SpecialistSubmissionType {
  return {
    id: "composite-test.finding",
    severity: "error",
    message: "test finding",
    ...overrides,
  };
}

// Coordinator submissions ARE full Findings (the coordinator path validates against the
// default full-Finding schema, since it re-emits already-stamped findings).
function fakeCoordFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "composite-test.finding",
    phase: "test-phase",
    severity: "error",
    confidence: "high",
    message: "test finding",
    ...overrides,
  };
}

function okRunner(findings: SpecialistSubmissionType[]) {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model: "fake/model", inputTokens: 5, outputTokens: 3, durationMs: 1 },
  });
}

/** Voter runner that always upholds. */
function upholdVoter() {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { verdict: "uphold", reason: "confirmed" },
    cost: { model: "fake/voter", inputTokens: 3, outputTokens: 2, durationMs: 1 },
  });
}

/** Voter runner that always refutes. */
function refuteVoter() {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { verdict: "refute", reason: "not real" },
    cost: { model: "fake/voter", inputTokens: 3, outputTokens: 2, durationMs: 1 },
  });
}

/** Coordinator runner that passes all findings through unchanged. */
function passthroughCoordinator(findings: Finding[]) {
  // Coordinator submission is full Finding shape (validated against the default schema).
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model: "fake/coordinator", inputTokens: 5, outputTokens: 3, durationMs: 1 },
  });
}

/** 1-voter verify config that stamps: 1 uphold → high (agreementForHigh: 1). */
const VERIFY_1V: VerifyConfig = {
  voters: 1,
  lenses: ["Is this finding real?"],
  agreementForHigh: 1,
  agreementForMedium: 1,
};

/** 1-voter verify config where nothing reaches "high" (bar is 2, max is 1). */
const VERIFY_1V_STRICT: VerifyConfig = {
  voters: 1,
  lenses: ["Is this finding real?"],
  agreementForHigh: 2,
  agreementForMedium: 1,
};

function makePhase(opts: {
  alphaFindings: SpecialistSubmissionType[];
  verifyRunner?: FakeAgentRunner;
  verify?: VerifyConfig;
  coordRunner?: FakeAgentRunner;
}) {
  const runners: Record<string, FakeAgentRunner> = {
    alpha: okRunner(opts.alphaFindings),
  };
  if (opts.verifyRunner) runners["verify"] = opts.verifyRunner;
  if (opts.coordRunner) runners["coordinator"] = opts.coordRunner;

  return makeCompositePhase(runners, {
    id: "test-phase",
    specialists: [
      {
        name: "alpha",
        rubric: "Find bugs.",
        toolset: ["read"],
        submitSchema: PhaseReport,
        budgets: { wallClockMs: 60_000, turns: 10, bashTimeoutMs: 10_000, bashOutputCap: 8_192 },
        buildUserPrompt: () => "diff context",
      },
    ],
    verify: opts.verify,
    coordinator: opts.coordRunner ? { rubric: "Judge.", model: "fake/coordinator" } : undefined,
  });
}

// ---------------------------------------------------------------------------
// audit.verify populated when verify runs
// ---------------------------------------------------------------------------

describe("verify wiring — audit.verify", () => {
  it("audit.verify is present in the report when verify runs with all upholds", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: upholdVoter(),
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    expect(report.audit.verify).toBeDefined();
    expect(report.audit.verify!.received).toBe(1);
    expect(report.audit.verify!.dropped).toHaveLength(0);
  });

  it("audit.verify.dropped lists findings that fail the agreement threshold", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: refuteVoter(),
      verify: VERIFY_1V_STRICT, // needs 2 upholds but gets 0 → dropped
    });

    const report = await phase.run(ctx());

    expect(report.audit.verify!.received).toBe(1);
    expect(report.audit.verify!.dropped).toHaveLength(1);
    expect(report.audit.verify!.dropped[0]!.id).toBe("test-phase.bug");
    expect(report.audit.verify!.dropped[0]!.upholds).toBe(0);
  });

  it("report validates against the PhaseReport schema when audit.verify is present", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: upholdVoter(),
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dropped findings don't reach the output
// ---------------------------------------------------------------------------

describe("verify wiring — dropped findings excluded", () => {
  it("a finding refuted by voters does not appear in the final report", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: refuteVoter(),
      verify: VERIFY_1V_STRICT, // 0 upholds < 2 needed → dropped
    });

    const report = await phase.run(ctx());

    expect(report.findings.map((f) => f.id)).not.toContain("test-phase.bug");
    expect(report.status).toBe("completed");
  });

  it("upheld findings survive while refuted ones are dropped", async () => {
    // Two findings; voter queue: uphold for first, refute for second.
    const good = fakeFinding({ id: "test-phase.good" });
    const bad = fakeFinding({ id: "test-phase.bad", message: "noisy finding" });

    // Queue: 1 uphold for 'good', 1 refute for 'bad'
    const queuedVoter = new FakeAgentRunner([
      {
        kind: "ok",
        submission: { verdict: "uphold", reason: "real" },
        cost: { model: "fake/voter", durationMs: 1 },
      },
      {
        kind: "ok",
        submission: { verdict: "refute", reason: "noise" },
        cost: { model: "fake/voter", durationMs: 1 },
      },
    ]);

    const alphaRunner = new FakeAgentRunner({
      kind: "ok",
      submission: { findings: [good, bad] },
      cost: { model: "fake/alpha", durationMs: 1 },
    });

    const phase = makeCompositePhase(
      { alpha: alphaRunner, verify: queuedVoter },
      {
        id: "test-phase",
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
      },
    );

    const report = await phase.run(ctx());

    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain("test-phase.good");
    expect(ids).not.toContain("test-phase.bad");
  });
});

// ---------------------------------------------------------------------------
// Confidence stamped by id survives coordinator re-attribution
// ---------------------------------------------------------------------------

describe("verify wiring — confidence stamped by id surviving coordinator", () => {
  it("verify-stamped high confidence survives coordinator re-attribution", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    // Coordinator passes it through (keeping whatever it receives)
    const coordOutput = fakeCoordFinding({ id: "test-phase.bug", confidence: "medium" });

    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: upholdVoter(), // stamps "high" (agreementForHigh: 1, 1 uphold)
      verify: VERIFY_1V,
      coordRunner: passthroughCoordinator([coordOutput]),
    });

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "test-phase.bug");
    expect(f).toBeDefined();
    expect(f!.confidence).toBe("high");
  });

  it("coordinator cannot lower verify-stamped confidence", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const lowered = fakeCoordFinding({ id: "test-phase.bug", confidence: "low" });

    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: upholdVoter(), // stamps "high"
      verify: VERIFY_1V,
      coordRunner: passthroughCoordinator([lowered]),
    });

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "test-phase.bug");
    expect(f!.confidence).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Total failure paths (no runner / ConfigError)
// ---------------------------------------------------------------------------

describe("verify wiring — total failure fallback (TDD A·3)", () => {
  it("all findings stamped confidence: low when verify runner is missing", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({
      alphaFindings: [finding],
      // No verifyRunner supplied
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "test-phase.bug");
    expect(f).toBeDefined();
    expect(f!.confidence).toBe("low");
  });

  it("verify-degraded warning is emitted when verify runner is missing", async () => {
    const phase = makePhase({
      alphaFindings: [fakeFinding({ id: "test-phase.bug" })],
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    const warn = report.findings.find((f) => f.id === "test-phase.verify-degraded");
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("warning");
    expect(warn!.confidence).toBe("high");
  });

  it("verify ConfigError (lenses ≠ voters) → same total-failure fallback", async () => {
    const finding = fakeFinding({ id: "test-phase.bug" });
    const badVerify: VerifyConfig = {
      voters: 3,
      lenses: ["only one lens"], // mismatch: 3 voters but 1 lens → ConfigError
      agreementForHigh: 3,
      agreementForMedium: 2,
    };

    const phase = makePhase({
      alphaFindings: [finding],
      verifyRunner: upholdVoter(),
      verify: badVerify,
    });

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "test-phase.bug");
    expect(f!.confidence).toBe("low");
    const warn = report.findings.find((f) => f.id === "test-phase.verify-degraded");
    expect(warn).toBeDefined();
  });

  it("status remains completed on total failure — never errors (TDD A·3)", async () => {
    const phase = makePhase({
      alphaFindings: [fakeFinding()],
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
  });

  it("total failure report validates against the PhaseReport schema", async () => {
    const phase = makePhase({
      alphaFindings: [fakeFinding()],
      verify: VERIFY_1V,
    });

    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Degraded verify + coordinator: the coordinator must be SKIPPED (latent M5 bug)
// ---------------------------------------------------------------------------

describe("verify wiring — degraded verify skips the coordinator (M5 latent bug)", () => {
  it("when verify degrades, the coordinator does not run and the conservative roll-up survives", async () => {
    // Coordinator that, IF it ran, would visibly change the result: it replaces the
    // roll-up with a single high-confidence finding (no verify-degraded warning).
    // A broken-verify run must NOT be able to produce this gating, warning-free result.
    const coordRunner = passthroughCoordinator([
      fakeCoordFinding({ id: "test-phase.bug", confidence: "high", severity: "error" }),
    ]);

    const phase = makePhase({
      alphaFindings: [fakeFinding({ id: "test-phase.bug" })],
      // No verifyRunner supplied → "no verify runner" degraded branch.
      verify: VERIFY_1V,
      coordRunner,
    });

    const report = await phase.run(ctx());

    // Coordinator did NOT run: no coordinator audit entry.
    expect(report.audit.coordinator).toBeUndefined();

    // The raw conservative roll-up survived: the specialist finding is stamped low,
    // NOT raised to high by the coordinator.
    const bug = report.findings.find((f) => f.id === "test-phase.bug");
    expect(bug).toBeDefined();
    expect(bug!.confidence).toBe("low");

    // The verify-degraded warning is present (coordinator would have dropped it).
    const warn = report.findings.find((f) => f.id === "test-phase.verify-degraded");
    expect(warn).toBeDefined();

    // And the run gates nothing: a broken-verify run cannot look like a clean gating run.
    expect(deriveExit([report], "error").exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Specialist roll-up parses SpecialistSubmission (no confidence) and stamps it
// ---------------------------------------------------------------------------

describe("specialist roll-up — SpecialistSubmission ingestion (no model confidence)", () => {
  it("a submission with no confidence field survives and is harness-stamped 'low'", async () => {
    // Shape = SpecialistSubmission: the model never sends confidence/specialist/phase.
    // Today's roll-up validates against full Finding, so parseFindings returns null and
    // the finding is dropped. After the fix it must reach the output with a stamped
    // provisional confidence of "low".
    const submission = {
      findings: [
        {
          id: "test-phase.bug",
          severity: "error" as const,
          message: "real bug, no confidence supplied",
          location: { file: "src/a.ts", line: 2 },
        },
      ],
    };
    const alphaRunner = new FakeAgentRunner({
      kind: "ok",
      submission,
      cost: { model: "fake/alpha", durationMs: 1 },
    });

    const phase = makeCompositePhase(
      { alpha: alphaRunner },
      {
        id: "test-phase",
        specialists: [
          {
            name: "alpha",
            rubric: "Find bugs.",
            toolset: ["read"],
            submitSchema: SpecialistSubmission,
            budgets: {
              wallClockMs: 60_000,
              turns: 10,
              bashTimeoutMs: 10_000,
              bashOutputCap: 8_192,
            },
            buildUserPrompt: () => "diff",
          },
        ],
        // No verify → assert the provisional stamp directly.
      },
    );

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "test-phase.bug");
    expect(f).toBeDefined();
    expect(f!.confidence).toBe("low");
    expect(f!.specialist).toBe("alpha");
    expect(f!.phase).toBe("test-phase");
  });
});

// ---------------------------------------------------------------------------
// No verify configured — existing behavior unchanged
// ---------------------------------------------------------------------------

describe("verify wiring — no verify configured", () => {
  it("audit.verify is absent when cfg.verify is not set", async () => {
    const phase = makePhase({ alphaFindings: [fakeFinding()] });
    const report = await phase.run(ctx());
    expect(report.audit.verify).toBeUndefined();
  });

  it("findings get the provisional 'low' confidence stamp when no verify configured", async () => {
    // No verify → the harness stamps the provisional confidence ("low") at roll-up; there is
    // no agreement-verify pass to upgrade it. The model never supplies confidence.
    const finding = fakeFinding({ id: "test-phase.bug" });
    const phase = makePhase({ alphaFindings: [finding] });
    const report = await phase.run(ctx());
    expect(report.findings.find((f) => f.id === "test-phase.bug")?.confidence).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// markPreexisting finalization wraps all five completed return paths (T12 · M4 · plan step 4)
//
// TDD B·2 / plan F2: a single markPreexisting call is applied post-coordinator on every
// completed return path. Pre-existing findings (location.line NOT in the diff added-line
// set) receive meta.preexisting = true; introduced findings (line IS in the added set) do not.
// A finding with no location.line is never stamped (conservative: still gates).
//
// The accept criterion for "non-gating" is structural: meta.preexisting = true means the
// downstream gate (deriveExit, M6 step 3) skips the finding. The harness stamps it here;
// M6 reads it. Tested here via the meta value directly.
// ---------------------------------------------------------------------------

/** A diff in which src/a.ts line 2 is added, lines 1/3/4 are context (pre-existing). */
const DIFF_WITH_ADDED_LINE = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,3 +1,4 @@",
  " existing line one",
  "+new added line",
  " existing line three",
  " existing line four",
].join("\n");

function ctxWithDiff() {
  return {
    cwd: "/tmp/composite-test",
    scope: { kind: "staged" as const, files: ["src/a.ts"] },
    config: {},
    diff: DIFF_WITH_ADDED_LINE,
  };
}

describe("markPreexisting finalization — no-coordinator (trivial) path (T12, TDD B·2)", () => {
  it("finding on a pre-existing line gets meta.preexisting = true", async () => {
    const finding = fakeFinding({
      id: "test-phase.preexist",
      location: { file: "src/a.ts", line: 1 }, // line 1 is context, not added
    });
    const phase = makePhase({ alphaFindings: [finding] });

    const report = await phase.run(ctxWithDiff());

    const f = report.findings.find((f) => f.id === "test-phase.preexist");
    expect(f).toBeDefined();
    expect(f!.meta).toMatchObject({ preexisting: true });
  });

  it("finding on an added line does NOT get meta.preexisting", async () => {
    const finding = fakeFinding({
      id: "test-phase.introduced",
      location: { file: "src/a.ts", line: 2 }, // line 2 is the added line
    });
    const phase = makePhase({ alphaFindings: [finding] });

    const report = await phase.run(ctxWithDiff());

    const f = report.findings.find((f) => f.id === "test-phase.introduced");
    expect(f).toBeDefined();
    expect((f!.meta as Record<string, unknown> | undefined)?.preexisting).toBeUndefined();
  });

  it("finding with no location.line is not stamped (conservative)", async () => {
    const finding = fakeFinding({
      id: "test-phase.noloc",
      // No location field — cross-cutting finding
    });
    const phase = makePhase({ alphaFindings: [finding] });

    const report = await phase.run(ctxWithDiff());

    const f = report.findings.find((f) => f.id === "test-phase.noloc");
    expect((f!.meta as Record<string, unknown> | undefined)?.preexisting).toBeUndefined();
  });

  it("status remains completed and report validates against PhaseReport schema", async () => {
    const finding = fakeFinding({
      id: "test-phase.preexist2",
      location: { file: "src/a.ts", line: 3 },
    });
    const phase = makePhase({ alphaFindings: [finding] });

    const report = await phase.run(ctxWithDiff());

    expect(report.status).toBe("completed");
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

describe("markPreexisting finalization — coordinator-ok path (T12, TDD B·2)", () => {
  it("coordinator-ok path: pre-existing finding gets meta.preexisting = true", async () => {
    const finding = fakeFinding({
      id: "test-phase.coord-preexist",
      location: { file: "src/a.ts", line: 1 }, // pre-existing line
    });
    const coordOutput = fakeCoordFinding({
      id: "test-phase.coord-preexist",
      location: { file: "src/a.ts", line: 1 },
    });

    const phase = makePhase({
      alphaFindings: [finding],
      coordRunner: passthroughCoordinator([coordOutput]),
    });

    const report = await phase.run(ctxWithDiff());

    const f = report.findings.find((f) => f.id === "test-phase.coord-preexist");
    expect(f).toBeDefined();
    expect(f!.meta).toMatchObject({ preexisting: true });
  });

  it("coordinator-ok path: introduced finding is not stamped", async () => {
    const finding = fakeFinding({
      id: "test-phase.coord-new",
      location: { file: "src/a.ts", line: 2 }, // added line
    });
    const coordOutput = fakeCoordFinding({
      id: "test-phase.coord-new",
      location: { file: "src/a.ts", line: 2 },
    });

    const phase = makePhase({
      alphaFindings: [finding],
      coordRunner: passthroughCoordinator([coordOutput]),
    });

    const report = await phase.run(ctxWithDiff());

    const f = report.findings.find((f) => f.id === "test-phase.coord-new");
    expect(f).toBeDefined();
    expect((f!.meta as Record<string, unknown> | undefined)?.preexisting).toBeUndefined();
  });
});
