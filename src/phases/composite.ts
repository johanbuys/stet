/**
 * Composite phase — parallel specialist execution + roll-up (M7 · PRD §3.3).
 *
 * A composite phase fans out to N specialists in parallel via the AgentRunner seam,
 * then rolls their findings up to a single PhaseReport. Each finding carries its
 * originating specialist. One specialist failing never loses the other specialists'
 * findings — the composite always aggregates and returns "completed".
 *
 * PRD refs: §3.3 (specialists), §4.1 (PhaseConfiguration), §4.4 (PhaseCost, specialists).
 * Plan refs: M7, decisions P1.
 */

import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { runWithWallClock } from "../agent/budgets.js";
import type { AgentError } from "../errors.js";
import type { AgentRunSuccess, AgentRunner, AgentRunInputs } from "../agent/runner.js";
import type { Cost, PhaseReport } from "../schema/report.js";
import { Finding } from "../schema/finding.js";
import type { Result } from "better-result";
import type { ActivationContext, PhaseContext, PhaseConfiguration } from "./types.js";
import type { CoordinatorConfig } from "./coordinator.js";
import { runCoordinatorJudge } from "./coordinator.js";

// ---------------------------------------------------------------------------
// Specialist config
// ---------------------------------------------------------------------------

/**
 * Configuration for a single specialist within a composite phase.
 * PRD §3.3: "each specialist is the same configuration shape (rubric + toolset + model + activation)".
 */
export interface SpecialistConfig {
  /** Unique name within the composite phase — used as the key in cost.specialists and to tag findings. */
  name: string;
  rubric: string;
  /** Tool allowlist. NEVER include edit/write tools (PRD §3.2). */
  toolset: string[];
  submitSchema: TSchema;
  /** Wall-clock enforced per-specialist by runWithWallClock (M3 reuse). */
  budgets: AgentRunInputs["budgets"];
  /** Optional model override; inherits from the phase when omitted. */
  model?: string;
  buildUserPrompt: (ctx: PhaseContext) => string;
  /** Narrows which scope this specialist runs for. Defaults to always-true. */
  activation?: (ctx: ActivationContext) => boolean;
}

// ---------------------------------------------------------------------------
// Composite phase config
// ---------------------------------------------------------------------------

export interface CompositePhaseConfig {
  id: string;
  specialists: SpecialistConfig[];
  /** Optional coordinator judge pass (PRD §3.3a). When present, runners["coordinator"] must exist. */
  coordinator?: CoordinatorConfig;
  activation?: (ctx: ActivationContext) => boolean;
}

// ---------------------------------------------------------------------------
// Internal parallel result types
// ---------------------------------------------------------------------------

interface SpecialistSkipped {
  name: string;
  kind: "skipped";
}

interface SpecialistRan {
  name: string;
  kind: "ran";
  runResult: Result<AgentRunSuccess, AgentError>;
  durationMs: number;
}

type SpecialistOutcome = SpecialistSkipped | SpecialistRan;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function costFromError(error: AgentError): Partial<Cost> {
  if (
    error._tag === "NoSubmitError" ||
    error._tag === "CancelledError" ||
    error._tag === "ModelError"
  ) {
    return {
      model: error.cost.model,
      inputTokens: error.cost.inputTokens,
      outputTokens: error.cost.outputTokens,
    };
  }
  // BudgetError carries no cost sub-object.
  return {};
}

/**
 * Parse and validate findings from a submission payload.
 * Returns the typed array on success, or null on failure.
 * Failure is silent — invalid submissions contribute no findings rather than aborting the roll-up.
 */
