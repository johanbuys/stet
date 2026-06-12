/**
 * Model qualification check (T20 · M6 · PRD §3.2, acceptance #15).
 *
 * A resolved model is "qualified" for a tier when the manifest contains a matching
 * (model, tier, rubricVersion, fixtureSetVersion) entry. A version bump to either
 * rubricVersion or fixtureSetVersion invalidates all prior qualifications — callers
 * bump CURRENT_RUBRIC_VERSION or CURRENT_FIXTURE_SET_VERSION when the eval suite
 * changes, which causes existing entries to no longer match and triggers warnings.
 *
 * checkQualification is pure (no I/O) — the caller reads the manifest via readManifest
 * and passes the entries in. This keeps the qualification logic fully testable without
 * temp files.
 */

import { HARNESS_PHASE_ID } from "../schema/finding.js";
import type { Finding } from "../schema/finding.js";
import type { ModelTier } from "./resolve.js";
import type { ManifestEntry } from "./manifest.js";

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

/**
 * Current rubric version. Bump this when phase rubrics change substantially enough
 * to require re-qualification of all previously qualified models.
 */
export const CURRENT_RUBRIC_VERSION = "1.0.0";

/**
 * Current fixture-set version. Bump this when the eval fixture set (prompts, expected
 * outputs, scorecards) changes in a way that invalidates prior qualification results.
 */
export const CURRENT_FIXTURE_SET_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Qualification check
// ---------------------------------------------------------------------------

/**
 * Check whether a resolved model is qualified for the given tier.
 *
 * A model is qualified iff the manifest contains at least one entry where all four
 * fields match: model, tier, CURRENT_RUBRIC_VERSION, CURRENT_FIXTURE_SET_VERSION.
 *
 * Returns null when the model is qualified (no warning needed).
 * Returns a harness.unqualified-model warning Finding when unqualified.
 *
 * PRD §3.2: "never blocks by default; strict CI gates it via --fail-on warning."
 */
export function checkQualification(
  model: string,
  tier: ModelTier,
  entries: ManifestEntry[],
): Finding | null {
  const qualified = entries.some(
    (e) =>
      e.model === model &&
      e.tier === tier &&
      e.rubricVersion === CURRENT_RUBRIC_VERSION &&
      e.fixtureSetVersion === CURRENT_FIXTURE_SET_VERSION,
  );

  if (qualified) return null;

  return {
    id: "harness.unqualified-model",
    phase: HARNESS_PHASE_ID,
    severity: "warning",
    confidence: "high",
    message:
      `Model "${model}" has no valid qualification for tier "${tier}" ` +
      `(rubricVersion=${CURRENT_RUBRIC_VERSION}, fixtureSetVersion=${CURRENT_FIXTURE_SET_VERSION}). ` +
      `Run "stet models test" to qualify it, or accept the unverified model.`,
  };
}
