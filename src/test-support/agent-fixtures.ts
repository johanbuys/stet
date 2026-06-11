/**
 * Shared test-support helpers: AgentRunner + PhaseContext fixtures.
 *
 * This is a plain `.ts` module (NOT `*.test.ts`) so it is safe to import from
 * any test file without triggering test registration side-effects.
 * No top-level side effects — safe under vp/vitest's module caching.
 *
 * Consumers: budgets.test.ts, fake-runner.test.ts, agent-phase.test.ts, pi-runner.test.ts,
 *            scheduler.test.ts, fixtures/signal-test/run.ts.
 */

import { Type } from "@sinclair/typebox";
import type { AgentRunInputs } from "../agent/runner.js";
import { FakeAgentRunner } from "../agent/fake-runner.js";
import { makeAgentPhase } from "../phases/agent-phase.js";
import type { PhaseConfiguration } from "../phases/index.js";
import type { PhaseContext } from "../phases/types.js";

// ---------------------------------------------------------------------------
// Shared submit schema
//
// Used by makeAgentPhase() to validate the agent's submission at the tool
// boundary (findings array + optional audit field).
// ---------------------------------------------------------------------------

export const SUBMIT_SCHEMA = Type.Object({
  findings: Type.Array(Type.Unknown()),
  audit: Type.Optional(Type.Unknown()),
});

// ---------------------------------------------------------------------------
// Default budgets
//
// Matches the values used by agent-phase.test.ts and fake-runner.test.ts.
//
// NOTE: budgets.test.ts uses a LOCAL DEFAULT_BUDGETS with wallClockMs: 100
// (deliberate — its makeAgentPhase tests rely on fake timers firing in 200ms)
// and bashOutputCap: 32_768 (matches the bash-level limit tests there).
// That file imports makeInputs and makeCtx from here but keeps its own
// DEFAULT_BUDGETS constant.
// ---------------------------------------------------------------------------

export const DEFAULT_BUDGETS = {
  wallClockMs: 60_000,
  turns: 30,
  bashTimeoutMs: 10_000,
  bashOutputCap: 4096,
};

// ---------------------------------------------------------------------------
// makeDelayAgentPhase — shared delay-runner agent phase builder
//
// Builds an agent phase backed by FakeAgentRunner({ kind: "delay", delayMs })
// with a standard rubric/toolset/schema/budgets config.
//
// NOTE: wallClockMs is taken directly from DEFAULT_BUDGETS (60_000) — no
// override needed. Callers that previously spread { ...DEFAULT_BUDGETS,
// wallClockMs: 60_000 } were redundant; this helper is the canonical form.
// ---------------------------------------------------------------------------

export function makeDelayAgentPhase(id: string, delayMs: number): PhaseConfiguration {
  return makeAgentPhase(new FakeAgentRunner({ kind: "delay", delayMs }), {
    id,
    rubric: "rubric",
    toolset: ["bash"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: DEFAULT_BUDGETS,
    buildUserPrompt: () => "prompt",
  });
}

// ---------------------------------------------------------------------------
// makeInputs — AgentRunInputs builder
//
// Defaults match agent-phase.test.ts and fake-runner.test.ts.
// Pass overrides for any field that a specific test needs to differ.
// ---------------------------------------------------------------------------

export function makeInputs(overrides: Partial<AgentRunInputs> = {}): AgentRunInputs {
  return {
    rubric: "test rubric",
    userPrompt: "test prompt",
    toolset: ["bash", "submit_findings"],
    submitSchema: SUBMIT_SCHEMA,
    budgets: DEFAULT_BUDGETS,
    cwd: "/tmp",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeCtx — PhaseContext builder
// ---------------------------------------------------------------------------

export function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    cwd: "/tmp/repo",
    scope: { kind: "staged" as const, files: ["src/foo.ts"] },
    config: {},
    ...overrides,
  };
}
