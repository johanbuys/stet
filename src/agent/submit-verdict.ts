/**
 * SubmitVerdictTool — SDK-independent handler for the submit_verdict tool boundary.
 *
 * Mirrors SubmitTool (submit-tool.ts) but for voter verdicts emitted during the
 * agreement-verify stage (TDD A·2). The schema is fixed: { verdict, reason }.
 *
 * Delegates all guard-1/2 logic to an internal SubmitTool instance, parameterised
 * with VERDICT_TOOL_NAME and the VoterVerdict-specific acceptance message. The only
 * genuinely different piece is the typed .submission getter (VoterVerdict | undefined).
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

import { VoterVerdict as VoterVerdictSchema } from "../schema/report.js";
import type { VoterVerdict } from "../schema/report.js";
import { SubmitTool } from "./submit-tool.js";
import type { SubmitResult } from "./submit-tool.js";

// ---------------------------------------------------------------------------
// Shared constant — single source of truth for the submit_verdict tool name
// ---------------------------------------------------------------------------

export const VERDICT_TOOL_NAME = "submit_verdict";

// ---------------------------------------------------------------------------
// Submit result — re-exported alias for API compatibility
// ---------------------------------------------------------------------------

export type VerdictSubmitResult = SubmitResult;

// ---------------------------------------------------------------------------
// SubmitVerdictTool
// ---------------------------------------------------------------------------

export class SubmitVerdictTool {
  // Delegate all guard logic to SubmitTool, configured with the verdict tool name
  // and verdict-specific success message. This eliminates ~60 lines of duplicated
  // guard-1/2 logic while keeping the typed .submission getter below.
  private readonly _inner: SubmitTool;

  constructor() {
    this._inner = new SubmitTool(
      VoterVerdictSchema,
      VERDICT_TOOL_NAME,
      "Verdict recorded. You are done — stop now.",
    );
  }

  submit(params: unknown): VerdictSubmitResult {
    return this._inner.submit(params);
  }

  get hasSubmission(): boolean {
    return this._inner.hasSubmission;
  }

  /** Typed accessor — narrows from unknown to VoterVerdict. */
  get submission(): VoterVerdict | undefined {
    return this._inner.hasSubmission ? (this._inner.submission as VoterVerdict) : undefined;
  }
}
