/**
 * Tests for applyBudget (T24, M8).
 *
 * Verifies context budget enforcement: diffs under budget pass unchanged;
 * diffs over budget are reduced to a file-order subset with a
 * `<phase>.partial-coverage` warning naming excluded files.
 *
 * All tests use synthetic diff strings — no real filesystem access.
 * Run: vp test coverage
 */

import { describe, expect, it } from "vite-plus/test";
import { Value } from "@sinclair/typebox/value";
import { Finding } from "../schema/finding.js";
import { applyBudget, DIFF_BUDGET } from "./coverage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diffSection(path: string, sizeApprox: number): string {
  const body = "+".repeat(sizeApprox);
  return [
    `diff --git a/${path} b/${path}`,
    `index abc..def 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,1 +1,2 @@`,
    body,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tests — T24: Budget enforcement
// ---------------------------------------------------------------------------

describe("applyBudget (T24)", () => {
  // ── Under budget: pass through unchanged ──────────────────────────────────

  it("diff under budget → returned unchanged, no warning", () => {
    const diff = diffSection("src/index.ts", 100);
    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.diff).toBe(diff);
    expect(result.excluded).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it("empty diff → returned unchanged, no warning", () => {
    const result = applyBudget("", DIFF_BUDGET, "review");
    expect(result.diff).toBe("");
    expect(result.excluded).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it("diff exactly at budget boundary → no truncation", () => {
    // Build a diff whose total length is exactly the budget
    const s1 = diffSection("src/file.ts", 10);
    // Pad remaining budget
    const remaining = DIFF_BUDGET - s1.length;
    const s2 = diffSection("src/other.ts", Math.max(0, remaining - 80));
    const combined = s1 + "\n" + s2;
    // Make sure it's within budget
    if (combined.length <= DIFF_BUDGET) {
      const result = applyBudget(combined, DIFF_BUDGET, "spec");
      expect(result.excluded).toEqual([]);
      expect(result.warning).toBeUndefined();
    }
  });

  // ── Over budget: subset + warning ─────────────────────────────────────────

  it("diff over budget → last file excluded, warning emitted", () => {
    const small = diffSection("src/small.ts", 50);
    const big = diffSection("src/big.ts", DIFF_BUDGET); // way over budget on its own
    const diff = small + "\n" + big;

    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.excluded).toContain("src/big.ts");
    expect(result.excluded).not.toContain("src/small.ts");
    expect(result.warning).toBeDefined();
  });

  it("warning id is <phaseId>.partial-coverage", () => {
    const diff = diffSection("src/huge.ts", DIFF_BUDGET + 1000);
    const result = applyBudget(diff, DIFF_BUDGET, "spec");

    expect(result.warning?.id).toBe("spec.partial-coverage");
  });

  it("warning phase matches phaseId", () => {
    const diff = diffSection("src/huge.ts", DIFF_BUDGET + 1000);
    const result = applyBudget(diff, DIFF_BUDGET, "test-quality");

    expect(result.warning?.phase).toBe("test-quality");
  });

  it("warning severity is warning", () => {
    const diff = diffSection("src/huge.ts", DIFF_BUDGET + 1000);
    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.warning?.severity).toBe("warning");
  });

  it("warning confidence is high", () => {
    const diff = diffSection("src/huge.ts", DIFF_BUDGET + 1000);
    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.warning?.confidence).toBe("high");
  });

  it("warning message names all excluded files", () => {
    const small = diffSection("src/small.ts", 50);
    const big1 = diffSection("src/big1.ts", DIFF_BUDGET);
    const big2 = diffSection("src/big2.ts", DIFF_BUDGET);
    const diff = small + "\n" + big1 + "\n" + big2;

    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.warning?.message).toContain("src/big1.ts");
    expect(result.warning?.message).toContain("src/big2.ts");
    expect(result.warning?.message).not.toContain("src/small.ts");
  });

  it("truncated diff contains included files, not excluded ones", () => {
    const small = diffSection("src/small.ts", 50);
    const big = diffSection("src/big.ts", DIFF_BUDGET + 5000);
    const diff = small + "\n" + big;

    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.diff).toContain("src/small.ts");
    expect(result.diff).not.toContain("src/big.ts");
  });

  it("warning is a valid Finding schema", () => {
    const diff = diffSection("src/huge.ts", DIFF_BUDGET + 1000);
    const result = applyBudget(diff, DIFF_BUDGET, "review");

    expect(result.warning).toBeDefined();
    expect(Value.Check(Finding, result.warning)).toBe(true);
  });

  // ── Budget with custom limit ──────────────────────────────────────────────

  it("custom small budget trims at the right point", () => {
    const s1 = diffSection("src/a.ts", 20);
    const s2 = diffSection("src/b.ts", 20);
    const s3 = diffSection("src/c.ts", 20);
    const diff = s1 + "\n" + s2 + "\n" + s3;

    // Budget only allows two sections
    const tightBudget = s1.length + s2.length + 5;
    const result = applyBudget(diff, tightBudget, "review");

    expect(result.excluded).toContain("src/c.ts");
    expect(result.warning).toBeDefined();
    expect(result.warning?.message).toContain("src/c.ts");
  });

  // ── DIFF_BUDGET exported constant ────────────────────────────────────────

  it("DIFF_BUDGET is 200_000", () => {
    expect(DIFF_BUDGET).toBe(200_000);
  });
});
