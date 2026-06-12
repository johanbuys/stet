/**
 * Unit tests for deepMerge — leaf-by-leaf deep merge semantics.
 *
 * PRD §3.7: resolution is per-setting; nested keys resolve leaf-by-leaf,
 * never whole-section replacement.
 */

import { describe, expect, it } from "vite-plus/test";
import { deepMerge } from "./merge.js";

describe("deepMerge", () => {
  // ── Slice 1: overlay scalar ─────────────────────────────────────────────────

  it("overlay value is used when base is empty", () => {
    expect(deepMerge({}, { output: { failOn: "warning" } })).toEqual({
      output: { failOn: "warning" },
    });
  });

  it("overlay scalar overrides base scalar at the same leaf", () => {
    expect(deepMerge({ output: { failOn: "error" } }, { output: { failOn: "warning" } })).toEqual({
      output: { failOn: "warning" },
    });
  });

  // ── Slice 2: nested object merge (both keys survive) ────────────────────────

  it("overlay does not clobber sibling keys in the same nested object", () => {
    // phases values are Record<string,unknown> — accepts extra keys at the TypeScript level
    expect(
      deepMerge(
        { phases: { review: { tier: "fast", cost: 0.1 } } },
        { phases: { review: { tier: "robust" } } },
      ),
    ).toEqual({ phases: { review: { tier: "robust", cost: 0.1 } } });
  });

  it("nested objects at the same key merge recursively — both sibling keys survive", () => {
    expect(
      deepMerge(
        { phases: { review: { tier: "fast" } } },
        { phases: { review: { enabled: true } } },
      ),
    ).toEqual({ phases: { review: { tier: "fast", enabled: true } } });
  });

  // ── Slice 3: top-level sibling keys survive ──────────────────────────────────

  it("overlay top-level key does not remove unrelated base top-level key", () => {
    expect(deepMerge({ phases: { a: {} } }, { output: { failOn: "info" } })).toEqual({
      phases: { a: {} },
      output: { failOn: "info" },
    });
  });

  // ── Slice 4: absent overlay keys ────────────────────────────────────────────

  it("absent overlay key preserves base value", () => {
    expect(deepMerge({ output: { failOn: "error" } }, {})).toEqual({
      output: { failOn: "error" },
    });
  });

  it("undefined overlay value is skipped (base value preserved)", () => {
    const overlay: Record<string, unknown> = { output: undefined };
    expect(deepMerge({ output: { failOn: "error" } }, overlay)).toEqual({
      output: { failOn: "error" },
    });
  });

  // ── Slice 5: deep nesting (3 levels) ────────────────────────────────────────

  it("three levels deep — overlay replaces target leaf, sibling leaf survives", () => {
    const base = { a: { b: { c: 1, d: 2 } } };
    const overlay = { a: { b: { c: 99 } } };
    expect(deepMerge(base as never, overlay as never)).toEqual({ a: { b: { c: 99, d: 2 } } });
  });

  // ── Slice 6: immutability ───────────────────────────────────────────────────

  it("base is not mutated", () => {
    const base = { output: { failOn: "error" as const } };
    const frozen = JSON.stringify(base);
    deepMerge(base, { output: { failOn: "warning" } });
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("overlay is not mutated", () => {
    const overlay = { output: { failOn: "warning" as const } };
    const frozen = JSON.stringify(overlay);
    deepMerge({ output: { failOn: "error" } }, overlay);
    expect(JSON.stringify(overlay)).toBe(frozen);
  });

  // ── Slice 7: prototype-pollution safety ─────────────────────────────────────
  //
  // The yaml package (like JSON.parse) emits `__proto__:` mappings as OWN enumerable
  // keys. A naive `result[key] = overlayVal` assignment on such a key invokes the
  // inherited Object.prototype.__proto__ setter, swapping the merged object's
  // prototype to config-controlled data. These keys must be dropped, not merged.

  it("__proto__ key in overlay does not swap the merged object's prototype", () => {
    // JSON.parse produces an own __proto__ key — same shape the yaml parser emits.
    const overlay = JSON.parse('{"__proto__": {"phases": {"evil": {"command": "bad"}}}}');
    const merged = deepMerge({}, overlay as never) as Record<string, unknown>;
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged["phases"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(merged, "__proto__")).toBe(false);
  });

  it("nested __proto__ key is dropped while sibling keys survive", () => {
    const overlay = JSON.parse(
      '{"phases": {"review": {"__proto__": {"evil": 1}, "tier": "fast"}}}',
    );
    const merged = deepMerge({}, overlay as never) as {
      phases: { review: Record<string, unknown> };
    };
    expect(merged.phases.review["tier"]).toBe("fast");
    expect(Object.getPrototypeOf(merged.phases.review)).toBe(Object.prototype);
    expect(merged.phases.review["evil"]).toBeUndefined();
  });

  it("constructor and prototype keys are dropped", () => {
    const overlay = JSON.parse('{"constructor": {"a": 1}, "prototype": {"b": 2}}');
    const merged = deepMerge({}, overlay as never) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(merged, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(merged, "prototype")).toBe(false);
  });
});
