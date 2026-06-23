/**
 * FakeAgentRunner — a scripted AgentRunner for tests.
 *
 * Constructed with a RunScript describing what the runner should emit.
 * No SDK, no API key, no network — pure deterministic behavior.
 * This is the whole point of the AgentRunner seam (plan §2a, decision P1):
 * the guards and wrapper's failure modes become scriptable, not hoped-for.
 *
 * Script shape (T7 scope — extensible toward T8):
 *   { kind: "ok", submission, cost }      → Ok(AgentRunSuccess)
 *   { kind: "err", error }                → Err(AgentError)
 *
 * T8 will extend the script toward multi-step sequences (e.g. invalid-then-valid
 * submissions, never-submit) by replacing the single-step shape with an ordered
 * list of tool-call events. The `kind` discriminant is chosen so that extension
 * is an additive new kind rather than a breaking change to existing scripts.
 *
 * PRD refs: §3.2 (mutation-free); plan §2a M2 step 1, decision P1.
 */

import { Result } from "better-result";
import { CancelledError, NoSubmitError } from "../errors.js";
import type { AgentError } from "../errors.js";
import type { AgentRunInputs, AgentRunSuccess, AgentRunner } from "./runner.js";
import { SUBMIT_TOOL_NAME } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// Script shapes
// ---------------------------------------------------------------------------

/**
 * Script step: the fake immediately returns Ok with the given submission + cost.
 * T8 may extend this with a `toolCalls` list for multi-step sequences.
 */
export interface OkScript {
  kind: "ok";
  /** The submission payload returned as AgentRunSuccess.submission. */
  submission: unknown;
  /** Cost to report alongside the submission. */
  cost: AgentRunSuccess["cost"];
}

/**
 * Script step: the fake immediately returns Err with the given AgentError.
 * Used to test the wrapper's error-mapping and the T8 guards.
 */
export interface ErrScript {
  kind: "err";
  /** The AgentError to return. Covers all four union members for testability. */
  error: AgentError;
}

/**
 * Script step: the fake hangs for delayMs before resolving naturally.
 * Used to test the wrapper's wall-clock race (plan §2a/P10, M3/T12).
 *
 * The fake respects inputs.signal — when it fires (e.g. the wall-clock abort), the fake
 * resolves immediately with Err(CancelledError) so there are no dangling timers in tests.
 * The wall-clock race has already resolved with Err(BudgetError) at that point, so the
 * CancelledError is discarded — it's only for clean teardown.
 *
 * If the delay expires without an abort, the fake resolves with Err(NoSubmitError):
 * the simulated runner hung and never called submit_findings.
 */
export interface DelayScript {
  kind: "delay";
  /** How many milliseconds to wait before resolving naturally (without abort). */
  delayMs: number;
}

/** The script passed to FakeAgentRunner at construction time. */
export type RunScript = OkScript | ErrScript | DelayScript;
// --- Seam for T8 ---
// T8 extends RunScript toward:
//   { kind: "submit-sequence", steps: Array<OkScript | ErrScript | InvalidSubmitStep> }
// where InvalidSubmitStep carries a bad payload that triggers the validate-or-retry guard.
// The FakeAgentRunner constructor then walks the steps list rather than returning immediately.
// The current single-step shape is the degenerate case of a one-step sequence.

// ---------------------------------------------------------------------------
// FakeAgentRunner
// ---------------------------------------------------------------------------

/**
 * FakeAgentRunner — scripted, synchronous-ish (Promise-returning) agent runner.
 *
 * Constructed with a RunScript (repeated on every call) or RunScript[] (queue —
 * each successive run() call dequeues the next script; throws when exhausted).
 * Calls onTool("submit_findings") on the Ok path so callers can track progress.
 *
 * Agent-run contract: run() always resolves — ok/err/delay paths all return a
 * Result and never reject. This mirrors the real AgentRunner contract.
 *
 * Queue exhaustion is the one intentional exception: nextScript() throws
 * synchronously when the queue is over-consumed. This is a test-setup
 * programming error (more run() calls than scripted entries), not a runtime
 * AgentError, so a loud synchronous throw is the right signal.
 */
export class FakeAgentRunner implements AgentRunner {
  private readonly singleScript: RunScript | undefined;
  private readonly queue: RunScript[] | undefined;
  private queueIndex = 0;

  /**
   * @param script
   *   - Single RunScript: the same script is returned on every run() call (backward compat).
   *   - RunScript[]: positional queue — one entry is consumed per run() invocation.
   *
   * Queue contract (important for retrying callers):
   * The queue is consumed strictly per run() call, not per logical operation.
   * A retry issued by the code under test (e.g. agreement-verify re-calling a voter)
   * dequeues the NEXT entry, as does a run() call that loses a wall-clock timeout race
   * (runWithWallClock still invokes runner.run() even when the timer wins).
   * Therefore a queue must contain one script per *expected run() invocation* — including
   * every retry attempt — not one per logical voter or operation. If the queue is shorter
   * than the actual call count, nextScript() will throw to signal the test-setup error.
   */
  constructor(script: RunScript | ReadonlyArray<RunScript>) {
    if (Array.isArray(script)) {
      this.queue = [...(script as RunScript[])];
      this.singleScript = undefined;
    } else {
      this.singleScript = script as RunScript;
      this.queue = undefined;
    }
  }

  /**
   * Returns the next script to execute.
   *
   * For single-script construction: always returns the same script.
   * For queue construction: dequeues the next entry in order.
   *
   * Throws synchronously if the queue is exhausted — this is a test-setup
   * programming error (more run() calls than scripted entries), not a runtime
   * AgentError. See the constructor doc for the one-entry-per-run() contract.
   */
  private nextScript(): RunScript {
    if (this.queue !== undefined) {
      if (this.queueIndex >= this.queue.length) {
        throw new Error(`FakeAgentRunner: script queue exhausted after ${this.queueIndex} call(s)`);
      }
      return this.queue[this.queueIndex++] as RunScript;
    }
    return this.singleScript as RunScript;
  }

  async run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>> {
    const script = this.nextScript();
    const { onTool, signal } = inputs;

    if (script.kind === "ok") {
      // Simulate tool invocation progress for the happy path
      onTool?.(SUBMIT_TOOL_NAME);
      return Result.ok({
        submission: script.submission,
        cost: script.cost,
      });
    }

    if (script.kind === "err") {
      return Result.err(script.error);
    }

    // kind === "delay": hang for delayMs, or abort early if signal fires.
    const { delayMs } = script;
    return new Promise<Result<AgentRunSuccess, AgentError>>((resolve) => {
      let timerId: ReturnType<typeof setTimeout>;

      const onAbort = () => {
        clearTimeout(timerId);
        resolve(
          Result.err(
            new CancelledError({
              message: "aborted by wall-clock budget",
              cost: { durationMs: 0 },
            }),
          ),
        );
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });

      timerId = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        // Delay expired without abort — the simulated runner hung and never submitted.
        resolve(
          Result.err(
            new NoSubmitError({
              message: "hung and never submitted",
              cost: { durationMs: delayMs },
            }),
          ),
        );
      }, delayMs);
    });
  }
}
