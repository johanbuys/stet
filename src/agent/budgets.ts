/**
 * Budget enforcement helpers — wall-clock race for the phase wrapper.
 *
 * Budget-enforcement layering (plan §2a/P10):
 * - The phase WRAPPER owns the per-phase wall clock: a race against the runner promise.
 *   On expiry, it aborts via AbortController and reports Err(BudgetError{ limit: "wallClockMs" }).
 * - The runner (PiAgentRunner) owns turns + bash limits, surfacing breaches as Err(BudgetError).
 *   In wrapper tests, a FakeAgentRunner scripted to return Err(BudgetError) exercises this path
 *   without the fake re-implementing enforcement.
 *
 * T12 scope: wall-clock enforcement (runWithWallClock).
 * T13 scope: bash-level limits (bash timeout + output cap) — wired inside PiAgentRunner.
 *
 * PRD refs: §3.5 (budgets), acceptance #7. Plan: M3, §2a/P10.
 */

import { Result } from "better-result";
import { BudgetError } from "../errors.js";
import type { AgentError } from "../errors.js";
import type { AgentRunner, AgentRunInputs, AgentRunSuccess } from "./runner.js";

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
