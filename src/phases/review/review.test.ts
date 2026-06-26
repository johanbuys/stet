/**
 * Tests for the review phase factory + full specialist panel (T13/T14 · M4, T15 · M5).
 *
 * Fake-driven: each specialist is driven by a scripted FakeAgentRunner.
 * Verifies:
 *   - All four SpecialistConfig properties (submitSchema, severityCeiling, maxFindings, toolset).
 *   - Shared preamble present in all specialist rubrics (convention rule, DO-NOT-FLAG blocklist).
 *   - Verify config: 3 lenses, agreementForHigh = 3, agreementForMedium = 2.
 *   - Review phase identity (id="review", kind="agent").
 *   - Activation: ≥1 file → true (R1); 0 files → false.
 *   - Full panel fan-out: all 4 specialists run; findings from each are included.
 *   - Phase validates against the PhaseReport schema.
 *   - Creds gate (AC#8): model=undefined → status "error", never completed+empty.
 *
 * TDD refs: D (specialist wiring), A·2 (verify lenses). Plan: M4 steps 2,3,5; M5 step.
 */

import { describe, expect, it } from "vite-plus/test";
import { Value } from "@sinclair/typebox/value";
import { FakeAgentRunner } from "../../agent/fake-runner.js";
import type { SpecialistSubmission as SpecialistSubmissionType } from "../../schema/finding.js";
import { SpecialistSubmission } from "../../schema/finding.js";
import { SUBMIT_TOOL_NAME } from "../../agent/submit-tool.js";
import { PhaseReport } from "../../schema/report.js";
import {
  BUGS_SPECIALIST,
  COVERAGE_SPECIALIST,
  MAX_FINDINGS,
  QUALITY_SPECIALIST,
  REVIEW_VERIFY_CONFIG,
  SECURITY_SPECIALIST,
  makeReviewPhase,
} from "./review.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(files: string[] = ["src/a.ts"]) {
  return {
    cwd: "/tmp/review-test",
    scope: { kind: "staged" as const, files },
    config: {},
    diff: "diff --git a/src/a.ts b/src/a.ts\n+new line\n",
  };
}

// Specialists submit SpecialistSubmission shape: no phase/specialist/confidence —
// those three are harness-stamped by the composite roll-up. Matching that shape here
// is what lets the fake submission survive ingestion (it is validated against
// SpecialistSubmission, not full Finding).
function fakeFinding(overrides: Partial<SpecialistSubmissionType> = {}): SpecialistSubmissionType {
  return {
    id: "review.bug",
    severity: "error",
    message: "Missing null check before deref",
    ...overrides,
  };
}

function bugsRunner(findings: SpecialistSubmissionType[]) {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model: "fake/bugs", inputTokens: 10, outputTokens: 5, durationMs: 1 },
  });
}

/** Runner that returns empty findings — used for non-bugs specialists in single-specialist tests. */
function emptyRunner(name = "fake/specialist") {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings: [] },
    cost: { model: name, inputTokens: 5, outputTokens: 2, durationMs: 1 },
  });
}

/** Voter runner that always upholds — used to let verify pass findings through. */
function upholdVoter() {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { verdict: "uphold", reason: "confirmed" },
    cost: { model: "fake/voter", inputTokens: 3, outputTokens: 2, durationMs: 1 },
  });
}

/**
 * Build a full runners map for all 4 specialists + verify.
 * bugsFindings allows seeding specific findings in the bugs specialist for full-run tests.
 */
function panelRunners(
  bugsFindings: SpecialistSubmissionType[] = [],
  opts: {
    securityFindings?: SpecialistSubmissionType[];
    qualityFindings?: SpecialistSubmissionType[];
    coverageFindings?: SpecialistSubmissionType[];
    voter?: ReturnType<typeof upholdVoter>;
  } = {},
) {
  return {
    bugs: bugsRunner(bugsFindings),
    security: opts.securityFindings
      ? bugsRunner(opts.securityFindings)
      : emptyRunner("fake/security"),
    quality: opts.qualityFindings ? bugsRunner(opts.qualityFindings) : emptyRunner("fake/quality"),
    "coverage-gaps": opts.coverageFindings
      ? bugsRunner(opts.coverageFindings)
      : emptyRunner("fake/coverage-gaps"),
    verify: opts.voter ?? upholdVoter(),
  };
}

// ---------------------------------------------------------------------------
// Bugs SpecialistConfig properties (plan M4 step 2 · TDD D)
// ---------------------------------------------------------------------------

