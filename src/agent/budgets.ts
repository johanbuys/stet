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
 * The exact marker appended when bash output is truncated at the cap (plan §2a, T13).
 * Agents and tests match on this string — never change the text.
 */
export const BASH_TRUNCATION_MARKER = "\n…[stet: output truncated at 32KB]";

export interface RunBashOptions {
  cwd: string;
  /** Kill the process and return output-so-far after this many ms (PRD §3.5). */
  timeoutMs: number;
  /** Truncate output at this many bytes and append BASH_TRUNCATION_MARKER (PRD §3.5). */
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
  /** true when output was capped and BASH_TRUNCATION_MARKER was appended. */
  truncated: boolean;
}

/**
 * Run a shell command with stet's bash safety limits.
 *
 * Timeout: kills the process after timeoutMs; output-so-far is returned to the caller.
 * Output cap: when accumulated bytes exceed outputCap, the process is killed and
 *   BASH_TRUNCATION_MARKER is appended so the agent can see that output was cut.
 *
 * stdout and stderr are merged in arrival order (same as the Pi SDK bash tool).
 * Never rejects — spawn errors resolve with exitCode -1.
 *
 * PRD §3.5, plan §2a/T13.
 */
export function runBash(command: string, options: RunBashOptions): Promise<RunBashResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    let child: ReturnType<typeof spawn>;
    try {
      // detached: true creates a new process group (pgid = child.pid) so we can
      // kill the shell AND any subprocesses it spawns (e.g. `yes`) with one signal.
      child = spawn(command, [], {
        shell: true,
        cwd: options.cwd,
        env: options.env ?? process.env,
        detached: true,
      });
    } catch {
      resolve({ output: "", exitCode: -1, timedOut: false, truncated: false });
      return;
    }

    const kill = () => {
      if (!settled && child.pid !== undefined) {
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

    // An already-aborted signal never fires its "abort" event (standard AbortSignal
    // semantics), so kill eagerly — otherwise an abandoned runner would burn the full
    // timeoutMs instead of dying instantly.
    if (options.signal?.aborted) {
      kill();
    } else {
      options.signal?.addEventListener("abort", kill, { once: true });
    }

    const handleChunk = (chunk: Buffer) => {
      if (truncated) return;
      if (outputBytes + chunk.byteLength > options.outputCap) {
        const remaining = options.outputCap - outputBytes;
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          outputBytes += remaining;
        }
        chunks.push(Buffer.from(BASH_TRUNCATION_MARKER, "utf8"));
        truncated = true;
        kill();
        return;
      }
      chunks.push(chunk);
      outputBytes += chunk.byteLength;
    };

    child.stdout?.on("data", handleChunk);
    child.stderr?.on("data", handleChunk);

    child.on("error", () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
      settled = true;
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: -1,
        timedOut,
        truncated,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", kill);
      settled = true;
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: code,
        timedOut,
        truncated,
      });
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
 *   - Output cap: BASH_TRUNCATION_MARKER already rides inside `output`; delivered via onData.
 *   - Timeout:   throw `timeout:<secs>` → wrapper renders "Command timed out after N seconds".
 *   - Abort:     throw "aborted"        → wrapper renders "Command aborted".
 *   - Otherwise: return { exitCode } (null when killed-on-cap, treated as success by the wrapper —
 *                the marker in the output is the cap's in-band signal).
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

  // External abort wins over the internal timer: the process died because the caller
  // (wall-clock controller) killed it, so surface the SDK-conventional "aborted".
  if (options.signal?.aborted) {
    throw new Error("aborted");
  }
  if (result.timedOut) {
    throw new Error(`timeout:${Math.round(timeoutMs / 1000)}`);
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
