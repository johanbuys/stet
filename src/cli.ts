#!/usr/bin/env node

/**
 * stet CLI entry point.
 *
 * Two surfaces:
 *   main(argv, io, phases) — testable core, returns Promise<Result<{exitCode:0|1|2}, StetError>>
 *   process entry — assembles default phases, calls resolveExit(await main(...)) and sets exitCode
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
 *   meta:   --version, --help
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
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { matchError, Result } from "better-result";
import { ConfigError, SchemaError, type StetError } from "./errors.js";
import { loadConfig } from "./config/load.js";
import { BUILT_IN_DEFAULTS, type StetConfig } from "./config/schema.js";
import { HARNESS_PHASE_ID, type Severity } from "./schema/finding.js";
import type { PhaseReport } from "./schema/report.js";
import { parseRunReport, syntheticPhaseReport } from "./schema/report.js";
import { detectScope, getScopeDiff, type ScopeFlags } from "./scope.js";
import { registerDefaultPhases, registeredPhases, registerPhase } from "./phases/index.js";
import type { PhaseConfiguration } from "./phases/types.js";
import { runPhases } from "./scheduler.js";
import { assembleReport } from "./report.js";
import { runWithSignals, signalExitCode } from "./signals.js";
import { teardownServices } from "./teardown.js";
import { buildSpecContext } from "./spec-context.js";
import { filterDiff } from "./diff-filter.js";
import { renderHuman } from "./output/human.js";

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
export function resolveExit(result: Result<{ exitCode: 0 | 1 | 2 }, StetError>): ExitResolution {
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
  /** Home directory — source of the user config layer. Injected so e2e tests stay hermetic. */
  homeDir: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /**
   * Whether to emit ANSI color codes in human output. Defaults to false (no color)
   * when absent. The process entry sets this based on process.stdout.isTTY and NO_COLOR.
   * Tests leave it unset → no color → stable, escape-free assertions.
   */
  color?: boolean;
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
  version: boolean;
  help: boolean;
  /** M8/T23: spec-context file path, "-" for stdin, or inline literal. */
  prd?: string;
  /** M8/T23: spec-context task string to concatenate with --prd. */
  task?: string;
  /** M9/T26: suppress passing phases from human output. */
  quiet: boolean;
  /** M9/T26: display-only severity filter (does not affect exit code). */
  show?: Severity;
}

/** Narrow a raw string to a member of a literal union, or undefined. */
function parseEnum<T extends string>(allowed: readonly T[], raw: string): T | undefined {
  return allowed.find((a) => a === raw);
}

