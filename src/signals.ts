/**
 * POSIX signal handling — wires SIGINT/SIGTERM into the scheduler's AbortController
 * so in-flight phases cancel and a partial report is written before exit.
 *
 * PRD §3.4.4: SIGINT ⇒ 130, SIGTERM ⇒ 143 (128 + signal number).
 * Exit 2 stays reserved for genuine tool errors.
 *
 * Design:
 * - First SIGINT/SIGTERM: fires the scheduler's AbortController (phases start cancelling);
 *   records which signal was received for exit-code selection.
 * - Second SIGINT: teardown was refused — force-kill via process.exit(130) without waiting
 *   for a report (PRD §3.4.4 "a second Ctrl-C force-kills").
 * - SIGTERM has no second-signal kill (no OS convention for a "second SIGTERM").
 *
 * Escalation rule: force-kill only on a SECOND SIGINT. A first SIGINT after a SIGTERM
 * does NOT escalate — it is idempotent (the signal was already recorded, teardown already
 * started). Only repeat SIGINT (SIGINT → SIGINT) triggers the force-kill path.
 *
 * The partial report is written by main() AFTER runPhases() resolves (all phases return
 * cancelled reports). The signal handler only fires the controller; the report path is
 * unchanged — main() always writes what it has before returning.
 */

/** The POSIX signal that interrupted the run. */
export type ReceivedSignal = "SIGINT" | "SIGTERM";

/** Returned by installSignalHandlers — call cleanup() when the run completes. */
export interface SignalHandlers {
  /** Remove the installed SIGINT/SIGTERM listeners after the run completes. */
  cleanup: () => void;
  /** Returns which POSIX signal was received, or null if run completed normally. */
  getReceived: () => ReceivedSignal | null;
}

/**
 * Install POSIX signal handlers wired to the scheduler's AbortController.
 *
 * Returns a cleanup function (call it after main() returns) and a getter for
 * which signal was received (used by the entry block to choose the exit code).
 */
export function installSignalHandlers(controller: AbortController): SignalHandlers {
  let received: ReceivedSignal | null = null;
  // Track SIGINT count separately — force-kill only on a SECOND SIGINT.
  // A SIGTERM → SIGINT sequence must NOT escalate: the first SIGINT after a SIGTERM
  // is still the first-ever SIGINT, so teardown keeps going and the partial report
  // is written. Only SIGINT → SIGINT (repeat Ctrl-C) triggers process.exit(130).
  let sigintCount = 0;

  const handleSIGINT = () => {
    sigintCount++;
    if (sigintCount > 1) {
      // Second (or later) Ctrl-C: teardown was refused — force-kill (no report written).
      process.exit(130);
    }
    // First SIGINT: record and abort. If a prior signal (e.g. SIGTERM) already fired,
    // first signal wins — do not overwrite received. The abort is a no-op if already aborted.
    if (received === null) {
      received = "SIGINT";
    }
    controller.abort("SIGINT");
  };

  const handleSIGTERM = () => {
    if (received !== null) return; // first signal wins (idempotent)
    received = "SIGTERM";
    controller.abort("SIGTERM");
  };

  process.on("SIGINT", handleSIGINT);
  process.on("SIGTERM", handleSIGTERM);

  return {
    cleanup: () => {
      process.off("SIGINT", handleSIGINT);
      process.off("SIGTERM", handleSIGTERM);
    },
    getReceived: () => received,
  };
}

/**
 * Map a received POSIX signal to its POSIX exit code (128 + signal number).
 * SIGINT (signal 2) ⇒ 130. SIGTERM (signal 15) ⇒ 143.
 */
export function signalExitCode(signal: ReceivedSignal): 130 | 143 {
  return signal === "SIGINT" ? 130 : 143;
}

/** Result of runWithSignals — the value returned by the inner run function plus
 * which signal interrupted the run (null if it completed normally). */
export interface WithSignalsResult<T> {
  result: T;
  received: ReceivedSignal | null;
}

/**
 * Shared signal choreography: install handlers, run an async task wired to the
 * AbortSignal, clean up in a finally regardless of outcome.
 *
 * Owner of: signal installation, cleanup, and the received-signal record.
 * NOT owner of: exit-code policy, Err-surfacing, teardownServices — those live in
 * the CLI entry block (or fixture), which remains the impure decision layer.
 *
 * Usage:
 *   const { result, received } = await runWithSignals(
 *     (signal) => someAsyncWork(signal)
 *   );
 *   // decide exit code from result + received
 *
 * The inner function receives the AbortSignal so it can wire it to the scheduler
 * or any cancellable operation. When a POSIX signal fires, the AbortSignal is
 * aborted and the inner function is expected to resolve (with partial results)
 * rather than reject — consistent with the harness "always write a partial report"
 * contract (PRD §3.4.4).
 */
export async function runWithSignals<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<WithSignalsResult<T>> {
  const controller = new AbortController();
  const { cleanup, getReceived } = installSignalHandlers(controller);
  try {
    const result = await run(controller.signal);
    return { result, received: getReceived() };
  } finally {
    cleanup();
  }
}
