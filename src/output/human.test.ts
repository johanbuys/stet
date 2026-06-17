/**
 * Tests for the human output renderer.
 *
 * Snapshot-style: assert on rendered text content, not layout or ANSI escapes.
 * Tests are grouped by feature (phase grouping, severity color, location, status,
 * cost footer) per the T25 acceptance criteria.
 */

import { describe, expect, it } from "vite-plus/test";
import { renderHuman } from "./human.js";
import type { RunReport } from "../schema/report.js";
import type { PhaseReport } from "../schema/report.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePhase(overrides: Partial<PhaseReport> = {}): PhaseReport {
  return {
    phase: "stub-det",
    status: "completed",
    findings: [],
    audit: {},
    cost: { durationMs: 100 },
    ...overrides,
  };
}

function makeReport(phases: PhaseReport[] = [makePhase()]): RunReport {
  return {
    version: 1,
    stet: "0.1.0",
    startedAt: "2026-01-01T00:00:00.000Z",
    scope: { kind: "staged", files: ["src/foo.ts"] },
    spec: { provided: false, sources: [] },
    phases,
    result: { exitCode: 0, failOn: "error", gating: [] },
    cost: { totalInputTokens: 100, totalOutputTokens: 50, durationMs: 1500 },
  };
}

// ---------------------------------------------------------------------------
// Phase grouping
// ---------------------------------------------------------------------------

