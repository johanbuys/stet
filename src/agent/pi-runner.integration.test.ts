/**
 * PiAgentRunner integration tests — the steel-thread suite for M2 (T11).
 *
 * Three legs:
 *   1. Fake-driven (always runs): FakeAgentRunner + explicit registration → RunReport with
 *      both phases, stub-det completed + stub-agent completed with two TODO findings. Proves
 *      the steel thread in-process without any network or API key.
 *   2. No-model stopgap (always runs, hermetic): PiAgentRunner with undefined model →
 *      stub-agent PhaseReport status "error" mentioning "no model", stub-det still completed.
 *      Proves the §2a "deterministic half still runs" guarantee.
 *   3. Keyed real round-trip (skips without PI_TEST_MODEL): PiAgentRunner with a real model →
 *      RunReport validates, both phases present, stub-agent completed (model found the TODOs).
 *
 * Registration discipline (plan §2, P10): NEVER rely on the default set; always call
 * resetRegistry() and register explicitly. main() receives registeredPhases() as a parameter.
 *
 * PRD refs: §3.2 (mutation-free), §3.9 (stub phases), §4.5 (RunReport), acceptance #17 (steel thread).
 * Plan refs: §2a M2 T11, decisions P1/P10.
 */

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliIo } from "../cli.js";
import { parseRunReport } from "../schema/report.js";
import { resetRegistry, registeredPhases, registerPhase } from "../phases/index.js";
import { stubDet } from "../phases/stub-det.js";
import { makeStubAgent } from "../phases/stub-agent.js";
import { FakeAgentRunner } from "./fake-runner.js";
import { PiAgentRunner } from "./pi-runner.js";
import { setupStubRepo } from "../test-support/stub-repo.js";

// ---------------------------------------------------------------------------
// I/O capture helper
// ---------------------------------------------------------------------------