function parseFindings(submission: unknown): Finding[] | null {
  if (
    typeof submission !== "object" ||
    submission === null ||
    !Array.isArray((submission as Record<string, unknown>).findings)
  ) {
    return null;
  }
  const raw = (submission as Record<string, unknown>).findings as unknown[];
  const result: Finding[] = [];
  for (const item of raw) {
    if (!Value.Check(Finding, item)) return null;
    result.push(item as Finding);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a composite PhaseConfiguration that fans out to N specialists in parallel.
 *
 * `runners` maps each specialist name to its AgentRunner — one runner per specialist so
 * tests can script each independently with a FakeAgentRunner.
 *
 * INFALLIBLE CONTRACT: run() never throws and never rejects.
 *
 * PRD §3.3; plan M7.
 */
export function makeCompositePhase(
  runners: Record<string, AgentRunner>,
  cfg: CompositePhaseConfig,
): PhaseConfiguration {
  return {
    id: cfg.id,
    kind: "agent",

    // Expose the merged tool allowlist across all specialists for the mutation-free audit.
    toolset: [...new Set(cfg.specialists.flatMap((s) => s.toolset))],

    activation: cfg.activation ?? (() => true),

    async run(ctx: PhaseContext): Promise<PhaseReport> {
      const start = Date.now();

      if (ctx.signal?.aborted) {
        const reason =
          typeof ctx.signal.reason === "string" ? ctx.signal.reason : "cancelled by scheduler";
        return {
          phase: cfg.id,
          status: "cancelled",
          reason,
          findings: [],
          audit: {},
          cost: { durationMs: 0 },
        };
      }

      let parallelResults: SpecialistOutcome[];
      try {
        parallelResults = await Promise.all(
          cfg.specialists.map(async (s): Promise<SpecialistOutcome> => {
            const isActive = (s.activation ?? (() => true))({ scope: ctx.scope });
            if (!isActive) return { name: s.name, kind: "skipped" };

            const runner = runners[s.name];
            if (!runner) {
              throw new Error(`No runner provided for specialist "${s.name}"`);
            }

            const specialistStart = Date.now();
            const controller = new AbortController();

            const runResult = await runWithWallClock(
              runner,
              {
                rubric: s.rubric,
                userPrompt: s.buildUserPrompt(ctx),
                toolset: s.toolset,
                submitSchema: s.submitSchema,
                budgets: s.budgets,
                model: s.model,
                cwd: ctx.cwd,
              },
              controller,
              ctx.signal,
            );

            const durationMs = Date.now() - specialistStart;
            return { name: s.name, kind: "ran", runResult, durationMs };
          }),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          phase: cfg.id,
          status: "error",
          reason: `composite phase threw unexpectedly: ${message}`,
          findings: [],
          audit: {},
          cost: { durationMs: Date.now() - start },
        };
      }

      const allFindings: Finding[] = [];
      const specialistsCost: Record<string, Cost> = {};

      for (const r of parallelResults) {
        if (r.kind === "skipped") continue;

        const { name, runResult, durationMs } = r;

        if (runResult.isOk()) {
          const { submission, cost } = runResult.value;
          const findings = parseFindings(submission) ?? [];
          for (const f of findings) {
            // Overwrite phase + set specialist: provenance is harness-controlled, not model-controlled.
            allFindings.push({ ...f, phase: cfg.id, specialist: name });
          }
          specialistsCost[name] = { ...cost, durationMs };
        } else {
          // Specialist failed: no findings but cost is tracked.
          specialistsCost[name] = { durationMs, ...costFromError(runResult.error) };
        }
      }

      // Coordinator judge pass (PRD §3.3a) — runs after roll-up when configured.
      if (cfg.coordinator) {
        const coordinatorRunner = runners["coordinator"];
        if (!coordinatorRunner) {
          const warnFinding: Finding = {
            id: `${cfg.id}.coordinator-failed`,
            phase: cfg.id,
            severity: "warning",
            confidence: "high",
            message: "Coordinator judge has no runner configured.",
          };
          return {
            phase: cfg.id,
            status: "completed",
            findings: [...allFindings, warnFinding],
            audit: {},
            cost: { durationMs: Date.now() - start, specialists: specialistsCost },
          };
        }

        let outcome: Awaited<ReturnType<typeof runCoordinatorJudge>>;
        try {
          outcome = await runCoordinatorJudge(coordinatorRunner, cfg.coordinator, allFindings, ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const warnFinding: Finding = {
            id: `${cfg.id}.coordinator-failed`,
            phase: cfg.id,
            severity: "warning",
            confidence: "high",
            message: `Coordinator judge threw unexpectedly: ${msg}`,
          };
          return {
            phase: cfg.id,
            status: "completed",
            findings: [...allFindings, warnFinding],
            audit: {},
            cost: { durationMs: Date.now() - start, specialists: specialistsCost },
          };
        }

        if (outcome.kind === "ok") {
          // Coordinator submission replaces the raw roll-up. Provenance is harness-controlled:
          // phase is forced, and specialist is re-derived from the originating finding (matched
          // by id) rather than trusted from the judge — a misbehaving model cannot fabricate a
          // specialist name nor silently drop the field. Findings the judge raises cross-cutting
          // (no id match in the roll-up) correctly carry no specialist.
          const specialistById = new Map(allFindings.map((f) => [f.id, f.specialist]));
          const finalFindings = outcome.findings.map((f) => {
            const { specialist: _modelSupplied, ...rest } = f;
            const origin = specialistById.get(f.id);
            return origin !== undefined
              ? { ...rest, phase: cfg.id, specialist: origin }
              : { ...rest, phase: cfg.id };
          });

          // Constrained authority (PRD #30, §4.6): deterministic/evidence-backed findings
          // (carrying evidence.command) are protected from coordinator drops or from any
          // downgrade of severity *or* confidence. The harness reinstates them unchanged
          // and records them.
          const SEVERITY_RANK = { error: 2, warning: 1, info: 0 } as const;
          const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 } as const;
          const finalFindingById = new Map(finalFindings.map((f) => [f.id, f]));
          const reinstated: { id: string; specialist?: string }[] = [];

          for (const raw of allFindings) {
            if (raw.evidence?.command === undefined) continue; // not protected

            const inFinal = finalFindingById.get(raw.id);
            const wasDropped = inFinal === undefined;
            const wasDowngraded =
              inFinal !== undefined &&
              (SEVERITY_RANK[inFinal.severity] < SEVERITY_RANK[raw.severity] ||
                CONFIDENCE_RANK[inFinal.confidence] < CONFIDENCE_RANK[raw.confidence]);

            if (wasDropped || wasDowngraded) {
              // Reinstate original unchanged — phase is harness-controlled; specialist
              // is already correct on raw (set by the roll-up loop above).
              const reinstatedFinding = { ...raw, phase: cfg.id };
              if (wasDropped) {
                finalFindings.push(reinstatedFinding);
              } else {
                const idx = finalFindings.findIndex((f) => f.id === raw.id);
                finalFindings[idx] = reinstatedFinding;
              }
              finalFindingById.set(raw.id, reinstatedFinding);
              const entry: { id: string; specialist?: string } = { id: raw.id };
              if (raw.specialist !== undefined) entry.specialist = raw.specialist;
              reinstated.push(entry);
            }
          }

          // dropped = roll-up minus survivors after reinstatement (reinstated are survivors).
          const survivorIds = new Set(finalFindings.map((f) => f.id));
          const dropped = allFindings
            .filter((f) => !survivorIds.has(f.id))
            .map((f) => {
              const entry: { id: string; specialist?: string; message: string } = {
                id: f.id,
                message: f.message,
              };
              if (f.specialist !== undefined) entry.specialist = f.specialist;
              return entry;
            });

          return {
            phase: cfg.id,
            status: "completed",
            findings: finalFindings,
            audit: {
              coordinator: {
                received: allFindings.length,
                dropped,
                reinstated,
              },
            },
            cost: {
              durationMs: Date.now() - start,
              specialists: specialistsCost,
              coordinator: outcome.cost,
            },
          };
        }

        // Coordinator failed — fall back to raw roll-up (decision #29: never forfeits findings).
        const failReason = `${outcome.error._tag}: ${outcome.error.message}`;
        const warnFinding: Finding = {
          id: `${cfg.id}.coordinator-failed`,
          phase: cfg.id,
          severity: "warning",
          confidence: "high",
          message: `Coordinator judge failed — ${failReason}. Showing raw specialist roll-up.`,
        };
        return {
          phase: cfg.id,
          status: "completed",
          findings: [...allFindings, warnFinding],
          audit: {},
          cost: { durationMs: Date.now() - start, specialists: specialistsCost },
        };
      }

      // No coordinator — return plain roll-up unchanged.
      return {
        phase: cfg.id,
        status: "completed",
        findings: allFindings,
        audit: {},
        cost: { durationMs: Date.now() - start, specialists: specialistsCost },
      };
    },
  };
}
