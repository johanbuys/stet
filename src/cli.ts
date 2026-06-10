#!/usr/bin/env node

/**
 * stet CLI entry point.
 *
 * Two surfaces:
 *   main(argv, io) — testable core, returns Promise<Result<{exitCode:0|1}, StetError>>
 *   process entry — calls resolveExit(await main(...)) and process.exit
 *
 * resolveExit is the SINGLE throw→exit boundary (PRD CLAUDE.md / plan §2a / plan P7).
 * Unknown flag parsing uses ConfigError — it is a user-supplied configuration error
 * (bad CLI input), not a scope detection failure, routing failure, or runtime schema
 * violation. ConfigError's { path, message } shape is used with path = "<argv>" as the
 * pseudo-path for a non-file config source.
 *
 * Flag parsing: node:util parseArgs — no new dependencies.
 * Flags implemented (PRD §4.7, M1 slice):
 *   scope: --staged, --working, --against <ref>, --commit <sha>, --commits <range>
 *   output: --format <human|json>  (default: human)
 *   gating: --fail-on <error|warning|info>  (default: error)
 *
 * M5 adds: user-layer config, full 4-layer precedence.
 * M8 adds: --prd, --task, --issue, --auto-context.
 * M9 adds: --quiet, --show, display polish.
 * M4 adds: --continue-on-failure.
 * M6 adds: --model, --budget.
 *
 * PRD refs: §4.7 (flags), §4.8 (output + exit codes), §3.7 (precedence).
 */

import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { matchError, Result } from "better-result";
import { ConfigError, type StetError } from "./errors.js";
import { loadConfig } from "./schema/config.js";
import type { Severity } from "./schema/finding.js";
import { parseRunReport } from "./schema/report.js";
import { detectScope, type ScopeFlags } from "./scope.js";
import { registerDefaultPhases, registeredPhases } from "./phases/index.js";
import { runPhases } from "./scheduler.js";
import { assembleReport } from "./report.js";

// ---------------------------------------------------------------------------
// Package version
// ---------------------------------------------------------------------------

// Bundler inlines package.json at build time; createRequire handles dev/test.
function readStetVersion(): string {
  try {
    const pkg: unknown = createRequire(import.meta.url)("../package.json");
    if (
      typeof pkg === "object" &&
      pkg !== null &&
      "version" in pkg &&
      typeof pkg.version === "string"
    ) {
      return pkg.version;
    }
  } catch {
    /* fall through */
  }
  return "0.0.0";
}
const STET_VERSION = readStetVersion();

// ---------------------------------------------------------------------------
// Exit resolution (the single Err→exit-2 boundary)
// ---------------------------------------------------------------------------

/** Shape returned by the CLI's exit-resolution function. */
export interface ExitResolution {
  exitCode: number;
  /** Human message for stderr; absent on Ok paths. */
  stderr?: string;
}

/**
 * Pure function: maps a Result from the run pipeline to an exit code + optional stderr message.
 *
 * This is the single exhaustive match over the StetError union. Adding a new variant
 * to StetError is a compile error here until a handler is added.
 *
 * Exit-code contract (PRD §4.8):
 *   0  — clean at threshold
 *   1  — ≥1 gating finding
 *   2  — stet malfunctioned (all taxonomy errors in M1)
 */
export function resolveExit(result: Result<{ exitCode: 0 | 1 }, StetError>): ExitResolution {
  if (result.isOk()) {
    return { exitCode: result.value.exitCode };
  }

  const stderr: string = matchError(result.error, {
    ScopeError: (e) => `stet: scope error — ${e.message}`,
    ConfigError: (e) => `stet: config error in ${e.path} — ${e.message}`,
    RoutingError: (e) =>
      e.tier !== undefined
        ? `stet: routing error (tier: ${e.tier}) — ${e.message}`
        : `stet: routing error — ${e.message}`,
    BudgetError: (e) => `stet: budget exceeded (limit: ${e.limit}) — ${e.message}`,
    SchemaError: (e) => `stet: schema validation error — ${e.message}`,
  });

  return { exitCode: 2, stderr };
}

