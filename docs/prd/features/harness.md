# Feature PRD: Harness

**Status:** draft — 2026-06-06.
**Depends on:** `docs/prd/stet-prd.md` (high-level PRD §4, §6, §8).
**Draws on:** `docs/research/behavioral-validation-findings.md` + proven contracts mined from the
`validation-agent-poc` repo (`src/{validate,prompt,schema}.ts`).
**Companion overview:** `harness-overview.html` (visual walkthrough for review).
**Downstream:** every other feature PRD writes against the contracts defined here.

---

## 1. What the harness is

The harness is stet's shared substrate: the one engine that all five phases run on. It owns
everything common — scope detection, config, the scheduler, the agent runner, the findings
schema, output-as-tool, report aggregation, output formats, budgets, cost accounting, and the
exit-code contract.

A **phase** is reduced to a configuration of the harness:

```
PhaseConfiguration = {
  id          "gates" | "spec" | "review" | "test-quality" | "behavioral"
  kind        "deterministic" | "agent"
  activation  predicate over (diff, spec presence, config)
  — agent phases only —
  rubric      constant system prompt (cacheable)
  toolset     allowlist of harness tools (never includes edit/write)
  model       default "provider/id", overridable via config routing
  extension   phase-specific additions to the submit-tool schema (e.g. Phase 5 claims/checks)
  budgets     overrides for time/turn defaults
}
```

If a capability is needed by two or more phases, it belongs to the harness. If it is needed by
one, it belongs to that phase's feature PRD (e.g. `start_service` → behavioral-engine).

## 2. In scope / out of scope

**In scope:** phase lifecycle + scheduler, agent runner (Pi SDK integration), findings schema +
report aggregation, output-as-tool with its guards, scope detection, spec-context plumbing, config
loading + precedence, output formats (human/JSON), progress streaming, exit codes, budgets and
safety limits, per-phase cost accounting.

**Out of scope (other PRDs):** gate detection heuristics and gate execution details
(`deterministic-gates`), the `init` exploration agent (`init`), all phase rubrics, behavioral
execution tools (`start-service`, `pty-session`, `browser-execution`), the eval suite
(`eval-suite`).

## 3. Data model

The schema is the product's API: agents submit it, loops consume it, the exit code derives from
it. Generalized from the POC's proven `ValidationResultSchema`; defined with TypeBox (runtime
validation is what makes output-as-tool enforceable).

### 3.1 Finding

```ts
Finding = {
  id:         string                          // stable rule id, phase-namespaced:
                                              // "gates.test-failed", "gates.no-linter-configured",
                                              // "spec.requirement-unmet", "review.bug",
                                              // "test-quality.tautological", "behavioral.claim-failed",
                                              // "behavioral.not-run" …
  phase:      PhaseId
  severity:   "error" | "warning" | "info"    // the gating vocabulary
  confidence: "high" | "medium" | "low"       // see 3.5 — deterministic and evidence-backed
                                              // findings are "high" by construction
  message:    string                          // what is wrong, stated against what it violates
  location?:  { file: string, line?: number, endLine?: number }
  evidence?:  { command?: string, output?: string }   // executable evidence; a Phase 5 `failed`
                                              // MUST carry the reproducing command here
  suggestion?: string                         // suggested next action (POC: suggested_next_action)
  meta?:      object                          // phase-specific extension; e.g. Phase 5 carries
                                              // priority: critical|high|medium|low here — finer
                                              // granularity preserved without a second gating vocab
}
```

**Severity unification decision:** one gating vocabulary (`error/warning/info`) everywhere. The
POC's `critical/high/medium/low` failure granularity survives as `meta.priority` on behavioral
findings. No information loss; one threshold mechanism.

### 3.2 Audit (first-class, every phase)

The POC's `checks[]` + claims buckets are what make a verdict *auditable* — generalized to all
phases as the anti-silent-green mechanism: a green report always shows what was actually examined.

```ts
Audit = {
  examined?: string[]                         // files/surfaces/requirements considered
  checks?:   Check[]                          // every concrete command run
  claims?:   { derived: string[], proven: string[], unproven: string[] }   // Phase 5
}

Check = {
  name:     string                            // "Run on valid input"
  type:     string                            // test_command | cli_run | http_call | file_check | …
  command?: string
  status:   "passed" | "failed" | "blocked" | "skipped"
  evidence: string                            // output / exit code / artifact reference
}
```

