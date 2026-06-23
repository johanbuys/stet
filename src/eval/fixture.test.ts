/**
 * Tests for Fixture schema + synthetic fixtures (TDD C·4).
 *
 * Run: vp test fixture
 *
 * Coverage:
 *   - Fixture TypeBox schema: accepts valid, rejects invalid (missing fields, extra fields)
 *   - ALL_FIXTURES: every fixture validates, unique ids, tier coverage, clean invariant
 *   - Per-fixture: non-clean fixtures have non-empty expected; clean fixtures have empty expected
 */

import { describe, expect, it } from "vite-plus/test";
import { Value } from "@sinclair/typebox/value";
import { ExpectedFinding, Fixture } from "./fixture.js";
import { ALL_FIXTURES } from "./fixtures/index.js";

// ── ExpectedFinding schema ────────────────────────────────────────────────────

describe("ExpectedFinding schema", () => {
  it("accepts a minimal valid entry", () => {
    const entry = { id: "review.bug", severity: "error", gist: "null deref" };
    expect(Value.Check(ExpectedFinding, entry)).toBe(true);
  });

  it("accepts an entry with optional location", () => {
    const entry = {
      id: "review.bug",
      severity: "warning",
      location: { file: "src/foo.ts", line: 42 },
      gist: "missing null check",
    };
    expect(Value.Check(ExpectedFinding, entry)).toBe(true);
  });

  it("accepts location without line", () => {
    const entry = {
      id: "review.bug",
      severity: "info",
      location: { file: "src/foo.ts" },
      gist: "style issue",
    };
    expect(Value.Check(ExpectedFinding, entry)).toBe(true);
  });

  it("rejects unknown severity", () => {
    const entry = { id: "review.bug", severity: "critical", gist: "bad" };
    expect(Value.Check(ExpectedFinding, entry)).toBe(false);
  });

  it("rejects missing id", () => {
    const entry = { severity: "error", gist: "missing id" };
    expect(Value.Check(ExpectedFinding, entry)).toBe(false);
  });

  it("rejects missing gist", () => {
    const entry = { id: "review.bug", severity: "error" };
    expect(Value.Check(ExpectedFinding, entry)).toBe(false);
  });

  it("rejects extra top-level fields (additionalProperties: false)", () => {
    const entry = {
      id: "review.bug",
      severity: "error",
      gist: "ok",
      extra: "not allowed",
    };
    expect(Value.Check(ExpectedFinding, entry)).toBe(false);
  });
});

// ── Fixture schema ────────────────────────────────────────────────────────────

describe("Fixture schema", () => {
  const minimalClean: Fixture = {
    id: "test-clean",
    diff: "diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-x\n+y\n",
    expected: [],
    clean: true,
    tier: "in-diff",
  };

  it("accepts a minimal clean fixture", () => {
    expect(Value.Check(Fixture, minimalClean)).toBe(true);
  });

  it("accepts a fixture with baseFiles", () => {
    const f = { ...minimalClean, baseFiles: { "src/foo.ts": "export const x = 1;\n" } };
    expect(Value.Check(Fixture, f)).toBe(true);
  });

  it("accepts a fixture with sensitivePaths", () => {
    const f = { ...minimalClean, sensitivePaths: true };
    expect(Value.Check(Fixture, f)).toBe(true);
  });

  it("accepts all three tier values", () => {
    for (const tier of ["in-diff", "needs-context", "cross-file"] as const) {
      expect(Value.Check(Fixture, { ...minimalClean, tier })).toBe(true);
    }
  });

  it("rejects unknown tier", () => {
    const f = { ...minimalClean, tier: "unknown-tier" };
    expect(Value.Check(Fixture, f)).toBe(false);
  });

  it("rejects missing id", () => {
    const { id: _, ...rest } = minimalClean;
    expect(Value.Check(Fixture, rest)).toBe(false);
  });

  it("rejects missing diff", () => {
    const { diff: _, ...rest } = minimalClean;
    expect(Value.Check(Fixture, rest)).toBe(false);
  });

  it("rejects missing clean", () => {
    const { clean: _, ...rest } = minimalClean;
    expect(Value.Check(Fixture, rest)).toBe(false);
  });

  it("rejects extra top-level fields", () => {
    const f = { ...minimalClean, unknownField: true };
    expect(Value.Check(Fixture, f)).toBe(false);
  });
});

// ── ALL_FIXTURES — load + coverage checks ────────────────────────────────────

describe("ALL_FIXTURES", () => {
  it("every fixture validates against the Fixture schema", () => {
    for (const fixture of ALL_FIXTURES) {
      expect(Value.Check(Fixture, fixture), `fixture '${fixture.id}' must validate`).toBe(true);
    }
  });

  it("all fixture ids are unique", () => {
    const ids = ALL_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least one in-diff fixture", () => {
    expect(ALL_FIXTURES.some((f) => f.tier === "in-diff")).toBe(true);
  });

  it("has at least one needs-context fixture", () => {
    expect(ALL_FIXTURES.some((f) => f.tier === "needs-context")).toBe(true);
  });

  it("has at least one cross-file fixture", () => {
    expect(ALL_FIXTURES.some((f) => f.tier === "cross-file")).toBe(true);
  });

  it("has at least one clean fixture", () => {
    expect(ALL_FIXTURES.some((f) => f.clean)).toBe(true);
  });

  it("clean fixtures have empty expected array", () => {
    for (const fixture of ALL_FIXTURES.filter((f) => f.clean)) {
      expect(
        fixture.expected,
        `clean fixture '${fixture.id}' must have empty expected`,
      ).toHaveLength(0);
    }
  });

  it("non-clean fixtures have at least one expected entry", () => {
    for (const fixture of ALL_FIXTURES.filter((f) => !f.clean)) {
      expect(
        fixture.expected.length,
        `non-clean fixture '${fixture.id}' must have at least one expected finding`,
      ).toBeGreaterThan(0);
    }
  });

  it("needs-context and cross-file fixtures have baseFiles", () => {
    for (const fixture of ALL_FIXTURES.filter(
      (f) => f.tier === "needs-context" || f.tier === "cross-file",
    )) {
      expect(
        fixture.baseFiles,
        `'${fixture.tier}' fixture '${fixture.id}' must supply baseFiles`,
      ).toBeDefined();
    }
  });

  it("all diffs are non-empty strings", () => {
    for (const fixture of ALL_FIXTURES) {
      expect(typeof fixture.diff).toBe("string");
      expect(fixture.diff.length, `fixture '${fixture.id}' diff must be non-empty`).toBeGreaterThan(
        0,
      );
    }
  });
});
