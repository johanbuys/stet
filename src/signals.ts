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
  let teardownStarted = false;

  const handleSIGINT = () => {
    if (teardownStarted) {
      // Second Ctrl-C: teardown was refused — force-kill (no report written).
      process.exit(130);
    }
    teardownStarted = true;
    received = "SIGINT";
    controller.abort("SIGINT");
  };

  const handleSIGTERM = () => {
    if (teardownStarted) return; // first signal wins
    teardownStarted = true;
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