### 3.3 PhaseReport

```ts
PhaseReport = {
  phase:    PhaseId
  status:   "completed"      // ran to the end and submitted (may contain findings)
          | "skipped"        // activation rule or config said don't run — reason names why
          | "cancelled"      // scheduler cancelled it (gate failure / Ctrl-C) — never silent
          | "error"          // the phase itself broke (model unavailable, budget exhausted …)
  reason?:  string            // required for skipped | cancelled | error
  findings: Finding[]
  audit:    Audit
  cost:     { model?: string, inputTokens?: number, outputTokens?: number, durationMs: number }
}
```

Skips that the high-level PRD mandates surface as findings, not just statuses: Phase 5 skipped
for lack of a spec ⇒ `behavioral.not-run` (warning) *and* `status: "skipped"`. A skipped phase
with a warning finding is how "did not run" stays visible to `--fail-on warning` callers.

### 3.4 RunReport (the aggregate)

```ts
RunReport = {
  version: 1                                  // schema version; bumped on breaking change
  scope:   { kind: "staged"|"working"|"against"|"commit"|"commits",
             ref?: string, files: string[] }
  spec:    { provided: boolean, sources: string[] }   // e.g. ["--prd auth.md", "--issue 42"]
  phases:  PhaseReport[]                      // one entry per configured phase, ALWAYS —
                                              // skipped/cancelled phases included with reasons
  result:  { exitCode: 0|1|2, failOn: Severity,
             gating: { phase, id, message }[] }       // exactly which findings caused exit 1
  cost:    { totalInputTokens, totalOutputTokens, durationMs }
}
```

Cost accounting is first-class (resolves overview §12): loops budget per-run; the report carries
per-phase and total cost.

### 3.5 Confidence rules

- **Deterministic findings** (Phase 1) are always `confidence: "high"` — a failing test run is
  not an opinion.
- **Evidence-backed findings** — any finding carrying `evidence.command` (Phase 5 faileds) — are
  `"high"` by construction. A reproducing command is proof; the confidence filter exists for
  opinions, not evidence.
- **AI-judgment findings** (phases 2–4, and Phase 5 inconclusives) carry model-assigned
  confidence and gate only at `"high"` (high-level PRD §6: sub-high-confidence AI findings never
  cause exit 1).

## 4. Output-as-tool (the agent completion contract)

Each agent phase gets exactly one way to finish: a `submit_findings` tool whose parameter schema
is `{ findings, audit }` plus the phase's `extension`. Ported from the POC with all three
eval-earned guards:

1. **Schema-validate-or-retry.** Tool input is validated against the schema at the tool boundary;
   invalid input rejects the call and the model retries. Loose freetext in, rigorous JSON out
   (D7).
2. **Idempotency.** First successful submission wins; duplicates get "already recorded — stop
   now." (Observed in evals: some models submit 10–13×.)
3. **No-submit fallback.** If the agent ends its turn without submitting, the harness synthesizes
   a `PhaseReport` with `status: "error"`, reason "agent finished without submitting", and a
   warning finding `<phase>.no-result` — a phase can never silently vanish from the report.

## 5. Agent runner

The Pi SDK integration, lifted from the POC recipe (`@earendil-works/pi-coding-agent` — the
proven stack; the behavioral-engine PRD confirms the `badlogic/pi-mono` relationship before
pinning):

- `createAgentSession` per phase run, with `systemPromptOverride` replacing the coding-agent
  persona entirely with the phase rubric; user prompt carries the per-run inputs (diff summary,
  spec context, run-instructions) as freetext.
- **Mutation-free at the tool-registration boundary:** the session's tool list is the phase's
  allowlist (`read`, `bash`, `grep`, `find`, `ls`, `submit_findings`, plus Phase 5's execution
  tools). Edit/write tools are never registered. There is no code path on which an agent phase
  can mutate the repo.
- In-memory session + settings managers; compaction enabled; SDK-level retry (max 2).
- **Model routing:** `"provider/id"` strings resolved via the SDK's model registry; per-phase
  default from the `PhaseConfiguration`, overridable in `stet.config.yml` (`phases.<id>.model`)
  and by `--model <phase>=<provider/id>` for one-off runs. Unresolvable model ⇒ phase `error`
  report (named reason), not a crash of the whole run.
