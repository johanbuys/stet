/**
 * Phase abstraction — the PhaseConfiguration contract.
 *
 * Implements the in-code side of the PhaseConfiguration contract from harness PRD §4.1.
 * Only M1-relevant fields are present here; agent-phase fields (rubric, toolset, model,
 * extension, budgets, specialists, coordinator, riskRules, riskLevels) arrive in M2+.
 *
 * The serialized §4.1 contract carries additional fields that the runtime schema handles at the
 * wire boundary; this in-code interface is the minimum a phase must satisfy to be registered and
 * run by the M1 deterministic tracer spine.
 */

import type { PhaseId } from "../schema/finding.js";
import type { PhaseReport } from "../schema/report.js";
import type { Scope } from "../scope.js";

/**
 * Inputs every activation predicate sees (PRD §3.4.1).
 * M1 slice: diff file list only — spec presence and full config arrive in M5/M8.
 */
export interface ActivationContext {
  scope: Scope;
}

/**
 * Per-run inputs handed to a phase's run().
 * `config` is the phase's own slice of user/project config — untyped at the seam
 * so the registry stays config-schema-agnostic; each phase validates its own slice.
 */
export interface PhaseContext {
  cwd: string;
  scope: Scope;
  /**
   * This phase's slice of user config (e.g. stub-det's { command }).
   * Untyped at the seam — each phase validates its own.
   */
  config: unknown;
  /**
   * Per-phase tool-progress callback; the scheduler supplies it from SchedulerContext.onTool,
   * scoped to this phase's id. Deterministic phases ignore it; agent phases forward it to
   * the runner so that tool invocations are reported to the caller (e.g. stderr liveness).
   */
  onTool?: (toolName: string) => void;
  /**
   * Scheduler cancellation signal (M4). When fired, the phase should abort its work.
   * Agent phases wire this into the wall-clock controller so either a budget expiry or
   * a scheduler cancel can abort the runner (T14/T15).
   */
  signal?: AbortSignal;
}

/**
 * The in-code PhaseConfiguration contract (PRD §4.1, M1/M2 slice).
 *
 * A phase is a pure data value — no class, no inheritance.
 * Adding a sixth phase is one new file + one `registerPhase(...)` call; no harness code changes.
 *
 * INFALLIBLE CONTRACT: `run` never throws and never rejects. Internal failures must be
 * converted to a PhaseReport with `status: "error"` and a `reason`. This is the phase boundary.
 */
export interface PhaseConfiguration {
  /** Open kebab-case identifier (decision #28). Built-in set: "gates" | "spec" | "review" | "test-quality" | "behavioral". */
  id: PhaseId;
  kind: "deterministic" | "agent";
  /**
   * Pure predicate: should this phase run for this scope?
   * Non-activated phases appear as `skipped` with a named reason (the scheduler's job, T6).
   */
  activation: (ctx: ActivationContext) => boolean;
  /**
   * Execute the phase. INFALLIBLE BY CONTRACT: never throws, never rejects.
   * Internal failures become a PhaseReport with status "error" and a reason.
   * better-result Results are used internally; the phase boundary converts them.
   */
  run: (ctx: PhaseContext) => Promise<PhaseReport>;
  /**
   * Agent phases expose their tool allowlist so the mutation-free invariant
   * (PRD §3.2, acceptance #2) is auditable on the registered phase itself.
   * Absent for deterministic phases.
   * M2+: set by makeAgentPhase(); deterministic phases (stub-det) leave it undefined.
   */
  toolset?: string[];
}
