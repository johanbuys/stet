/**
 * Budget enforcement helpers — wall-clock race for the phase wrapper and bash-level limits.
 *
 * Budget-enforcement layering (plan §2a/P10):
 * - The phase WRAPPER owns the per-phase wall clock: a race against the runner promise.
 *   On expiry, it aborts via AbortController and reports Err(BudgetError{ limit: "wallClockMs" }).
 * - The runner (PiAgentRunner) owns turns + bash limits, surfacing breaches as Err(BudgetError).
 *   In wrapper tests, a FakeAgentRunner scripted to return Err(BudgetError) exercises this path
 *   without the fake re-implementing enforcement.
 *
 * T12 scope: wall-clock enforcement (runWithWallClock).
 * T13 scope: bash-level limits (bash timeout + output cap) — runBash + Pi SDK wiring.
 *
 * PRD refs: §3.5 (budgets), acceptance #7. Plan: M3, §2a/P10.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { Result } from "better-result";
import { BudgetError } from "../errors.js";
import type { AgentError } from "../errors.js";
import type { AgentRunner, AgentRunInputs, AgentRunSuccess } from "./runner.js";

// ---------------------------------------------------------------------------
// Budget class constants (PRD §3.5, decision #22)
// ---------------------------------------------------------------------------

/** 5-minute budget class — static agent phases (PRD §3.5). */
export const WALL_CLOCK_5MIN_MS = 5 * 60 * 1000;
export const TURNS_5MIN = 50;

/** 15-minute budget class — gate phases and behavioral phases (PRD §3.5). */
export const WALL_CLOCK_15MIN_MS = 15 * 60 * 1000;
export const TURNS_15MIN = 120;

/** Bash tool timeout in milliseconds (PRD §3.5, T13). */
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;

/** Bash output cap in bytes — 32 KiB (PRD §3.5, T13). */
export const DEFAULT_BASH_OUTPUT_CAP = 32 * 1024;

// ---------------------------------------------------------------------------
// Bash-level limits (T13) — timeout + output cap enforced per call
// ---------------------------------------------------------------------------

/**
 * Format a byte count as a human-readable size string used in the truncation marker.
 * 32768 → "32KB", 4096 → "4KB", 50 → "50B".
 *
 * Exported so pi-runner's buildBashToolDescription can format cap sizes consistently
 * with the truncation marker (plan §2a, T13 fix 4).
 */
