/**
 * Tests for buildAddedLineIndex + markPreexisting (TDD B·2).
 *
 * Run: vp test preexisting
 */

import { describe, expect, it } from "vite-plus/test";
import { buildAddedLineIndex, markPreexisting } from "./preexisting.js";
import type { Finding } from "./schema/finding.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeFinding(
  overrides: Partial<Finding> &
    Pick<Finding, "id" | "severity" | "message" | "confidence" | "phase">,
): Finding {
  return {
    ...overrides,
  };
}

// ── buildAddedLineIndex ───────────────────────────────────────────────────────

describe("buildAddedLineIndex", () => {
  it("empty string → empty map", () => {
    expect(buildAddedLineIndex("")).toEqual(new Map());
  });

  it("diff with no hunk lines → file entry exists but set is empty", () => {
    const diff = ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts"].join(
      "\n",
    );
    const idx = buildAddedLineIndex(diff);
    expect(idx.has("src/a.ts")).toBe(true);
    expect(idx.get("src/a.ts")?.size).toBe(0);
  });

  it("single hunk, single added line → Set contains that line number", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " context line 1",
      "+added line 2",
      " context line 3",
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([2]));
  });

  it("context lines are NOT added to the set", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " context line 1",
      " context line 2",
      " context line 3",
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")?.size).toBe(0);
  });

  it("deleted lines do not advance the new-file counter", () => {
    // @@ -1,3 +1,2 @@: delete line 2, keep lines 1 and 3
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,2 @@",
      " line 1", // new line 1
      "-deleted", // old line 2 only — no new-file advance
      " line 3", // new line 2 (not 3!)
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    // Only context lines — nothing added
    expect(idx.get("src/a.ts")?.size).toBe(0);
  });

  it("mixed +/context/- lines — correct new-file line numbers", () => {
    // @@ -1,4 +1,4 @@
    // new lines: 1=context, 2=added, 3=context (was 3, no-4 deleted), 4=added
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,4 +1,4 @@",
      " line 1", // new line 1 (context)
      "+added", // new line 2 (added)
      " line 3", // new line 3 (context)
      "-deleted", // old line 4 only
      "+added 4", // new line 4 (added)
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([2, 4]));
  });

  // ── multi-hunk ────────────────────────────────────────────────────────────

  it("multi-hunk: each @@ resets the new-file counter independently", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " line 1", // new line 1
      "-old 2",
      "+new 2", // new line 2 (added)
      " line 3", // new line 3
      "@@ -10,3 +10,3 @@",
      " line 10", // new line 10
      "-old 11",
      "+new 11", // new line 11 (added)
      " line 12", // new line 12
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([2, 11]));
  });

  it("multi-hunk: hunk starting mid-file has correct start offset", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -50,2 +50,3 @@",
      " line 50", // new line 50
      "+added 51", // new line 51 (added)
      " line 52", // new line 52
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([51]));
  });

  // ── off-by-one ────────────────────────────────────────────────────────────

  it("off-by-one: first added line in hunk gets exactly the hunk start line", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,0 +5,3 @@",
      "+line 5", // new line 5 (the very first line in this hunk)
      "+line 6", // new line 6
      "+line 7", // new line 7
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([5, 6, 7]));
  });

  it("off-by-one: last added line is not off by one from context boundary", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,4 +3,5 @@",
      " line 3", // new line 3
      " line 4", // new line 4
      "+added 5", // new line 5 (added)
      " line 6", // new line 6 (context — NOT added)
      " line 7", // new line 7 (context — NOT added)
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([5]));
  });

  // ── multi-file ────────────────────────────────────────────────────────────

  it("two files tracked independently", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      "+added a1", // src/a.ts line 1
      " line 2",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,2 +1,2 @@",
      " line 1",
      "+added b2", // src/b.ts line 2
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.get("src/a.ts")).toEqual(new Set([1]));
    expect(idx.get("src/b.ts")).toEqual(new Set([2]));
  });

  it("pure deletion (+++ /dev/null) → no entry created for that file", () => {
    const diff = [
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-gone",
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.has("old.ts")).toBe(false);
    expect(idx.has("/dev/null")).toBe(false);
  });

  it("b/ prefix stripped from path", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1,1 +1,2 @@",
      " line 1",
      "+added 2",
    ].join("\n");
    const idx = buildAddedLineIndex(diff);
    expect(idx.has("src/x.ts")).toBe(true);
    expect(idx.has("b/src/x.ts")).toBe(false);
  });
});

// ── markPreexisting ───────────────────────────────────────────────────────────

