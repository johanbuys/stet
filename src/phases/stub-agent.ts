/**
 * stub-agent — the agent-backed stub phase (PRD §3.9).
 *
 * Permanent product surface: lives in src/, never in a released binary's default
 * phase set, but always available for registration (the steel-thread test registers
 * it explicitly alongside stub-det).
 *
 * Responsibilities:
 *   - Built on top of makeAgentPhase (T7) — NOT a hand-rolled PhaseConfiguration.
 *   - Rubric: find lines matching /\bTODO\b/ in the changed files and submit one
 *     info finding per match, each with its file:line location and matched text.
 *   - Toolset: read-only subset — mutation-free (PRD §3.2). No edit/write tools.
 *   - submitSchema: { findings: Finding[], audit?: Audit } — validated by the
 *     SubmitTool at the tool boundary (guard 1) and re-validated by the wrapper.
 *   - buildUserPrompt: names the changed files and cwd so the agent knows where to look.
 *   - Activation: always-true (PRD §3.9 — stub phases declare trivial predicates).
 *   - Budgets: sane stub defaults; budget ENFORCEMENT is M3.
 *
 * The rubric is deterministic enough to assert against in fake-driven tests (T9) and
 * real enough that a live model can execute it faithfully in the T11 steel thread.
 *
 * PRD refs: §3.2 (mutation-free), §3.9 (stub phases), §4.1 (PhaseConfiguration),
 * §4.2 (Finding), §4.4 (PhaseReport).
 * Plan refs: §2a M2 step 2 (T9), decisions P1/P10.
 */

import { Type } from "@sinclair/typebox";
import type { AgentRunner } from "../agent/runner.js";
import { Finding } from "../schema/finding.js";
import { Audit } from "../schema/report.js";
import type { PhaseConfiguration } from "./types.js";
import { makeAgentPhase } from "./agent-phase.js";

// ---------------------------------------------------------------------------
// Submit schema — { findings: Finding[], audit?: Audit }
//
// This is what the real runner's SubmitTool (guard 1) validates against.
// A shared base submit schema can be promoted here when a real phase needs it,
// but we resist that abstraction now (YAGNI — no second consumer yet).
// ---------------------------------------------------------------------------

const StubAgentSubmitSchema = Type.Object(
  {
    findings: Type.Array(Finding),
    audit: Type.Optional(Audit),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Rubric — plan §2a canonical stub-agent rubric
//
// Deterministic enough to assert against fake-driven results (T9).
// Real enough that a live model (T11) can execute it faithfully and produce
// the expected findings against fixtures/stub-repo/src/main.ts.
// ---------------------------------------------------------------------------

const STUB_AGENT_RUBRIC = `\
You are stub-agent, a read-only code-analysis agent for the stet validation harness.

Your ONLY job in this run:
  Find every line matching the word TODO (the regex /\\bTODO\\b/) in the changed files
  listed in the user prompt. For EACH matching line, submit exactly one finding with:
    - severity: "info"
    - confidence: "high"
    - message: the matched line content (trimmed), e.g. "TODO: implement feature A"
    - location: { file: "<relative-path>", line: <1-based line number> }

Rules:
  - Use the read tool (or grep/bash) to inspect the files. You MUST NOT use any
    write or edit tool. This agent is mutation-free.
  - Submit ALL findings in a single submit_findings call once you have examined
    every changed file. Do not submit partial results.
  - If no TODO lines are found, submit an empty findings array.
  - Do not add findings for any other reason. Only TODO matches count.
  - Use "stub-agent" as the phase for every finding.
  - Use "stub-agent.todo" as the id for every finding.

After submit_findings is accepted, STOP immediately.`;

// ---------------------------------------------------------------------------
// Budgets — sane stub defaults.
// Budget ENFORCEMENT is M3; these values are present now so the interface
// does not need to change when enforcement arrives.
// ---------------------------------------------------------------------------

const STUB_AGENT_BUDGETS = {
  wallClockMs: 300_000, // 5 minutes wall-clock (enforced M3)
  turns: 50, // 50 agent turns (enforced T10/PiAgentRunner)
  bashTimeoutMs: 60_000, // 60 s per bash call (enforced T10/PiAgentRunner)
  bashOutputCap: 32_768, // 32 KB bash output cap (enforced T10/PiAgentRunner)
};

// ---------------------------------------------------------------------------
// Public factory: makeStubAgent
// ---------------------------------------------------------------------------

/**
 * Build the stub-agent PhaseConfiguration with an injected AgentRunner.
 *
 * The runner is injected so tests can drive the phase with a FakeAgentRunner
 * (T9) and the steel thread can wire in PiAgentRunner (T10/T11) without
 * touching this file.
 *
 * @example
 *   // In tests (T9):
 *   const phase = makeStubAgent(new FakeAgentRunner({ kind: "ok", ... }));
 *
 *   // In the steel thread (T11):
 *   const phase = makeStubAgent(new PiAgentRunner());
 */
export function makeStubAgent(runner: AgentRunner): PhaseConfiguration {
  return makeAgentPhase(runner, {
    id: "stub-agent",
    rubric: STUB_AGENT_RUBRIC,

    // Mutation-free toolset: read-only inspection tools only (PRD §3.2).
    // NO edit, write, or any file-modification tool ever appears here.
    toolset: ["read", "bash", "grep", "find", "ls", "submit_findings"],

    submitSchema: StubAgentSubmitSchema,
    budgets: STUB_AGENT_BUDGETS,

    /**
     * Per-run user prompt: names the changed files and cwd so the agent knows
     * where to look. The rubric describes HOW; the prompt describes WHAT and WHERE.
     */
    buildUserPrompt: (ctx) => {
      const fileList = ctx.scope.files.join("\n  - ");
      return `\
Changed files to examine (relative to cwd):
  - ${fileList}

Working directory (cwd): ${ctx.cwd}

Search for TODO matches in the files listed above and submit your findings.`;
    },

    // Activation: always-true — PRD §3.9 stub phases declare trivial predicates.
    // Omitting activation lets makeAgentPhase default to () => true.
  });
}
