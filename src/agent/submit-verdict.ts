/**
 * SubmitVerdictTool — SDK-independent handler for the submit_verdict tool boundary.
 *
 * Mirrors SubmitTool (submit-tool.ts) but for voter verdicts emitted during the
 * agreement-verify stage (TDD A·2). The schema is fixed: { verdict, reason }.
 *
 * Guard 1 (schema-validate-or-retry):
 *   Input is validated against VoterVerdict. Invalid input is rejected with a
 *   corrective message; state is NOT captured, so a later valid call can succeed.
 *
 * Guard 2 (idempotency):
 *   The first valid submission wins. Subsequent submissions are rejected with
 *   "already recorded — stop now"; the original payload is retained.
 *
 * Plan refs: M1 step 1 · TDD A·2
 */

import { Value } from "@sinclair/typebox/value";

import { VoterVerdict as VoterVerdictSchema } from "../schema/report.js";
import type { VoterVerdict } from "../schema/report.js";

// ---------------------------------------------------------------------------
// Shared constant — single source of truth for the submit_verdict tool name
// ---------------------------------------------------------------------------

export const VERDICT_TOOL_NAME = "submit_verdict";

// ---------------------------------------------------------------------------
// Submit result
// ---------------------------------------------------------------------------

export interface VerdictSubmitResult {
  accepted: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// SubmitVerdictTool
// ---------------------------------------------------------------------------

export class SubmitVerdictTool {
  private _submission: VoterVerdict | undefined = undefined;
  private _captured = false;

  submit(params: unknown): VerdictSubmitResult {
    // Guard 1: schema validation
    if (!Value.Check(VoterVerdictSchema, params)) {
      const errors = [...Value.Errors(VoterVerdictSchema, params)];
      const first = errors[0];
      const detail = first
        ? `${first.path || "/"}: ${first.message}`
        : "parameters did not match the expected schema";
      return {
        accepted: false,
        message: `submit_verdict validation failed — ${detail}. Fix your parameters and resubmit.`,
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
    this._submission = params as VoterVerdict;
    this._captured = true;
    return {
      accepted: true,
      message: "Verdict recorded. You are done — stop now.",
    };
  }

  get hasSubmission(): boolean {
    return this._captured;
  }

  get submission(): VoterVerdict | undefined {
    return this._submission;
  }
}