// ---------------------------------------------------------------------------
// I/O abstraction (injectable for tests)
// ---------------------------------------------------------------------------

export interface CliIo {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

const VALID_FORMATS = ["human", "json"] as const;
type Format = (typeof VALID_FORMATS)[number];

const VALID_FAIL_ON = ["error", "warning", "info"] as const;

interface ParsedFlags {
  staged: boolean;
  working: boolean;
  against?: string;
  commit?: string;
  commits?: string;
  format: Format;
  failOn?: Severity;
}

/** Narrow a raw string to a member of a literal union, or undefined. */
function parseEnum<T extends string>(allowed: readonly T[], raw: string): T | undefined {
  return allowed.find((a) => a === raw);
}

/**
 * Parse argv using node:util parseArgs.
 * Unknown flags or invalid enum values → Err(ConfigError) with path "<argv>".
 *
 * ConfigError chosen for unknown/invalid flags because invalid CLI input is a
 * user-configuration error — the same taxonomy as an invalid config file.
 * ScopeError would be wrong (scope hasn't been detected yet).
 * SchemaError is for runtime contract violations, not CLI input.
 */
function parseFlags(argv: string[]): Result<ParsedFlags, ConfigError> {
  try {
    const { values } = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true, // unknown flags throw
      options: {
        staged: { type: "boolean", default: false },
        working: { type: "boolean", default: false },
        against: { type: "string" },
        commit: { type: "string" },
        commits: { type: "string" },
        format: { type: "string", default: "human" },
        "fail-on": { type: "string" },
      },
    });

    // Validate --format
    const formatRaw = values.format ?? "human";
    const format = parseEnum(VALID_FORMATS, formatRaw);
    if (format === undefined) {
      return Result.err(
        new ConfigError({
          path: "<argv>",
          message: `--format must be one of: ${VALID_FORMATS.join(", ")} (got: ${formatRaw})`,
        }),
      );
    }

    // Validate --fail-on
    const failOnRaw = values["fail-on"];
    let failOn: Severity | undefined;
    if (failOnRaw !== undefined) {
      failOn = parseEnum(VALID_FAIL_ON, failOnRaw);
      if (failOn === undefined) {
        return Result.err(
          new ConfigError({
            path: "<argv>",
            message: `--fail-on must be one of: ${VALID_FAIL_ON.join(", ")} (got: ${failOnRaw})`,
          }),
        );
      }
    }

