import { describe, expect, it } from "vite-plus/test";

import { parseRunReport, type RunReport } from "./report.js";

// ---------------------------------------------------------------------------
// Shared fixture: a valid RunReport adapted from PRD §4.10 Example A.
// Includes: stet, startedAt, a finding with location+evidence, a skipped
// phase with reason, scope.stripped, and a phase with specialists in cost.
// ---------------------------------------------------------------------------
const validReport: RunReport = {
  version: 1,
  stet: "1.0.3",
  startedAt: "2026-06-07T18:02:11Z",
  scope: {
    kind: "staged",
    files: ["src/export.ts", "src/cli.ts"],
    stripped: ["pnpm-lock.yaml"],
  },
  spec: { provided: false, sources: [] },
  phases: [
    {
      phase: "gates",
      status: "completed",
      findings: [
        {
          id: "gates.no-linter-configured",
          phase: "gates",
          severity: "warning",
          confidence: "high",
          message: "No lint gate detected.",
          evidence: {
            command: "vp lint",
            output: "exit 0 · no lint config found",
          },
          location: { file: "stet.config.yml", line: 1, endLine: 5 },
          suggestion: "Run `stet init` to configure gates.",
        },
      ],
      audit: {
        checks: [
          {
            name: "tests",
            type: "test_command",
            command: "vp test",
            status: "passed",
            evidence: "exit 0 · 142 passed",
          },
        ],
      },
      cost: { durationMs: 11240 },
    },
    {
      phase: "spec",
      status: "skipped",
      reason: "no spec context provided (--prd/--task/--issue)",
      findings: [],
      audit: {},
      cost: { durationMs: 0 },
    },
    {
      phase: "review",
      status: "completed",
      findings: [],
      audit: { examined: ["src/export.ts", "src/cli.ts"] },
      cost: {
        model: "anthropic/claude-sonnet-4-6",
        inputTokens: 48211,
        outputTokens: 2933,
        durationMs: 64880,
        specialists: {
          bugs: { inputTokens: 16114, outputTokens: 1102, durationMs: 61240 },
          security: { inputTokens: 15876, outputTokens: 844, durationMs: 49530 },
        },
      },
    },
    {
      phase: "behavioral",
      status: "skipped",
      reason: "runnable surfaces changed but no spec provided",
      findings: [
        {
          id: "behavioral.not-run",
          phase: "behavioral",
          severity: "warning",
          confidence: "high",
          message: "Behavioral verification did not run.",
        },
      ],
      audit: {},
      cost: { durationMs: 2 },
    },
  ],
  result: { exitCode: 0, failOn: "error", gating: [] },
  cost: { totalInputTokens: 48211, totalOutputTokens: 2933, durationMs: 66120 },
};

describe("parseRunReport — valid inputs", () => {
  it("round-trips a complete valid RunReport as Ok", () => {
    const result = parseRunReport(validReport);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.version).toBe(1);
      expect(result.value.stet).toBe("1.0.3");
      expect(result.value.startedAt).toBe("2026-06-07T18:02:11Z");
      expect(result.value.scope.stripped).toEqual(["pnpm-lock.yaml"]);
    }
  });

  it("accepts a report where the phase id is 'stub-det' (decision #28 — open PhaseId)", () => {
    const stubReport: RunReport = {
      ...validReport,
      phases: [
        {
          phase: "stub-det",
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 5 },
        },
      ],
    };
    const result = parseRunReport(stubReport);
    expect(result.isOk()).toBe(true);
  });

  it("accepts a report with coordinator cost fields on a phase", () => {
    const withCoordinator: RunReport = {
      ...validReport,
      phases: [
        {
          phase: "review",
          status: "completed",
          findings: [],
          audit: {
            coordinator: {
              received: 5,
              dropped: [{ id: "review.nitpick", specialist: "quality", message: "nit" }],
              reinstated: [{ id: "review.bug", specialist: "bugs" }],
            },
          },
          cost: {
            durationMs: 70000,
            coordinator: {
              model: "anthropic/claude-opus-4-8",
              inputTokens: 4000,
              outputTokens: 200,
              durationMs: 5000,
            },
          },
        },
      ],
    };
    const result = parseRunReport(withCoordinator);
    expect(result.isOk()).toBe(true);
  });

  it("accepts findings with meta carrying arbitrary extra fields (open object)", () => {
    const withMeta: RunReport = {
      ...validReport,
      phases: [
        {
          phase: "behavioral",
          status: "completed",
          findings: [
            {
              id: "behavioral.claim-failed",
              phase: "behavioral",
              severity: "error",
              confidence: "high",
              message: "Claim failed.",
              meta: { priority: "critical", extras: [1, 2, 3] },
            },
          ],
          audit: {},
          cost: { durationMs: 1000 },
        },
      ],
    };
    const result = parseRunReport(withMeta);
    expect(result.isOk()).toBe(true);
  });
});

describe("parseRunReport — invalid inputs yield SchemaError", () => {
  it("rejects a non-object input", () => {
    const result = parseRunReport("not an object");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });

  it("rejects when version is missing", () => {
    const { version: _v, ...noVersion } = validReport;
    const result = parseRunReport(noVersion);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
      expect(result.error.message).toMatch(/version/i);
    }
  });

  it("rejects when version is 2 (wrong literal)", () => {
    const result = parseRunReport({ ...validReport, version: 2 });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
      expect(result.error.message).toMatch(/version/i);
    }
  });

  it("rejects when severity is an invalid value", () => {
    const badSeverity = {
      ...validReport,
      phases: [
        {
          ...validReport.phases[0],
          findings: [
            {
              id: "gates.x",
              phase: "gates",
              severity: "critical", // invalid
              confidence: "high",
              message: "Bad severity.",
            },
          ],
        },
      ],
    };
    const result = parseRunReport(badSeverity);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });

  it("rejects when phases is not an array", () => {
    const result = parseRunReport({ ...validReport, phases: "not-an-array" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
      expect(result.error.message).toMatch(/phases/i);
    }
  });

  it("rejects an unknown extra top-level property on RunReport", () => {
    const result = parseRunReport({ ...validReport, unknownTopLevel: "oops" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });

  it("rejects null input", () => {
    const result = parseRunReport(null);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });
});

describe("PhaseId pattern — accepted and rejected values (via RunReport phases)", () => {
  function reportWithPhaseId(phase: string) {
    return parseRunReport({
      ...validReport,
      phases: [
        {
          phase,
          status: "completed",
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        },
      ],
    });
  }

  it("accepts 'gates'", () => {
    expect(reportWithPhaseId("gates").isOk()).toBe(true);
  });

  it("accepts 'stub-det'", () => {
    expect(reportWithPhaseId("stub-det").isOk()).toBe(true);
  });

  it("rejects 'Gates' (uppercase)", () => {
    const result = reportWithPhaseId("Gates");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });

  it("rejects '3gates' (leading digit)", () => {
    const result = reportWithPhaseId("3gates");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });

  it("rejects 'gates_x' (underscore)", () => {
    const result = reportWithPhaseId("gates_x");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("SchemaError");
    }
  });
});
