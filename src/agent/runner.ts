/**
 * AgentRunner interface — the seam between the harness and the agent SDK.
 *
 * Implements the deep-module contract from harness plan §2a (decision P1).
 * Tests drive a scripted FakeAgentRunner; the real Pi-SDK adapter (PiAgentRunner)
 * lives behind this interface, isolating harness tests from SDK churn.
 *
 * PRD refs: §3.2 (mutation-free principle), §3.5 (budgets), §4.4 (cost).
 * Plan refs: §2a (AgentRunner signature), M2 step 1, decisions P1/P10.
 */

import type { TSchema } from "@sinclair/typebox";
import type { Result } from "better-result";
import type { AgentError } from "../errors.js";
import type { Cost } from "../schema/report.js";

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * All inputs that a single agent run needs.
 * harness plan §2a; budget enforcement layering: wrapper owns wall-clock (M3),
 * runner owns turn count + bash limits (M3, T12/T13 — not yet implemented).
 */
export interface AgentRunInputs {
  /** System-prompt override — the phase's persona/rubric. */
  rubric: string;
  /** Per-run user-prompt: diff summary, spec context, run instructions. */
  userPrompt: string;
  /** Tool allowlist. NEVER contains edit/write tools — mutation-free (PRD §3.2). */
  toolset: string[];
  /** TypeBox schema for the submit_findings parameter (findings + audit + extension). */
  submitSchema: TSchema;
  /** Safety budgets: wrapper enforces wallClockMs (M3), runner enforces turns/bash (M3, T12/T13 — not yet implemented). */
  budgets: {
    wallClockMs: number;
    turns: number;
    bashTimeoutMs: number;
    bashOutputCap: number;
  };
  /** Resolved "provider/id" string. undefined ⇒ adapter resolves later (M6 routing). */
  model?: string;
  /** Repo under validation — agent's working directory. */
  cwd: string;
  /** Progress callback: called with each tool name as the agent invokes tools → stderr. */
  onTool?: (toolName: string) => void;
  /** Scheduler cancellation signal (M4 wires this; ignored by FakeAgentRunner). */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Success contract
// ---------------------------------------------------------------------------

/**
 * What a successful agent run produces.
 * `submission` is the raw (already-submitted) payload validated by the runner at the
 * tool boundary — the wrapper re-validates against Finding/Audit schemas.
 * harness plan §2a.
 */
export interface AgentRunSuccess {
  /**
   * The validated submit_findings payload.
   * Shape expected by the phase wrapper: { findings: Finding[], audit: Audit, ...extension }.
   * The runner validates against submitSchema at the tool boundary; the wrapper
   * validates the findings/audit sub-shapes against the TypeBox schemas.
   */
  submission: unknown;
  /** Token and wall-clock cost for this run. */
  cost: Cost;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * The harness-owned seam for running an agent.
 *
 * One method: run(inputs) → Promise<Result<AgentRunSuccess, AgentError>>.
 * Implementations: FakeAgentRunner (tests), PiAgentRunner (T10, real SDK).
 *
 * Contract: run() never throws. All failure modes surface as Err(AgentError).
 * harness plan §2a, decision P1.
 */
export interface AgentRunner {
  run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>>;
}
