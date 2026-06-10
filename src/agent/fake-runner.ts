/**
 * FakeAgentRunner — a scripted AgentRunner for tests.
 *
 * Constructed with a RunScript describing what the runner should emit.
 * No SDK, no API key, no network — pure deterministic behavior.
 * This is the whole point of the AgentRunner seam (plan §2a, decision P1):
 * the guards and wrapper's failure modes become scriptable, not hoped-for.
 *
 * Script shape (T7 scope — extensible toward T8):
 *   { kind: "ok", submission, cost }      → Ok(AgentRunSuccess)
 *   { kind: "err", error }                → Err(AgentError)
 *
 * T8 will extend the script toward multi-step sequences (e.g. invalid-then-valid
 * submissions, never-submit) by replacing the single-step shape with an ordered
 * list of tool-call events. The `kind` discriminant is chosen so that extension
 * is an additive new kind rather than a breaking change to existing scripts.
 *
 * PRD refs: §3.2 (mutation-free); plan §2a M2 step 1, decision P1.
 */

import { Result } from "better-result";
import type { AgentError } from "../errors.js";
import type { AgentRunInputs, AgentRunSuccess, AgentRunner } from "./runner.js";
import { SUBMIT_TOOL_NAME } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// Script shapes
// ---------------------------------------------------------------------------

/**
 * Script step: the fake immediately returns Ok with the given submission + cost.
 * T8 may extend this with a `toolCalls` list for multi-step sequences.
 */
export interface OkScript {
  kind: "ok";
  /** The submission payload returned as AgentRunSuccess.submission. */
  submission: unknown;
  /** Cost to report alongside the submission. */
  cost: AgentRunSuccess["cost"];
}

/**
 * Script step: the fake immediately returns Err with the given AgentError.
 * Used to test the wrapper's error-mapping and the T8 guards.
 */
export interface ErrScript {
  kind: "err";
  /** The AgentError to return. Covers all four union members for testability. */
  error: AgentError;
}

/** The script passed to FakeAgentRunner at construction time. */
export type RunScript = OkScript | ErrScript;
// --- Seam for T8 ---
// T8 extends RunScript toward:
//   { kind: "submit-sequence", steps: Array<OkScript | ErrScript | InvalidSubmitStep> }
// where InvalidSubmitStep carries a bad payload that triggers the validate-or-retry guard.
// The FakeAgentRunner constructor then walks the steps list rather than returning immediately.
// The current single-step shape is the degenerate case of a one-step sequence.

// ---------------------------------------------------------------------------
// FakeAgentRunner
// ---------------------------------------------------------------------------

/**
 * FakeAgentRunner — scripted, synchronous-ish (Promise-returning) agent runner.
 *
 * Constructed with a RunScript; calling run() resolves immediately according to the script.
 * Calls onTool("submit_findings") on the Ok path so callers can track progress.
 *
 * Never throws, never rejects — mirrors the real AgentRunner contract.
 */
export class FakeAgentRunner implements AgentRunner {
  private readonly script: RunScript;

  constructor(script: RunScript) {
    this.script = script;
  }

  async run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>> {
    const { onTool } = inputs;

    if (this.script.kind === "ok") {
      // Simulate tool invocation progress for the happy path
      onTool?.(SUBMIT_TOOL_NAME);
      return Result.ok({
        submission: this.script.submission,
        cost: this.script.cost,
      });
    }

    // kind === "err"
    return Result.err(this.script.error);
  }
}
