/**
 * Minimal M1 scheduler — runs phases, synthesizes skips.
 *
 * M4 adds: cancellation classes, parallel teardown, signal handling.
 * For M1 all activated phases run via Promise.all (real concurrency is trivial with one phase;
 * the machinery for cancellation and teardown lands in M4).
 *
 * PRD refs: §3.4 (scheduler), §3.4.1 (activation), §4.4 (PhaseReport), §4.5 (RunReport).
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