describe("BUGS_SPECIALIST config", () => {
  it('name is "bugs"', () => {
    expect(BUGS_SPECIALIST.name).toBe("bugs");
  });

  it("submitSchema is SpecialistSubmission (TDD B·1 — no confidence field)", () => {
    expect(BUGS_SPECIALIST.submitSchema).toBe(SpecialistSubmission);
  });

  it('severityCeiling is "error" (TDD D — bugs may emit up to error)', () => {
    expect(BUGS_SPECIALIST.severityCeiling).toBe("error");
  });

  it(`maxFindings is ${MAX_FINDINGS} (R8)`, () => {
    expect(BUGS_SPECIALIST.maxFindings).toBe(MAX_FINDINGS);
    expect(MAX_FINDINGS).toBe(5);
  });

  it("toolset includes submit_findings and read-only inspection tools", () => {
    const { toolset } = BUGS_SPECIALIST;
    expect(toolset).toContain(SUBMIT_TOOL_NAME);
    expect(toolset).toContain("read");
    expect(toolset).toContain("grep");
    expect(toolset).toContain("find");
    expect(toolset).toContain("ls");
    expect(toolset).toContain("bash");
  });

  it("rubric references the {MAX_FINDINGS} value", () => {
    expect(BUGS_SPECIALIST.rubric).toContain(String(MAX_FINDINGS));
  });

  it("rubric covers correctness focus", () => {
    expect(BUGS_SPECIALIST.rubric.toLowerCase()).toContain("correctness");
  });
});

// ---------------------------------------------------------------------------
// Verify config (plan M4 step 2 · TDD A·2 / PRD R5)
// ---------------------------------------------------------------------------

describe("REVIEW_VERIFY_CONFIG", () => {
  it("has 3 voters", () => {
    expect(REVIEW_VERIFY_CONFIG.voters).toBe(3);
  });

  it("has exactly 3 lenses", () => {
    expect(REVIEW_VERIFY_CONFIG.lenses).toHaveLength(3);
  });

  it("agreementForHigh is 3 (all voters must uphold for high confidence, PRD C1 / R5)", () => {
    expect(REVIEW_VERIFY_CONFIG.agreementForHigh).toBe(3);
  });

  it("agreementForMedium is 2 (PRD C1)", () => {
    expect(REVIEW_VERIFY_CONFIG.agreementForMedium).toBe(2);
  });

  it("lenses cover reproduction/soundness, partial-context, and scope/blocklist", () => {
    const lenses = REVIEW_VERIFY_CONFIG.lenses;
    expect(lenses[0]).toMatch(/[Rr]eproduction|soundness/);
    expect(lenses[1]).toMatch(/[Pp]artial.context|skepticism/i);
    expect(lenses[2]).toMatch(/[Ss]cope|blocklist/i);
  });
});

// ---------------------------------------------------------------------------
// Review phase identity
// ---------------------------------------------------------------------------

