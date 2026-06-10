/**
 * SubmitTool — SDK-independent handler for the submit_findings tool boundary.
 *
 * Owns guards 1 & 2 of the "output-as-tool" contract (PRD §3.1):
 *
 *   Guard 1 (schema-validate-or-retry):
 *     Tool input is validated against the submit schema at the tool boundary.
 *     Invalid input is rejected with a corrective message naming the validation
 *     errors; state is NOT captured, so a later valid submission can still succeed.
 *
 *   Guard 2 (idempotency):
 *     The first valid submission wins. Subsequent valid submissions are rejected
 *     with "already recorded — stop now" and the original payload is retained.
 *     Real models were observed submitting 10–13× in the POC; this guard prevents
 *     a later (potentially garbled) submission from overwriting the first good one.
 *
 * Designed to be SDK-free and directly unit-testable without the Pi SDK.
 *
 * T10 SEAM: PiAgentRunner (T10) wires this handler into Pi SDK's defineTool.execute:
 *   execute(params) → { content: [{ type: "text", text: handler.submit(params).message }], details: {} }
 * After the session ends, PiAgentRunner reads handler.submission:
 *   undefined  ⇒ runner returns Err(new NoSubmitError(...))   — guard 3 (no-submit fallback)
 *   defined    ⇒ runner returns Ok({ submission: handler.submission, cost })
 *
 * PRD refs: §3.1 (output-as-tool guards), §4.6 (confidence).
 * Plan refs: M2 T8, T10, decisions P1/P10.
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// ---------------------------------------------------------------------------
// Submit result
// ---------------------------------------------------------------------------

/**
 * The result of a single submit() call.
 *   accepted: true  → params were valid and this is the first submission; payload captured.
 *   accepted: false → either guard 1 (invalid schema) or guard 2 (duplicate).
 *   message         → returned as the tool's text response to the model.
 */
export interface SubmitResult {
  accepted: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// SubmitTool
// ---------------------------------------------------------------------------

/**
 * SubmitTool — constructed with the submit_findings TypeBox schema.
 *
 * Holds the captured submission in instance state. Each SubmitTool instance is
 * independent (one per agent run).
 *
 * @example
 *   const handler = new SubmitTool(MySubmitSchema);
 *   // Wired into the SDK tool:
 *   handler.submit(params)  // → { accepted, message }
 *   handler.hasSubmission   // → boolean
 *   handler.submission      // → unknown | undefined
 */
export class SubmitTool {
  private readonly schema: TSchema;
  private _submission: unknown = undefined;
  private _captured = false;

  constructor(schema: TSchema) {
    this.schema = schema;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Process a submit_findings tool call.
   *
   * Guard 1 (schema-validate-or-retry):
   *   If params fail Value.Check against the schema, returns { accepted:false,
   *   message: <corrective text naming the first validation error path> }.
   *   State is NOT updated — a later valid call can still succeed.
   *
   * Guard 2 (idempotency):
   *   If a valid submission was already captured, returns { accepted:false,
   *   message: "A result was already recorded; this duplicate was ignored. You are done — stop now." }.
   *
   * Otherwise captures params and returns { accepted:true,
   *   message: "Findings recorded. You are done — stop now." }.
   */
  submit(params: unknown): SubmitResult {
    // Guard 1: schema validation
    if (!Value.Check(this.schema, params)) {
      const errors = [...Value.Errors(this.schema, params)];
      const first = errors[0];
      const detail = first
        ? `${first.path || "/"}: ${first.message}`
        : "parameters did not match the expected schema";
      return {
        accepted: false,
        message: `submit_findings validation failed — ${detail}. Fix your parameters and resubmit.`,
      };
    }

    // Guard 2: idempotency
    if (this._captured) {
      return {
        accepted: false,
        message:
          "A result was already recorded; this duplicate was ignored. You are done — stop now.",
      };
    }

    // First valid submission — capture and acknowledge
    this._submission = params;
    this._captured = true;
    return {
      accepted: true,
      message: "Findings recorded. You are done — stop now.",
    };
  }

  /**
   * True iff a valid submission has been captured.
   * T10 seam: PiAgentRunner checks this after the session ends.
   *   false ⇒ Err(new NoSubmitError(...))
   */
  get hasSubmission(): boolean {
    return this._captured;
  }

  /**
   * The captured submission payload, or undefined if no valid submission was made.
   * T10 seam: PiAgentRunner returns this as AgentRunSuccess.submission when defined.
   */
  get submission(): unknown {
    return this._submission;
  }
}
