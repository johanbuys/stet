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

import type { StetConfig } from "./schema/config.js";
import type { PhaseReport } from "./schema/report.js";
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
}

// ---------------------------------------------------------------------------
// Skipped report builder
// ---------------------------------------------------------------------------

/**
 * Synthesize a PhaseReport for a non-activated phase.
 * PRD §3.4.1: "Non-activated phases appear in the report as `skipped` with the rule named."
 * PRD §4.5 acceptance #6: every configured phase appears exactly once.
 */
function skippedReport(phase: PhaseConfiguration): PhaseReport {
  return {
    phase: phase.id,
    status: "skipped",
    // Name the mechanism — the specific human-readable rule is in the PhaseConfiguration's
    // activation predicate description; here we name the mechanism (PRD §3.4.1).
    reason: "activation: phase predicate returned false",
    findings: [],
    audit: {},
    cost: { durationMs: 0 },
  };
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
 * - Activated phases run concurrently via Promise.all (all promises start before the await).
 *   Real cancellation machinery and scheduler policies arrive in M4.
 * - Non-activated phases are synthesized as `skipped` with the rule named.
 * - Every configured phase appears exactly once (PRD §4.5 acceptance #6).
 * - Each phase receives its own config slice (`config.phases?.[id]`).
 *   Phases validate their own slice; the scheduler passes it through untyped.
 *
 * INFALLIBLE: this function never throws. Each phase's `run()` is wrapped in
 * `runPhaseGuarded`, which catches any throw/rejection and synthesizes a
 * PhaseReport { status: "error" } so the pipeline always completes.
 */
export async function runPhases(
  phases: PhaseConfiguration[],
  ctx: SchedulerContext,
): Promise<PhaseReport[]> {
  return Promise.all(
    phases.map((phase) => {
      // Guard activation() — a throwing activation is a contract violation just like a
      // throwing run(). Catch it here so the Promise.all never rejects due to a buggy phase.
      let activated: boolean;
      try {
        activated = phase.activation({ scope: ctx.scope });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Promise.resolve<PhaseReport>({
          phase: phase.id,
          status: "error",
          reason: `phase violated its contract: activation threw: ${message}`,
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        });
      }
      return activated ? runPhaseGuarded(phase, ctx) : Promise.resolve(skippedReport(phase));
    }),
  );
}
