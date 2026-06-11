/// <reference types="node" />
/**
 * Signal integration test fixture — spawned as a child process by src/signals.test.ts.
 *
 * Runs two slow fake agent phases (30s delay) with signal handlers installed and the
 * scheduler's AbortSignal wired. When SIGINT or SIGTERM fires:
 *   1. The scheduler's combined signal aborts → FakeAgentRunner(delay) cancels immediately.
 *   2. runPhases resolves with two "cancelled" PhaseReports.
 *   3. Partial JSON report is written to stdout.
 *   4. Process exits 130 (SIGINT) or 143 (SIGTERM).
 *
 * stdout protocol:
 *   Line 1 : "READY\n"   — test may now send the signal
 *   Line 2 : JSON string — { phases: PhaseReport[] }
 *
 * Signal choreography is owned by runWithSignals (src/signals.ts) — this fixture
 * is a thin caller, not a reimplementation.
 *
 * IMPORTANT: "READY" is written INSIDE the runWithSignals callback, after signal
 * handlers are installed but before runPhases is called. This ensures the handlers
 * are active before the test sends a signal.
 */

import { runWithSignals, signalExitCode } from "../../src/signals.js";
import { runPhases } from "../../src/scheduler.js";
import { makeDelayAgentPhase } from "../../src/test-support/agent-fixtures.js";
import type { StetConfig } from "../../src/schema/config.js";

function makeSlowPhase(id: string) {
  return makeDelayAgentPhase(id, 30_000);
}

const { result: reports, received } = await runWithSignals((signal) => {
  // Notify the test that signal handlers are installed and we're ready for a signal.
  // This is written AFTER installSignalHandlers runs (inside runWithSignals) so the
  // handlers are guaranteed to be active when the test calls proc.kill().
  process.stdout.write("READY\n");

  return runPhases([makeSlowPhase("phase-a"), makeSlowPhase("phase-b")], {
    cwd: process.cwd(),
    scope: { kind: "staged", files: [] },
    config: {} as StetConfig,
    signal,
  });
});

// Write partial report as a single JSON line.
process.stdout.write(JSON.stringify({ phases: reports }) + "\n");

process.exitCode = received !== null ? signalExitCode(received) : 0;