- Progress events (`tool_execution_start`) stream to stderr so a human sees liveness without
  corrupting machine-readable stdout.

## 6. Scheduler

### 6.1 Activation

Before launch, each configured phase's activation predicate is evaluated against (diff file list,
spec presence, config). Built-in rules:

| Phase | Activates when |
|---|---|
| gates | always (unless `--skip-gates` / config) |
| spec | spec context present |
| review | diff non-empty |
| test-quality | diff touches test files, or diff adds non-test code (for the no-tests finding) |
| behavioral | diff touches runnable surfaces AND spec present |

Non-activated phases appear in the report as `skipped` with the rule named. Mandated visibility
findings (e.g. `behavioral.not-run` when surfaces changed but no spec was given) are emitted by
the harness at activation time.

### 6.2 Execution policies

- **`parallel` (default):** all activated phases launch concurrently. Wall-clock ≈ slowest phase.
- **`sequential`:** gates → static phases → behavioral, stopping per the cancellation rules below
  — for cost-conscious callers.
- **`--continue-on-failure`:** disables cancellation entirely; everything runs to completion.

### 6.3 Fail-fast cancellation (the gate signal)

Gates are split into two classes:

- **Cancel class** — gates proving the code doesn't function: **tests, types, build**. A failure
  here cancels in-flight AI phases (their reports: `cancelled`, reason "gates failed: <gate>").
- **Report-only class** — style gates: **lint, format**. Failures become findings but do not
  cancel; a lint error does not invalidate a behavioral run.

Class membership is overridable per gate in config (`gates.<name>.cancel: true|false`).

### 6.4 Teardown

Cancellation (gate-triggered or Ctrl-C/SIGTERM) must be total: agent sessions disposed, child
processes killed (process groups), Phase 5 services torn down (delegated to `start_service`'s
guaranteed-teardown contract). A second Ctrl-C force-kills. The report is still written on
interrupt, with `cancelled` statuses — a partial run produces a partial report, never nothing.

## 7. Budgets & safety limits

The POC ran with no limits and produced 300s+ hangs in evals; the harness makes limits the
default:

| Limit | Default | On breach |
|---|---|---|
| per-phase wall clock | 5 min (agent), 10 min (gates, behavioral) | phase `error`, reason "budget exceeded", partial audit preserved |
| per-phase turn count | 50 | same |
| bash command timeout | 60 s | command killed; output so far returned to the agent (it can react) |
| bash output cap | 32 KB per call, truncation marked | truncated marker visible to agent |

All overridable per phase in config. A budget breach is always a named `error` report — never a
silent hang or a silent kill.

## 8. Scope detection & inputs

Carried from v1/high-level PRD, owned by the harness:

- Auto-detection priority: staged → working tree → branch vs default branch → last commit.
  Detected scope always echoed in the report and human output.
- Explicit flags `--staged | --working | --against <ref> | --commit <sha> | --commits <range>`
  override; conflicting flags are an immediate exit-2 error.
- Nothing detectable (clean tree on the default branch) ⇒ clear message, exit 2.
- Spec context: `--prd <file|-|literal>`, `--task <string>`, `--issue <n>` (delegates to `gh`),
  combinable; concatenated and handed to phases that declare they consume spec context.
- **Large diffs:** v1 left this open; decision — **degrade with visibility, don't chunk** (v1
  scope). When the diff exceeds a phase's context budget, the phase analyzes the highest-signal
  subset (changed files ranked by churn) and the harness emits `<phase>.partial-coverage`
  (warning) naming what was excluded. No silent truncation — same ethos as hygiene findings.

## 9. Configuration

`stet.config.yml` at the repo root. Precedence: **flags > config > built-in defaults**. Harness-
owned sections (others defined in their feature PRDs):

```yaml
scheduler:                  # parallel | sequential; continueOnFailure
phases:
  <id>:
    enabled: true|false
    model: provider/id      # routing override
    budgets: { wallClockMs, turns }
gates:
  <name>: { cancel: true|false }   # cancellation class override
output:
  format: human|json
  failOn: error|warning|info
ignore: [paths]
```

