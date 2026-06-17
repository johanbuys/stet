import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vite-plus/test";
import {
  Confidence,
  Finding,
  parseFindings,
  PhaseId,
  severityAtLeast,
  Severity,
} from "./finding.js";

const validFinding: Finding = {
  id: "gates.x",
  phase: "gates",
  severity: "error",
  confidence: "high",
  message: "msg",
};

describe("parseFindings", () => {
  it("returns the typed array when every element is a valid Finding", () => {
    const second: Finding = { ...validFinding, id: "gates.y", severity: "warning" };
    const result = parseFindings({ findings: [validFinding, second] });
    expect(result).toEqual([validFinding, second]);
  });

  it("returns an empty array for an empty findings array", () => {
    expect(parseFindings({ findings: [] })).toEqual([]);
  });

  it("returns null when the submission is not an object", () => {
    expect(parseFindings(null)).toBeNull();
    expect(parseFindings(undefined)).toBeNull();
    expect(parseFindings("nope")).toBeNull();
  });

  it("returns null when findings is missing or not an array", () => {
    expect(parseFindings({})).toBeNull();
    expect(parseFindings({ findings: "x" })).toBeNull();
  });

  it("returns null (rejects the whole batch) when any element fails the Finding schema", () => {
    const bad = { id: "gates.x", phase: "gates", severity: "error" }; // missing confidence + message
    expect(parseFindings({ findings: [validFinding, bad] })).toBeNull();
  });

  it("ignores extra top-level properties on the submission envelope", () => {
    const result = parseFindings({ findings: [validFinding], audit: { examined: ["a"] } });
    expect(result).toEqual([validFinding]);
  });
});

describe("PhaseId", () => {
  it("accepts valid kebab-case identifiers", () => {
    expect(Value.Check(PhaseId, "gates")).toBe(true);
    expect(Value.Check(PhaseId, "stub-det")).toBe(true);
    expect(Value.Check(PhaseId, "stub-agent")).toBe(true);
    expect(Value.Check(PhaseId, "test-quality")).toBe(true);
    expect(Value.Check(PhaseId, "behavioral")).toBe(true);
    expect(Value.Check(PhaseId, "spec")).toBe(true);
    expect(Value.Check(PhaseId, "review")).toBe(true);
    expect(Value.Check(PhaseId, "a")).toBe(true);
    expect(Value.Check(PhaseId, "a1")).toBe(true);
    expect(Value.Check(PhaseId, "a-b-c")).toBe(true);
  });

  it("rejects invalid identifiers — uppercase, leading digit, underscores", () => {
    expect(Value.Check(PhaseId, "Gates")).toBe(false);
    expect(Value.Check(PhaseId, "3gates")).toBe(false);
    expect(Value.Check(PhaseId, "gates_x")).toBe(false);
    expect(Value.Check(PhaseId, "")).toBe(false);
    expect(Value.Check(PhaseId, "-gates")).toBe(false);
    expect(Value.Check(PhaseId, "GATES")).toBe(false);
  });
});

describe("Severity", () => {
  it("accepts valid severity values", () => {
    expect(Value.Check(Severity, "error")).toBe(true);
    expect(Value.Check(Severity, "warning")).toBe(true);
    expect(Value.Check(Severity, "info")).toBe(true);
  });

  it("rejects invalid severity values", () => {
    expect(Value.Check(Severity, "critical")).toBe(false);
    expect(Value.Check(Severity, "high")).toBe(false);
    expect(Value.Check(Severity, "")).toBe(false);
  });
});

describe("severityAtLeast", () => {
  it("is true when a is strictly more severe than b", () => {
    expect(severityAtLeast("error", "warning")).toBe(true);
    expect(severityAtLeast("warning", "info")).toBe(true);
    expect(severityAtLeast("error", "info")).toBe(true);
  });

  it("is false when a is less severe than b", () => {
    expect(severityAtLeast("info", "warning")).toBe(false);
    expect(severityAtLeast("warning", "error")).toBe(false);
    expect(severityAtLeast("info", "error")).toBe(false);
  });

  it("is true for equal severities", () => {
    expect(severityAtLeast("error", "error")).toBe(true);
    expect(severityAtLeast("warning", "warning")).toBe(true);
    expect(severityAtLeast("info", "info")).toBe(true);
  });
});

describe("Confidence", () => {
  it("accepts valid confidence values", () => {
    expect(Value.Check(Confidence, "high")).toBe(true);
    expect(Value.Check(Confidence, "medium")).toBe(true);
    expect(Value.Check(Confidence, "low")).toBe(true);
  });

  it("rejects invalid confidence values", () => {
    expect(Value.Check(Confidence, "very-high")).toBe(false);
    expect(Value.Check(Confidence, "")).toBe(false);
  });
});

describe("Finding", () => {
  const minimalFinding: Finding = {
    id: "gates.test-failed",
    phase: "gates",
    severity: "error",
    confidence: "high",
    message: "Test gate failed.",
  };

  it("accepts a minimal valid finding (required fields only)", () => {
    expect(Value.Check(Finding, minimalFinding)).toBe(true);
  });

  it("accepts a full finding with all optional fields", () => {
    const full: Finding = {
      ...minimalFinding,
      specialist: "bugs",
      location: { file: "src/api.ts", line: 42, endLine: 55 },
      evidence: { command: "vp test", output: "exit 1 · 3 failed" },
      suggestion: "Fix the failing assertions.",
      meta: { priority: "critical", extraField: true },
    };
    expect(Value.Check(Finding, full)).toBe(true);
  });

  it("accepts a finding with location but no line numbers", () => {
    const f: Finding = {
      ...minimalFinding,
      location: { file: "src/api.ts" },
    };
    expect(Value.Check(Finding, f)).toBe(true);
  });

  it("accepts meta with arbitrary extra properties (open object)", () => {
    const f: Finding = {
      ...minimalFinding,
      meta: { anything: "goes", nested: { deep: true }, count: 42 },
    };
    expect(Value.Check(Finding, f)).toBe(true);
  });

  it("rejects a finding missing required fields", () => {
    const noId = { phase: "gates", severity: "error", confidence: "high", message: "msg" };
    expect(Value.Check(Finding, noId)).toBe(false);

    const noPhase = { id: "gates.x", severity: "error", confidence: "high", message: "msg" };
    expect(Value.Check(Finding, noPhase)).toBe(false);

    const noSeverity = { id: "gates.x", phase: "gates", confidence: "high", message: "msg" };
    expect(Value.Check(Finding, noSeverity)).toBe(false);
  });

  it("rejects a finding with an invalid PhaseId", () => {
    const badPhase = { ...minimalFinding, phase: "Gates" };
    expect(Value.Check(Finding, badPhase)).toBe(false);
  });

  it("rejects a finding with an unknown extra top-level property (additionalProperties: false)", () => {
    const extra = { ...minimalFinding, unknownField: "oops" };
    expect(Value.Check(Finding, extra)).toBe(false);
  });
});
