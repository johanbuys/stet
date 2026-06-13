/**
 * Four-layer config loader.
 *
 * Build order (PRD §3.7, plan M5):
 *   built-in defaults
 *   → user config (~/.config/stet/config.yml)
 *   → project config (cwd/stet.config.yml)
 *   → flag override (caller-supplied partial config from parsed flags)
 *
 * Each layer is deep-merged leaf-by-leaf so sibling keys at every depth survive.
 * A missing file is a no-op (not an error). A malformed file → Err(ConfigError).
 * Unknown keys pass through; T18 turns them into warning findings.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ConfigError } from "../errors.js";
import { isFileAbsentError } from "../fs-util.js";
import { HARNESS_PHASE_ID, type Finding } from "../schema/finding.js";
import { collectSchemaErrors } from "../schema/validation.js";
import { BUILT_IN_DEFAULTS, StetConfig } from "./schema.js";
import { deepMerge, isPlainObject } from "./merge.js";

const PROJECT_CONFIG_FILE = "stet.config.yml";
const USER_CONFIG_SUBPATH = join(".config", "stet", "config.yml");

export interface LoadConfigOpts {
  /** Project root — source of `stet.config.yml`. */
  cwd: string;
  /**
   * Home directory — source of the user config layer. Required so hermeticity is
   * structural: the only place that may consult os.homedir() is the CLI entry block.
   */
  homeDir: string;
  /** Flag overlay: a partial config built from parsed CLI flags (highest priority). */
  flagOverride?: StetConfig;
}

/** The successful result of loadConfig — the merged config plus any forward-compat warnings. */
export interface LoadConfigResult {
  config: StetConfig;
  /** harness.unknown-config-key warnings for unknown keys in any config file. */
  findings: Finding[];
}

interface YamlLayerResult {
  data: StetConfig | null;
  findings: Finding[];
}

/**
 * Minimal structural view of a TypeBox object schema, for the unknown-key walk.
 * Schemas without `properties` (Record, Unknown, unions, scalars) end the walk —
 * their contents are validated elsewhere (e.g. each phase validates its own
 * `phases.<id>` slice) or have no sub-keys to check.
 */
interface ObjectishSchema {
  properties?: Record<string, ObjectishSchema>;
}

function unknownKeyFinding(keyPath: string, configPath: string): Finding {
  return {
    id: `${HARNESS_PHASE_ID}.unknown-config-key`,
    phase: HARNESS_PHASE_ID,
    severity: "warning",
    confidence: "high",
    message: `Unknown config key "${keyPath}" in ${configPath} — not recognized, may be misspelled (ignored for forward compatibility).`,
    location: { file: configPath },
  };
}

/**
 * Walk the schema-known object subtree and warn on every key the schema does not
 * name (T18, PRD §3.7: "unknown keys ⇒ warning, not error" — at every depth the
 * schema describes, not just the top level; `output.failOnn` is exactly the typo
 * class this exists to catch). Recursion stops where the schema stops describing
 * keys (`phases.<id>` is a Record — each phase validates its own slice, T18-6).
 */
function unknownKeyFindings(
  data: Record<string, unknown>,
  schema: ObjectishSchema,
  prefix: string,
  configPath: string,
): Finding[] {
  const props = schema.properties;
  if (props === undefined) return [];
  const findings: Finding[] = [];
  for (const [key, value] of Object.entries(data)) {
    // Object.hasOwn, not `in`: inherited keys ("constructor", …) must not count as known.
    if (!Object.hasOwn(props, key)) {
      findings.push(unknownKeyFinding(`${prefix}${key}`, configPath));
    } else if (isPlainObject(value)) {
      findings.push(...unknownKeyFindings(value, props[key]!, `${prefix}${key}.`, configPath));
    }
  }
  return findings;
}

/** Read and validate a YAML config file. Returns null when the file does not exist. */
async function readYamlLayer(configPath: string): Promise<Result<YamlLayerResult, ConfigError>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    // A missing file is a no-op (zero-config is valid; PRD §3.7).
    if (isFileAbsentError(err)) {
      return Result.ok({ data: null, findings: [] });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Result.err(new ConfigError({ path: configPath, message }));
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return Result.err(new ConfigError({ path: configPath, message }));
  }

  if (parsed === null || parsed === undefined) return Result.ok({ data: {}, findings: [] });

  if (!Value.Check(StetConfig, parsed)) {
    const { details } = collectSchemaErrors(StetConfig, parsed);
    return Result.err(
      new ConfigError({ path: configPath, message: `invalid config — ${details}` }),
    );
  }

  // Detect unknown keys in the schema-described subtree — forward-compat warning (T18).
  const findings = unknownKeyFindings(
    parsed as Record<string, unknown>,
    StetConfig as unknown as ObjectishSchema,
    "",
    configPath,
  );

  return Result.ok({ data: parsed, findings });
}

/**
 * Load the merged config from all four layers.
 *
 * - Missing files are silently skipped (zero-config is valid; PRD §3.7).
 * - Malformed YAML in any file → Err(ConfigError) naming the path + line.
 * - Unknown keys → warning findings in the Ok result (never error; PRD §3.7).
 * - Never throws.
 */
export async function loadConfig(
  opts: LoadConfigOpts,
): Promise<Result<LoadConfigResult, ConfigError>> {
  const { cwd, homeDir, flagOverride } = opts;

  const allFindings: Finding[] = [];

  // Layer 1: built-in defaults. Deep copy so the module-level constant's nested
  // objects can never be aliased into a returned config (the spread is shallow).
  let config: StetConfig = structuredClone(BUILT_IN_DEFAULTS);

  // Layer 2: user config
  const userConfigPath = join(homeDir, USER_CONFIG_SUBPATH);
  const userResult = await readYamlLayer(userConfigPath);
  if (userResult.isErr()) return Result.err(userResult.error);
  if (userResult.value.data !== null) config = deepMerge(config, userResult.value.data);
  allFindings.push(...userResult.value.findings);

  // Layer 3: project config
  const projectConfigPath = join(cwd, PROJECT_CONFIG_FILE);
  const projectResult = await readYamlLayer(projectConfigPath);
  if (projectResult.isErr()) return Result.err(projectResult.error);
  if (projectResult.value.data !== null) config = deepMerge(config, projectResult.value.data);
  allFindings.push(...projectResult.value.findings);

  // Layer 4: flag overrides (programmatically constructed — no unknown-key check needed)
  if (flagOverride !== undefined) config = deepMerge(config, flagOverride);

  return Result.ok({ config, findings: allFindings });
}