describe("phase grouping", () => {
  it("renders the phase name in the output", () => {
    const report = makeReport([makePhase({ phase: "stub-det" })]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("stub-det");
  });

  it("renders multiple phases each with their name", () => {
    const report = makeReport([
      makePhase({ phase: "stub-det" }),
      makePhase({ phase: "stub-agent" }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("stub-det");
    expect(out).toContain("stub-agent");
  });

  it("renders phase status in the output", () => {
    const report = makeReport([makePhase({ status: "completed" })]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("completed");
  });

  it("phase with no findings shows 'no findings'", () => {
    const report = makeReport([makePhase({ findings: [] })]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("no findings");
  });

  it("phase with findings shows each finding's message", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "stub-det.command-failed",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "command exited with code 1",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("command exited with code 1");
    expect(out).toContain("stub-det.command-failed");
  });

  it("phase header shows the original finding count for a multi-finding phase", () => {
    const report = makeReport([
      makePhase({
        phase: "stub-det",
        status: "completed",
        findings: [
          { id: "f1", phase: "stub-det", severity: "error", confidence: "high", message: "a" },
          { id: "f2", phase: "stub-det", severity: "warning", confidence: "high", message: "b" },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    const header = out.split("\n").find((l) => l.startsWith("── stub-det"));
    expect(header).toContain("(2 findings)");
  });

  it("phase header omits the count for a zero-finding phase", () => {
    const report = makeReport([makePhase({ phase: "stub-det", findings: [] })]);
    const out = renderHuman(report, { color: false });
    const header = out.split("\n").find((l) => l.startsWith("── stub-det"));
    expect(header).not.toContain("finding");
  });

  it("phase header count stays at the original count under --show", () => {
    const report = makeReport([
      makePhase({
        phase: "stub-det",
        findings: [
          { id: "e1", phase: "stub-det", severity: "error", confidence: "high", message: "e" },
          { id: "w1", phase: "stub-det", severity: "warning", confidence: "high", message: "w" },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false, show: "error" });
    const header = out.split("\n").find((l) => l.startsWith("── stub-det"));
    // Original count (2), not the --show-filtered count (1).
    expect(header).toContain("(2 findings)");
  });

  it("multiple findings are each rendered", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "review.bug",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "null pointer",
          },
          {
            id: "review.style",
            phase: "stub-det",
            severity: "warning",
            confidence: "medium",
            message: "inconsistent naming",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("null pointer");
    expect(out).toContain("inconsistent naming");
  });
});

// ---------------------------------------------------------------------------
// file:line location
// ---------------------------------------------------------------------------

describe("file:line location", () => {
  it("finding with file and line shows 'file:line'", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "review.bug",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "null deref",
            location: { file: "src/foo.ts", line: 42 },
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("src/foo.ts:42");
  });

  it("finding with file only (no line) shows file without colon-number", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "review.bug",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "null deref",
            location: { file: "src/bar.ts" },
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("src/bar.ts");
    expect(out).not.toContain("src/bar.ts:");
  });

  it("finding with no location shows no path", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "review.bug",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "general issue",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("general issue");
    expect(out).not.toContain(".ts:");
  });
});

// ---------------------------------------------------------------------------
// Per-phase status lines (skipped/cancelled/error reasons)
// ---------------------------------------------------------------------------

describe("per-phase status lines", () => {
  it("skipped phase shows status and reason", () => {
    const report = makeReport([
      makePhase({ status: "skipped", reason: "no spec context provided" }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("skipped");
    expect(out).toContain("no spec context provided");
  });

  it("cancelled phase shows status and reason", () => {
    const report = makeReport([makePhase({ status: "cancelled", reason: "SIGINT received" })]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("cancelled");
    expect(out).toContain("SIGINT received");
  });

  it("error phase shows status and reason", () => {
    const report = makeReport([makePhase({ status: "error", reason: "agent budget exceeded" })]);
    const out = renderHuman(report, { color: false });
    expect(out).toContain("error");
    expect(out).toContain("agent budget exceeded");
  });

  it("completed phase with no reason shows no reason line", () => {
    const report = makeReport([makePhase({ status: "completed" })]);
    const out = renderHuman(report, { color: false });
    expect(out).not.toContain("reason:");
  });
});

// ---------------------------------------------------------------------------
// Severity color
// ---------------------------------------------------------------------------

describe("severity color", () => {
  it("color=false: no ANSI escape codes in output", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "f1",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "err msg",
          },
          {
            id: "f2",
            phase: "stub-det",
            severity: "warning",
            confidence: "high",
            message: "warn msg",
          },
          {
            id: "f3",
            phase: "stub-det",
            severity: "info",
            confidence: "low",
            message: "info msg",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false });
    expect(out).not.toContain("\x1b[");
  });

  it("color=true: error severity uses red ANSI code", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "f1",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "red msg",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: true });
    expect(out).toContain("\x1b[31m");
    expect(out).toContain("\x1b[0m");
  });

  it("color=true: warning severity uses yellow ANSI code", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "f1",
            phase: "stub-det",
            severity: "warning",
            confidence: "high",
            message: "yellow msg",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: true });
    expect(out).toContain("\x1b[33m");
    expect(out).toContain("\x1b[0m");
  });

  it("color=true: info severity uses dim ANSI code", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "f1",
            phase: "stub-det",
            severity: "info",
            confidence: "low",
            message: "dim msg",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: true });
    expect(out).toContain("\x1b[2m");
    expect(out).toContain("\x1b[0m");
  });

  it("color=true: severity text still present (readable without color support)", () => {
    const report = makeReport([
      makePhase({
        findings: [
          {
            id: "f1",
            phase: "stub-det",
            severity: "error",
            confidence: "high",
            message: "msg",
          },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: true });
    expect(out).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// Cost footer
// ---------------------------------------------------------------------------

describe("cost footer", () => {
  it("renders input and output token counts", () => {
    const report = makeReport();
    const out = renderHuman(report, { color: false });
    expect(out).toContain("100");
    expect(out).toContain("50");
  });

  it("renders duration in seconds", () => {
    const report = makeReport();
    const out = renderHuman(report, { color: false });
    // 1500ms → "1.5s"
    expect(out).toContain("1.5s");
  });

  it("cost footer includes 'in' and 'out' labels", () => {
    const report = makeReport();
    const out = renderHuman(report, { color: false });
    expect(out).toContain("in");
    expect(out).toContain("out");
    expect(out).toContain("tokens");
  });
});

// ---------------------------------------------------------------------------
// Result line
// ---------------------------------------------------------------------------

describe("result line", () => {
  it("exit 0 shows 'ok' label", () => {
    const report = makeReport();
    const out = renderHuman(report, { color: false });
    expect(out).toContain("exit 0");
    expect(out).toContain("ok");
  });

  it("exit 1 shows 'findings gate' label", () => {
    const report = {
      ...makeReport(),
      result: {
        exitCode: 1 as const,
        failOn: "error" as const,
        gating: [{ phase: "stub-det", id: "stub-det.command-failed", message: "failed" }],
      },
    };
    const out = renderHuman(report, { color: false });
    expect(out).toContain("exit 1");
    expect(out).toContain("findings gate");
  });

  it("exit 2 shows 'interrupted' label", () => {
    const report = {
      ...makeReport(),
      result: { exitCode: 2 as const, failOn: "error" as const, gating: [] },
    };
    const out = renderHuman(report, { color: false });
    expect(out).toContain("exit 2");
    expect(out).toContain("interrupted");
  });

  it("fail-on value appears in result line", () => {
    const report = makeReport();
    const out = renderHuman(report, { color: false });
    expect(out).toContain("error");
  });
});

// ---------------------------------------------------------------------------
// --quiet display filter
// ---------------------------------------------------------------------------

describe("--quiet display filter", () => {
  it("passing phase (completed, no findings) is suppressed when quiet=true", () => {
    const report = makeReport([
      makePhase({ phase: "stub-det", status: "completed", findings: [] }),
    ]);
    const out = renderHuman(report, { color: false, quiet: true });
    expect(out).not.toContain("stub-det");
  });

  it("phase with findings is shown even when quiet=true", () => {
    const report = makeReport([
      makePhase({
        phase: "stub-det",
        findings: [
          { id: "f1", phase: "stub-det", severity: "error", confidence: "high", message: "boom" },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false, quiet: true });
    expect(out).toContain("stub-det");
    expect(out).toContain("boom");
  });

  it("skipped phase is shown even when quiet=true (only completed+no-findings is suppressed)", () => {
    const report = makeReport([makePhase({ status: "skipped", reason: "no spec" })]);
    const out = renderHuman(report, { color: false, quiet: true });
    expect(out).toContain("skipped");
  });

  it("quiet=false (default) shows all phases including passing ones", () => {
    const report = makeReport([
      makePhase({ phase: "stub-det", status: "completed", findings: [] }),
    ]);
    const out = renderHuman(report, { color: false, quiet: false });
    expect(out).toContain("stub-det");
    expect(out).toContain("no findings");
  });

  it("result line and cost footer still appear when all phases are suppressed", () => {
    const report = makeReport([makePhase({ status: "completed", findings: [] })]);
    const out = renderHuman(report, { color: false, quiet: true });
    expect(out).toContain("result:");
    expect(out).toContain("cost:");
  });

  it("mixed phases: only passing ones suppressed", () => {
    const report = makeReport([
      makePhase({ phase: "phase-a", status: "completed", findings: [] }),
      makePhase({
        phase: "phase-b",
        findings: [
          { id: "f1", phase: "phase-b", severity: "error", confidence: "high", message: "err" },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false, quiet: true });
    expect(out).not.toContain("phase-a");
    expect(out).toContain("phase-b");
  });
});

// ---------------------------------------------------------------------------
// --show severity display filter
// ---------------------------------------------------------------------------

describe("--show severity display filter", () => {
  function makePhaseWithFindings(): PhaseReport {
    return makePhase({
      phase: "stub-det",
      findings: [
        { id: "e1", phase: "stub-det", severity: "error", confidence: "high", message: "err msg" },
        {
          id: "w1",
          phase: "stub-det",
          severity: "warning",
          confidence: "high",
          message: "warn msg",
        },
        { id: "i1", phase: "stub-det", severity: "info", confidence: "low", message: "info msg" },
      ],
    });
  }

  it("show=error: only error findings shown", () => {
    const report = makeReport([makePhaseWithFindings()]);
    const out = renderHuman(report, { color: false, show: "error" });
    expect(out).toContain("err msg");
    expect(out).not.toContain("warn msg");
    expect(out).not.toContain("info msg");
  });

  it("show=warning: error and warning findings shown, info hidden", () => {
    const report = makeReport([makePhaseWithFindings()]);
    const out = renderHuman(report, { color: false, show: "warning" });
    expect(out).toContain("err msg");
    expect(out).toContain("warn msg");
    expect(out).not.toContain("info msg");
  });

  it("show=info: all findings shown (same as no filter)", () => {
    const report = makeReport([makePhaseWithFindings()]);
    const out = renderHuman(report, { color: false, show: "info" });
    expect(out).toContain("err msg");
    expect(out).toContain("warn msg");
    expect(out).toContain("info msg");
  });

  it("show=error with no matching findings: phase reports hidden count, NOT 'no findings'", () => {
    const report = makeReport([
      makePhase({
        findings: [
          { id: "w1", phase: "stub-det", severity: "warning", confidence: "high", message: "warn" },
        ],
      }),
    ]);
    const out = renderHuman(report, { color: false, show: "error" });
    // A phase that flagged issues must never be reported as clean.
    expect(out).toContain("1 finding hidden by --show error");
    expect(out).not.toContain("no findings");
    expect(out).not.toContain("warn");
  });

  it("genuinely empty phase still shows 'no findings' under --show", () => {
    const report = makeReport([makePhase({ findings: [] })]);
    const out = renderHuman(report, { color: false, show: "error" });
    expect(out).toContain("no findings");
  });

  it("show filter does not affect exit code (result line shows original exit code)", () => {
    const report = {
      ...makeReport([makePhaseWithFindings()]),
      result: {
        exitCode: 1 as const,
        failOn: "error" as const,
        gating: [{ phase: "stub-det", id: "e1", message: "err msg" }],
      },
    };
    const out = renderHuman(report, { color: false, show: "warning" });
    // Exit code unchanged even though we filtered to show warnings only
    expect(out).toContain("exit 1");
    expect(out).toContain("findings gate");
  });
});
