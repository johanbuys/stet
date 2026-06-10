/**
 * agent-phase — wraps an AgentRunner + rubric/config into a PhaseConfiguration.
 *
 * Responsibility: bridge the AgentRunner seam (runner.ts) and the phase abstraction
 * (types.ts) so that any agent-backed phase is constructed by calling makeAgentPhase().
 *
 * T7 scope (happy path + error skeleton):
 *   - Happy path: Ok(AgentRunSuccess) whose submission contains { findings, audit } →
 *     PhaseReport { status: "completed", findings, audit, cost }.
 *   - Error path: Err(AgentError) exhaustively matched → PhaseReport { status: "error", reason }.
 *
 * T8 scope (guard 3 — no-submit fallback):
 *   - NoSubmitError → PhaseReport { status: "error", reason, findings: [<phase>.no-result warning] }.
 *   - The no-result finding has confidence "high": we KNOW the agent didn't submit (structural fact).
 *   - Guards 1 & 2 live in src/agent/submit-tool.ts (SubmitTool); T10 wires them into PiAgentRunner.
 *
 * INFALLIBLE CONTRACT: makeAgentPhase().run() never throws and never rejects.
 * All failures produce a PhaseReport { status: "error", reason }.
 *
 * PRD refs: §3.1 (guards), §3.2 (mutation-free), §4.1 (PhaseConfiguration), §4.4 (PhaseReport).
 * Plan refs: §2a M2 step 1, decisions P1/P10.
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { matchError } from "better-result";
import type { AgentError } from "../errors.js";
import { Audit, type PhaseReport, type PhaseCost } from "../schema/report.js";
import { Finding } from "../schema/finding.js";
import type { AgentRunner, AgentRunInputs } from "../agent/runner.js";
import type { PhaseContext, PhaseConfiguration, ActivationContext } from "./types.js";

// ---------------------------------------------------------------------------
// AgentPhaseConfig — construction inputs
// ---------------------------------------------------------------------------

/**
 * All the information needed to build an agent-backed PhaseConfiguration.
 * Fixed at construction time; per-run inputs (diff, spec context) are assembled
 * by the run() closure from PhaseContext, then passed to the runner.
 */
export interface AgentPhaseConfig {
  /** Phase id (kebab-case; must match the PhaseConfiguration.id contract). */
  id: string;
  /** System-prompt / persona rubric for this phase. */
  rubric: string;
  /** Tool allowlist. NEVER include edit/write tools (PRD §3.2 mutation-free). */
  toolset: string[];
  /** TypeBox schema for the submit_findings parameter (validated by the runner at tool boundary). */
  submitSchema: TSchema;
  /**
   * Safety budgets. wallClockMs is enforced by the wrapper (M3). turns + bash limits
   * are enforced by the runner (PiAgentRunner, T10). Both layers are present now so the
   * interface doesn't need to change in M3.
   */
  budgets: AgentRunInputs["budgets"];
  /** Resolved model id (optional; undefined ⇒ M6 routing resolves it). */
  model?: string;
  /**
   * Build the per-run user prompt from phase context.
   * Called inside run() so the prompt can include the diff summary, spec context, etc.
   */
  buildUserPrompt: (ctx: PhaseContext) => string;
  /**
   * Activation predicate (pure, fast). Non-activated phases appear as "skipped".
   * Defaults to always-true if omitted.
   */
  activation?: (ctx: ActivationContext) => boolean;
}

// ---------------------------------------------------------------------------
// Submission validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse `findings` from an unknown submission payload.
 * Returns the typed array on success, or a reason string on failure.
 * Used to validate the happy-path submission before building the PhaseReport.
 */
function parseFindings(
  submission: unknown,
): { ok: true; value: Finding[] } | { ok: false; reason: string } {
  if (
    typeof submission !== "object" ||
    submission === null ||
    !("findings" in submission) ||
    !Array.isArray((submission as Record<string, unknown>).findings)
  ) {
    return { ok: false, reason: "submission missing required 'findings' array" };
  }

  const raw = (submission as Record<string, unknown>).findings as unknown[];
  const valid: Finding[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (!Value.Check(Finding, raw[i])) {
      const errors = [...Value.Errors(Finding, raw[i])];
      const first = errors[0];
      return {
        ok: false,
        reason: `submission.findings[${i}] invalid: ${first ? `${first.path}: ${first.message}` : "unknown error"}`,
      };
    }
    valid.push(raw[i] as Finding);
  }
  return { ok: true, value: valid };
}

/**
 * Parse `audit` from an unknown submission payload.
 * Returns the typed Audit on success, or falls back to an empty Audit ({}) on failure.
 * Audit is best-effort: if the agent omits or garbles it, we don't fail the phase.
 */
