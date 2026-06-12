/**
 * Deep merge for StetConfig.
 *
 * Merge semantics (PRD §3.7): resolution is per-setting — nested objects merge
 * leaf-by-leaf so sibling keys at every depth survive independently. A scalar at
 * the overlay layer replaces the same leaf in the base; an object in the overlay
 * merges recursively with the corresponding base object.
 */

import type { StetConfig } from "./schema.js";

function isPlainObject(val: unknown): val is Record<string, unknown> {
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

    const baseVal = result[key];
    if (isPlainObject(baseVal) && isPlainObject(overlayVal)) {
      result[key] = deepMerge(baseVal as StetConfig, overlayVal as StetConfig);
    } else {
      result[key] = overlayVal;
    }
  }

  return result as StetConfig;
}
