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
import { Result } from "better-result";
import { ConfigError } from "../errors.js";
import type { ModelTier } from "./resolve.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single qualification entry from the manifest. */
export interface ManifestEntry {
  /** Fully-qualified "provider/model-id" string. */
  model: string;
  /** The tier this entry qualifies the model for. */
  tier: ModelTier;
  /** Version of the phase rubric used during qualification. */
  rubricVersion: string;
  /** Version of the fixture set used during qualification. */
  fixtureSetVersion: string;
}

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
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return Result.ok([]);
    }
    return Result.err(
      new ConfigError({ path, message: `Failed to read manifest: ${String(err)}` }),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return Result.err(
      new ConfigError({ path, message: `Manifest is not valid JSON: ${String(err)}` }),
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    return Result.err(
      new ConfigError({ path, message: 'Manifest must be a JSON object with an "entries" array.' }),
    );
  }

  const rawEntries = (parsed as { entries: unknown[] }).entries;
  const entries: ManifestEntry[] = [];
  for (const item of rawEntries) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).model !== "string" ||
      typeof (item as Record<string, unknown>).tier !== "string" ||
      typeof (item as Record<string, unknown>).rubricVersion !== "string" ||
      typeof (item as Record<string, unknown>).fixtureSetVersion !== "string"
    ) {
      return Result.err(
        new ConfigError({
          path,
          message:
            "Each manifest entry must have string fields: model, tier, rubricVersion, fixtureSetVersion.",
        }),
      );
    }
    entries.push(item as ManifestEntry);
  }

  return Result.ok(entries);
}