export function formatCapSize(bytes: number): string {
  if (bytes >= 1024 && bytes % 1024 === 0) {
    return `${bytes / 1024}KB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}

/**
 * Return the exact marker string appended when bash output is truncated at `capBytes`.
 * Agents and tests match on this string — the text must not change for a given cap.
 *
 * Plan §2a, T13 (fix 4): derives the marker from the actual cap in use so commands
 * run with a small cap (e.g. 50 bytes in tests) emit a marker that accurately reflects
 * how many bytes were allowed, not the hardcoded default.
 */
export function truncationMarker(capBytes: number): string {
  return `\n…[stet: output truncated at ${formatCapSize(capBytes)}]`;
}

/**
 * The exact marker appended when bash output is truncated at the default cap (plan §2a, T13).
 * Agents and tests match on this string — never change the text.
 *
 * For non-default caps use `truncationMarker(capBytes)` directly.
 */
export const BASH_TRUNCATION_MARKER = truncationMarker(DEFAULT_BASH_OUTPUT_CAP);

export interface RunBashOptions {
  cwd: string;
  /** Kill the process and return output-so-far after this many ms (PRD §3.5). */
  timeoutMs: number;
  /** Truncate output at this many bytes and append truncationMarker(outputCap) (PRD §3.5). */
  outputCap: number;
  env?: NodeJS.ProcessEnv;
  /** External abort signal — kills the process immediately (used by wall-clock controller). */
  signal?: AbortSignal;
}

export interface RunBashResult {
  /** Accumulated stdout + stderr, possibly truncated. */
  output: string;
  /** Exit code, or null if the process was killed. */
  exitCode: number | null;
  /** true when the process was killed by the timeout timer. */
  timedOut: boolean;
  /** true when output was capped and truncationMarker was appended. */
  truncated: boolean;
  /**
   * true when the process was killed by an external signal NOT attributable to stet's own
   * kills (not timedOut, not truncated/cap, not abort). E.g. OOM, SIGKILL from the OS.
   * runBashForSdk surfaces this in-band so the model can tell it from clean success.
   */
  killedBySignal: boolean;
  /**
   * true when the process was killed because the caller's AbortSignal fired.
   * Set only when stet's abort handler delivered the kill — not when the signal is merely
   * aborted at call time (that path never spawns).
   */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Shell resolution (fix 3) — resolved once at module level.
//
// Prefer /bin/bash, then bash on PATH, fall back to sh.  Mirrors the SDK's
// getShellConfig() logic (utils/shell.js) without importing from the SDK
// (budgets.ts must stay SDK-free per its doc comment — plan §2a/P10).
// ---------------------------------------------------------------------------

function resolveShell(): string {
  if (existsSync("/bin/bash")) return "/bin/bash";
  // Try bash on PATH via a synchronous lookup of common locations.
  // We deliberately avoid spawnSync("which", ...) to keep this pure-sync
  // and free of child processes at module load time.
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    if (dir && existsSync(`${dir}/bash`)) {
      return `${dir}/bash`;
    }
  }
  return "sh";
}

const BASH_SHELL = resolveShell();

/**
 * Run a shell command with stet's bash safety limits.
 *
 * Timeout: kills the process after timeoutMs; output-so-far is returned to the caller.
 * Output cap: when accumulated bytes exceed outputCap, the process is killed and
 *   truncationMarker(outputCap) is appended so the agent can see that output was cut.
 *
 * stdout and stderr are merged in arrival order (same as the Pi SDK bash tool).
 * Never rejects — spawn errors resolve with exitCode -1 and the error message in output.
 *
 * Background children: listens for 'exit' first, then gives stdio a 100ms grace period
 *   for 'close' to arrive; if it doesn't, destroys the streams and resolves with the
 *   real exit code. This prevents a background child holding the inherited pipe from
 *   burning the full timeoutMs (mirrors SDK waitForChildProcess, utils/child-process.js).
 *
 * PRD §3.5, plan §2a/T13.
 */
export function runBash(command: string, options: RunBashOptions): Promise<RunBashResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let aborted = false;
    let settled = false;

    // Short-circuit before spawn when the signal is already aborted (fix 5).
    if (options.signal?.aborted) {
      resolve({
        output: "",
        exitCode: null,
        timedOut: false,
        truncated: false,
        killedBySignal: false,
        aborted: true,
      });
      return;
    }

    // hasExited is hoisted above kill() so the guard in kill() can reference it.
    // Prevents a late timer/abort from SIGKILLing a possibly-reused pgid after
    // the child already exited (plan §2a, T13 fix 2).
    let hasExited = false;

    let child: ReturnType<typeof spawn>;
    try {
      // detached: true creates a new process group (pgid = child.pid) so we can
      // kill the shell AND any subprocesses it spawns (e.g. `yes`) with one signal.
      // shell: BASH_SHELL uses real bash (not /bin/sh / dash) — fix 3.
      child = spawn(command, [], {
        shell: BASH_SHELL,
        cwd: options.cwd,
        env: options.env ?? process.env,
        detached: true,
      });
    } catch (err) {
      // Spawn threw synchronously — very rare but guard it.
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        output: msg,
        exitCode: -1,
        timedOut: false,
        truncated: false,
        killedBySignal: false,
        aborted: false,
      });
      return;
    }

    const kill = () => {
      // Gate on !hasExited in addition to !settled: a late timer or abort listener
      // must not SIGKILL a pgid that may have been reused after the child already exited
      // (plan §2a, T13 fix 2).
      if (!settled && !hasExited && child.pid !== undefined) {
        try {
          // Kill the whole process group so subprocesses can't keep the pipe open.
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Group already gone or PID reused — ignore.
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);

    // The abort listener sets aborted=true then kills — so we can distinguish
    // "stet aborted this" from an external OS kill (fix 1/8).
    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const handleChunk = (chunk: Buffer) => {
      if (truncated) return;
      if (outputBytes + chunk.byteLength > options.outputCap) {
        const remaining = options.outputCap - outputBytes;
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          outputBytes += remaining;
        }
        // Derive the marker from the actual cap in use (fix 4).
        chunks.push(Buffer.from(truncationMarker(options.outputCap), "utf8"));
        truncated = true;
        kill();
        return;
      }
      chunks.push(chunk);
      outputBytes += chunk.byteLength;
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      settled = true;
      // Prepend captured output-so-far so the model sees what ran before the error.
      // Join with "\n" only when there is prior output (avoids a leading blank line).
      // Include the error message so the model has a self-describing failure (fix 3/7).
      const prior = Buffer.concat(chunks).toString("utf8");
      const errText = err.message;
      const output = prior.length > 0 ? `${prior}\n${errText}` : errText;
      resolve({
        output,
        exitCode: -1,
        timedOut,
        truncated,
        killedBySignal: false,
        aborted,
      });
    });

    // ---------------------------------------------------------------------------
    // Background-child hang prevention (fix 2).
    //
    // A command that exits 0 but leaves a background child holding the inherited
    // stdout/stderr pipe never fires 'close'; runBash would burn the full timeoutMs
    // then misreport timedOut.  Mirror the SDK's waitForChildProcess pattern:
    //   - Listen for 'exit' to capture the real exit code.
    //   - Give stdio a short grace period (100ms) for 'close' to arrive.
    //   - If 'close' doesn't arrive, destroy the streams and resolve.
    //
    // The 'close' handler still fires immediately for the normal case (no background
    // children) and resolves first, making the grace-timer a no-op.
    // ---------------------------------------------------------------------------

    const EXIT_STDIO_GRACE_MS = 100;

    let exitedCode: number | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      settled = true;

      // Gate stet-kill attribution on the process actually dying by signal (plan §2a, T13 fix 1).
      //
      // The timedOut/aborted flags can be set by the wall-clock timer or abort listener AFTER
      // the process already exited normally — the exit→close window, widened to 100ms by the
      // grace timer. A completed exitCode-0 command must NOT be reported as "aborted"/"timedOut".
      //
      // SIGKILL is untrappable, so stet's own kills always present signal !== null here.
      // Normal exits have signal === null, making the gate sound.
      const diedBySignal = signal !== null;
      const stetKilled = timedOut || truncated || aborted;
      const killedBySignal = diedBySignal && !stetKilled;

      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: code,
        timedOut: timedOut && diedBySignal,
        truncated,
        killedBySignal,
        aborted: aborted && diedBySignal,
      });
    };

    child.on("exit", (code, signal) => {
      hasExited = true;
      exitedCode = code;
      // Start the grace period; 'close' may fire before it expires (normal case).
      if (!settled) {
        graceTimer = setTimeout(() => {
          // Grace expired — background child is holding the pipe. Destroy streams
          // and resolve with the exit code we already have.
          child.stdout?.destroy();
          child.stderr?.destroy();
          finalize(exitedCode, signal);
        }, EXIT_STDIO_GRACE_MS);
      }
    });

    child.on("close", (code, signal) => {
      if (!hasExited) {
        // 'close' without a prior 'exit' — use the code from 'close' directly.
        finalize(code, signal);
      } else {
        // Normal path: 'exit' fired, grace timer is pending, 'close' arrived in time.
        finalize(exitedCode, signal);
      }
    });
  });
}

/**
 * Structural shape of the options bag the Pi SDK bash wrapper passes to
 * `BashOperations.exec` (see node_modules/.../core/tools/bash.{d.ts,js}).
 * Kept as a local interface so budgets.ts stays free of SDK imports — the
 * enforcement layer must not depend on the wiring layer (plan §2a/P10).
 */
export interface BashExecOptions {
  /** Stream sink for accumulated output. */
  onData: (data: Buffer) => void;
  /** External abort (wall-clock controller). */
  signal?: AbortSignal;
  /** Model-supplied per-call timeout in SECONDS (bash tool schema). */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Adapt runBash to the Pi SDK's `BashOperations.exec` contract, translating
 * stet's limit outcomes into the SDK's in-band conventions so the model can
 * tell "completed quietly" from "killed mid-run" (plan M3: no silent hangs/kills).
 *
 * Mapping (mirrors the SDK's own local ops in core/tools/bash.js):
 *   - Output cap:    truncationMarker already rides inside `output`; delivered via onData.
 *                    return { exitCode: null } — marker is the cap's in-band signal.
 *   - Timeout:       throw `timeout:<secs>` → wrapper renders "Command timed out after N seconds".
 *   - Abort:         throw "aborted"        → wrapper renders "Command aborted".
 *   - External kill: append `\n…[stet: command killed by signal]` via onData, then
 *                    return { exitCode } — same cap-path convention; avoids the SDK's
 *                    raw-rethrow path that would drop the output already delivered (fix 6).
 *   - Otherwise:     return { exitCode } (wrapper renders non-zero as a command failure).
 *
 * Effective timeout = min(model timeout, budget timeout): the budget stays a hard
 * ceiling, but a shorter model-requested timeout is honored (finding: don't ignore it).
 *
 * `onData` is called ONCE with the full accumulated output (runBash buffers internally
 * rather than streaming); harmless headless, and it must precede the throw so the SDK
 * wrapper captures output-so-far before appending the timeout/abort status.
 *
 * PRD §3.5, plan §2a/T13.
 */
export async function runBashForSdk(
  command: string,
  cwd: string,
  options: BashExecOptions,
  budgets: { bashTimeoutMs: number; bashOutputCap: number },
): Promise<{ exitCode: number | null }> {
  // Short-circuit before spawn when the signal is already aborted (fix 5).
  // The SDK's own local ops do the same check before spawning (bash.js).
  if (options.signal?.aborted) {
    throw new Error("aborted");
  }

  const modelTimeoutMs =
    options.timeout !== undefined && options.timeout > 0 ? options.timeout * 1000 : undefined;
  const timeoutMs =
    modelTimeoutMs !== undefined
      ? Math.min(modelTimeoutMs, budgets.bashTimeoutMs)
      : budgets.bashTimeoutMs;

  const result = await runBash(command, {
    cwd,
    timeoutMs,
    outputCap: budgets.bashOutputCap,
    signal: options.signal,
    env: options.env ?? undefined,
  });

  // Deliver output-so-far BEFORE any throw (the SDK wrapper appends status text to it).
  if (result.output) {
    options.onData(Buffer.from(result.output, "utf8"));
  }

  // Branch on result data only — not signal.aborted — to avoid misreporting
  // a completed command as "aborted" if the signal fires in the exit→close window (fix 8).
  if (result.aborted) {
    throw new Error("aborted");
  }
  if (result.timedOut) {
    // Report exact seconds (not Math.round) so sub-second timeouts aren't reported as
    // "0" and so 1500ms → "1.5" not "2" (fix 6).
    throw new Error(`timeout:${timeoutMs / 1000}`);
  }
  if (result.killedBySignal) {
    // Process killed externally (OOM, SIGKILL from OS) — surface in-band so the model
    // sees a descriptive failure without losing the output already delivered (fix 6).
    //
    // The SDK wrapper preserves captured output ONLY for thrown messages equal to "aborted"
    // or starting with "timeout:" — any other throw is rethrown raw and the output is lost.
    // We therefore use the cap-path convention: append a marker and return { exitCode } so
    // the wrapper sees success but the marker is the in-band signal to the model, exactly
    // like the truncation path (plan §2a, T13 fix 6).
    options.onData(Buffer.from("\n…[stet: command killed by signal]", "utf8"));
    return { exitCode: result.exitCode };
  }
  return { exitCode: result.exitCode };
}

/**
 * Race the runner.run() promise against a wall-clock timeout.
 *
 * On timeout (wallClockMs exceeded):
 *   - Calls controller.abort() so the runner can clean up quickly (e.g. FakeAgentRunner's
 *     signal listener fires, PiAgentRunner's session is disposed).
 *   - Returns Err(BudgetError{ limit: "wallClockMs" }).
 *
 * On runner completion before timeout:
 *   - Clears the pending timeout timer (no leaks).
 *   - Returns the runner's result unchanged (Ok or any Err variant).
 *
 * The caller supplies the AbortController so the signal can be passed into inputs.signal.
 * A new AbortController must be created per call — never reuse across runs.
 *
 * Plan §2a/P10: wrapper's half of the budget-enforcement layering.
 */
export async function runWithWallClock(
  runner: AgentRunner,
  inputs: AgentRunInputs,
  controller: AbortController,
): Promise<Result<AgentRunSuccess, AgentError>> {
  const { wallClockMs } = inputs.budgets;

  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<Result<AgentRunSuccess, AgentError>>((resolve) => {
    timerId = setTimeout(() => {
      controller.abort();
      resolve(
        Result.err(
          new BudgetError({
            limit: "wallClockMs",
            message: `wall-clock budget of ${wallClockMs}ms exceeded`,
          }),
        ),
      );
    }, wallClockMs);
  });

  // Pass the wall-clock abort signal so the runner can clean up when the timeout fires.
  const runPromise = runner
    .run({ ...inputs, signal: controller.signal })
    .finally(() => clearTimeout(timerId));

  return Promise.race([runPromise, timeoutPromise]);
}
