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
import { runWithWallClock } from "../agent/budgets.js";
import type { AgentError } from "../errors.js";
import type { AgentRunSuccess, AgentRunner, AgentRunInputs } from "../agent/runner.js";
import type { Cost, PhaseReport } from "../schema/report.js";
import { type Finding, parseFindings } from "../schema/finding.js";
import type { Result } from "better-result";
import type { ActivationContext, PhaseContext, PhaseConfiguration } from "./types.js";
import type { CoordinatorConfig } from "./coordinator.js";
import { runCoordinatorJudge } from "./coordinator.js";
import { classify, type RiskRule } from "../risk/classify.js";

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

/** Maps a resolved risk level to the specialist subset and coordinator on/off (PRD §4.1). */
export interface RiskLevel {
  /** Names of specialists to fan out to at this level. Undefined → all specialists run. */
  specialists?: string[];
  /** Whether the coordinator runs at this level. Defaults to true when undefined. */
  coordinator?: boolean;
}

export interface CompositePhaseConfig {
  id: string;
  specialists: SpecialistConfig[];
  /** Optional coordinator judge pass (PRD §3.3a). When present, runners["coordinator"] must exist. */
  coordinator?: CoordinatorConfig;
  activation?: (ctx: ActivationContext) => boolean;
  /**
   * Deterministic risk rules (PRD §3.4.1a, #32).
   * Evaluated once per run before fan-out via classify(diff, paths, rules) → level.
   * When absent the mechanism is inert — the full panel always runs.
   */
  riskRules?: RiskRule[];
  /**
   * Mapping of resolved level to specialist subset + coordinator on/off.
   * Applied only when riskRules is declared and a level is resolved.
   */
  riskLevels?: Record<string, RiskLevel>;
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
 * Validate the declared risk config at construction time (findings 3 & 4).
 *
 * Risk rules and levels are code-defined (RiskRule.predicate is a function, never
 * deserialized from user YAML), so a mismatch is a programmer error that must fail
 * loudly at startup rather than silently mis-route fan-out at run time:
 *   - a level subset naming an unknown specialist would skip the ENTIRE panel
 *     (`levelSpecialists.has(name)` is false for every real specialist), and
 *   - a rule resolving to a level absent from riskLevels would fall through to the
 *     full panel — silently defeating a rule meant to narrow scope.
 *
 * Throws (outside run()'s infallible boundary) with an actionable message.
 */
function validateRiskConfig(cfg: CompositePhaseConfig): void {
  if (!cfg.riskLevels) return;

  const specialistNames = new Set(cfg.specialists.map((s) => s.name));
  for (const [level, levelCfg] of Object.entries(cfg.riskLevels)) {
    for (const name of levelCfg.specialists ?? []) {
      if (!specialistNames.has(name)) {
        throw new Error(
          `Composite phase "${cfg.id}": riskLevels["${level}"].specialists references unknown ` +
            `specialist "${name}". Known specialists: ${[...specialistNames].join(", ")}.`,
        );
      }
    }
  }

  for (const rule of cfg.riskRules ?? []) {
    if (!(rule.level in cfg.riskLevels)) {
      throw new Error(
        `Composite phase "${cfg.id}": a risk rule resolves to level "${rule.level}" which has no ` +
          `riskLevels entry. Mapped levels: ${Object.keys(cfg.riskLevels).join(", ")}.`,
      );
    }
  }
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
 * INFALLIBLE CONTRACT: run() never throws and never rejects. (Construction-time config
 * validation may throw — see validateRiskConfig — but that is before any run.)
 *
 * PRD §3.3; plan M7.
 */
export function makeCompositePhase(
  runners: Record<string, AgentRunner>,
  cfg: CompositePhaseConfig,
): PhaseConfiguration {
  validateRiskConfig(cfg);

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

      // Risk classification (PRD §3.4.1a, #32): evaluated once before fan-out.
      // With no riskRules the mechanism is inert — full panel runs unchanged.
      let resolvedLevel: string | undefined;
      let levelSpecialists: Set<string> | undefined;
      let skipCoordinatorForLevel = false;

      if (cfg.riskRules && cfg.riskRules.length > 0) {
        resolvedLevel = classify(ctx.diff ?? "", ctx.scope.files, cfg.riskRules);
        const levelCfg = cfg.riskLevels?.[resolvedLevel];
        if (levelCfg) {
          if (levelCfg.specialists !== undefined) {
            levelSpecialists = new Set(levelCfg.specialists);
          }
          if (levelCfg.coordinator === false) {
            skipCoordinatorForLevel = true;
          }
        }
      }

      // Convenience: include resolved level in every completed report (PRD §3.4.1a).
      const levelEntry = resolvedLevel !== undefined ? { level: resolvedLevel } : {};

      let parallelResults: SpecialistOutcome[];
      try {
        parallelResults = await Promise.all(
          cfg.specialists.map(async (s): Promise<SpecialistOutcome> => {
            const isActive = (s.activation ?? (() => true))({ scope: ctx.scope });
            const inLevelSubset = levelSpecialists === undefined || levelSpecialists.has(s.name);
            if (!isActive || !inLevelSubset) return { name: s.name, kind: "skipped" };

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
          ...levelEntry,
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

      // Coordinator judge pass (PRD §3.3a) — runs after roll-up when configured and not
      // suppressed by the risk level (e.g. riskLevels["trivial"].coordinator === false).
      if (cfg.coordinator && !skipCoordinatorForLevel) {
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
            ...levelEntry,
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
            ...levelEntry,
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

          // Constrained authority (PRD #30, §4.6) + drop audit (#31).
          //
          // Both are reconciled against the roll-up by *multiplicity*, not by id alone.
          // A single rule id can legitimately appear N>1 times in one roll-up (a specialist
          // emits one finding per match, all sharing an id). Keying purely by id would
          // (a) reinstate only the first of N dropped protected copies — silently losing the
          // rest (#30) — and (b) under-count drops when the judge keeps one copy but drops its
          // siblings (#31). We hold a per-id pool of surviving finding indices and consume
          // from it greedily so each raw finding is accounted for individually.
          const SEVERITY_RANK = { error: 2, warning: 1, info: 0 } as const;
          const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 } as const;

          const survivorPool = new Map<string, number[]>();
          finalFindings.forEach((f, i) => {
            const pool = survivorPool.get(f.id);
            if (pool) pool.push(i);
            else survivorPool.set(f.id, [i]);
          });

          const reinstated: { id: string; specialist?: string }[] = [];
          const dropped: { id: string; specialist?: string; message: string }[] = [];

          for (const raw of allFindings) {
            const pool = survivorPool.get(raw.id) ?? [];

            if (raw.evidence?.command !== undefined) {
              // Protected: satisfied by any surviving copy the judge did not downgrade in
              // severity or confidence. Consume that copy if present.
              const okPos = pool.findIndex((i) => {
                const s = finalFindings[i]!;
                return (
                  SEVERITY_RANK[s.severity] >= SEVERITY_RANK[raw.severity] &&
                  CONFIDENCE_RANK[s.confidence] >= CONFIDENCE_RANK[raw.confidence]
                );
              });
              if (okPos !== -1) {
                pool.splice(okPos, 1);
                continue;
              }
              // No adequate survivor — the judge dropped or downgraded this copy. Reinstate
              // the original unchanged: replace a downgraded survivor in place if one exists,
              // else append. phase is harness-controlled; specialist is already correct on raw.
              const reinstatedFinding = { ...raw, phase: cfg.id };
              const downgradedPos = pool.shift();
              if (downgradedPos !== undefined) {
                finalFindings[downgradedPos] = reinstatedFinding;
              } else {
                finalFindings.push(reinstatedFinding);
              }
              const entry: { id: string; specialist?: string } = { id: raw.id };
              if (raw.specialist !== undefined) entry.specialist = raw.specialist;
              reinstated.push(entry);
              continue;
            }

            // Non-protected: kept if a surviving copy is available to match it, else dropped.
            if (pool.length > 0) {
              pool.shift();
            } else {
              const entry: { id: string; specialist?: string; message: string } = {
                id: raw.id,
                message: raw.message,
              };
              if (raw.specialist !== undefined) entry.specialist = raw.specialist;
              dropped.push(entry);
            }
          }

          return {
            phase: cfg.id,
            status: "completed",
            ...levelEntry,
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
          ...levelEntry,
          findings: [...allFindings, warnFinding],
          audit: {},
          cost: { durationMs: Date.now() - start, specialists: specialistsCost },
        };
      }

      // No coordinator (or skipped by risk level) — return plain roll-up unchanged.
      return {
        phase: cfg.id,
        status: "completed",
        ...levelEntry,
        findings: allFindings,
        audit: {},
        cost: { durationMs: Date.now() - start, specialists: specialistsCost },
      };
    },
  };
}
