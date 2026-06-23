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
import type { Finding } from "../schema/finding.js";
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

function fakeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "composite-test.finding",
    phase: "test-phase",
    severity: "error",
    confidence: "high",
    message: "test finding",
    ...overrides,
  };
}

function okRunner(findings: Finding[]) {
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
  alphaFindings: Finding[];
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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "medium" });
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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "high" });
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
    const good = fakeFinding({ id: "test-phase.good", confidence: "high" });
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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "medium" });
    // Coordinator passes it through (keeping whatever it receives)
    const coordOutput = fakeFinding({ id: "test-phase.bug", confidence: "medium" });

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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "medium" });
    const lowered = fakeFinding({ id: "test-phase.bug", confidence: "low" });

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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "high" });
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
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "high" });
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
// No verify configured — existing behavior unchanged
// ---------------------------------------------------------------------------

describe("verify wiring — no verify configured", () => {
  it("audit.verify is absent when cfg.verify is not set", async () => {
    const phase = makePhase({ alphaFindings: [fakeFinding()] });
    const report = await phase.run(ctx());
    expect(report.audit.verify).toBeUndefined();
  });

  it("findings are returned unchanged when no verify configured", async () => {
    const finding = fakeFinding({ id: "test-phase.bug", confidence: "medium" });
    const phase = makePhase({ alphaFindings: [finding] });
    const report = await phase.run(ctx());
    expect(report.findings.find((f) => f.id === "test-phase.bug")?.confidence).toBe("medium");
  });
});