/** Parse a severity-valued flag (--fail-on/--show). Ok(undefined) when absent. */
function parseSeverityFlag(
  flagName: string,
  raw: string | undefined,
): Result<Severity | undefined, ConfigError> {
  if (raw === undefined) return Result.ok(undefined);
  const sev = parseEnum(VALID_FAIL_ON, raw);
  if (sev === undefined) {
    return Result.err(
      new ConfigError({
        path: "<argv>",
        message: `${flagName} must be one of: ${VALID_FAIL_ON.join(", ")} (got: ${raw})`,
      }),
    );
  }
  return Result.ok(sev);
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
        version: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        prd: { type: "string" },
        task: { type: "string" },
        quiet: { type: "boolean", default: false },
        show: { type: "string" },
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

    // Validate --fail-on (default "error" is applied later via BUILT_IN_DEFAULTS,
    // so keep failOn undefined here when the flag is absent).
    const failOnResult = parseSeverityFlag("--fail-on", values["fail-on"]);
    if (failOnResult.isErr()) return Result.err(failOnResult.error);
    const failOn = failOnResult.value;

    // Validate --show
    const showResult = parseSeverityFlag("--show", values["show"]);
    if (showResult.isErr()) return Result.err(showResult.error);
    const show = showResult.value;

    return Result.ok({
      staged: values.staged ?? false,
      working: values.working ?? false,
      against: values.against,
      commit: values.commit,
      commits: values.commits,
      format,
      failOn,
      version: values.version ?? false,
      help: values.help ?? false,
      prd: values.prd,
      task: values.task,
      quiet: values.quiet ?? false,
      show,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Result.err(new ConfigError({ path: "<argv>", message }));
  }
}

// ---------------------------------------------------------------------------
// Flag → config overlay
// ---------------------------------------------------------------------------

/** Build the flag overlay partial config from parsed CLI flags (M5, T17). */
function buildFlagOverride(flags: ParsedFlags): StetConfig {
  const override: StetConfig = {};
  if (flags.failOn !== undefined) {
    override.output = { failOn: flags.failOn };
  }
  return override;
}

// ---------------------------------------------------------------------------
// main — testable core
// ---------------------------------------------------------------------------

/**
 * The testable pipeline core.
 *
 * Accepts a `phases` array directly — main() no longer touches the registry.
 * The process-entry block is the only place defaults are assembled:
 *   registerDefaultPhases(); await main(argv, realIo, registeredPhases())
 * Tests pass [stubDet] explicitly (plan P10 steel-thread mechanism) — this ensures
 * the e2e tests keep passing unchanged when real phases later displace stubs from
 * the default set.
 *
 * Returns Ok({exitCode: 0|1|2}) — the Ok path always has the pipeline's exit code:
 *   0 — clean run (no gating findings)
 *   1 — ≥1 gating finding
 *   2 — interrupted run (signal fired before all phases completed; partial report written)
 * Returns Err(StetError) only when stet itself malfunctioned (config error, scope error,
 * self-check schema error). The caller (entry block) passes this to resolveExit → exit 2.
 *
 * Signal interruption is detected by checking signal?.aborted after runPhases AND
 * whether any phase has status="cancelled". A signal that fires AFTER all phases complete
 * (e.g. during report assembly) does NOT count as an interrupted run — the phases all
 * completed and the derived exit code stands (PRD §3.4.4, finding 2a).
 *
 * JSON mode: EXACTLY the RunReport JSON on io.stdout, nothing else on stdout ever.
 * Human mode: minimal per-phase status lines to io.stdout (M9 does display polish).
 * Progress / chrome: io.stderr at all times.
 */
export async function main(
  argv: string[],
  io: CliIo,
  phases: PhaseConfiguration[],
  signal?: AbortSignal,
): Promise<Result<{ exitCode: 0 | 1 | 2 }, StetError>> {
  // ── 1. Parse flags ────────────────────────────────────────────────────────
  const flagsResult = parseFlags(argv);
  if (flagsResult.isErr()) return Result.err(flagsResult.error);
  const flags = flagsResult.value;

  // ── 2. Handle meta flags FIRST (before any pipeline work) ─────────────────
  // --version wins over --help if both are given (logical: version is cheaper).
  if (flags.version) {
    io.stdout(STET_VERSION);
    return Result.ok({ exitCode: 0 });
  }
  if (flags.help) {
    io.stdout(
      [
        "Usage: stet [flags]",
        "",
        "Scope flags (pick at most one; auto-detects when none given):",
        "  --staged              Analyze staged changes",
        "  --working             Analyze working-tree changes",
        "  --against <ref>       Analyze diff between merge base of <ref> and HEAD",
        "  --commit <sha>        Analyze a single commit",
        "  --commits <range>     Analyze a commit range (e.g. HEAD~3..HEAD)",
        "",
        "Output flags:",
        "  --format <human|json> Output format (default: human)",
        "  --fail-on <error|warning|info>",
        "                        Gate exit code on findings at or above this severity",
        "                        (default: error)",
        "  --quiet               Suppress passing phases and progress; findings only",
        "  --show <error|warning|info>",
        "                        Display findings at or above this severity only",
        "                        (display filter; does not affect exit code)",
        "",
        "Spec context flags:",
        "  --prd <file|-|literal>  Spec / PRD to provide as context (file path, - for stdin, or inline string)",
        "  --task <string>       Task description to concatenate with --prd",
        "",
        "Meta flags:",
        "  --version             Print stet version and exit",
        "  --help                Print this usage block and exit",
      ].join("\n"),
    );
    return Result.ok({ exitCode: 0 });
  }

  // ── 2a. Reject the reserved harness phase id ──────────────────────────────
  // The synthetic config-warning report uses HARNESS_PHASE_ID; a real phase with
  // the same id would put two entries with phase === "harness" in the RunReport,
  // breaking "one entry per configured phase" (PRD §4.5). Embedder misuse → exit 2.
  if (phases.some((p) => p.id === HARNESS_PHASE_ID)) {
    return Result.err(
      new SchemaError({
        message: `phase id "${HARNESS_PHASE_ID}" is reserved for harness-emitted findings and cannot name a real phase`,
        errors: [],
      }),
    );
  }

  // ── 3. Load merged config (all four layers: built-in→user→project→flags) ───
  const flagOverride = buildFlagOverride(flags);
  const configResult = await loadConfig({ cwd: io.cwd, homeDir: io.homeDir, flagOverride });
  if (configResult.isErr()) return Result.err(configResult.error);
  const { config, findings: configFindings } = configResult.value;

  // ── 3b. Build spec context from --prd/--task (M8/T23) ───────────────────
  const specResult = await buildSpecContext({ prd: flags.prd, task: flags.task });
  if (specResult.isErr()) return Result.err(specResult.error);
  const specContext = specResult.value;

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
  const rawScope = scopeResult.value;

  // ── 4b. Semantic diff pre-filtering (M8/T24) ─────────────────────────────
  // Get the raw diff text, strip noise files (lockfiles/minified/sourcemaps/
  // vendored/@generated-except-migrations), and record stripped paths in
  // scope.stripped (#33). The filtered diff flows to phases via the scheduler.
  //
  // getScopeDiff surfaces real git failures as Err(ScopeError) (bad ref, oversize
  // output, corrupt object) instead of silently swallowing them — a swallowed
  // failure would yield a confident "clean" review of an unread diff. On Err we
  // warn visibly on stderr and proceed with "" (NOT fatal): specialists read files
  // directly; the diff only feeds the deterministic risk classifier and the
  // @generated/noise pre-filter, so path-only analysis is a sound degraded mode.
  const diffResult = await getScopeDiff(io.cwd, rawScope);
  const rawDiff = diffResult.isOk() ? diffResult.value : "";
  if (diffResult.isErr()) {
    io.stderr(
      `stet: warning — could not read diff (${diffResult.error.message}); proceeding with path-only analysis`,
    );
  }
  const { filteredFiles, strippedFiles, filteredDiff } = filterDiff(rawScope.files, rawDiff);
  // Hand phases (and through them the risk classifier, PRD #32) the post-filter file
  // list so lockfile/vendored/minified churn never inflates risk or reaches a specialist;
  // `stripped` preserves the removed paths for the report (#33), so files ∪ stripped = original.
  const scope =
    strippedFiles.length > 0
      ? { ...rawScope, files: filteredFiles, stripped: strippedFiles }
      : rawScope;

  // Echo scope to stderr (progress / human chrome — JSON consumers read scope from the report).
  // scope.files is now the post-filter list; the stripped count is reported alongside (PRD #33).
  // --quiet suppresses progress (PRD §3.8): the scope echo is part of the stderr progress
  // stream, so it is skipped when quiet — findings-only output remains on stdout.
  const strippedSuffix = strippedFiles.length > 0 ? `, ${strippedFiles.length} stripped` : "";
  if (!flags.quiet) {
    io.stderr(
      `stet: scope detected — ${scope.kind}${scope.ref ? ` (${scope.ref})` : ""}, ${scope.files.length} file(s)${strippedSuffix}`,
    );
  }

  // ── 5. Run phases ─────────────────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  const runStartMs = Date.now();
  const phaseReports = await runPhases(phases, {
    cwd: io.cwd,
    scope,
    config,
    // Human chrome → stderr so stdout stays exactly the JSON in json mode (PRD §4.8).
    // Format: "stet: <phaseId> · <toolName>" — minimal liveness signal for M2+.
    // M9 polishes the human surface; this wires the plumbing end-to-end.
    // --quiet suppresses progress (PRD §3.8): the per-tool liveness signal is the
    // progress stream, so the callback is omitted entirely when quiet.
    onTool: flags.quiet
      ? undefined
      : (phaseId, toolName) => io.stderr(`stet: ${phaseId} · ${toolName}`),
    // T16: scheduler cancellation signal (SIGINT/SIGTERM → phases cancelled → partial report).
    signal,
    // M8/T23: combined spec text from --prd/--task; absent when no spec flags provided.
    spec: specContext.sources.length > 0 ? specContext.text : undefined,
    // M8/T24: pre-filtered diff for the risk classifier and per-phase budget enforcement.
    diff: filteredDiff.length > 0 ? filteredDiff : undefined,
  });
  const durationMs = Date.now() - runStartMs;

  // ── 6. Detect interruption ────────────────────────────────────────────────
  // A run is "interrupted" iff the signal was aborted AND at least one phase was
  // cancelled. A signal that fires AFTER all phases complete does not interrupt
  // the run — the derived exit code stands (PRD §3.4.4, finding 2a).
  const interrupted =
    signal?.aborted === true && phaseReports.some((p) => p.status === "cancelled");

  // ── 7. Assemble report ────────────────────────────────────────────────────
  // flags.failOn is already merged into config via flagOverride (M5), so failOn is
  // always present after loadConfig; the fallback only restates the built-in layer
  // for the type system and can never change the value (single source of truth).
  const failOn = config.output?.failOn ?? BUILT_IN_DEFAULTS.output.failOn;

  // Inject a synthetic "harness" phase report for config-load warnings (T18, PRD §3.7).
  // Only present when there are findings to surface; omitted when the config is clean.
  const harnessPhaseReport: PhaseReport | undefined =
    configFindings.length > 0
      ? syntheticPhaseReport(HARNESS_PHASE_ID, "completed", { findings: configFindings })
      : undefined;

  const { report, exitCode } = assembleReport({
    stetVersion: STET_VERSION,
    startedAt,
    scope,
    phases: harnessPhaseReport !== undefined ? [harnessPhaseReport, ...phaseReports] : phaseReports,
    failOn,
    durationMs,
    interrupted,
    // M8/T23: wire spec sources into the run report.
    spec:
      specContext.sources.length > 0
        ? { provided: true, sources: specContext.sources }
        : { provided: false, sources: [] },
  });

  // ── 8. Self-check: the report we produce must be valid (stet bug if not) ──
  // An invalid self-produced report is a stet bug → SchemaError → exit 2.
  // "Nothing passes silently" applies to stet itself (plan §2a).
  const selfCheck = parseRunReport(report);
  if (selfCheck.isErr()) return Result.err(selfCheck.error);

  // ── 9. Output ─────────────────────────────────────────────────────────────
  if (flags.format === "json") {
    // EXACTLY the RunReport JSON on stdout. Nothing else on stdout ever (PRD §4.8).
    io.stdout(JSON.stringify(report, null, 2));
  } else {
    // Human mode — grouped findings, severity-colored, file:line located, cost footer.
    // M9/T25/T26. Color disabled by default; the process entry enables it on real TTYs.
    io.stdout(
      renderHuman(report, { color: io.color ?? false, quiet: flags.quiet, show: flags.show }),
    );
  }

  return Result.ok({ exitCode });
}

// ── process boundary ──────────────────────────────────────────────────────────
// Only executed when this module is the entry point. The pure resolveExit above
// is imported by tests; this thin wrapper owns the actual side effects.

/**
 * Guard the entry-point check against ENOENT and other fs errors.
 *
 * `realpathSync(process.argv[1])` throws if argv[1] is set but doesn't exist on disk
 * (SEA/virtual entries, deleted shims). An uncaught throw here would be OUTSIDE the
 * single throw→exit boundary, causing Node to exit 1 (which the exit-code contract
 * defines as "gating findings"). The guard catches any throw and returns false so the
 * entry block is skipped rather than crashing. Not unit-testable from inside the module
 * (module-top-level execution; the guard is the fix).
 */
function computeIsEntryPoint(): boolean {
  try {
    return (
      process.argv[1] !== undefined &&
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

const isEntryPoint = computeIsEntryPoint();

if (isEntryPoint) {
  const realIo: CliIo = {
    cwd: process.cwd(),
    homeDir: homedir(),
    stdout: (line) => process.stdout.write(line + "\n"),
    stderr: (line) => process.stderr.write(line + "\n"),
    // Color on when stdout is a real TTY and NO_COLOR is not set (no-color.org spec).
    color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
  };

  // Assemble the default phase set here — the only place defaults live.
  // main() receives phases as a parameter and never touches the registry itself.
  registerDefaultPhases();

  // T16: install POSIX signal handlers before any async work so a signal that fires
  // during SDK loading or scope detection still fires the controller. The scheduler
  // receives the combined signal via main()'s signal parameter; when it fires,
  // in-flight phases cancel and return "cancelled" reports, and main() writes the
  // partial report normally before returning.
  //
  // runWithSignals installs the handlers, runs the async block, and cleans up in a
  // finally — the CLI entry block only owns exit-code policy, Err-surfacing, and
  // teardownServices (the impure decision layer, per finding 5).

  // Unreachable by design (Result discipline means nothing escapes main()) —
  // this boundary enforces the honesty contract anyway: if something ever throws,
  // it is a stet internal bug → exit 2, not exit 1 (which means "gating findings").
  try {
    // Skip the Pi SDK load entirely for meta-only invocations — --version and --help
    // return before running any phases, so paying ~0.5 s of SDK module-load is wasteful.
    // Any SDK load failure for non-meta invocations surfaces as exit 2 (a stet malfunction)
    // rather than escaping to Node's uncaught-exception handler (which exits 1).
    // Deterministic-only optimisation (activating the SDK only when agent phases are
    // needed) is a deeper change; a comment here is enough for now.
    if (!process.argv.includes("--version") && !process.argv.includes("--help")) {
      // Lazy-load the agent runner so the Pi SDK is only paid for when an agent phase
      // is actually registered, and so any SDK load failure surfaces as exit 2 (a stet
      // malfunction) rather than escaping to Node's exit 1.
      const { PiAgentRunner } = await import("./agent/pi-runner.js");
      const { makeStubAgent } = await import("./phases/stub-agent.js");
      const { makeReviewPhase, makeReviewRunners } = await import("./phases/review/review.js");
      // Pre-M6 model stopgap (plan §2a/P10): agent phases resolve their model from
      // PI_TEST_MODEL until M6 routing exists. Unset ⇒ stub-agent reports "no model
      // available" (PiAgentRunner Part B); review phase fires the creds gate (AC#8 /
      // plan M4 step 5 F3) and reports status "error" / "no model available" instead
      // of completed+empty. Done in the entry block (the impure wiring layer) so module
      // import stays side-effect-free and defaultPhases stays a static [stubDet].
      const piModel = process.env.PI_TEST_MODEL;
      registerPhase(makeStubAgent(new PiAgentRunner(), piModel));
      // Review phase (M5 full panel — bugs/security/quality/coverage-gaps + 3-voter verify).
      // makeReviewRunners builds one PiAgentRunner per panel specialist (looked up by name
      // in the composite) plus "verify", derived from REVIEW_SPECIALISTS so the map can't
      // drift from the panel. makeReviewPhase gates on piModel — when undefined the phase
      // immediately reports status "error", never completed+empty (AC#8).
      registerPhase(
        makeReviewPhase(
          makeReviewRunners(() => new PiAgentRunner()),
          piModel,
        ),
      );
    }

    const { result, received } = await runWithSignals((signal) =>
      main(process.argv.slice(2), realIo, registeredPhases(), signal),
    );

    // Finding 4 (teardown seam): teardownServices is called in every exit path via
    // the runWithSignals/try structure. cleanupSignals is handled inside runWithSignals.
    teardownServices();

    // Finding 1 (Err not swallowed on signal): resolveExit ALWAYS runs — an Err result
    // (e.g. ScopeError during loadConfig when Ctrl-C fires early) is never silently
    // discarded in favour of the signal exit code. If main() returns Err, it surfaces
    // via resolveExit → stderr message + exit 2, regardless of received signal.
    //
    // Finding 2 (report/process exit-code agreement):
    //   - For interrupted runs (main() returns Ok({exitCode:2})), the process also exits
    //     with the POSIX signal code (130/143) — both indicate "non-normal termination".
    //   - For fully-completed runs (no cancelled phases, main() returns Ok({exitCode:0|1})),
    //     the process uses the derived exit code — the signal fired too late to matter.
    //   - For Err results, resolveExit always produces exit 2 regardless of the signal.
    //
    //   Detection: the signal exit code applies only to Ok({exitCode:2}) — an interrupted
    //   run. resolveExit also yields 2 for Err, so gate on result.isOk() to keep the
    //   Err→exit-2 boundary contract intact even when a signal was received.
    const { exitCode, stderr } = resolveExit(result);
    if (stderr !== undefined) {
      process.stderr.write(stderr + "\n");
    }

    if (received !== null && result.isOk() && result.value.exitCode === 2) {
      // Interrupted run: apply the POSIX signal exit code (130 or 143).
      // Both process exit code and report.result.exitCode=2 signal non-normal termination.
      process.exitCode = signalExitCode(received);
    } else {
      // Normal completion (exitCode 0 or 1) OR Err path (exitCode 2 from resolveExit).
      // Use process.exitCode rather than process.exit() so that Node waits for all
      // streams (stdout, stderr) to flush before tearing down. process.exit() returns
      // immediately and can truncate output when stdout is piped — exactly how
      // --format json consumers and loops receive the RunReport.
      process.exitCode = exitCode;
    }
  } catch (err) {
    // Finding 4 (teardown seam): teardownServices runs here too via the catch path.
    // This mirrors the success path — both paths call teardownServices before exiting.
    // Note: cleanupSignals is guaranteed by runWithSignals' finally block, so we
    // do not need to call it here even if runWithSignals itself threw (which it
    // shouldn't since it only throws if the inner function throws and we don't catch it
    // here — but teardownServices is the important idempotent seam).
    teardownServices();
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`stet: internal error — ${message}\n`);
    process.exitCode = 2;
  }
}
