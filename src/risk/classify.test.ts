/**
 * Tests for classify (T29 · M7.5 · PRD §3.4.1a).
 *
 * Pure function, table-tested: classify(diff, paths, rules) → level.
 * The fixture rule used here is `lines > 10 ⇒ "full" else "trivial"` — the same
 * rule declared on stub-composite. Real thresholds are the code-review PRD's (plan P9).
 *
 * PRD refs: §3.4.1a; decisions #26, #32; plan M7.5 step 5.
 */

import { describe, expect, it } from "vite-plus/test";
import { classify } from "./classify.js";
import type { RiskRule } from "./classify.js";

// ---------------------------------------------------------------------------
// Fixture rule set — lines > 10 ⇒ "full" else "trivial"
// ---------------------------------------------------------------------------

const LINE_COUNT_RULES: RiskRule[] = [
  { predicate: (diff) => diff.split("\n").length > 10, level: "full" },
  { predicate: () => true, level: "trivial" },
];

function makeDiff(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `+line ${i + 1}`).join("\n");
}

// ---------------------------------------------------------------------------
// Table tests — fixture rules
// ---------------------------------------------------------------------------

describe("classify — fixture rules (lines > 10 ⇒ full else trivial)", () => {
  it("returns 'trivial' for an empty diff", () => {
    expect(classify("", [], LINE_COUNT_RULES)).toBe("trivial");
  });

  it("returns 'trivial' for a 1-line diff", () => {
    expect(classify("+one change", [], LINE_COUNT_RULES)).toBe("trivial");
  });

  it("returns 'trivial' for exactly 10 lines", () => {
    expect(classify(makeDiff(10), [], LINE_COUNT_RULES)).toBe("trivial");
  });

  it("returns 'full' for 11 lines (threshold boundary)", () => {
    expect(classify(makeDiff(11), [], LINE_COUNT_RULES)).toBe("full");
  });

  it("returns 'full' for a large diff", () => {
    expect(classify(makeDiff(100), ["auth/login.ts"], LINE_COUNT_RULES)).toBe("full");
  });

  it("paths are not used by the line-count rule (paths have no effect)", () => {
    const smallDiff = makeDiff(5);
    expect(classify(smallDiff, ["src/critical.ts", "auth/secret.ts"], LINE_COUNT_RULES)).toBe(
      "trivial",
    );
  });
});

// ---------------------------------------------------------------------------
// Table tests — path-sensitive rules
// ---------------------------------------------------------------------------

describe("classify — path-sensitive rules", () => {
  const AUTH_RULES: RiskRule[] = [
    { predicate: (_diff, paths) => paths.some((p) => p.startsWith("auth/")), level: "full" },
    { predicate: () => true, level: "trivial" },
  ];

  it("returns 'full' when a path matches the auth/ prefix", () => {
    expect(classify("", ["auth/login.ts"], AUTH_RULES)).toBe("full");
  });

  it("returns 'trivial' for paths outside auth/", () => {
    expect(classify("", ["src/utils.ts", "tests/main.test.ts"], AUTH_RULES)).toBe("trivial");
  });

  it("returns 'full' when any path matches (mixed paths)", () => {
    expect(classify("", ["src/ui.ts", "auth/middleware.ts"], AUTH_RULES)).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// Rule evaluation order — first match wins
// ---------------------------------------------------------------------------

describe("classify — rule evaluation order", () => {
  it("returns the level of the first matching rule", () => {
    const rules: RiskRule[] = [
      { predicate: () => true, level: "trivial" },
      { predicate: () => true, level: "full" }, // never reached
    ];
    expect(classify("any diff", ["any/path.ts"], rules)).toBe("trivial");
  });

  it("skips non-matching rules and returns the first match", () => {
    const rules: RiskRule[] = [
      { predicate: (diff) => diff.includes("CRITICAL"), level: "full" },
      { predicate: () => true, level: "trivial" },
    ];
    expect(classify("small change", [], rules)).toBe("trivial");
    expect(classify("CRITICAL change", [], rules)).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// No rules / no match fallback
// ---------------------------------------------------------------------------

describe("classify — empty rules / no match", () => {
  it("returns 'full' when the rules array is empty (safe default)", () => {
    expect(classify("any diff", ["any/path.ts"], [])).toBe("full");
  });

  it("returns 'full' when no rule matches (safe default)", () => {
    const rules: RiskRule[] = [
      { predicate: () => false, level: "trivial" },
      { predicate: () => false, level: "standard" },
    ];
    expect(classify("any diff", [], rules)).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// Multi-level rules
// ---------------------------------------------------------------------------

describe("classify — multi-level rules", () => {
  const MULTI_LEVEL: RiskRule[] = [
    { predicate: (diff) => diff.split("\n").length > 50, level: "full" },
    { predicate: (diff) => diff.split("\n").length > 10, level: "standard" },
    { predicate: () => true, level: "trivial" },
  ];

  it("returns 'trivial' for <= 10 lines", () => {
    expect(classify(makeDiff(10), [], MULTI_LEVEL)).toBe("trivial");
  });

  it("returns 'standard' for 11–50 lines", () => {
    expect(classify(makeDiff(25), [], MULTI_LEVEL)).toBe("standard");
  });

  it("returns 'full' for > 50 lines", () => {
    expect(classify(makeDiff(51), [], MULTI_LEVEL)).toBe("full");
  });
});
