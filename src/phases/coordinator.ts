/**
 * Coordinator judge pass — M7.5 · PRD §3.3a.
 *
 * A coordinator is an optional robust-tier agent that runs after all specialists
 * in a composite phase, reads their roll-up, and produces the final finding set.
 * The coordinator runs through the AgentRunner seam with the same three §3.1 guards
 * as any specialist; its submission replaces the raw roll-up on success, and the
 * phase falls back to the roll-up on failure (decision #29 — never forfeits findings).
 *
 * PRD refs: §3.3a, §4.1 (coordinator config), §4.4 (cost.coordinator), decisions #25, #29.
 * Plan refs: M7.5 steps 1–3.
 */

import { Type } from "@sinclair/typebox";
import { runWithWallClock, FIVE_MINUTE_BUDGETS } from "../agent/budgets.js";
import type { AgentError } from "../errors.js";
import type { AgentRunner } from "../agent/runner.js";
import { SUBMIT_TOOL_NAME } from "../agent/submit-tool.js";
import { Finding, parseFindings } from "../schema/finding.js";
import type { Cost } from "../schema/report.js";
import { Audit } from "../schema/report.js";

// ---------------------------------------------------------------------------
// Coordinator config (PRD §4.1)
// ---------------------------------------------------------------------------

/**
 * Configuration for the coordinator judge pass within a composite phase.
 * PRD §4.1: coordinator is { rubric, model (default tier robust) }.
 */
export interface CoordinatorConfig {
  rubric: string;
  /** Resolved "provider/id" string or tier. undefined → defaults to robust tier. */
  model?: string;
  /** Budget overrides. Defaults to the 5-minute class (same as specialists). */
  budgets?: {
    wallClockMs: number;
    turns: number;
    bashTimeoutMs: number;
    bashOutputCap: number;
  };
  /** Tool allowlist. Defaults to [SUBMIT_TOOL_NAME] — coordinator is a judge, not an investigator. */
  toolset?: string[];
}

// ---------------------------------------------------------------------------
// Submit schema
// ---------------------------------------------------------------------------

/**
 * TypeBox schema for the coordinator's submit_findings payload.
 * Shape mirrors specialist submissions: { findings: Finding[], audit?: Audit }.
 */
export const CoordinatorSubmitSchema = Type.Object(
  {
    findings: Type.Array(Finding),
    audit: Type.Optional(Audit),
  },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the coordinator's per-run user prompt from the raw specialist roll-up.
 * The harness builds this from the findings — no buildUserPrompt in config.
 */
export function buildCoordinatorUserPrompt(rawFindings: Finding[]): string {
  return `Specialist findings to judge (${rawFindings.length} total):\n${JSON.stringify(rawFindings, null, 2)}`;
}

// ---------------------------------------------------------------------------
// Outcome type
// ---------------------------------------------------------------------------

export type CoordinatorJudgeOutcome =
  | { kind: "ok"; findings: Finding[]; cost: Cost & { durationMs: number } }
  | { kind: "err"; error: AgentError; durationMs: number };

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * Run the coordinator judge through the AgentRunner seam (three §3.1 guards apply).
 *
 * Returns Ok with the coordinator's findings and cost on success,
 * or Err with the AgentError and wall-clock durationMs on failure.
 * Never throws — caller's infallible contract is maintained.
 */
export async function runCoordinatorJudge(
  runner: AgentRunner,
  cfg: CoordinatorConfig,
  rawFindings: Finding[],
  phaseCtx: { cwd: string; signal?: AbortSignal },
): Promise<CoordinatorJudgeOutcome> {
  const start = Date.now();
  const controller = new AbortController();

  const result = await runWithWallClock(
    runner,
    {
      rubric: cfg.rubric,
      userPrompt: buildCoordinatorUserPrompt(rawFindings),
      toolset: cfg.toolset ?? [SUBMIT_TOOL_NAME],
      submitSchema: CoordinatorSubmitSchema,
      budgets: cfg.budgets ?? FIVE_MINUTE_BUDGETS,
      model: cfg.model,
      cwd: phaseCtx.cwd,
    },
    controller,
    phaseCtx.signal,
  );

  const durationMs = Date.now() - start;

  if (result.isOk()) {
    const { submission, cost } = result.value;
    // Coordinator ingests harness-stamped findings → validates against full Finding (default).
    const findings = (parseFindings(submission) as Finding[] | null) ?? [];
    return { kind: "ok", findings, cost: { ...cost, durationMs } };
  }

  return { kind: "err", error: result.error, durationMs };
}
