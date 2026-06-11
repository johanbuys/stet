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

    options.signal?.addEventListener("abort", kill, { once: true });

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
