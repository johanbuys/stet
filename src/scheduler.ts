/**
 * Scheduler — runs all activated phases concurrently and synthesizes skips.
 *
 * Execution model (PRD §3.4.2): all activated phases launch via Promise.all so
 * wall-clock ≈ slowest phase. The scheduler's AbortSignal (M4, SchedulerContext.signal)
 * is forwarded to every phase's run context, enabling T15's cancel-class gate to abort
 * in-flight agent phases and T16's signal handling (SIGINT/SIGTERM teardown).
 *
 * T14: parallel execution proven + signal seam established.
 * T15: cancellation classes (cancel-class vs report-only gates).
 * T16: teardown + POSIX signal handling (SIGINT⇒130, SIGTERM⇒143).
 *
 * PRD refs: §3.4 (scheduler), §3.4.1 (activation), §3.4.2 (execution policies),
 *           §3.4.3 (cancellation classes), §3.4.4 (teardown), §4.4 (PhaseReport).
 */

import type { StetConfig } from "./config/schema.js";
import type { PhaseReport } from "./schema/report.js";
import { syntheticPhaseReport } from "./schema/report.js";
import type { Scope } from "./scope.js";
import type { PhaseConfiguration } from "./phases/types.js";

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface SchedulerContext {
  cwd: string;
  scope: Scope;
  /** Parsed project config — phases slices are keyed by phase id. */
  config: StetConfig;
  /**
   * Tool-progress callback: called with (phaseId, toolName) each time an agent phase
   * invokes a tool. The scheduler scopes the phase id in before handing a per-phase
   * callback down to PhaseContext.onTool. Absent → no progress reporting (e.g. tests
   * that don't care about liveness). CLI supplies this → stderr in M2+; M9 polishes it.
   */
  onTool?: (phaseId: string, toolName: string) => void;
  /**
   * Scheduler-level cancellation signal (M4). Forwarded to each phase's run context so
   * that a cancel-class gate failure (T15) can abort in-flight agent phases.
   * Absent → no external cancellation (normal operation without gate-triggered abort).
   */
  signal?: AbortSignal;
  /**
   * Combined spec text from --prd/--task/--issue (§3.6, M8/T23).
   * Forwarded to each phase's run context for phases that declare spec consumption.
   * Absent when no spec flags were provided.
   */
  spec?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable reason from an AbortSignal.
 *
 * docs/engineering-notes.md §148-150: always guard with `typeof signal.reason === 'string'`.
 * A caller doing `controller.abort()` with no argument leaves `signal.reason` as a
 * DOMException, not a string — `String(signal.reason)` would produce "AbortError: This
 * operation was aborted" instead of the curated fallback text.
 *
 * The fallback matches agent-phase.ts line 294 so both started and not-yet-started phases
 * emit the same reason text for the same abort.
 */
function abortReason(signal: AbortSignal, fallback = "cancelled by scheduler"): string {
  return typeof signal.reason === "string" ? signal.reason : fallback;
}

// ---------------------------------------------------------------------------
// Report builders for non-running phases
// ---------------------------------------------------------------------------

/**
 * Synthesize a PhaseReport for a non-activated phase.
 * PRD §3.4.1: "Non-activated phases appear in the report as `skipped` with the rule named."
 * PRD §4.5 acceptance #6: every configured phase appears exactly once.
 */
function skippedReport(phase: PhaseConfiguration): PhaseReport {
  // Name the mechanism — the specific human-readable rule is in the PhaseConfiguration's
  // activation predicate description; here we name the mechanism (PRD §3.4.1).
  return syntheticPhaseReport(phase.id, "skipped", {
    reason: "activation: phase predicate returned false",
  });
}

/**
 * Synthesize a PhaseReport for a phase cancelled before it got to run.
 * T15: used when the gate abort signal fires before a phase's activation completes.
 */
function cancelledReport(phase: PhaseConfiguration, reason: string): PhaseReport {
  return syntheticPhaseReport(phase.id, "cancelled", { reason });
}

// ---------------------------------------------------------------------------
// Gate failure detection
// ---------------------------------------------------------------------------

/**
 * A cancel-class gate "fails" (for cancellation purposes) when it completed its run
 * AND reported at least one error-severity finding.
 *
 * PRD §3.4.3: "A gate timeout is always report-only regardless of class — a merely-slow
 * suite must not nuke the AI phases; only a failing gate proves the code doesn't function."
 *
 * status "error" covers both budget expiry (timeout) and spawn failures — both are
 * report-only under this rule. status "completed" with error findings = the gate ran
 * and explicitly reported failure.
 */
function isGateFailure(report: PhaseReport): boolean {
  return report.status === "completed" && report.findings.some((f) => f.severity === "error");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a single phase, enforcing the "never throws" contract boundary.
 *
 * If `phase.run()` throws synchronously or rejects (a bug in the phase), the scheduler
 * catches it and synthesizes an error PhaseReport rather than letting the exception
 * propagate — which would reject the whole Promise.all and lose every other phase's report.
 * Duration is measured around the attempt so the cost field is always populated.
 *
 * This is the "guarantee by construction" principle (PRD "nothing passes silently"):
 * even buggy third-party phases cannot detonate the pipeline.
 */
async function runPhaseGuarded(
  phase: PhaseConfiguration,
  ctx: SchedulerContext,
): Promise<PhaseReport> {
  const start = Date.now();
  try {
    return await phase.run({
      cwd: ctx.cwd,
      scope: ctx.scope,
      config: ctx.config.phases?.[phase.id],
      // Scope the phase id into the scheduler-level callback so PhaseContext.onTool
      // only needs the tool name — the phase doesn't know its own id at call sites.
      onTool: ctx.onTool ? (toolName) => ctx.onTool!(phase.id, toolName) : undefined,
      // Forward the scheduler's cancellation signal so agent phases can abort when
      // a cancel-class gate fails (T15) or the harness tears down (T16).
      signal: ctx.signal,
      // Forward spec context (M8/T23) so phases that consume spec receive it.
      spec: ctx.spec,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      phase: phase.id,
      status: "error",
      reason: `phase violated its contract: ${message}`,
      findings: [],
      audit: {},
      cost: { durationMs: Date.now() - start },
    };
  }
}

/**
 * Run all configured phases and return one PhaseReport per phase, in registration order.
 *
 * Execution model (PRD §3.4.2): all activated phases launch concurrently via Promise.all.
 * Wall-clock ≈ slowest phase (proven by T14).
 *
 * Cancellation classes (T15, PRD §3.4.3):
 * - An internal AbortController (`gateController`) fires when a cancel-class gate fails.
 * - The external scheduler signal (T16: SIGINT/SIGTERM) and the internal gate signal are
 *   merged via AbortSignal.any so either can abort in-flight agent phases.
 * - Cancel-class gate failure: phase.cancelClass === true AND the gate completed with
 *   error-severity findings (status "completed"). A gate timeout (status "error") is always
 *   report-only regardless of cancelClass (PRD §3.4.3 — "only a failing gate proves the code
 *   doesn't function").
 * - Phases that haven't started yet when the abort fires are synthesized as "cancelled".
 * - In-flight agent phases receive the combined signal and return "cancelled" (T15 agent-phase).
 *
 * Non-activated phases → "skipped" with reason. Every phase appears exactly once (acceptance #6).
 * Each phase receives its own config slice; phases validate their own slice.
 *
 * INFALLIBLE: this function never throws. Each phase's `run()` is wrapped in `runPhaseGuarded`,
 * and activation errors are caught inline — the pipeline always completes.
 */
export async function runPhases(
  phases: PhaseConfiguration[],
  ctx: SchedulerContext,
): Promise<PhaseReport[]> {
  // Internal gate-cancellation controller (T15): fires when a cancel-class gate fails.
  const gateController = new AbortController();

  // Merge external cancellation signal (T16: POSIX signals) with the internal gate signal.
  // Either firing aborts all in-flight agent phases. AbortSignal.any propagates the reason
  // of whichever signal fires first, so agent phases see "gates failed: <id>" or the T16 reason.
  const combinedSignal: AbortSignal =
    ctx.signal !== undefined
      ? AbortSignal.any([ctx.signal, gateController.signal])
      : gateController.signal;

  const innerCtx: SchedulerContext = { ...ctx, signal: combinedSignal };

  return Promise.all(
    phases.map(async (phase): Promise<PhaseReport> => {
      // Guard activation() — a throwing activation is a contract violation just like a
      // throwing run(). Catch it here so Promise.all never rejects due to a buggy phase.
      let activated: boolean;
      try {
        activated = phase.activation({ scope: ctx.scope });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          phase: phase.id,
          status: "error",
          reason: `phase violated its contract: activation threw: ${message}`,
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        };
      }

      if (!activated) {
        return skippedReport(phase);
      }

      // T15/T16: if the combined abort signal already fired before this phase starts,
      // cancel it immediately without running. Reachable when the external signal
      // (ctx.signal) is already aborted on entry (T16: a pre-aborted scheduler signal) —
      // an internal gate abort cannot beat this check, since every map callback evaluates
      // it synchronously before any phase's promise can resolve to fire gateController.
      if (combinedSignal.aborted) {
        return cancelledReport(phase, abortReason(combinedSignal));
      }

      const report = await runPhaseGuarded(phase, innerCtx);

      // T15: cancel-class gate failure → abort all other in-flight agent phases.
      // Only trigger if: this phase is cancel-class, the gate hasn't fired yet, and the gate
      // actually FAILED (not timed out or errored internally — those are always report-only).
      if (phase.cancelClass === true && !gateController.signal.aborted && isGateFailure(report)) {
        gateController.abort(`gates failed: ${phase.id}`);
      }

      return report;
    }),
  );
}