function makeIo(cwd: string): { io: CliIo; stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io: CliIo = {
    cwd,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
  return { io, stdoutLines, stderrLines };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PiAgentRunner integration — M2 steel thread (T11)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "stet-pi-integration-"));
    resetRegistry();
    await setupStubRepo(tmpDir, "pass");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Leg 1: fake-driven — always runs, no key needed ──────────────────────
  //
  // Proves the steel thread in-process: both phases registered and run, RunReport
  // is valid, both phases present in the expected states.

  describe("Leg 1 — fake-driven (always runs)", () => {
    it("RunReport is valid, has stet + startedAt, both phases present, exit 0", async () => {
      // Register both phases explicitly (P10 discipline).
      registerPhase(stubDet);
      registerPhase(
        makeStubAgent(
          new FakeAgentRunner({
            kind: "ok",
            submission: {
              findings: [
                {
                  id: "stub-agent.todo",
                  phase: "stub-agent",
                  severity: "info",
                  confidence: "high",
                  message: "TODO: implement feature A",
                  location: { file: "src/main.ts", line: 9 },
                },
                {
                  id: "stub-agent.todo",
                  phase: "stub-agent",
                  severity: "info",
                  confidence: "high",
                  message: "TODO: implement feature B",
                  location: { file: "src/main.ts", line: 14 },
                },
              ],
              audit: {},
            },
            cost: { durationMs: 1 },
          }),
          "fake/model",
        ),
      );

      const phases = registeredPhases();
      const { io, stdoutLines } = makeIo(tmpDir);

      const result = await main(["--format", "json"], io, phases);

      // Pipeline returns Ok
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.exitCode).toBe(0);
      }

      // Exactly one stdout write — the JSON report
      expect(stdoutLines).toHaveLength(1);
      const parsed = JSON.parse(stdoutLines[0]!);

      // RunReport schema validates
      const valid = parseRunReport(parsed);
      expect(valid.isOk()).toBe(true);

      // Has stet + startedAt (PRD §4.5 acceptance #17)
      expect(typeof parsed.stet).toBe("string");
      expect(typeof parsed.startedAt).toBe("string");

      // Both phases present
      expect(parsed.phases).toHaveLength(2);

      // stub-det completed (deterministic phase)
      const detReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-det");
      expect(detReport).toBeDefined();
      expect(detReport.status).toBe("completed");
      expect(detReport.kind).toBeUndefined(); // kind is not part of PhaseReport schema

      // stub-agent completed with two info findings
      const agentReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-agent");
      expect(agentReport).toBeDefined();
      expect(agentReport.status).toBe("completed");
      expect(agentReport.findings).toHaveLength(2);
      expect(agentReport.findings[0].severity).toBe("info");
      expect(agentReport.findings[1].severity).toBe("info");

      // Exit 0 — info findings are below the "error" default threshold
      expect(parsed.result.exitCode).toBe(0);
    });
  });

  // ── Leg 2: no-model stopgap — always runs, hermetic ──────────────────────
  //
  // Simulates unset PI_TEST_MODEL: undefined model → PiAgentRunner returns
  // Err(ModelError) immediately, stub-agent phase reports "error", but stub-det
  // still completes. Proves §2a "deterministic half still runs" guarantee.

  describe("Leg 2 — no-model stopgap (always runs, hermetic)", () => {
    it("stub-agent reports error with 'no model' reason, stub-det still completed, RunReport valid", async () => {
      // Register both phases: stub-det and stub-agent with undefined model (simulates unset PI_TEST_MODEL)
      registerPhase(stubDet);
      registerPhase(makeStubAgent(new PiAgentRunner(), undefined));

      const phases = registeredPhases();
      const { io, stdoutLines } = makeIo(tmpDir);

      const result = await main(["--format", "json"], io, phases);

      // Pipeline returns Ok (phase-level error is not a stet malfunction)
      expect(result.isOk()).toBe(true);

      // Report is emitted
      expect(stdoutLines).toHaveLength(1);
      const parsed = JSON.parse(stdoutLines[0]!);

      // RunReport schema validates even with a phase error
      const valid = parseRunReport(parsed);
      expect(valid.isOk()).toBe(true);

      // stub-det still completed (deterministic half still runs — §2a guarantee)
      const detReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-det");
      expect(detReport).toBeDefined();
      expect(detReport.status).toBe("completed");

      // stub-agent is error with "no model" in the reason
      const agentReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-agent");
      expect(agentReport).toBeDefined();
      expect(agentReport.status).toBe("error");
      expect(agentReport.reason).toMatch(/no model/i);
    });
  });

  // ── Leg 3: keyed real round-trip — skips without PI_TEST_MODEL ───────────
  //
  // Only runs when PI_TEST_MODEL is set. Exercises the full real-model path:
  // PiAgentRunner → Pi SDK → model → submit_findings → PhaseReport.
  // The stub-agent rubric (find /\bTODO\b/ in changed files) is real enough that
  // a live model can find the two TODOs in fixtures/stub-repo/src/main.ts.

  describe.skipIf(!process.env.PI_TEST_MODEL)("Leg 3 — keyed real round-trip", () => {
    it("real model run: RunReport validates, both phases present, stub-agent completed", async () => {
      const model = process.env.PI_TEST_MODEL!;
      registerPhase(stubDet);
      registerPhase(makeStubAgent(new PiAgentRunner(), model));

      const phases = registeredPhases();
      const { io, stdoutLines } = makeIo(tmpDir);

      const result = await main(["--format", "json"], io, phases);

      // Pipeline returns Ok
      expect(result.isOk()).toBe(true);

      expect(stdoutLines).toHaveLength(1);
      const parsed = JSON.parse(stdoutLines[0]!);

      // RunReport validates
      const valid = parseRunReport(parsed);
      expect(valid.isOk()).toBe(true);

      // Both phases present
      expect(parsed.phases).toHaveLength(2);

      // stub-det completed
      const detReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-det");
      expect(detReport?.status).toBe("completed");

      // stub-agent completed (real model found the TODO(s))
      const agentReport = parsed.phases.find((p: { phase: string }) => p.phase === "stub-agent");
      expect(agentReport?.status).toBe("completed");
    }, 300_000); // Allow up to 5 minutes for a real model run
  });
});

// ---------------------------------------------------------------------------
// Part F — mutation-free invariant test
//
// Assert that every registered agent phase exposes a `toolset` that:
//   1. Is defined (auditable on the registered phase, not hidden in a closure).
//   2. Contains NONE of the Pi SDK mutation tools ["edit", "write"].
//   3. At least one agent phase exists (so the test cannot vacuously pass).
//
// PRD §3.2 (mutation-free), acceptance #2.
// ---------------------------------------------------------------------------

describe("Mutation-free invariant (PRD §3.2, acceptance #2)", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("every registered agent phase has a defined toolset containing no mutation tools", () => {
    // Register the real stub-agent (model string doesn't matter — never run in this test)
    registerPhase(makeStubAgent(new PiAgentRunner(), "anthropic/claude-haiku-4-5"));
    // Also register stub-det to confirm deterministic phases don't interfere
    registerPhase(stubDet);

    const MUTATION_TOOLS = ["edit", "write"];

    const agentPhases = registeredPhases().filter((p) => p.kind === "agent");

    // Must have at least one agent phase (prevents vacuous pass)
    expect(agentPhases.length).toBeGreaterThan(0);

    for (const phase of agentPhases) {
      // toolset must be defined on agent phases
      expect(phase.toolset).toBeDefined();

      if (phase.toolset !== undefined) {
        // No mutation tools in the allowlist
        for (const mutationTool of MUTATION_TOOLS) {
          expect(phase.toolset).not.toContain(mutationTool);
        }
      }
    }
  });
});
