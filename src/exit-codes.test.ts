/**
 * Tests for deriveExit — pure exit-code derivation.
 *
 * Covers PRD §4.8 gating rule, §4.10 worked examples (A, B, C adapted),
 * and acceptance criterion #8.
 */

import { describe, expect, test } from "vite-plus/test";
import type { Finding } from "./schema/finding.js";
import { PREEXISTING_META_KEY } from "./schema/finding.js";
import type { PhaseReport } from "./schema/report.js";
import { deriveExit, exitLabel } from "./exit-codes.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePhase(
  phase: string,
  findings: Finding[],
  status: PhaseReport["status"] = "completed",
): PhaseReport {
  return {
    phase,
    status,
    findings,
    audit: {},
    cost: { durationMs: 0 },
  };
}

function makeFinding(
  phase: string,
  id: string,
  severity: Finding["severity"],
  confidence: Finding["confidence"],
  message = `${id} message`,
): Finding {
  return { id, phase, severity, confidence, message };
}

// ---------------------------------------------------------------------------
// Basic exit 0 cases
// ---------------------------------------------------------------------------

describe("deriveExit — exit 0 cases", () => {
  test("empty phases array ⇒ exit 0, empty gating", () => {
    const result = deriveExit([], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("phase with no findings ⇒ exit 0", () => {
    const result = deriveExit([makePhase("gates", [])], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("high-confidence info finding with failOn error ⇒ exit 0 (below threshold)", () => {
    const findings = [makeFinding("review", "review.info", "info", "high")];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("high-confidence warning finding with failOn error ⇒ exit 0 (below threshold)", () => {
    const findings = [makeFinding("review", "review.warn", "warning", "high")];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("medium-confidence error finding ⇒ exit 0 (PRD AC#8: sub-high AI findings never gate)", () => {
    const findings = [makeFinding("review", "review.bug", "error", "medium")];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("low-confidence error finding ⇒ exit 0", () => {
    const findings = [makeFinding("review", "review.bug", "error", "low")];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("Example A: clean run — warning on skipped behavioral with failOn error ⇒ exit 0", () => {
    // PRD §4.10 Example A: behavioral.not-run is a high-confidence warning,
    // but failOn is error so it does NOT gate.
    const phases: PhaseReport[] = [
      makePhase("gates", [
        makeFinding(
          "gates",
          "gates.no-linter-configured",
          "warning",
          "high",
          "No lint gate detected.",
        ),
      ]),
      makePhase("spec", [], "skipped"),
      makePhase("review", []),
      makePhase("test-quality", [], "skipped"),
      makePhase(
        "behavioral",
        [
          makeFinding(
            "behavioral",
            "behavioral.not-run",
            "warning",
            "high",
            "Behavioral verification did not run.",
          ),
        ],
        "skipped",
      ),
    ];
    const result = deriveExit(phases, "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Basic exit 1 cases
// ---------------------------------------------------------------------------

describe("deriveExit — exit 1 cases", () => {
  test("high-confidence error finding with failOn error ⇒ exit 1", () => {
    const findings = [makeFinding("review", "review.bug", "error", "high", "Unhandled rejection")];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toEqual([
      { phase: "review", id: "review.bug", message: "Unhandled rejection" },
    ]);
  });

  test("high-confidence warning with failOn warning ⇒ exit 1", () => {
    const findings = [makeFinding("review", "review.warn", "warning", "high", "Deprecation risk")];
    const result = deriveExit([makePhase("review", findings)], "warning");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toEqual([
      { phase: "review", id: "review.warn", message: "Deprecation risk" },
    ]);
  });

  test("high-confidence info with failOn info ⇒ exit 1", () => {
    const findings = [makeFinding("review", "review.style", "info", "high", "Style note")];
    const result = deriveExit([makePhase("review", findings)], "info");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toEqual([{ phase: "review", id: "review.style", message: "Style note" }]);
  });

  test("Example B: two gating findings (review error + behavioral error) ⇒ exit 1, both listed", () => {
    // PRD §4.10 Example B adapted — two high-confidence error findings, both must appear in gating.
    const phases: PhaseReport[] = [
      makePhase("gates", []),
      makePhase("spec", []),
      makePhase("review", [
        makeFinding(
          "review",
          "review.bug",
          "error",
          "high",
          "Unhandled promise rejection: `buildCsv()` can reject but the route handler has no catch.",
        ),
      ]),
      makePhase("test-quality", [], "skipped"),
      makePhase("behavioral", [
        makeFinding(
          "behavioral",
          "behavioral.claim-failed",
          "error",
          "high",
          "Spec claim 'export endpoint returns CSV for a valid date range' fails: GET returns 500.",
        ),
      ]),
    ];
    const result = deriveExit(phases, "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(2);
    expect(result.gating[0]).toEqual({
      phase: "review",
      id: "review.bug",
      message:
        "Unhandled promise rejection: `buildCsv()` can reject but the route handler has no catch.",
    });
    expect(result.gating[1]).toEqual({
      phase: "behavioral",
      id: "behavioral.claim-failed",
      message:
        "Spec claim 'export endpoint returns CSV for a valid date range' fails: GET returns 500.",
    });
  });

  test("Example C: cancelled phase does not suppress findings on other phases", () => {
    // PRD §4.10 Example C: gates has a gating finding, review is cancelled.
    // Phase status (cancelled) does not affect gating — only findings do.
    const phases: PhaseReport[] = [
      makePhase("gates", [
        makeFinding(
          "gates",
          "gates.test-failed",
          "error",
          "high",
          "Test gate failed: 3 of 142 tests failing.",
        ),
      ]),
      makePhase("spec", [], "skipped"),
      makePhase("review", [], "cancelled"),
      makePhase("test-quality", [], "skipped"),
      makePhase(
        "behavioral",
        [
          makeFinding(
            "behavioral",
            "behavioral.not-run",
            "warning",
            "high",
            "Behavioral verification did not run: no spec provided.",
          ),
        ],
        "skipped",
      ),
    ];
    const result = deriveExit(phases, "error");
    expect(result.exitCode).toBe(1);
    // Only the error finding gates (failOn: error); the warning on behavioral does not.
    expect(result.gating).toEqual([
      {
        phase: "gates",
        id: "gates.test-failed",
        message: "Test gate failed: 3 of 142 tests failing.",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase status has no effect on gating
// ---------------------------------------------------------------------------

describe("deriveExit — phase status is irrelevant to gating", () => {
  test("high-confidence error on a skipped phase still gates (phase status ignored)", () => {
    const findings = [makeFinding("behavioral", "behavioral.err", "error", "high", "Error msg")];
    const result = deriveExit([makePhase("behavioral", findings, "skipped")], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("high-confidence error on a cancelled phase still gates", () => {
    const findings = [makeFinding("review", "review.err", "error", "high", "Error msg")];
    const result = deriveExit([makePhase("review", findings, "cancelled")], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("high-confidence error on an error-status phase still gates", () => {
    const findings = [makeFinding("spec", "spec.err", "error", "high", "Error msg")];
    const result = deriveExit([makePhase("spec", findings, "error")], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("behavioral.not-run warning on skipped phase gates under --fail-on warning (PRD §4.4)", () => {
    // PRD §4.4 says 'did not run' warning on a skipped phase stays visible via --fail-on warning.
    const findings = [
      makeFinding(
        "behavioral",
        "behavioral.not-run",
        "warning",
        "high",
        "Behavioral verification did not run: no spec provided.",
      ),
    ];
    const result = deriveExit([makePhase("behavioral", findings, "skipped")], "warning");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toEqual([
      {
        phase: "behavioral",
        id: "behavioral.not-run",
        message: "Behavioral verification did not run: no spec provided.",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Severity threshold boundary
// ---------------------------------------------------------------------------

describe("deriveExit — severity threshold (failOn)", () => {
  test("failOn warning: error and warning gate, info does not", () => {
    const findings = [
      makeFinding("review", "review.e", "error", "high", "An error"),
      makeFinding("review", "review.w", "warning", "high", "A warning"),
      makeFinding("review", "review.i", "info", "high", "An info"),
    ];
    const result = deriveExit([makePhase("review", findings)], "warning");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(2);
    expect(result.gating.map((g) => g.id)).toEqual(["review.e", "review.w"]);
  });

  test("failOn info: all three severities gate (all high-confidence)", () => {
    const findings = [
      makeFinding("review", "review.e", "error", "high", "An error"),
      makeFinding("review", "review.w", "warning", "high", "A warning"),
      makeFinding("review", "review.i", "info", "high", "An info"),
    ];
    const result = deriveExit([makePhase("review", findings)], "info");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(3);
  });

  test("failOn error: only errors gate, warnings and infos do not", () => {
    const findings = [
      makeFinding("review", "review.e", "error", "high", "An error"),
      makeFinding("review", "review.w", "warning", "high", "A warning"),
      makeFinding("review", "review.i", "info", "high", "An info"),
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
    expect(result.gating[0]?.id).toBe("review.e");
  });
});

// ---------------------------------------------------------------------------
// Confidence filter
// ---------------------------------------------------------------------------

describe("deriveExit — confidence filter", () => {
  test("medium-confidence warning with failOn warning ⇒ exit 0 (sub-high never gates)", () => {
    const findings = [makeFinding("review", "review.w", "warning", "medium", "A medium warning")];
    const result = deriveExit([makePhase("review", findings)], "warning");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("low-confidence info with failOn info ⇒ exit 0", () => {
    const findings = [makeFinding("review", "review.i", "info", "low", "A low info")];
    const result = deriveExit([makePhase("review", findings)], "info");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("mix of high and medium errors: only high gates", () => {
    const findings = [
      makeFinding("review", "review.e-high", "error", "high", "High error"),
      makeFinding("review", "review.e-med", "error", "medium", "Medium error"),
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
    expect(result.gating[0]?.id).toBe("review.e-high");
  });
});

// ---------------------------------------------------------------------------
// Ordering: gating preserves phases[]/findings[] order
// ---------------------------------------------------------------------------

describe("deriveExit — gating order", () => {
  test("gating list preserves phases[] then findings[] order", () => {
    const phases: PhaseReport[] = [
      makePhase("gates", [
        makeFinding("gates", "gates.a", "error", "high", "First"),
        makeFinding("gates", "gates.b", "error", "high", "Second"),
      ]),
      makePhase("review", [makeFinding("review", "review.a", "error", "high", "Third")]),
    ];
    const result = deriveExit(phases, "error");
    expect(result.gating.map((g) => g.id)).toEqual(["gates.a", "gates.b", "review.a"]);
  });
});

// ---------------------------------------------------------------------------
// Return type shape
// ---------------------------------------------------------------------------

describe("deriveExit — return type", () => {
  test("return shape: { exitCode, gating } with correct literal types on exit 0", () => {
    const result = deriveExit([], "error");
    expect(result).toHaveProperty("exitCode", 0);
    expect(result).toHaveProperty("gating");
    expect(Array.isArray(result.gating)).toBe(true);
  });

  test("gating entries have exactly { phase, id, message } keys", () => {
    const findings = [makeFinding("review", "review.bug", "error", "high", "A bug")];
    const result = deriveExit([makePhase("review", findings)], "error");
    const entry = result.gating[0]!;
    expect(Object.keys(entry).sort()).toEqual(["id", "message", "phase"]);
  });
});

// ---------------------------------------------------------------------------
// Pre-existing filter (TDD G · T19 · PRD R6/C6)
// ---------------------------------------------------------------------------

describe("deriveExit — pre-existing filter (TDD G)", () => {
  test("high-confidence error with meta.preexisting=true ⇒ exit 0 (does not gate)", () => {
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.bug", "error", "high", "A pre-existing bug"),
        meta: { [PREEXISTING_META_KEY]: true } as Record<string, unknown>,
      },
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("high-confidence error without meta.preexisting ⇒ exit 1 (gates normally)", () => {
    const findings: Finding[] = [
      makeFinding("review", "review.bug", "error", "high", "An introduced bug"),
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("high-confidence error with meta.preexisting=false ⇒ exit 1 (false is not pre-existing)", () => {
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.bug", "error", "high", "A bug"),
        meta: { [PREEXISTING_META_KEY]: false } as Record<string, unknown>,
      },
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("mix: pre-existing error + introduced error ⇒ exit 1, only introduced in gating", () => {
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.old", "error", "high", "Old bug"),
        meta: { [PREEXISTING_META_KEY]: true } as Record<string, unknown>,
      },
      makeFinding("review", "review.new", "error", "high", "New bug"),
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
    expect(result.gating[0]?.id).toBe("review.new");
  });

  test("all pre-existing high-confidence errors ⇒ exit 0", () => {
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.a", "error", "high", "Pre-existing A"),
        meta: { [PREEXISTING_META_KEY]: true } as Record<string, unknown>,
      },
      {
        ...makeFinding("review", "review.b", "error", "high", "Pre-existing B"),
        meta: { [PREEXISTING_META_KEY]: true } as Record<string, unknown>,
      },
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
    expect(result.gating).toEqual([]);
  });

  test("meta with other keys but no preexisting ⇒ still gates", () => {
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.bug", "error", "high", "A bug"),
        meta: { selfConfidence: "medium" } as Record<string, unknown>,
      },
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(1);
    expect(result.gating).toHaveLength(1);
  });

  test("pre-existing check is a runtime read — Finding schema allows any meta key", () => {
    // Validates the open-meta contract: meta.preexisting is not narrowed in the schema.
    const findings: Finding[] = [
      {
        ...makeFinding("review", "review.bug", "error", "high", "Pre-existing"),
        meta: { [PREEXISTING_META_KEY]: true, selfConfidence: "high" } as Record<string, unknown>,
      },
    ];
    const result = deriveExit([makePhase("review", findings)], "error");
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// exitLabel
// ---------------------------------------------------------------------------

describe("exitLabel", () => {
  test("exitLabel(0) ⇒ 'ok'", () => {
    expect(exitLabel(0)).toBe("ok");
  });

  test("exitLabel(1) ⇒ 'findings gate'", () => {
    expect(exitLabel(1)).toBe("findings gate");
  });

  test("exitLabel(2) ⇒ 'interrupted'", () => {
    expect(exitLabel(2)).toBe("interrupted");
  });
});