describe("makeReviewPhase — identity", () => {
  function makePhase() {
    return makeReviewPhase({ bugs: bugsRunner([]) }, "fake/model");
  }

  it('id is "review"', () => {
    expect(makePhase().id).toBe("review");
  });

  it('kind is "agent"', () => {
    expect(makePhase().kind).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// Activation (PRD R1 — ≥1 reviewable file)
// ---------------------------------------------------------------------------

describe("makeReviewPhase — activation (R1)", () => {
  function makePhase() {
    return makeReviewPhase({ bugs: bugsRunner([]) }, "fake/model");
  }

  it("returns true when scope has ≥1 file", () => {
    const phase = makePhase();
    expect(phase.activation({ scope: { kind: "staged", files: ["src/a.ts"] } })).toBe(true);
  });

  it("returns true when scope has multiple files", () => {
    const phase = makePhase();
    expect(phase.activation({ scope: { kind: "staged", files: ["src/a.ts", "src/b.ts"] } })).toBe(
      true,
    );
  });

  it("returns false when scope has 0 files", () => {
    const phase = makePhase();
    expect(phase.activation({ scope: { kind: "staged", files: [] } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full run with fakes (unit — verify + bugs fake)
// ---------------------------------------------------------------------------

describe("makeReviewPhase — full run with fakes", () => {
  it("completes and includes bugs specialist findings when all voters uphold", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase(panelRunners([finding]), "fake/model");

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.phase).toBe("review");
    expect(report.findings.some((f) => f.id === "review.bug")).toBe(true);
  });

  it("finding is phase-tagged as review and specialist-tagged as bugs", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase(panelRunners([finding]), "fake/model");

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "review.bug");
    expect(f).toBeDefined();
    expect(f!.phase).toBe("review");
    expect(f!.specialist).toBe("bugs");
  });

  it("report validates against PhaseReport schema", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase(panelRunners([finding]), "fake/model");

    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("empty findings when scope has no files (phase skips activation check via run direct)", async () => {
    // When run is called directly with 0 files, the composite still runs but no findings
    // are produced if no bugs are found (the phase activation guard is at the scheduler level).
    // The composite itself does not re-check activation inside run().
    const phase = makeReviewPhase(panelRunners([]), "fake/model");

    const report = await phase.run(ctx([]));

    expect(report.status).toBe("completed");
    expect(report.findings.filter((f) => f.id === "review.bug")).toHaveLength(0);
  });

  it("status is completed and audit.verify is populated when verify runs", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase(panelRunners([finding]), "fake/model");

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.audit.verify).toBeDefined();
    expect(report.audit.verify!.received).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Creds gate — model=undefined → error, never completed+empty (AC#8)
// ---------------------------------------------------------------------------

describe("makeReviewPhase — creds gate (T14 · AC#8 / plan M4 step 5 F3)", () => {
  it("returns status:error when model is undefined", async () => {
    const phase = makeReviewPhase({}, undefined);
    const report = await phase.run(ctx());
    expect(report.status).toBe("error");
  });

  it("returns status:error when model is an empty string (AC#8 — empty PI_TEST_MODEL)", async () => {
    // A falsy-but-defined model (e.g. `PI_TEST_MODEL=` or CI expanding an unset var) must
    // fire the gate too — otherwise it reaches the specialist runner, fails with ModelError,
    // and the composite rolls it up as the forbidden completed+empty state.
    const phase = makeReviewPhase({}, "");
    const report = await phase.run(ctx());
    expect(report.status).toBe("error");
    expect(report.findings).toHaveLength(0);
  });

  it("reason mentions 'no model available' when model is undefined", async () => {
    const phase = makeReviewPhase({}, undefined);
    const report = await phase.run(ctx());
    expect(report.reason).toMatch(/no model available/);
  });

  it("findings is empty on the error phase (not completed+empty — AC#8)", async () => {
    const phase = makeReviewPhase({}, undefined);
    const report = await phase.run(ctx());
    // completed+empty is the AC#8 forbidden state; error with [] is the correct state.
    expect(report.status).not.toBe("completed");
    expect(report.findings).toHaveLength(0);
  });

  it("phase id is 'review' on the error phase", async () => {
    const phase = makeReviewPhase({}, undefined).id;
    expect(phase).toBe("review");
  });

  it("kind is 'agent' on the error phase", () => {
    expect(makeReviewPhase({}, undefined).kind).toBe("agent");
  });

  it("activation still uses reviewActivation on the error phase", () => {
    const phase = makeReviewPhase({}, undefined);
    expect(phase.activation({ scope: { kind: "staged", files: ["src/a.ts"] } })).toBe(true);
    expect(phase.activation({ scope: { kind: "staged", files: [] } })).toBe(false);
  });

  it("error phase report validates against PhaseReport schema", async () => {
    const phase = makeReviewPhase({}, undefined);
    const report = await phase.run(ctx());
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shared preamble (M5 · T15 · PRD R7/R8/AC#11)
// ---------------------------------------------------------------------------

describe("shared preamble (all specialist rubrics)", () => {
  const specialists = [
    BUGS_SPECIALIST,
    SECURITY_SPECIALIST,
    QUALITY_SPECIALIST,
    COVERAGE_SPECIALIST,
  ];

  it("every specialist rubric contains the concrete-scenario evidence bar", () => {
    for (const s of specialists) {
      expect(s.rubric).toContain("CONCRETE failure scenario");
    }
  });

  it("every specialist rubric contains the DO-NOT-FLAG blocklist", () => {
    for (const s of specialists) {
      expect(s.rubric).toContain("DO NOT FLAG");
    }
  });

  it("every specialist rubric contains partial-context anti-hallucination instruction", () => {
    for (const s of specialists) {
      expect(s.rubric).toMatch(/PARTIAL.CONTEXT/i);
    }
  });

  it("every specialist rubric contains the convention / CLAUDE.md rule (AC#11)", () => {
    for (const s of specialists) {
      expect(s.rubric).toMatch(/CLAUDE\.md|convention/i);
      // "quote the ... exact rule ... exact line" (may span a line break in rubric text)
      expect(s.rubric).toMatch(/quote the\s+exact rule/);
      expect(s.rubric).toMatch(/exact line/);
    }
  });

  it("every specialist rubric contains the abstention / empty-list instruction", () => {
    for (const s of specialists) {
      expect(s.rubric).toContain("EMPTY list is a valid");
    }
  });

  it("every specialist rubric contains the MAX_FINDINGS cap", () => {
    for (const s of specialists) {
      expect(s.rubric).toContain(String(MAX_FINDINGS));
    }
  });
});

// ---------------------------------------------------------------------------
// SECURITY_SPECIALIST config (M5 · T15 · TDD D)
// ---------------------------------------------------------------------------

describe("SECURITY_SPECIALIST config", () => {
  it('name is "security"', () => {
    expect(SECURITY_SPECIALIST.name).toBe("security");
  });

  it("submitSchema is SpecialistSubmission (TDD B·1 — no confidence field)", () => {
    expect(SECURITY_SPECIALIST.submitSchema).toBe(SpecialistSubmission);
  });

  it('severityCeiling is "error" (security may gate — PRD §R3, TDD D)', () => {
    expect(SECURITY_SPECIALIST.severityCeiling).toBe("error");
  });

  it(`maxFindings is ${MAX_FINDINGS} (R8)`, () => {
    expect(SECURITY_SPECIALIST.maxFindings).toBe(MAX_FINDINGS);
  });

  it("toolset includes bash (security needs path-tracing)", () => {
    expect(SECURITY_SPECIALIST.toolset).toContain("bash");
  });

  it("toolset includes read-only inspection tools and submit", () => {
    const { toolset } = SECURITY_SPECIALIST;
    expect(toolset).toContain(SUBMIT_TOOL_NAME);
    expect(toolset).toContain("read");
    expect(toolset).toContain("grep");
    expect(toolset).toContain("find");
    expect(toolset).toContain("ls");
  });

  it("rubric covers security focus (injection / exploit path)", () => {
    expect(SECURITY_SPECIALIST.rubric.toLowerCase()).toContain("inject");
    expect(SECURITY_SPECIALIST.rubric.toLowerCase()).toContain("exploit");
  });

  it("rubric references MAX_FINDINGS cap", () => {
    expect(SECURITY_SPECIALIST.rubric).toContain(String(MAX_FINDINGS));
  });
});

// ---------------------------------------------------------------------------
// QUALITY_SPECIALIST config (M5 · T15 · TDD D)
// ---------------------------------------------------------------------------

describe("QUALITY_SPECIALIST config", () => {
  it('name is "quality"', () => {
    expect(QUALITY_SPECIALIST.name).toBe("quality");
  });

  it("submitSchema is SpecialistSubmission (TDD B·1)", () => {
    expect(QUALITY_SPECIALIST.submitSchema).toBe(SpecialistSubmission);
  });

  it('severityCeiling is "warning" (quality never gates on error — PRD §R3, TDD D)', () => {
    expect(QUALITY_SPECIALIST.severityCeiling).toBe("warning");
  });

  it(`maxFindings is ${MAX_FINDINGS} (R8)`, () => {
    expect(QUALITY_SPECIALIST.maxFindings).toBe(MAX_FINDINGS);
  });

  it("toolset does NOT include bash (read-only set — TDD D)", () => {
    expect(QUALITY_SPECIALIST.toolset).not.toContain("bash");
  });

  it("toolset includes read-only inspection tools and submit", () => {
    const { toolset } = QUALITY_SPECIALIST;
    expect(toolset).toContain(SUBMIT_TOOL_NAME);
    expect(toolset).toContain("read");
    expect(toolset).toContain("grep");
    expect(toolset).toContain("find");
    expect(toolset).toContain("ls");
  });

  it("rubric says specialist NEVER emits error (enforces ceiling via rubric text)", () => {
    expect(QUALITY_SPECIALIST.rubric).toMatch(/NEVER emits error/i);
  });

  it("rubric covers maintainability / duplication focus", () => {
    const rubric = QUALITY_SPECIALIST.rubric.toLowerCase();
    expect(rubric).toMatch(/maintainab|duplicat|re-implement/);
  });

  it("rubric references MAX_FINDINGS cap", () => {
    expect(QUALITY_SPECIALIST.rubric).toContain(String(MAX_FINDINGS));
  });
});

// ---------------------------------------------------------------------------
// COVERAGE_SPECIALIST config (M5 · T15 · TDD D)
// ---------------------------------------------------------------------------

describe("COVERAGE_SPECIALIST config", () => {
  it('name is "coverage-gaps"', () => {
    expect(COVERAGE_SPECIALIST.name).toBe("coverage-gaps");
  });

  it("submitSchema is SpecialistSubmission (TDD B·1)", () => {
    expect(COVERAGE_SPECIALIST.submitSchema).toBe(SpecialistSubmission);
  });

  it('severityCeiling is "warning" (missing tests never gate on error — PRD §R3, TDD D)', () => {
    expect(COVERAGE_SPECIALIST.severityCeiling).toBe("warning");
  });

  it(`maxFindings is ${MAX_FINDINGS} (R8)`, () => {
    expect(COVERAGE_SPECIALIST.maxFindings).toBe(MAX_FINDINGS);
  });

  it("toolset does NOT include bash (read-only set — TDD D)", () => {
    expect(COVERAGE_SPECIALIST.toolset).not.toContain("bash");
  });

  it("toolset includes read-only inspection tools and submit", () => {
    const { toolset } = COVERAGE_SPECIALIST;
    expect(toolset).toContain(SUBMIT_TOOL_NAME);
    expect(toolset).toContain("read");
    expect(toolset).toContain("grep");
    expect(toolset).toContain("find");
    expect(toolset).toContain("ls");
  });

  it("rubric says specialist NEVER emits error (enforces ceiling via rubric text)", () => {
    expect(COVERAGE_SPECIALIST.rubric).toMatch(/NEVER emits error/i);
  });

  it("rubric covers untested branches / gaps focus", () => {
    const rubric = COVERAGE_SPECIALIST.rubric.toLowerCase();
    expect(rubric).toMatch(/coverage|gap|untested|branch/);
  });

  it("rubric references MAX_FINDINGS cap", () => {
    expect(COVERAGE_SPECIALIST.rubric).toContain(String(MAX_FINDINGS));
  });
});

// ---------------------------------------------------------------------------
// Full panel fan-out — all 4 specialists (M5 · T15 · PRD R3)
// ---------------------------------------------------------------------------

describe("makeReviewPhase — full panel fan-out (M5 · T15)", () => {
  it("includes findings from the security specialist", async () => {
    const secFinding = fakeFinding({ id: "review.security.sqli", severity: "error" });
    const phase = makeReviewPhase(
      panelRunners([], { securityFindings: [secFinding] }),
      "fake/model",
    );

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.findings.some((f) => f.id === "review.security.sqli")).toBe(true);
    const f = report.findings.find((f) => f.id === "review.security.sqli");
    expect(f!.specialist).toBe("security");
  });

  it("includes findings from the quality specialist", async () => {
    const qFinding = fakeFinding({ id: "review.quality.dup", severity: "warning" });
    const phase = makeReviewPhase(panelRunners([], { qualityFindings: [qFinding] }), "fake/model");

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    const f = report.findings.find((f) => f.id === "review.quality.dup");
    expect(f).toBeDefined();
    expect(f!.specialist).toBe("quality");
  });

  it("includes findings from the coverage-gaps specialist", async () => {
    const covFinding = fakeFinding({ id: "review.coverage-gap.missing-edge", severity: "warning" });
    const phase = makeReviewPhase(
      panelRunners([], { coverageFindings: [covFinding] }),
      "fake/model",
    );

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    const f = report.findings.find((f) => f.id === "review.coverage-gap.missing-edge");
    expect(f).toBeDefined();
    expect(f!.specialist).toBe("coverage-gaps");
  });

  it("fans out all 4 specialists simultaneously — findings from all appear in one report", async () => {
    const bugF = fakeFinding({ id: "review.bug.null", severity: "error" });
    const secF = fakeFinding({ id: "review.security.path", severity: "error" });
    const qualF = fakeFinding({ id: "review.quality.copy", severity: "warning" });
    const covF = fakeFinding({ id: "review.coverage-gap.err-path", severity: "warning" });

    const phase = makeReviewPhase(
      panelRunners([bugF], {
        securityFindings: [secF],
        qualityFindings: [qualF],
        coverageFindings: [covF],
      }),
      "fake/model",
    );

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain("review.bug.null");
    expect(ids).toContain("review.security.path");
    expect(ids).toContain("review.quality.copy");
    expect(ids).toContain("review.coverage-gap.err-path");
  });

  it("full-panel report validates against PhaseReport schema", async () => {
    const bugF = fakeFinding({ id: "review.bug.x", severity: "error" });
    const secF = fakeFinding({ id: "review.security.y", severity: "warning" });

    const phase = makeReviewPhase(panelRunners([bugF], { securityFindings: [secF] }), "fake/model");

    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});
