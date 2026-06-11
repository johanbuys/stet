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
 */

import { installSignalHandlers, signalExitCode } from "../../src/signals.js";
import { runPhases } from "../../src/scheduler.js";
import { makeAgentPhase } from "../../src/phases/agent-phase.js";
import { FakeAgentRunner } from "../../src/agent/fake-runner.js";
import { SUBMIT_SCHEMA, DEFAULT_BUDGETS } from "../../src/test-support/agent-fixtures.js";
import type { StetConfig } from "../../src/schema/config.js";

function makeSlowPhase(id: string) {
  return makeAgentPhase(new FakeAgentRunner({ kind: "delay", delayMs: 30_000 }), {
    id,
    rubric: "rubric",
    toolset: ["bash"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: { ...DEFAULT_BUDGETS, wallClockMs: 60_000 },
    buildUserPrompt: () => "prompt",
  });
}

const controller = new AbortController();
const { cleanup, getReceived } = installSignalHandlers(controller);

// Notify the test that the fixture is ready to receive signals.
process.stdout.write("READY\n");

const reports = await runPhases([makeSlowPhase("phase-a"), makeSlowPhase("phase-b")], {
  cwd: process.cwd(),
  scope: { kind: "staged", files: [] },
  config: {} as StetConfig,
  signal: controller.signal,
});

// Write partial report as a single JSON line.
process.stdout.write(JSON.stringify({ phases: reports }) + "\n");

cleanup();
const received = getReceived();
process.exitCode = received !== null ? signalExitCode(received) : 0;
