/**
 * Manifest reader for the qualification check (T20 · M6 · PRD §3.2, acceptance #15).
 *
 * The manifest is a JSON file shipped with the harness at fixtures/manifest.json.
 * Each entry records a (model, tier, rubricVersion, fixtureSetVersion) tuple that was
 * validated on the eval suite — earning the model "qualified" status for that tier.
 *
 * A missing manifest is treated as empty (no qualifications), which causes
 * checkQualification to emit the harness.unqualified-model warning for every model.
 */

import { readFile } from "node:fs/promises";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { ConfigError } from "../errors.js";
import { isFileAbsentError } from "../fs-util.js";
import { collectSchemaErrors } from "../schema/validation.js";
import { ModelTierSchema } from "./resolve.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * A single qualification entry from the manifest. Validated at the boundary so an
 * out-of-union `tier` (e.g. "Robust") is rejected with a path-named error instead of
 * being cast into ModelTier and silently never matching in checkQualification.
 * `tier` shares ModelTierSchema with the resolver, so the two can't drift.
 */
export const ManifestEntry = Type.Object({
  /** Fully-qualified "provider/model-id" string. */
  model: Type.String(),
  /** The tier this entry qualifies the model for. */
  tier: ModelTierSchema,
  /** Version of the phase rubric used during qualification. */
  rubricVersion: Type.String(),
  /** Version of the fixture set used during qualification. */
  fixtureSetVersion: Type.String(),
});
export type ManifestEntry = Static<typeof ManifestEntry>;

/** The manifest wire shape: a JSON object with an `entries` array. */
const Manifest = Type.Object({ entries: Type.Array(ManifestEntry) });

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Read and parse the qualification manifest at the given path.
 *
 * Returns Ok([]) when the file is missing (no qualifications → warning for every model).
 * Returns Err(ConfigError) for malformed JSON or schema violations.
 */
export async function readManifest(path: string): Promise<Result<ManifestEntry[], ConfigError>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isFileAbsentError(err)) {
      return Result.ok([]);
    }
    const message = err instanceof Error ? err.message : String(err);
    return Result.err(new ConfigError({ path, message: `Failed to read manifest: ${message}` }));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return Result.err(
      new ConfigError({ path, message: `Manifest is not valid JSON: ${String(err)}` }),
    );
  }

  if (!Value.Check(Manifest, parsed)) {
    const { details } = collectSchemaErrors(Manifest, parsed);
    return Result.err(new ConfigError({ path, message: `invalid manifest — ${details}` }));
  }

  return Result.ok(parsed.entries);
}
