/**
 * Tests for the review phase factory + bugs specialist (T13 · M4 · plan steps 2,3).
 *
 * Fake-driven: the bugs specialist is driven by a scripted FakeAgentRunner.
 * Verifies:
 *   - Bugs SpecialistConfig properties (submitSchema, severityCeiling, maxFindings, toolset).
 *   - Verify config: 3 lenses, agreementForHigh = 3, agreementForMedium = 2.
 *   - Review phase identity (id="review", kind="agent").
 *   - Activation: ≥1 file → true (R1); 0 files → false.
 *   - Full run with fakes: findings routed from bugs specialist.
 *   - Phase validates against the PhaseReport schema.
 *
 * TDD refs: D (specialist wiring), A·2 (verify lenses). Plan: M4 steps 2,3.
 */

import { describe, expect, it } from "vite-plus/test";
import { Value } from "@sinclair/typebox/value";
import { FakeAgentRunner } from "../../agent/fake-runner.js";
import type { Finding } from "../../schema/finding.js";
import { SpecialistSubmission } from "../../schema/finding.js";
import { SUBMIT_TOOL_NAME } from "../../agent/submit-tool.js";
import { PhaseReport } from "../../schema/report.js";
import { BUGS_SPECIALIST, MAX_FINDINGS, REVIEW_VERIFY_CONFIG, makeReviewPhase } from "./review.js";

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

function fakeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "review.bug",
    phase: "review",
    specialist: "bugs",
    severity: "error",
    confidence: "high",
    message: "Missing null check before deref",
    ...overrides,
  };
}

function bugsRunner(findings: Finding[]) {
  return new FakeAgentRunner({
    kind: "ok",
    submission: { findings },
    cost: { model: "fake/bugs", inputTokens: 10, outputTokens: 5, durationMs: 1 },
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
    return makeReviewPhase({ bugs: bugsRunner([]) });
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
    return makeReviewPhase({ bugs: bugsRunner([]) });
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
    const finding = fakeFinding({ id: "review.bug", confidence: "high" });
    const phase = makeReviewPhase({
      bugs: bugsRunner([finding]),
      // 3 voters each upholding — one per-voter runner repeated for all candidates
      verify: new FakeAgentRunner({
        kind: "ok",
        submission: { verdict: "uphold", reason: "confirmed" },
        cost: { model: "fake/voter", inputTokens: 3, outputTokens: 2, durationMs: 1 },
      }),
    });

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.phase).toBe("review");
    expect(report.findings.some((f) => f.id === "review.bug")).toBe(true);
  });

  it("finding is phase-tagged as review and specialist-tagged as bugs", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase({
      bugs: bugsRunner([finding]),
      verify: upholdVoter(),
    });

    const report = await phase.run(ctx());

    const f = report.findings.find((f) => f.id === "review.bug");
    expect(f).toBeDefined();
    expect(f!.phase).toBe("review");
    expect(f!.specialist).toBe("bugs");
  });

  it("report validates against PhaseReport schema", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase({
      bugs: bugsRunner([finding]),
      verify: upholdVoter(),
    });

    const report = await phase.run(ctx());

    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  it("empty findings when scope has no files (phase skips activation check via run direct)", async () => {
    // When run is called directly with 0 files, the composite still runs but no findings
    // are produced if no bugs are found (the phase activation guard is at the scheduler level).
    // The composite itself does not re-check activation inside run().
    const phase = makeReviewPhase({
      bugs: bugsRunner([]),
      verify: upholdVoter(),
    });

    const report = await phase.run(ctx([]));

    expect(report.status).toBe("completed");
    expect(report.findings.filter((f) => f.id === "review.bug")).toHaveLength(0);
  });

  it("status is completed and audit.verify is populated when verify runs", async () => {
    const finding = fakeFinding({ id: "review.bug" });
    const phase = makeReviewPhase({
      bugs: bugsRunner([finding]),
      verify: upholdVoter(),
    });

    const report = await phase.run(ctx());

    expect(report.status).toBe("completed");
    expect(report.audit.verify).toBeDefined();
    expect(report.audit.verify!.received).toBe(1);
  });
});