describe("markPreexisting", () => {
  const base = {
    phase: "review" as const,
    confidence: "high" as const,
    severity: "error" as const,
  } as const;

  it("finding on an added line → introduced (no meta.preexisting stamp)", () => {
    const idx = new Map([["src/a.ts", new Set([5])]]);
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
      location: { file: "src/a.ts", line: 5 },
    });
    markPreexisting([f], idx);
    expect((f.meta as Record<string, unknown>)?.["preexisting"]).toBeUndefined();
  });

  it("finding on a non-added line → meta.preexisting: true", () => {
    const idx = new Map([["src/a.ts", new Set([5])]]);
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
      location: { file: "src/a.ts", line: 3 },
    });
    markPreexisting([f], idx);
    expect((f.meta as Record<string, unknown>)?.["preexisting"]).toBe(true);
  });

  it("finding in a file not in the index → meta.preexisting: true", () => {
    const idx = new Map<string, Set<number>>();
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
      location: { file: "src/unchanged.ts", line: 10 },
    });
    markPreexisting([f], idx);
    expect((f.meta as Record<string, unknown>)?.["preexisting"]).toBe(true);
  });

  it("finding with no location.line → unchanged (no stamp)", () => {
    const idx = new Map<string, Set<number>>();
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
      location: { file: "src/a.ts" }, // no line
    });
    markPreexisting([f], idx);
    expect(f.meta).toBeUndefined();
  });

  it("finding with no location at all → unchanged (no stamp)", () => {
    const idx = new Map<string, Set<number>>();
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
    });
    markPreexisting([f], idx);
    expect(f.meta).toBeUndefined();
  });

  it("pre-existing stamp preserves existing meta keys", () => {
    const idx = new Map([["src/a.ts", new Set([5])]]);
    const f = makeFinding({
      ...base,
      id: "review.bug",
      message: "msg",
      location: { file: "src/a.ts", line: 3 },
      meta: { selfConfidence: "medium", customKey: "value" },
    });
    markPreexisting([f], idx);
    const meta = f.meta as Record<string, unknown>;
    expect(meta["preexisting"]).toBe(true);
    expect(meta["selfConfidence"]).toBe("medium");
    expect(meta["customKey"]).toBe("value");
  });

  it("multiple findings: each handled independently", () => {
    const idx = new Map([["src/a.ts", new Set([2, 4])]]);
    const introduced = makeFinding({
      ...base,
      id: "review.bug",
      message: "introduced",
      location: { file: "src/a.ts", line: 2 }, // added
    });
    const preexisting = makeFinding({
      ...base,
      id: "review.sec",
      message: "pre-existing",
      location: { file: "src/a.ts", line: 3 }, // context
    });
    const noline = makeFinding({
      ...base,
      id: "review.other",
      message: "cross-cutting",
      location: { file: "src/a.ts" }, // no line
    });

    markPreexisting([introduced, preexisting, noline], idx);

    expect((introduced.meta as Record<string, unknown>)?.["preexisting"]).toBeUndefined();
    expect((preexisting.meta as Record<string, unknown>)?.["preexisting"]).toBe(true);
    expect(noline.meta).toBeUndefined();
  });

  it("returns the same findings array (mutates in place)", () => {
    const idx = new Map<string, Set<number>>();
    const findings: Finding[] = [];
    expect(markPreexisting(findings, idx)).toBe(findings);
  });

  // ── multi-hunk integration ────────────────────────────────────────────────

  it("multi-hunk diff: findings correctly classified across hunk boundaries", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " line 1",
      "-old 2",
      "+new 2", // new line 2
      " line 3",
      "@@ -10,3 +10,3 @@",
      " line 10",
      "-old 11",
      "+new 11", // new line 11
      " line 12",
    ].join("\n");
    const idx = buildAddedLineIndex(diff);

    const onAdded2 = makeFinding({
      ...base,
      id: "r.a",
      message: "m",
      location: { file: "src/a.ts", line: 2 },
    });
    const onContext3 = makeFinding({
      ...base,
      id: "r.b",
      message: "m",
      location: { file: "src/a.ts", line: 3 },
    });
    const onAdded11 = makeFinding({
      ...base,
      id: "r.c",
      message: "m",
      location: { file: "src/a.ts", line: 11 },
    });
    const onContext12 = makeFinding({
      ...base,
      id: "r.d",
      message: "m",
      location: { file: "src/a.ts", line: 12 },
    });

    markPreexisting([onAdded2, onContext3, onAdded11, onContext12], idx);

    expect((onAdded2.meta as Record<string, unknown>)?.["preexisting"]).toBeUndefined();
    expect((onContext3.meta as Record<string, unknown>)?.["preexisting"]).toBe(true);
    expect((onAdded11.meta as Record<string, unknown>)?.["preexisting"]).toBeUndefined();
    expect((onContext12.meta as Record<string, unknown>)?.["preexisting"]).toBe(true);
  });
});
