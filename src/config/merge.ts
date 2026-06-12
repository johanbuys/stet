/**
 * Deep merge for StetConfig.
 *
 * Merge semantics (PRD §3.7): resolution is per-setting — nested objects merge
 * leaf-by-leaf so sibling keys at every depth survive independently. A scalar at
 * the overlay layer replaces the same leaf in the base; an object in the overlay
 * merges recursively with the corresponding base object.
 */

import type { StetConfig } from "./schema.js";

/**
 * Keys that must never be merged: the yaml package (like JSON.parse) emits
 * `__proto__:` mappings as OWN enumerable keys, and a plain `result[key] = val`
 * assignment on such a key invokes the inherited Object.prototype.__proto__
 * setter — swapping the merged config's prototype to config-controlled data
 * (prototype pollution). constructor/prototype are dropped for the same class
 * of gadget. This is the one deliberate exception to "unknown keys pass through".
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Narrow to a plain (non-array) object — the only shape deepMerge recurses into. */
export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Return a new StetConfig that is `base` deep-merged with `overlay`.
 * Neither argument is mutated.
 */
export function deepMerge(base: StetConfig, overlay: StetConfig): StetConfig {
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, overlayVal] of Object.entries(overlay as Record<string, unknown>)) {
    if (overlayVal === undefined) continue;
    if (FORBIDDEN_KEYS.has(key)) continue;

    const baseVal = result[key];
    if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
      result[key] = deepMerge(baseVal as StetConfig, overlayVal as StetConfig);
    } else {
      result[key] = overlayVal;
    }
  }

  return result as StetConfig;
}
