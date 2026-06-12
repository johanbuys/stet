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

import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import { Result } from "better-result";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { ConfigError } from "../errors.js";
import type { Finding } from "../schema/finding.js";
import { BUILT_IN_DEFAULTS, StetConfig, type StetConfig as StetConfigType } from "./schema.js";
import { deepMerge } from "./merge.js";

const PROJECT_CONFIG_FILE = "stet.config.yml";
const USER_CONFIG_SUBPATH = join(".config", "stet", "config.yml");

// Keys known at the top level of StetConfig; anything else is unknown (forward-compat warning).
const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(StetConfig.properties));

export interface LoadConfigOpts {
  /** Project root — source of `stet.config.yml`. */
  cwd: string;
  /** Home directory for user config. Defaults to `os.homedir()`. Injected in tests. */
  homeDir?: string;
  /** Flag overlay: a partial config built from parsed CLI flags (highest priority). */
  flagOverride?: StetConfigType;
}

/** The successful result of loadConfig — the merged config plus any forward-compat warnings. */
export interface LoadConfigResult {
  config: StetConfigType;
  /** harness.unknown-config-key warnings for unknown top-level keys in any config file. */
  findings: Finding[];
}

interface YamlLayerResult {
  data: StetConfigType | null;
  findings: Finding[];
}

/** Read and validate a YAML config file. Returns null when the file does not exist. */
async function readYamlLayer(configPath: string): Promise<Result<YamlLayerResult, ConfigError>> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return Result.ok({ data: null, findings: [] });
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
    const errors = [...Value.Errors(StetConfig, parsed)];
    const details = errors
      .slice(0, 3)
      .map((e) => `${e.path || "/"}: ${e.message}`)
      .join("; ");
    return Result.err(
      new ConfigError({ path: configPath, message: `invalid config — ${details}` }),
    );
  }

  // Detect unknown top-level keys — forward-compat warning (T18, PRD §3.7).
  const findings: Finding[] = [];
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      findings.push({
        id: "harness.unknown-config-key",
        phase: "harness",
        severity: "warning",
        confidence: "high",
        message: `Unknown config key "${key}" in ${configPath} — not recognized, may be misspelled (ignored for forward compatibility).`,
        location: { file: configPath },
      });
    }
  }

  return Result.ok({ data: parsed, findings });
}

/**
 * Load the merged config from all four layers.
 *
 * - Missing files are silently skipped (zero-config is valid; PRD §3.7).
 * - Malformed YAML in any file → Err(ConfigError) naming the path + line.
 * - Unknown top-level keys → warning findings in the Ok result (never error; PRD §3.7).
 * - Never throws.
 */
export async function loadConfig(
  opts: LoadConfigOpts,
): Promise<Result<LoadConfigResult, ConfigError>> {
  const { cwd, homeDir = osHomedir(), flagOverride } = opts;

  const allFindings: Finding[] = [];

  // Layer 1: built-in defaults. Deep copy so the module-level constant's nested
  // objects can never be aliased into a returned config (the spread is shallow).
  let config: StetConfigType = structuredClone(BUILT_IN_DEFAULTS);

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

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
