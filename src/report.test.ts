/**
 * Tests for assembleReport.
 *
 * TDD vertical slices — behavior through the public interface.
 */

import { describe, expect, it } from "vite-plus/test";
import type { PhaseReport } from "./schema/report.js";
import { parseRunReport } from "./schema/report.js";
import type { Scope } from "./scope.js";
import { assembleReport, type AssembleInput } from "./report.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeScope: Scope = { kind: "staged", files: ["src/a.ts"] };

function completedPhase(id: string, durationMs = 10): PhaseReport {
  return {
    phase: id,
    status: "completed",
    findings: [],
    audit: {},
    cost: { durationMs },
  };
}

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    stetVersion: "0.0.1",
    startedAt: "2026-06-09T12:00:00.000Z",
    scope: fakeScope,
    phases: [completedPhase("stub-det", 10)],
    failOn: "error",
    durationMs: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assembleReport", () => {
  // ── Slice 1: produces a valid RunReport (parseRunReport Ok) ──────────────

  it("produces a report that passes parseRunReport", () => {
    const { report } = assembleReport(baseInput());
    const parsed = parseRunReport(report);
    expect(parsed.isOk()).toBe(true);
  });

  // ── Slice 2: version is always 1 ────────────────────────────────────────

  it("version is 1", () => {
    const { report } = assembleReport(baseInput());
    expect(report.version).toBe(1);
  });

  // ── Slice 3: stet version and startedAt are passed through ───────────────

  it("stet and startedAt come from input", () => {
    const { report } = assembleReport(
      baseInput({ stetVersion: "1.2.3", startedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(report.stet).toBe("1.2.3");
    expect(report.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  // ── Slice 4: scope is passed through ────────────────────────────────────

  it("scope comes from input", () => {
    const { report } = assembleReport(baseInput());
    expect(report.scope.kind).toBe("staged");
    expect(report.scope.files).toEqual(["src/a.ts"]);
  });

  // ── Slice 4b: scope is deep-equal to input, including stripped (M8 field) ─
  //
  // The previous re-projection spread in assembleReport silently dropped the
  // `stripped` array (finding F10). assembleReport now passes scope straight through.

  it("report.scope deep-equals the input scope including stripped", () => {
    const scopeWithStripped: Scope = {
      kind: "staged",
      files: ["src/a.ts"],
      stripped: ["src/generated.ts", "src/vendor.ts"],
    };
    const { report } = assembleReport(baseInput({ scope: scopeWithStripped }));
    expect(report.scope).toEqual(scopeWithStripped);
    expect(report.scope.stripped).toEqual(["src/generated.ts", "src/vendor.ts"]);
  });

  // ── Slice 5: spec is M8 placeholder ─────────────────────────────────────

  it("spec is provided:false with empty sources (M8 placeholder)", () => {
    const { report } = assembleReport(baseInput());
    expect(report.spec).toEqual({ provided: false, sources: [] });
  });

  // ── Slice 6: phases array is passed through ──────────────────────────────

  it("phases are passed through unchanged", () => {
    const phases = [completedPhase("stub-det", 20)];
    const { report } = assembleReport(baseInput({ phases }));
    expect(report.phases).toHaveLength(1);
    expect(report.phases[0]?.phase).toBe("stub-det");
  });

  // ── Slice 7: exit 0 when no gating findings ──────────────────────────────

  it("exitCode 0 when no gating findings", () => {
    const { report, exitCode } = assembleReport(baseInput());
    expect(exitCode).toBe(0);
    expect(report.result.exitCode).toBe(0);
    expect(report.result.gating).toEqual([]);
  });

  // ── Slice 8: exit 1 when a gating finding exists ─────────────────────────

  it("exitCode 1 when an error+high finding exists", () => {
    const phases: PhaseReport[] = [
      {
        phase: "stub-det",
        status: "completed",
        findings: [
          {
            id: "stub-det.command-failed",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "command failed",
          },
        ],
        audit: {},
        cost: { durationMs: 10 },
      },
    ];
    const { report, exitCode } = assembleReport(baseInput({ phases }));
    expect(exitCode).toBe(1);
    expect(report.result.exitCode).toBe(1);
    expect(report.result.gating).toHaveLength(1);
    expect(report.result.gating[0]?.id).toBe("stub-det.command-failed");
  });

  // ── Slice 9: failOn is echoed in result ──────────────────────────────────

  it("result.failOn reflects the input failOn", () => {
    const { report } = assembleReport(baseInput({ failOn: "warning" }));
    expect(report.result.failOn).toBe("warning");
  });

  // ── Slice 10: cost totals — wall-clock durationMs, tokens summed ─────────
  //
  // PRD §4.10 worked example: phase durations sum to 76,122ms but total is 66,120ms
  // because the scheduler runs phases concurrently. The caller measures wall-clock time
  // and passes it via AssembleInput.durationMs; sumCost sums TOKENS only.

  it("cost.durationMs equals the passed-in wall-clock value, not the sum of phase durations", () => {
    const phases: PhaseReport[] = [
      {
        phase: "a",
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 100, inputTokens: 50, outputTokens: 20 },
      },
      {
        phase: "b",
        status: "skipped",
        reason: "activation: predicate",
        findings: [],
        audit: {},
        cost: { durationMs: 0 },
      },
      {
        phase: "c",
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 200, inputTokens: 30, outputTokens: 10 },
      },
    ];
    // Wall-clock is 180ms (concurrency means it's less than the 300ms sum)
    const wallClock = 180;
    const { report } = assembleReport(baseInput({ phases, durationMs: wallClock }));
    // Total durationMs must be the wall-clock value, not 300 (sum of phase durations)
    expect(report.cost.durationMs).toBe(wallClock);
    expect(report.cost.durationMs).not.toBe(300);
  });

  it("token totals are still summed over all phases", () => {
    const phases: PhaseReport[] = [
      {
        phase: "a",
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 100, inputTokens: 50, outputTokens: 20 },
      },
      {
        phase: "b",
        status: "skipped",
        reason: "activation: predicate",
        findings: [],
        audit: {},
        cost: { durationMs: 0 },
      },
      {
        phase: "c",
        status: "completed",
        findings: [],
        audit: {},
        cost: { durationMs: 200, inputTokens: 30, outputTokens: 10 },
      },
    ];
    const { report } = assembleReport(baseInput({ phases, durationMs: 180 }));
    expect(report.cost.totalInputTokens).toBe(80);
    expect(report.cost.totalOutputTokens).toBe(30);
  });

  // ── Slice 11: --fail-on warning gates warning+high findings ──────────────

  it("failOn:warning causes warning+high finding to gate", () => {
    const phases: PhaseReport[] = [
      {
        phase: "stub-det",
        status: "completed",
        findings: [
          {
            id: "stub-det.something",
            phase: "stub-det",
            severity: "warning",
            confidence: "high",
            message: "a warning",
          },
        ],
        audit: {},
        cost: { durationMs: 5 },
      },
    ];
    const { exitCode: exitError } = assembleReport(baseInput({ phases, failOn: "error" }));
    expect(exitError).toBe(0); // warning below "error" threshold

    const { exitCode: exitWarning } = assembleReport(baseInput({ phases, failOn: "warning" }));
    expect(exitWarning).toBe(1);
  });
});
