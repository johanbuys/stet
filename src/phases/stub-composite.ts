/**
 * stub-composite — a composite stub phase for testing the specialist machinery (PRD §3.9).
 *
 * Three specialists (alpha, beta, gamma) with trivial rubrics, driven by injected
 * AgentRunners. Never shipped in the default phase set but always available for
 * registration. Used by T21/T22 tests to verify parallel execution, roll-up, and
 * partial-failure isolation.
 *
 * PRD refs: §3.3 (specialists), §3.9 (stub phases), §4.1 (PhaseConfiguration).
 * Plan refs: M7.
 */

import { Type } from "@sinclair/typebox";
import type { AgentRunner } from "../agent/runner.js";
import { SUBMIT_TOOL_NAME } from "../agent/submit-tool.js";
import { Finding } from "../schema/finding.js";
import { Audit } from "../schema/report.js";
import type { PhaseConfiguration } from "./types.js";
import { makeCompositePhase, type SpecialistConfig } from "./composite.js";
import type { CoordinatorConfig } from "./coordinator.js";

// ---------------------------------------------------------------------------
// Submit schema — shared across all stub specialists
// ---------------------------------------------------------------------------

const StubSpecialistSubmitSchema = Type.Object(
  {
    findings: Type.Array(Finding),
    audit: Type.Optional(Audit),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Specialist budgets — same sane defaults as stub-agent
// ---------------------------------------------------------------------------

const STUB_SPECIALIST_BUDGETS = {
  wallClockMs: 300_000,
  turns: 50,
  bashTimeoutMs: 60_000,
  bashOutputCap: 32_768,
};

// ---------------------------------------------------------------------------
// Specialist configs
// ---------------------------------------------------------------------------

/**
 * The three stub specialists. Rubrics are simple enough for fake-driven tests;
 * real enough that a live model could execute them faithfully.
 */
export const STUB_COMPOSITE_SPECIALISTS: SpecialistConfig[] = [
  {
    name: "alpha",
    rubric: `\
You are the "alpha" specialist in the stub-composite phase.

Your ONLY job: find every line matching /\\bFIXME\\b/ in the changed files.
For each match, submit one finding with severity "warning", confidence "high",
and the matched line as the message. Use id "stub-composite.alpha.fixme".

If no FIXME lines are found, submit an empty findings array.`,
    toolset: ["read", "bash", "grep", "find", SUBMIT_TOOL_NAME],
    submitSchema: StubSpecialistSubmitSchema,
    budgets: STUB_SPECIALIST_BUDGETS,
    buildUserPrompt: (ctx) => {
      const fileList = ctx.scope.files.join("\n  - ");
      return `Changed files:\n  - ${fileList}\n\nWorking directory: ${ctx.cwd}`;
    },
  },

  {
    name: "beta",
    rubric: `\
You are the "beta" specialist in the stub-composite phase.

Your ONLY job: find every line matching /\\bHACK\\b/ in the changed files.
For each match, submit one finding with severity "warning", confidence "high",
and the matched line as the message. Use id "stub-composite.beta.hack".

If no HACK lines are found, submit an empty findings array.`,
    toolset: ["read", "bash", "grep", "find", SUBMIT_TOOL_NAME],
    submitSchema: StubSpecialistSubmitSchema,
    budgets: STUB_SPECIALIST_BUDGETS,
    buildUserPrompt: (ctx) => {
      const fileList = ctx.scope.files.join("\n  - ");
      return `Changed files:\n  - ${fileList}\n\nWorking directory: ${ctx.cwd}`;
    },
  },

  {
    name: "gamma",
    rubric: `\
You are the "gamma" specialist in the stub-composite phase.

Your ONLY job: find every line matching /\\bNOTE\\b/ in the changed files.
For each match, submit one finding with severity "info", confidence "high",
and the matched line as the message. Use id "stub-composite.gamma.note".

If no NOTE lines are found, submit an empty findings array.`,
    toolset: ["read", "bash", "grep", "find", SUBMIT_TOOL_NAME],
    submitSchema: StubSpecialistSubmitSchema,
    budgets: STUB_SPECIALIST_BUDGETS,
    buildUserPrompt: (ctx) => {
      const fileList = ctx.scope.files.join("\n  - ");
      return `Changed files:\n  - ${fileList}\n\nWorking directory: ${ctx.cwd}`;
    },
  },
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the stub-composite PhaseConfiguration with injected AgentRunners.
 *
 * `runners` must contain an entry for each specialist name ("alpha", "beta", "gamma").
 * When `opts.coordinator` is provided, `runners["coordinator"]` must also be present.
 * Pass FakeAgentRunners in tests to script each specialist independently.
 *
 * @example
 *   const phase = makeStubComposite({
 *     alpha: new FakeAgentRunner({ kind: "ok", submission: { findings: [...] }, cost: ... }),
 *     beta:  new FakeAgentRunner({ kind: "ok", submission: { findings: [] }, cost: ... }),
 *     gamma: new FakeAgentRunner({ kind: "err", error: new ModelError(...) }),
 *   });
 */
export function makeStubComposite(
  runners: Record<string, AgentRunner>,
  opts?: { coordinator?: CoordinatorConfig },
): PhaseConfiguration {
  return makeCompositePhase(runners, {
    id: "stub-composite",
    specialists: STUB_COMPOSITE_SPECIALISTS,
    coordinator: opts?.coordinator,
  });
}
