/**
 * Eval runner — orchestrates fixture → specialist → grade → metrics pipeline (TDD C·3).
 *
 * At M3 (scaffold): works with CassetteRunner for deterministic tests (no creds).
 * At M5 (live): used by eval:live with real specialists + OpenAI embedder.
 *
 * For each fixture, the runner builds a deterministic AgentRunInputs from the
 * fixture id and diff, delegates to the provided AgentRunner, parses findings
 * from the submission, and grades them against the fixture's expected set.
 *
 * Key design: userPrompt = buildFixturePrompt(fixture). This is the documented
 * cassette-key input so tests can pre-populate CassetteRunner.fromStore with
 * exactly-matched entries using computeCassetteKey({ rubric: EVAL_RUBRIC, userPrompt }).
 */

import { parseFindings } from "../schema/finding.js";
import { Finding } from "../schema/finding.js";
import type { AgentRunner, AgentRunInputs } from "../agent/runner.js";
import type { EmbedFn, GraderConfig, GradeResult } from "./grader.js";
import { gradeFindings } from "./grader.js";
import type { Fixture } from "./fixture.js";
import type { Finding as FindingType } from "../schema/finding.js";
import type { EvalBaseline, GateCheck } from "./metrics.js";
import { computeMetrics, checkGate, DEFAULT_GATE_EPSILON } from "./metrics.js";

// ---------------------------------------------------------------------------
// Eval rubric — the system prompt for the M3 eval specialist
// ---------------------------------------------------------------------------

/**
 * Placeholder rubric for the M3 eval scaffold.
 * Replaced by the real specialist rubric in M5 (bugs / security / quality).
 * Part of the cassette key — changing this string invalidates existing cassettes.
 */
export const EVAL_RUBRIC =
  "You are a code-review specialist. Review the provided diff for bugs, security issues, and quality problems. Submit your findings using submit_findings.";

// ---------------------------------------------------------------------------
// Prompt builder — deterministic, documented key input
// ---------------------------------------------------------------------------

/**
 * Build the userPrompt for a fixture run.
 *
 * Format: `diff:\n<diff>` followed by `\n\nfile: <path>\n<content>` for each baseFile.
 * This is the documented format — cassette keys depend on this exact output.
 */
export function buildFixturePrompt(fixture: Fixture): string {
  const parts: string[] = [`diff:\n${fixture.diff}`];
  if (fixture.baseFiles) {
    for (const [path, content] of Object.entries(fixture.baseFiles)) {
      parts.push(`file: ${path}\n${content}`);
    }
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalRunConfig {
  /** System prompt / specialist rubric. Defaults to EVAL_RUBRIC. */
  rubric?: string;
  /** Embedding function (injectable). Real: makeOpenAIEmbedder; tests: fake. */
  embed: EmbedFn;
  /** Grader algorithm overrides. */
  graderCfg?: GraderConfig;
  /** Committed baseline for the regression gate. If absent, gate is skipped. */
  baseline?: EvalBaseline;
  /** Regression gate tolerance (default DEFAULT_GATE_EPSILON = 0.05). */
  epsilon?: number;
}

export interface FixtureEvalResult {
  fixture: Fixture;
  findings: FindingType[];
  gradeResult: GradeResult;
}

export interface EvalRunResult {
  fixtureResults: FixtureEvalResult[];
  /** Aggregate metrics across all fixtures. */
  metrics: ReturnType<typeof computeMetrics>;
  /** Present when cfg.baseline is supplied. */
  gateCheck?: GateCheck;
}

// ---------------------------------------------------------------------------
// budgets / toolset defaults for M3 eval runner
// ---------------------------------------------------------------------------

const EVAL_BUDGETS: AgentRunInputs["budgets"] = {
  wallClockMs: 120_000,
  turns: 30,
  bashTimeoutMs: 30_000,
  bashOutputCap: 100_000,
};

// ---------------------------------------------------------------------------
// runEval
// ---------------------------------------------------------------------------

/**
 * Run the full eval pipeline: fixture → runner → grade → aggregate metrics.
 *
 * For each fixture:
 *   1. Build AgentRunInputs (rubric + buildFixturePrompt(fixture) + eval budgets).
 *   2. Call runner.run(inputs). On Err (cassette miss, no creds, etc.) → empty findings.
 *   3. Parse findings from the submission using parseFindings.
 *   4. Grade findings against fixture.expected via gradeFindings.
 *
 * Aggregate gradeResults into EvalMetrics, apply gate check if baseline supplied.
 *
 * @param fixtures  Fixtures to evaluate (use ALL_FIXTURES for full eval).
 * @param runner    AgentRunner — CassetteRunner for tests, real runner for live.
 * @param cfg       Config including embed fn, optional baseline, optional rubric.
 */
export async function runEval(
  fixtures: ReadonlyArray<Fixture>,
  runner: AgentRunner,
  cfg: EvalRunConfig,
): Promise<EvalRunResult> {
  const rubric = cfg.rubric ?? EVAL_RUBRIC;
  const fixtureResults: FixtureEvalResult[] = [];

  for (const fixture of fixtures) {
    const userPrompt = buildFixturePrompt(fixture);
    const inputs: AgentRunInputs = {
      rubric,
      userPrompt,
      toolset: [],
      submitSchema: Finding,
      budgets: EVAL_BUDGETS,
      cwd: process.cwd(),
    };

    const agentResult = await runner.run(inputs);
    const findings: FindingType[] = agentResult.isOk()
      ? (parseFindings(agentResult.value.submission) ?? [])
      : [];

    const gradeResult = await gradeFindings(
      findings,
      fixture.expected,
      fixture.clean,
      cfg.embed,
      cfg.graderCfg,
    );

    fixtureResults.push({ fixture, findings, gradeResult });
  }

  const gradeInputs = fixtureResults.map(({ fixture, gradeResult }) => ({ fixture, gradeResult }));
  const metrics = computeMetrics(gradeInputs);

  let gateCheck: GateCheck | undefined;
  if (cfg.baseline !== undefined) {
    gateCheck = checkGate(metrics, cfg.baseline, cfg.epsilon ?? DEFAULT_GATE_EPSILON);
  }

  return { fixtureResults, metrics, gateCheck };
}
