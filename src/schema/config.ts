/**
 * Minimal M1 config schema and loader.
 *
 * Full 4-layer precedence (flags > project > user > built-in) is M5 (T18).
 * This module covers: project-layer `stet.config.yml` only; missing = Ok({}); malformed or
 * schema-invalid = Err(ConfigError). Unknown top-level keys are silently passed through
 * (forward compat — M5 / T18 turns them into a warning finding).
 *
 * PRD refs: §3.7 (config), §4.9 (schema); plan §M5.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ConfigError } from "../errors.js";
import { Severity } from "./finding.js";

// ---------------------------------------------------------------------------
// Schema (TypeBox)
// ---------------------------------------------------------------------------

/**
 * The M1 config schema.
 *
 * - `phases.<id>` slices stay `unknown` at this seam — each phase validates its own slice.
 * - `output.failOn` is validated here because the CLI reads it before dispatching to phases.
 * - Unknown TOP-LEVEL keys: NOT rejected here.
 *   // M5 (T18) turns unknown top-level keys into a warning finding.
 *   TypeBox additionalProperties:true at the top level is the forward-compat choice: a config
 *   written for a future stet version still loads without error on an older binary.
 */
export const StetConfig = Type.Object(
  {
    /**
     * Per-phase config slices. Keys are phase ids; values are passed through to each phase
     * untyped — each phase validates its own slice (T5 design).
     */
    phases: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** Output settings this binary reads. */
    output: Type.Optional(
      Type.Object(
        {
          /** The severity threshold for gating findings. Overridden by --fail-on flag. */
          failOn: Type.Optional(Severity),
        },
        // M5 (T18) turns unknown output sub-keys into a warning finding.
        { additionalProperties: true },
      ),
    ),
  },
  // M5 (T18) turns unknown top-level keys into a warning finding.
  { additionalProperties: true },
);

export type StetConfig = Static<typeof StetConfig>;

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

const CONFIG_FILE = "stet.config.yml";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load the project config file from `cwd/stet.config.yml`.
 *
 * - Missing file → Ok({}) (zero-config is valid; PRD §3.7 "sparse by design").
 * - Empty file → Ok({}) (empty YAML parses to null; treated as defaults).
 * - Malformed YAML or schema-invalid → Err(ConfigError) carrying path + message.
 * - Unknown top-level keys → passed through silently.
 *   M5 (T18) turns them into a warning finding.
 * - Unknown keys inside `phases.<id>` → each phase's business; not validated here.
 *
 * Never throws.
 */
export async function loadConfig(cwd: string): Promise<Result<StetConfig, ConfigError>> {
  const configPath = join(cwd, CONFIG_FILE);

  // ── Read ──────────────────────────────────────────────────────────────────
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    // ENOENT → missing file is fine (zero-config)
    if (isNodeError(err) && err.code === "ENOENT") {
      return Result.ok({});
    }
    // Other read errors (permissions, etc.) → ConfigError
    const message = err instanceof Error ? err.message : String(err);
    return Result.err(new ConfigError({ path: configPath, message }));
  }

  // ── Parse YAML ───────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return Result.err(new ConfigError({ path: configPath, message }));
  }

  // Empty YAML (null) → treat as {} defaults
  if (parsed === null || parsed === undefined) {
    return Result.ok({});
  }

  // ── Schema validation ─────────────────────────────────────────────────────
  if (!Value.Check(StetConfig, parsed)) {
    const errors = [...Value.Errors(StetConfig, parsed)];
    const firstFew = errors.slice(0, 3);
    const details = firstFew.map((e) => `${e.path || "/"}: ${e.message}`).join("; ");
    return Result.err(
      new ConfigError({
        path: configPath,
        message: `invalid config — ${details}`,
      }),
    );
  }

  return Result.ok(parsed);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