    return Result.ok({
      staged: values.staged ?? false,
      working: values.working ?? false,
      against: values.against,
      commit: values.commit,
      commits: values.commits,
      format,
      failOn,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Result.err(new ConfigError({ path: "<argv>", message }));
  }
}

// ---------------------------------------------------------------------------
// failOn precedence helper
// ---------------------------------------------------------------------------

/**
 * Resolve the effective failOn.
 * Precedence (M1 slice of PRD §3.7): flag > project config output.failOn > default "error".
 * Full 4-layer merge (including user-layer config) is M5 (T18).
 */
function resolveFailOn(
  flagFailOn: Severity | undefined,
  configFailOn: Severity | undefined,
): Severity {
  return flagFailOn ?? configFailOn ?? "error";
}

// ---------------------------------------------------------------------------
// main — testable core
// ---------------------------------------------------------------------------

/**
 * The testable pipeline core.
 *
 * Returns Ok({exitCode: 0|1}) — the Ok path always has the pipeline's exit code.
 * Returns Err(StetError) only when stet itself malfunctioned (config error, scope error,
 * self-check schema error). The caller (entry block) passes this to resolveExit → exit 2.
 *
 * JSON mode: EXACTLY the RunReport JSON on io.stdout, nothing else on stdout ever.
 * Human mode: minimal per-phase status lines to io.stdout (M9 does display polish).
 * Progress / chrome: io.stderr at all times.
 *
 * registerDefaultPhases() is called here — safe to call multiple times (idempotent:
 * duplicate-id registration replaces in-place, per the registry design).
 */
export async function main(
  argv: string[],
  io: CliIo,
): Promise<Result<{ exitCode: 0 | 1 }, StetError>> {
  // ── 1. Register default phases (idempotent) ──────────────────────────────
  registerDefaultPhases();

  // ── 2. Parse flags ────────────────────────────────────────────────────────
  const flagsResult = parseFlags(argv);
  if (flagsResult.isErr()) return Result.err(flagsResult.error);
  const flags = flagsResult.value;

  // ── 3. Load project config ────────────────────────────────────────────────
  const configResult = await loadConfig(io.cwd);
  if (configResult.isErr()) return Result.err(configResult.error);
  const config = configResult.value;

  // ── 4. Detect scope ───────────────────────────────────────────────────────
  const scopeFlags: ScopeFlags = {
    staged: flags.staged || undefined,
    working: flags.working || undefined,
    against: flags.against,
    commit: flags.commit,
    commits: flags.commits,
  };
  const scopeResult = await detectScope(io.cwd, scopeFlags);
  if (scopeResult.isErr()) return Result.err(scopeResult.error);
  const scope = scopeResult.value;

  // Echo scope to stderr (progress / human chrome — JSON consumers read scope from the report)
  io.stderr(
    `stet: scope detected — ${scope.kind}${scope.ref ? ` (${scope.ref})` : ""}, ${scope.files.length} file(s)`,
  );

  // ── 5. Run phases ─────────────────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  const phaseReports = await runPhases(registeredPhases(), {
    cwd: io.cwd,
    scope,
    config,
  });

  // ── 6. Assemble report ────────────────────────────────────────────────────
  const failOn = resolveFailOn(flags.failOn, config.output?.failOn);
  const { report, exitCode } = assembleReport({
    stetVersion: STET_VERSION,
    startedAt,
    scope,
    phases: phaseReports,
    failOn,
  });

  // ── 7. Self-check: the report we produce must be valid (stet bug if not) ──
  // An invalid self-produced report is a stet bug → SchemaError → exit 2.
  // "Nothing passes silently" applies to stet itself (plan §2a).
  const selfCheck = parseRunReport(report);
  if (selfCheck.isErr()) return Result.err(selfCheck.error);

  // ── 8. Output ─────────────────────────────────────────────────────────────
  if (flags.format === "json") {
    // EXACTLY the RunReport JSON on stdout. Nothing else on stdout ever (PRD §4.8).
    io.stdout(JSON.stringify(report, null, 2));
  } else {
    // Human mode — M9 polishes this; for M1 we emit honest-minimal output.
    for (const phase of report.phases) {
      const findingCount = phase.findings.length;
      const findingSummary =
        findingCount === 0
          ? "no findings"
          : `${findingCount} finding${findingCount === 1 ? "" : "s"}`;
      const reasonSuffix = phase.reason !== undefined ? ` (${phase.reason})` : "";
      io.stdout(`  ${phase.phase}: ${phase.status}${reasonSuffix} — ${findingSummary}`);
    }
    const exitLabel = exitCode === 0 ? "ok" : "findings gate";
    io.stdout(`\nresult: exit ${exitCode} (${exitLabel}), failOn: ${report.result.failOn}`);
  }

  return Result.ok({ exitCode });
}

// ── process boundary ──────────────────────────────────────────────────────────
// Only executed when this module is the entry point. The pure resolveExit above
// is imported by tests; this thin wrapper owns the actual side effects.

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
  const realIo: CliIo = {
    cwd: process.cwd(),
    stdout: (line) => process.stdout.write(line + "\n"),
    stderr: (line) => process.stderr.write(line + "\n"),
  };

  const result = await main(process.argv.slice(2), realIo);
  const { exitCode, stderr } = resolveExit(result);
  if (stderr !== undefined) {
    process.stderr.write(stderr + "\n");
  }
  // Use process.exitCode rather than process.exit() so that Node waits for all
  // streams (stdout, stderr) to flush before tearing down. process.exit() returns
  // immediately and can truncate output when stdout is piped — exactly how
  // --format json consumers and loops receive the RunReport.
  process.exitCode = exitCode;
}