function parseAudit(submission: unknown): Audit {
  if (typeof submission !== "object" || submission === null || !("audit" in submission)) {
    return {};
  }
  const rawAudit = (submission as Record<string, unknown>).audit;
  if (Value.Check(Audit, rawAudit)) {
    return rawAudit;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Error-path: exhaustive AgentError → PhaseReport mapping
// ---------------------------------------------------------------------------

/**
 * Map an AgentError to a PhaseReport { status: "error", reason }.
 * Exhaustive over the AgentError union — adding a new variant is a compile error here.
 *
 * Guard 3 (no-submit fallback, T8): the NoSubmitError case synthesizes a
 * `<phase>.no-result` warning Finding in the report's findings array.
 * The other three variants (Budget/Cancelled/Model) receive empty findings.
 */
function agentErrorToReport(phaseId: string, error: AgentError, durationMs: number): PhaseReport {
  const reason: string = matchError(error, {
    NoSubmitError: (e) => e.message || "agent finished without submitting",
    BudgetError: (e) => `budget exceeded: ${e.limit} — ${e.message}`,
    CancelledError: (e) => e.message || "cancelled",
    ModelError: (e) => e.message || "model error",
  });

  const cost: PhaseCost = {
    durationMs,
    // Carry model from the error's cost when available (NoSubmitError/CancelledError/ModelError)
    ...costFromError(error),
  };

  // Guard 3: synthesize a no-result warning finding for NoSubmitError only.
  // We KNOW the agent didn't submit — this is a structural fact, not a judgment (PRD §4.6),
  // so confidence is "high". The other three AgentError variants (Budget/Cancelled/Model)
  // already carry their own semantics in `reason` and must NOT get a no-result finding.
  const findings: Finding[] =
    error._tag === "NoSubmitError"
      ? [
          {
            id: `${phaseId}.no-result`,
            phase: phaseId,
            severity: "warning",
            confidence: "high",
            message: "agent finished without submitting a result",
          },
        ]
      : [];

  return {
    phase: phaseId,
    status: "error",
    reason,
    findings,
    audit: {},
    cost,
  };
}

/**
 * Extract cost fields from an AgentError where available.
 * BudgetError doesn't carry a cost object — it only has limit + message.
 */
function costFromError(error: AgentError): Partial<PhaseCost> {
  if (
    error._tag === "NoSubmitError" ||
    error._tag === "CancelledError" ||
    error._tag === "ModelError"
  ) {
    return {
      model: error.cost.model,
      inputTokens: error.cost.inputTokens,
      outputTokens: error.cost.outputTokens,
      // durationMs is merged from the outer measurement below
    };
  }
  // BudgetError: no cost sub-object
  return {};
}

// ---------------------------------------------------------------------------
// Public factory: makeAgentPhase
// ---------------------------------------------------------------------------

/**
 * Build a PhaseConfiguration backed by the given AgentRunner.
 *
 * The returned PhaseConfiguration satisfies the infallible run() contract:
 * it never throws, never rejects, always returns a PhaseReport.
 *
 * Usage:
 *   const myPhase = makeAgentPhase(runner, {
 *     id: "review",
 *     rubric: "...",
 *     toolset: ["bash", "submit_findings"],
 *     submitSchema: ReviewSubmitSchema,
 *     budgets: { wallClockMs: 300_000, turns: 120, bashTimeoutMs: 30_000, bashOutputCap: 4096 },
 *     buildUserPrompt: (ctx) => `Review the diff: ${ctx.scope.files.join(", ")}`,
 *   });
 */
export function makeAgentPhase(runner: AgentRunner, cfg: AgentPhaseConfig): PhaseConfiguration {
  return {
    id: cfg.id,
    kind: "agent",

    // Expose the tool allowlist so the mutation-free invariant (PRD §3.2, acceptance #2)
    // is auditable on the registered phase — not hidden in a closure.
    toolset: cfg.toolset,

    activation: cfg.activation ?? (() => true),

    /**
     * Execute the agent phase. INFALLIBLE BY CONTRACT: never throws, never rejects.
     * Internal failures (runner errors, schema parse failures) become PhaseReport { status: "error" }.
     */
    async run(ctx: PhaseContext): Promise<PhaseReport> {
      const start = Date.now();

      let runResult: Awaited<ReturnType<AgentRunner["run"]>>;
      try {
        runResult = await runner.run({
          rubric: cfg.rubric,
          userPrompt: cfg.buildUserPrompt(ctx),
          toolset: cfg.toolset,
          submitSchema: cfg.submitSchema,
          budgets: cfg.budgets,
          model: cfg.model,
          cwd: ctx.cwd,
        });
      } catch (err) {
        // runner.run() should never reject, but be defensive (same pattern as scheduler.ts)
        const message = err instanceof Error ? err.message : String(err);
        return {
          phase: cfg.id,
          status: "error",
          reason: `agent runner threw unexpectedly: ${message}`,
          findings: [],
          audit: {},
          cost: { durationMs: Date.now() - start },
        };
      }

      const durationMs = Date.now() - start;

      // --- Error path ---
      if (runResult.isErr()) {
        return agentErrorToReport(cfg.id, runResult.error, durationMs);
      }

      // --- Happy path ---
      const { submission, cost } = runResult.value;

      // Parse findings from submission
      const findingsResult = parseFindings(submission);
      if (!findingsResult.ok) {
        return {
          phase: cfg.id,
          status: "error",
          reason: findingsResult.reason,
          findings: [],
          audit: {},
          cost: { ...cost, durationMs },
        };
      }

      // Parse audit from submission (best-effort; falls back to {} on failure)
      const audit = parseAudit(submission);

      return {
        phase: cfg.id,
        status: "completed",
        findings: findingsResult.value,
        audit,
        cost: { ...cost, durationMs },
      };
    },
  };
}