Malformed config ⇒ exit 2 with the YAML error and path; unknown keys ⇒ warning (forward
compatibility), not error.

## 10. Output & exit codes

- **human (default):** findings grouped by phase, severity-colored, locations as `file:line`;
  per-phase status lines including skipped/cancelled reasons; cost summary footer. Progress to
  stderr while running.
- **`--format json`:** the `RunReport`, exactly, on stdout; nothing else on stdout. Versioned via
  `version`.
- **`--quiet`:** suppress passing phases and progress; findings only.
- **Exit codes:** `0` clean at threshold · `1` ≥1 gating finding · `2` tool error. A finding
  gates iff `severity ≥ failOn` **and** `confidence == "high"`. The report's `result.gating`
  lists exactly which findings caused exit 1 — no parsing required to answer "why did it fail?".
- SARIF: deferred (v1.x), enabled by the stable `Finding` shape.

## 11. Acceptance criteria

1. A `PhaseConfiguration` (id, kind, activation, rubric, toolset, model, extension) is sufficient
   to register a runnable phase; adding a sixth phase touches no harness code.
2. Agent phases cannot mutate the repo: no edit/write tool is registerable through the harness
   toolset API (enforced by construction, verified by a test that asserts the registered tool
   list).
3. `submit_findings` input failing schema validation is rejected and retried; a duplicate
   submission is ignored with the "already recorded" reply; an agent ending without submitting
   yields a synthesized `error` report with a `<phase>.no-result` warning finding.
4. With the default `parallel` policy, total wall-clock for a run where all phases pass is within
   10% of the slowest single phase (measured with stub phases).
5. A cancel-class gate failure cancels in-flight agent phases; their reports appear as
   `cancelled` with the gate named; a report-only gate failure cancels nothing and yields a
   finding.
6. Every configured phase appears in every `RunReport` exactly once, regardless of outcome.
7. Budget breaches (wall-clock, turns, bash timeout) produce `error`/truncation outcomes exactly
   as specified in §7 — verified with a deliberately-hanging stub phase and a `sleep` command.
8. Exit code policy: a high-confidence error finding ⇒ exit 1; the same finding at medium
   confidence ⇒ exit 0 (default `failOn: error`); `--fail-on warning` additionally gates
   warnings; `result.gating` names the responsible findings.
9. Ctrl-C mid-run kills all children and services, writes the partial report with `cancelled`
   statuses, and exits 2.
10. `--format json` emits only the `RunReport` on stdout (validated against the schema in tests);
    progress and human chrome go to stderr.
11. Conflicting scope flags, undetectable scope, malformed config each produce exit 2 with a
    distinct, actionable message.
12. Per-phase and total token/duration cost appear in every report for agent phases.

## 12. Edge cases

- **Not a git repo / detached HEAD / shallow clone:** scope detection degrades in that order:
  explicit flags still work where the underlying refs exist; otherwise exit 2 with the specific
  limitation named.
- **Empty diff in scope:** valid run; phases activate per rules (most skip); report says so;
  exit 0.
- **Model unavailable / auth missing for one phase:** that phase reports `error` with the SDK's
  reason; other phases are unaffected; exit code computed from what did run (plus the error
  phase's `<phase>.no-result` warning).
- **Two stet runs concurrently in one repo:** phases 1–4 are read-only and safe; Phase 5 port
  collisions are the behavioral-engine PRD's isolation concern; the harness contributes a
  per-run temp/workspace namespace.
- **Spec file unreadable / `gh` missing for `--issue`:** exit 2 before any phase launches (fail
  fast on inputs), with the v1-specified helpful messages.
- **Findings with no location** (e.g. "no linter configured"): valid — `location` is optional;
  human output groups them under the phase, not a file.

## 13. Open questions (deliberately deferred)

- **Result streaming:** should phases stream findings as they're found (NDJSON event mode) for
  long behavioral runs, or only the final report? Deferred until a consumer needs it; the
  `RunReport` contract is unaffected.
- **Caching:** re-running on an unchanged scope could reuse phase reports (cache key: scope hash ×
  phase config hash). v1.x roadmap item; requires deterministic report serialization, which the
  schema already provides.
- **SARIF mapping** of `Finding` (v1.x).
