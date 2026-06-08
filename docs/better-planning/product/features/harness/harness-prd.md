# Feature PRD: Harness

**Status:** settled — 2026-06-07. Review round 1 (2026-06-06) and round 2 (2026-06-07, canvas)
resolved and folded in. Round 2 landed the harness-only steel-thread scoping (brief direction 8,
decision #24), closed #20–23, and added the worked contract examples (§4.10). Restructured to
the standard feature-PRD shape along the way.
**Brief:** `harness-brief.md` (settled 2026-06-06) — the alignment record this PRD drafts from.
**Depends on:** `docs/better-planning/product/stet-prd.md` (high-level PRD §4, §6, §8).
**Draws on:** `docs/better-planning/research/behavioral-validation-findings.md` + proven contracts mined from the
`validation-agent-poc` repo (`src/{validate,prompt,schema}.ts`).
**Companion:** `harness-prd-overview.html` (visual walkthrough for review).
**Downstream:** every other feature PRD writes against the contracts in §4.

---

## 1. Overview

The harness is stet's shared substrate: the one engine that all five phases run on. It owns
everything common — scope detection, config, the scheduler, the agent runner, the findings
schema, output-as-tool, report aggregation, output formats, budgets, cost accounting, and the
exit-code contract. A **phase** is reduced to a configuration of the harness (the
`PhaseConfiguration` contract, §4.1); adding a sixth phase must touch no harness code.

**The boundary rule:** if a capability is needed by two or more phases, it belongs to the
harness. If it is needed by one, it belongs to that phase's feature PRD (e.g. `start_service` →
behavioral-engine).

**The harness ships with no real phase** (decision #24, from brief direction 8): its build
scope includes two **stub phases** that prove every contract end-to-end — the steel thread —
before any real phase exists; real phases integrate via their own feature plans (§3.9).

**In scope:** phase lifecycle + scheduler, agent runner (Pi SDK integration), findings schema +
report aggregation, output-as-tool with its guards, scope detection, spec-context plumbing, config
loading + precedence, output formats (human/JSON), progress streaming, exit codes, budgets and
safety limits, per-phase cost accounting, and the two stub phases + steel thread (§3.9).

**Out of scope (other PRDs):** *all real phases* — including Phase 1 — each integrating via its
own feature PRD/plan against the §4.1 contract; gate detection heuristics and gate execution
details (`deterministic-gates`), the `init` exploration agent (`init`), all phase rubrics,
behavioral execution tools (`start-service`, `pty-session`, `browser-execution`), the eval suite
(`eval-suite`).

## 2. User stories

**Humans running stet**

1. As a human developer, I want to run `stet` with zero arguments and have it detect what to
   verify, so that checking my work costs nothing to start.
2. As a human developer, I want findings grouped by phase, severity-colored, with `file:line`
   locations, so that I can jump straight to what's wrong.
3. As a human developer, I want every green phase to show what it actually examined, so that
   "no findings" never quietly means "nothing was checked".
4. As a human developer, I want `--skip <phase>` and `--only <phase>`, so that I can target the
   verification I need right now.
5. As a human developer, I want progress on stderr while phases run, so that I see liveness
   without corrupting output I'm redirecting.
6. As a human developer, I want Ctrl-C to tear everything down and still write the partial
   report, so that an interrupted run isn't a wasted run.

**AI agents and autonomous loops**

7. As an AI agent invoked at the end of a task, I want `--format json` to put exactly the
   versioned `RunReport` on stdout, so that I can parse findings without scraping human chrome.
8. As an AI agent, I want findings to carry a message, evidence, and a suggested next action,
   so that I can remediate without re-deriving the problem.
9. As an autonomous loop (ideoshi-code), I want exit codes alone to distinguish clean /
   findings / tool error / interrupted, so that I can branch without parsing anything.
10. As an autonomous loop, I want `result.gating` to name exactly which findings caused exit 1,
    so that "why did it fail?" needs no analysis.
11. As an autonomous loop, I want per-phase and total cost in every report, so that I can budget
    verification per iteration.
12. As an autonomous loop, I want a single `--budget thorough` preset, so that I can trade
    latency for completeness without tuning four numbers.
13. As a loop operator whose wrapper kills runs on a timeout, I want SIGTERM to exit 143 with a
    partial report, so that I can tell "my timeout fired, partial findings usable" from "stet
    malfunctioned, trust nothing" (exit 2).
14. As an autonomous loop, I want a phase that didn't run to surface as `skipped` with a reason —
    and, where mandated, as a warning finding — so that "verification didn't happen" can never
    look like "verification passed".

**CI systems**

15. As a CI system, I want headless, no-TTY operation with deterministic output streams, so that
    stet can be the merge gate in a container.
16. As a CI maintainer, I want the CI run to use pinned model routing while local runs stay
    advisory, so that the binding verdict is reproducible.
17. As a strict-CI policy owner, I want `--fail-on warning`, so that skipped behavioral
    verification, blocked claims, and unqualified models also block the merge.

**Teams and model routing**

18. As a team lead, I want the checked-in project config to speak capability tiers and never name
    providers, so that one config works for every teammate's subscriptions.
19. As a teammate with different credentials, I want tiers resolved at run time against the
    providers I actually hold, so that the same repo config picks the best model I have.
20. As a user with no config at all, I want every agent phase to resolve a model via tier
    defaults — or a preflight failure with an actionable message before anything launches — so
    that I never burn half a run to discover a missing credential.
21. As a quality-conscious user, I want a warning whenever a tier resolves to a model with no
    valid qualification, so that I know when my judge hasn't passed its exam.
22. As a power user, I want `--model <phase>=<provider/id>` one-off overrides, so that I can
    experiment without touching shared config.

**stet contributors and feature-PRD authors**

23. As a stet contributor, I want a new phase to be just a `PhaseConfiguration`, so that adding a
    sixth phase touches no harness code.
24. As a feature-PRD author, I want the findings schema, report shapes, and submit-tool guards
    stable and versioned here, so that I can spec my feature against them without coordination.
25. As a phase author, I want specialists to be first-class configuration, so that a composite
    phase gets fan-out, roll-up, and per-specialist cost without bespoke plumbing.
26. As a stet contributor, I want the harness proven end-to-end by stub phases before any real
    phase exists, so that integrating a real phase is plug-in proof against stable contracts,
    not co-development with the engine.

**Safety and operations**

27. As a security-conscious adopter, I want mutation-freedom enforced at tool registration and
    verified by a test, so that I can point stet at any repo knowing no code path can modify it.
28. As an operator, I want every budget breach to be a named `error` outcome with the partial
    audit preserved, so that there are no silent hangs and no silent kills.
29. As an operator debugging divergent verdicts, I want `cost.model` recorded per agent phase,
    so that disagreement between two runs is diagnosable at first look.
30. As a cost-conscious caller, I want a failing tests/types/build gate to cancel in-flight AI
    phases, so that I don't pay for judgment on code that demonstrably doesn't function.
31. As a caller who wants the full picture, I want `--continue-on-failure`, so that one gate
    failure doesn't suppress everything else.
32. As a caller providing spec context, I want `--prd`, `--task`, and `--issue` to combine, so
    that phases judge against everything I know.
33. As a reviewer of a very large change, I want a `partial-coverage` warning naming what was
    excluded when a diff exceeds a phase's context budget, so that truncation is never silent.

## 3. Requirements / behavior

### 3.1 Output-as-tool (the agent completion contract)

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

### 3.2 Agent runner

The Pi SDK integration, lifted from the POC recipe. **SDK confirmed (2026-06-06):**
`@earendil-works/pi-coding-agent` *is* the successor of `badlogic/pi-mono`'s coding-agent — the
GitHub repo transferred to `earendil-works/pi`, and the old `@mariozechner/pi-coding-agent` npm
scope is deprecated ("please use @earendil-works/pi-coding-agent instead", frozen at 0.73.1
while the new scope releases actively — 0.78.1 at time of writing). Same project, same author
(Mario Zechner), MIT. stet standardizes on `@earendil-works/pi-coding-agent` (0.78.x); zero
porting risk — the POC already runs on it. The runner:

- `createAgentSession` per phase run, with `systemPromptOverride` replacing the coding-agent
  persona entirely with the phase rubric; user prompt carries the per-run inputs (diff summary,
  spec context, run-instructions) as freetext.
- **Mutation-free at the tool-registration boundary:** the session's tool list is the phase's
  allowlist (`read`, `bash`, `grep`, `find`, `ls`, `submit_findings`, plus Phase 5's execution
  tools). Edit/write tools are never registered. There is no code path on which an agent phase
  can mutate the repo.
- In-memory session + settings managers; compaction enabled; SDK-level retry (max 2).
- **Model routing — tiers, not IDs.** Built-in defaults are **capability tiers** (`robust` for
  behavioral/review, `fast` for the structured phases), resolved at run time against the
  providers the user actually has credentials for (the SDK's model registry + auth storage
  already know), via a shipped per-provider preference table. Project config speaks tiers —
  safe to share across a team whose members hold different subscriptions; concrete model pins
  live in the user layer or in flags (the documented exception, not the norm). One-off override:
  `--model <phase>=<provider/id>`, repeatable; bare `--model X` applies to all agent phases;
  specific beats general. No credentialed provider satisfies a required tier ⇒ caught at
  preflight, before any phase launches, with an actionable message; a single phase's resolution
  failure ⇒ that phase reports `error` (named reason), the rest run.
- **Model qualification.** Tier membership is earned on the eval suite. A resolved model with no
  valid qualification for the tier it serves — from the shipped curated manifest or a local
  `stet models test` run, keyed by *(model × rubric version × fixture-set version)* — emits
  `harness.unqualified-model` (warning): never blocks by default; strict CI gates it via
  `--fail-on warning`. The command, N-run scorecards, and manifest format belong to the
  eval-suite PRD; the harness owns the resolution-time check and the finding.
- Progress events (`tool_execution_start`) stream to stderr so a human sees liveness without
  corrupting machine-readable stdout.

### 3.3 Specialists (composite agent phases)

A phase may declare **specialists**: parallel narrow sub-agents — a panel of specialists beats
one generalist with a kitchen-sink rubric. Each specialist is the same configuration shape (rubric +
toolset + model + activation predicate); the phase stays the *reporting* unit, specialists are the
*execution* unit. Mechanics are uniform: each specialist is its own agent run with its own
`submit_findings` (all three §3.1 guards apply per specialist), per-specialist cost in the phase report, the
emitting specialist recorded on each finding, and one specialist failing (error/budget) never loses the
other specialists' findings. Specialists inherit the phase's model/tier unless individually overridden,
and may narrow activation (e.g. review's `coverage-gaps` specialist — where tests should be added or
updated, risk-weighted — activates only when non-test code is added or changed).

The review phase is the first composite phase; its concrete specialist set (bugs, security, patterns,
quality, coverage-gaps) is the code-review feature PRD's to define. Built-in specialists are
enable/disable-able in config; **custom user-defined specialists are deferred** (§7) — a config-supplied
rubric is the plugin system v1 explicitly excludes. No cross-specialist dedup/verification pass in v1:
specialists are disjoint by rubric design; an adversarial-verify stage is the known fix if overlap
proves noisy in practice.

### 3.4 Scheduler

#### 3.4.1 Activation

Before launch, each configured phase's activation predicate is evaluated against (diff file list,
spec presence, config). The harness owns the predicate *mechanism*; the table below records the
product-level default rules that the phase feature PRDs implement when they register (the stub
phases used to prove the harness declare their own trivial predicates — §3.9):

| Phase | Activates when |
|---|---|
| gates | always (unless `--skip gates` / config) |
| spec | spec context present |
| review | diff non-empty (per-specialist predicates may narrow further — `coverage-gaps` only when non-test code is added/changed) |
| test-quality | diff touches test files — the tests themselves are the object of judgment; "tests missing/stale" belongs to review's `coverage-gaps` specialist |
| behavioral | diff touches runnable surfaces AND spec present |

Non-activated phases appear in the report as `skipped` with the rule named. Mandated visibility
findings (e.g. `behavioral.not-run` when surfaces changed but no spec was given) are emitted by
the harness at activation time.

#### 3.4.2 Execution policies

- **`parallel` (default):** all activated phases launch concurrently. Wall-clock ≈ slowest phase.
- **`sequential`:** gates → static phases → behavioral, stopping per the cancellation rules below
  — for cost-conscious callers.
- **`--continue-on-failure`:** disables cancellation entirely; everything runs to completion.

#### 3.4.3 Fail-fast cancellation (the gate signal)

Gates are split into two classes:

- **Cancel class** — gates proving the code doesn't function: **tests, types, build**. A failure
  here cancels in-flight AI phases (their reports: `cancelled`, reason "gates failed: <gate>").
- **Report-only class** — style gates: **lint, format**. Failures become findings but do not
  cancel; a lint error does not invalidate a behavioral run.

Class membership is overridable per gate in config (`gates.<name>.cancel: true|false`). A gate
**timeout** is always report-only regardless of class — a merely-slow suite must not nuke the
AI phases; only a *failing* gate proves the code doesn't function.

#### 3.4.4 Teardown

Cancellation (gate-triggered or Ctrl-C/SIGTERM) must be total: agent sessions disposed, child
processes killed (process groups), Phase 5 services torn down (delegated to `start_service`'s
guaranteed-teardown contract). A second Ctrl-C force-kills (no report — teardown was refused).
The report is still written on graceful interrupt, with `cancelled` statuses — a partial run
produces a partial report, never nothing. Interrupts exit per POSIX signal convention — SIGINT
⇒ `130`, SIGTERM ⇒ `143` — keeping exit `2` reserved for genuine tool errors, so a wrapper can
distinguish "my timeout killed it, partial findings usable" (143) from "stet malfunctioned,
trust nothing" (2).

### 3.5 Budgets & safety limits

The POC ran with no limits and produced 300s+ hangs in evals; the harness makes limits the
default:

| Limit | Default | On breach |
|---|---|---|
| per-phase wall clock | 5 min (static agent phases), 15 min (gates, behavioral) | phase `error`, reason "budget exceeded", partial audit preserved |
| per-phase turn count | follows the wall-clock class: 50 (5-min class), 120 (15-min class) | same |
| bash command timeout | 60 s | command killed; output so far returned to the agent (it can react) |
| bash output cap | 32 KB per call, truncation marked | truncated marker visible to agent |

The behavioral ceiling carries real headroom over observed successful runs (the POC's web
validations ran ~8 min): a false "budget exceeded" costs a loop a whole iteration and is worse
than a slow pass. A gate hitting its wall clock is report-only, never cancel-class (§3.4.3). The
60 s bash timeout is deliberate design pressure — anything long-lived belongs in
`start_service`, not a hanging shell.

All overridable per phase in config, and bundled as presets: `--budget <fast|default|thorough>`
(config: `budgets.preset`) scales the set without tuning four numbers — `fast` for snappy
pre-commit, `thorough` for loops that prize completeness over latency. A budget breach is
always a named `error` report — never a silent hang or a silent kill.

*Resolved (#22, round 2):* turn ceilings follow the wall-clock class — budgets come in two
classes, period. 120 for the 15-min class keeps the same headroom ratio over observed successful
runs (POC web validations: ~8 min, dozens of tool calls) as 50 does for the 5-min class.
Presets scale both classes together.

### 3.6 Scope detection & inputs

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

### 3.7 Configuration

Two config homes with one rule: **project config records project facts; user config records
machine/provider facts.** Precedence, resolved per-setting (deep merge, never whole-section
replacement):

**flags > `stet.config.yml` (project, checked in) > `~/.config/stet/config.yml` (user) >
built-in defaults**

- **Project layer** — gate commands, behavioral run-instructions, tier intent
  (`phases.<id>.tier`), scheduler policy, deliberate deviations. Safe to share across a team
  whose members hold different model subscriptions, because it never names providers.
- **User layer** — provider/model preferences ("robust means X on this machine"), local model
  qualifications (§3.2). Never project-specific.
- **Sparse by design:** `stet init` writes only project facts that have no built-in default and
  deviations it has evidence for — never a restatement of defaults (which would freeze them
  against future improvement) and never model pins (it can't know teammates' providers).
- **The binding run is CI's run.** AI findings are judgments, not pure functions of the code —
  two users on different tiers can legitimately disagree at the margins, and even one model
  disagrees with itself across runs. Local runs are advisory pre-flight; the merge gate is CI
  with pinned routing in its own user layer (the same answer every toolchain gives to
  environment variance). Evidence-backed findings travel regardless — a reproducing command is
  checkable by anyone — and `cost.model` makes any divergence diagnosable at first look.
  *Resolved (#21, round 2):* CI carries its pins as **`--model` flags in the workflow
  invocation itself** — the binding routing is visible and versioned exactly where the merge
  gate is defined, reviewable in the same PR that changes it, with zero new mechanism. This
  doesn't violate "shared config never names providers": that rule protects `stet.config.yml`
  from breaking teammates; the workflow is CI's *own* invocation and CI's credentials are
  known. A dedicated env-var layer is deferred (§7).

Malformed config ⇒ exit 2 with the YAML error and path; unknown keys ⇒ warning (forward
compatibility), not error. Concrete file schema: §4.9.

### 3.8 Human output & display

- **human (default):** findings grouped by phase, severity-colored, locations as `file:line`;
  per-phase status lines including skipped/cancelled reasons; cost summary footer. Progress to
  stderr while running.
- **`--quiet`:** suppress passing phases and progress; findings only. **`--show <severity>`**
  filters *display* only — renamed from v1's `--severity` to be visually distinct from
  `--fail-on`, which decides exit codes (a CI confusion trap otherwise).
- **Phase selection:** `--skip <phase>` (repeatable) and `--only <phase>` generalize v1's
  ad-hoc `--skip-gates`/`--no-behavioral`; config keeps `phases.<id>.enabled` as the durable
  form.

### 3.9 Stub phases & the steel thread (decision #24)

The harness ships with **no real phase**. Its build scope includes two **stub phases** that
exist to prove the machinery, and they remain in the codebase permanently as test fixtures —
they are never registered in a released binary's default phase set:

- **`stub-det`** (kind `deterministic`) — runs a configured trivial command and reports its
  exit code as a finding, exercising the deterministic-phase lifecycle, gate-class plumbing,
  and report aggregation.
- **`stub-agent`** (kind `agent`) — a **real Pi SDK run** with a trivial rubric (e.g. "count
  the TODO comments in the changed files and submit them as info findings"), so output-as-tool
  and all three of its guards, model routing, budgets, cost accounting, and the cancellation
  path carry genuine agent traffic — not simulated calls.

**The steel thread:** on a fixture repo with both stubs registered and no config, zero-argument
`stet` runs end-to-end — scope detection → activation → parallel scheduler → both phase kinds →
findings → `RunReport` → exit code — exercising every §4 contract with real traffic before any
real phase exists. Real phases then integrate via their own feature plans (deterministic-gates
first, per the roadmap), each integration re-proving acceptance criterion 1 ("touches no
harness code"). Known accepted limitation (brief direction 8): a trivial rubric won't surface
eval-grade judgment failure modes — that proof burden belongs to `behavioral-engine` and
`eval-suite`.

## 4. Contracts & schemas

The schema is the product's API: agents submit it, loops consume it, the exit code derives from
it. Generalized from the POC's proven `ValidationResultSchema`; defined with TypeBox (runtime
validation is what makes output-as-tool enforceable).

### 4.1 PhaseConfiguration

```
PhaseConfiguration = {
  id          "gates" | "spec" | "review" | "test-quality" | "behavioral"
  kind        "deterministic" | "agent"
  activation  predicate over (diff, spec presence, config)
  — agent phases only —
  rubric      constant system prompt (cacheable)
  toolset     allowlist of harness tools (never includes edit/write)
  model       capability tier ("robust" | "fast") or pinned "provider/id" (§3.2)
  extension   phase-specific additions to the submit-tool schema (e.g. Phase 5 claims/checks)
  budgets     overrides for time/turn defaults
  specialists optional: parallel narrow sub-agents, each itself a
              (rubric, toolset, model, activation) tuple — see §3.3
}
```

### 4.2 Finding

```ts
Finding = {
  id:         string                          // stable rule id, phase-namespaced:
                                              // "gates.test-failed", "gates.no-linter-configured",
                                              // "spec.requirement-unmet", "review.bug",
                                              // "test-quality.tautological", "behavioral.claim-failed",
                                              // "behavioral.not-run" …
  phase:      PhaseId
  specialist?: string                         // composite phases: which specialist emitted it
  severity:   "error" | "warning" | "info"    // the gating vocabulary
  confidence: "high" | "medium" | "low"       // see §4.6 — deterministic and evidence-backed
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

**Harness-emitted findings** (decision #20, settled round 2): findings the harness itself emits
(`harness.unqualified-model`, `<phase>.partial-coverage`, activation-time findings like
`behavioral.not-run`) attach to the report of the phase they concern; the id namespace records
the emitter. `Finding.phase` is always the report's phase — there is no harness pseudo-phase in
`phases[]`.

### 4.3 Audit (first-class, every phase)

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

*Settled, pending application (decisions #19):* `claims` gains a fourth bucket — `outOfScope` —
for spec-derived claims that reach no selected surface (behavioral-engine brief D2). The
amendment lands in the same change as the behavioral-engine PRD.

### 4.4 PhaseReport

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
  cost:     { model?: string, inputTokens?: number, outputTokens?: number, durationMs: number,
              specialists?: Record<string, Cost> }  // composite phases: per-specialist breakdown
}
```

Skips that the high-level PRD mandates surface as findings, not just statuses: Phase 5 skipped
for lack of a spec ⇒ `behavioral.not-run` (warning) *and* `status: "skipped"`. A skipped phase
with a warning finding is how "did not run" stays visible to `--fail-on warning` callers.

### 4.5 RunReport (the aggregate)

```ts
RunReport = {
  version: 1                                  // schema version; bumped on breaking change
  stet:    string                             // the producing binary's semver, e.g. "1.0.3" (#23)
  startedAt: string                           // run start, ISO-8601 UTC (#23) — the one field the
                                              // v1.x cache key must exclude
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

Cost accounting is first-class: loops budget per-run; the report carries per-phase and total
cost.

*Resolved (#23, round 2):* `stet` (binary semver) and `startedAt` (ISO-8601 UTC) are in the
report — when two reports disagree, "which stet, when" is answered without leaving the
artifact. Reports travel; artifacts self-describe. The deferred v1.x cache key excludes
`startedAt` (§7).

### 4.6 Confidence rules

- **Deterministic findings** (Phase 1) are always `confidence: "high"` — a failing test run is
  not an opinion.
- **Evidence-backed findings** — any finding carrying `evidence.command` (Phase 5 faileds) — are
  `"high"` by construction. A reproducing command is proof; the confidence filter exists for
  opinions, not evidence.
- **AI-judgment findings** (phases 2–4, and Phase 5 inconclusives) carry model-assigned
  confidence and gate only at `"high"` (high-level PRD §6: sub-high-confidence AI findings never
  cause exit 1).

### 4.7 CLI flag surface

Flags are escape hatches, never required: zero-config `stet` runs everything on tier defaults.

| Group | Flags |
|---|---|
| scope | *(none = auto-detect)* · `--staged` · `--working` · `--against <ref>` · `--commit <sha>` · `--commits <range>` |
| spec | `--prd <file\|-\|literal>` · `--task <string>` · `--issue <n>` (via `gh`) · `--auto-context` |
| phases | `--skip <phase>` (repeatable) · `--only <phase>` |
| routing / budget | `--model [<phase>=]<provider/id>` (repeatable; specific beats general) · `--budget fast\|default\|thorough` |
| output | `--format human\|json` · `--quiet` · `--show <severity>` (display) · `--fail-on <severity>` (gating) |
| scheduler | `--continue-on-failure` |
| commands | `stet init [--refresh]` · `stet models test <provider/id>` |

### 4.8 Exit codes & gating

- **`--format json`:** the `RunReport`, exactly, on stdout; nothing else on stdout. Versioned via
  `version`. Progress and human chrome go to stderr.
- **Exit codes:** `0` clean at threshold · `1` ≥1 gating finding · `2` tool error ·
  `130`/`143` interrupted (SIGINT/SIGTERM, POSIX `128+signal`) after writing the partial
  report. A finding gates iff `severity ≥ failOn` **and** `confidence == "high"`. The report's
  `result.gating` lists exactly which findings caused exit 1 — no parsing required to answer
  "why did it fail?".

### 4.9 Config file schema

```yaml
# project: stet.config.yml
scheduler:                  # parallel | sequential; continueOnFailure
budgets: { preset: default }       # fast | default | thorough
phases:
  <id>:
    enabled: true|false
    tier: robust|fast       # or model: provider/id — the documented exception, not the norm
    budgets: { wallClockMs, turns }
    specialists: { <specialist>: { enabled: true|false } }
gates:
  <name>: { cancel: true|false }   # cancellation class override
output:
  format: human|json
  failOn: error|warning|info
ignore: [paths]
```

### 4.10 Worked examples (informative)

Three realistic `RunReport` instances — added for contract evaluation during review round 2.
*Informative, not normative:* the schemas in §4.2–4.5 govern; comments (`//`) are annotations,
not part of the JSON.

**Example A — clean run, no spec provided.** Hygiene and visibility findings exist but nothing
gates; behavioral is skipped *loudly*. Exit `0`.

```jsonc
{
  "version": 1,
  "stet": "1.0.3",
  "startedAt": "2026-06-07T18:02:11Z",
  "scope": { "kind": "staged", "files": ["src/export.ts", "src/cli.ts"] },
  "spec": { "provided": false, "sources": [] },
  "phases": [
    {
      "phase": "gates",
      "status": "completed",
      "findings": [
        { "id": "gates.no-linter-configured", "phase": "gates",
          "severity": "warning", "confidence": "high",
          "message": "No lint gate detected (no oxlint/eslint config, no lint script). Style issues are unchecked.",
          "suggestion": "Run `stet init` to detect or configure gates." }
      ],
      "audit": {
        "checks": [
          { "name": "tests", "type": "test_command", "command": "vp test",
            "status": "passed", "evidence": "exit 0 · 142 passed, 0 failed (8.3s)" },
          { "name": "types", "type": "test_command", "command": "vp check --types",
            "status": "passed", "evidence": "exit 0" }
        ]
      },
      "cost": { "durationMs": 11240 }
    },
    {
      "phase": "spec",
      "status": "skipped",
      "reason": "no spec context provided (--prd/--task/--issue)",
      "findings": [], "audit": {}, "cost": { "durationMs": 0 }
    },
    {
      "phase": "review",
      "status": "completed",
      "findings": [],
      "audit": { "examined": ["src/export.ts", "src/cli.ts"] },
      "cost": { "model": "anthropic/claude-sonnet-4-6", "inputTokens": 48211, "outputTokens": 2933,
                "durationMs": 64880,
                "specialists": {
                  "bugs":     { "inputTokens": 16114, "outputTokens": 1102, "durationMs": 61240 },
                  "security": { "inputTokens": 15876, "outputTokens":  844, "durationMs": 49530 }
                } }
    },
    {
      "phase": "test-quality",
      "status": "skipped",
      "reason": "no test files in scope",
      "findings": [], "audit": {}, "cost": { "durationMs": 0 }
    },
    {
      "phase": "behavioral",
      "status": "skipped",
      "reason": "runnable surfaces changed but no spec provided",
      "findings": [
        { "id": "behavioral.not-run", "phase": "behavioral",
          "severity": "warning", "confidence": "high",
          "message": "Behavioral verification did not run: src/cli.ts changes a runnable surface but no spec was provided.",
          "suggestion": "Re-run with --prd/--task/--issue to enable behavioral verification." }
      ],
      "audit": {}, "cost": { "durationMs": 2 }
    }
  ],
  "result": { "exitCode": 0, "failOn": "error", "gating": [] },
  "cost": { "totalInputTokens": 48211, "totalOutputTokens": 2933, "durationMs": 66120 }
}
```

**Example B — failing run.** A review bug and a behavioral `failed` claim (surfaced as an
`error` finding carrying the reproducing command) both gate. Exit `1`. Gates/spec/test-quality
reports elided (`…`) — same shapes as Example A.

```jsonc
{
  "version": 1,
  "stet": "1.0.3",
  "startedAt": "2026-06-07T18:09:47Z",
  "scope": { "kind": "against", "ref": "main", "files": ["src/api/export.ts", "src/api/router.ts"] },
  "spec": { "provided": true, "sources": ["--prd docs/prd/csv-export.md"] },
  "phases": [
    { "phase": "gates", "status": "completed", "findings": [], "audit": { "…": "…" }, "cost": { "durationMs": 9100 } },
    { "phase": "spec", "status": "completed", "findings": [], "audit": { "…": "…" }, "cost": { "…": "…" } },
    {
      "phase": "review",
      "status": "completed",
      "findings": [
        { "id": "review.bug", "phase": "review", "specialist": "bugs",
          "severity": "error", "confidence": "high",
          "message": "Unhandled promise rejection: `buildCsv()` can reject but the route handler has no catch — a malformed row crashes the worker.",
          "location": { "file": "src/api/export.ts", "line": 87 },
          "suggestion": "Wrap the stream pipeline in try/catch and return 500 with a logged error id." }
      ],
      "audit": { "examined": ["src/api/export.ts", "src/api/router.ts"] },
      "cost": { "model": "anthropic/claude-sonnet-4-6", "inputTokens": 51002, "outputTokens": 3120, "durationMs": 71400 }
    },
    { "phase": "test-quality", "status": "skipped", "reason": "no test files in scope",
      "findings": [], "audit": {}, "cost": { "durationMs": 0 } },
    {
      "phase": "behavioral",
      "status": "completed",
      "findings": [
        { "id": "behavioral.claim-failed", "phase": "behavioral",
          "severity": "error", "confidence": "high",
          "message": "Spec claim 'export endpoint returns CSV for a valid date range' fails: GET /api/export?from=2026-01-01&to=2026-01-31 returns 500.",
          "evidence": {
            "command": "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/api/export?from=2026-01-01&to=2026-01-31'",
            "output": "500"
          },
          "meta": { "priority": "critical" } }
      ],
      "audit": {
        "checks": [
          { "name": "Service boots and reports ready", "type": "http_call",
            "command": "start_service: vp run dev · ready: GET /health", "status": "passed",
            "evidence": "ready after 3.1s, HTTP 200" },
          { "name": "Export valid range", "type": "http_call",
            "command": "curl …/api/export?from=2026-01-01&to=2026-01-31", "status": "failed",
            "evidence": "HTTP 500; body: {\"error\":\"date parsing\"}" }
        ],
        "claims": {
          "derived": ["export returns CSV for valid range", "export 400s on invalid range"],
          "proven": ["export 400s on invalid range"],
          "unproven": ["export returns CSV for valid range"]
        }
      },
      "cost": { "model": "anthropic/claude-opus-4-8", "inputTokens": 92110, "outputTokens": 6480, "durationMs": 412000 }
    }
  ],
  "result": {
    "exitCode": 1, "failOn": "error",
    "gating": [
      { "phase": "review", "id": "review.bug", "message": "Unhandled promise rejection: `buildCsv()` can reject …" },
      { "phase": "behavioral", "id": "behavioral.claim-failed", "message": "Spec claim 'export endpoint returns CSV …' fails: … returns 500." }
    ]
  },
  "cost": { "totalInputTokens": 143112, "totalOutputTokens": 9600, "durationMs": 421000 }
}
```

**Example C — cancel-class gate failure.** Tests fail; in-flight AI phases are cancelled, the
run reports what it knows. Exit `1`.

```jsonc
{
  "version": 1,
  "stet": "1.0.3",
  "startedAt": "2026-06-07T18:15:03Z",
  "scope": { "kind": "working", "files": ["src/parse.ts"] },
  "spec": { "provided": false, "sources": [] },
  "phases": [
    {
      "phase": "gates",
      "status": "completed",
      "findings": [
        { "id": "gates.test-failed", "phase": "gates",
          "severity": "error", "confidence": "high",
          "message": "Test gate failed: 3 of 142 tests failing.",
          "evidence": { "command": "vp test", "output": "FAIL src/parse.test.ts · expected 'a,b' got 'a;b' …(truncated)" } }
      ],
      "audit": { "checks": [ { "name": "tests", "type": "test_command", "command": "vp test",
                               "status": "failed", "evidence": "exit 1 · 3 failed" } ] },
      "cost": { "durationMs": 12800 }
    },
    { "phase": "spec", "status": "skipped", "reason": "no spec context provided",
      "findings": [], "audit": {}, "cost": { "durationMs": 0 } },
    { "phase": "review", "status": "cancelled", "reason": "gates failed: tests",
      "findings": [], "audit": {}, "cost": { "model": "anthropic/claude-sonnet-4-6",
      "inputTokens": 18211, "outputTokens": 0, "durationMs": 12950 } },
    { "phase": "test-quality", "status": "skipped", "reason": "no test files in scope",
      "findings": [], "audit": {}, "cost": { "durationMs": 0 } },
    { "phase": "behavioral", "status": "skipped",
      "reason": "runnable surfaces changed but no spec provided",
      "findings": [ { "id": "behavioral.not-run", "phase": "behavioral", "severity": "warning",
        "confidence": "high", "message": "Behavioral verification did not run: no spec provided." } ],
      "audit": {}, "cost": { "durationMs": 1 } }
  ],
  "result": {
    "exitCode": 1, "failOn": "error",
    "gating": [ { "phase": "gates", "id": "gates.test-failed", "message": "Test gate failed: 3 of 142 tests failing." } ]
  },
  "cost": { "totalInputTokens": 18211, "totalOutputTokens": 0, "durationMs": 13400 }
}
```

## 5. Acceptance criteria

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
   as specified in §3.5 — verified with a deliberately-hanging stub phase and a `sleep` command.
8. Exit code policy: a high-confidence error finding ⇒ exit 1; the same finding at medium
   confidence ⇒ exit 0 (default `failOn: error`); `--fail-on warning` additionally gates
   warnings; `result.gating` names the responsible findings.
9. Ctrl-C mid-run kills all children and services, writes the partial report with `cancelled`
   statuses, and exits 130 (SIGTERM: 143); exit 2 stays reserved for genuine tool errors.
10. `--format json` emits only the `RunReport` on stdout (validated against the schema in tests);
    progress and human chrome go to stderr.
11. Conflicting scope flags, undetectable scope, malformed config each produce exit 2 with a
    distinct, actionable message.
12. Per-phase and total token/duration cost appear in every report for agent phases.
13. With no config at all, every agent phase resolves a model via tier defaults against whatever
    credentialed providers exist; with none available, preflight fails before any phase
    launches, with the actionable message.
14. A composite phase's specialists run in parallel; each finding carries its specialist; per-specialist cost
    appears in the phase report; one specialist failing (error/budget) does not lose the other
    specialists' findings.
15. Routing a tier to a model with no valid qualification yields the
    `harness.unqualified-model` warning finding; a valid local `stet models test` result
    suppresses it; a rubric/fixture-set version bump invalidates prior qualifications.
16. `--only <phase>` runs exactly that phase (others `skipped`, reasons named); `--skip` is
    repeatable; both are reflected in the report (verified with the stub phases).
17. **The steel thread:** on a fixture repo with both stub phases registered (§3.9) and no
    config, zero-argument `stet` runs end-to-end — scope detection → activation → parallel
    scheduler → both phase kinds → findings → `RunReport` (carrying `stet` + `startedAt`) →
    correct exit code — with no real phase existing anywhere in the build.

## 6. Edge cases

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

## 7. Deliberately deferred

- **Result streaming (NDJSON event mode)** — resolved 2026-06-06: run-then-read is the loop
  contract (confirmed against the ideoshi-code use case); an event mode can be added later
  without touching the `RunReport` contract.
- **Caching** — re-running on an unchanged scope could reuse phase reports (cache key: scope
  hash × phase config hash, **excluding `startedAt`** — #23). v1.x roadmap item; requires
  deterministic report serialization, which the schema otherwise already provides.
- **Env-var routing layer** (`STET_MODEL_*` or similar) — #21 chose `--model` flags in the CI
  workflow invocation; an env layer is addable later between flags and project config without
  breaking precedence semantics, if wrapper tooling ever needs it.
- **SARIF mapping** of `Finding` — v1.x; enabled by the stable `Finding` shape.
- **Custom user-defined specialists** — a config-supplied rubric is the plugin system v1
  explicitly excludes; revisit when the built-in specialist set stabilizes.
- **Cross-specialist dedup / adversarial-verify pass** — specialists are disjoint by rubric
  design; an adversarial-verify stage is the known fix if overlap proves noisy in practice.

## 8. Decisions

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| 1 | One gating severity vocabulary (`error/warning/info`); POC `critical/high/medium/low` survives as `meta.priority` | draft | no information loss; one threshold mechanism | settled |
| 2 | `Audit` (examined/checks/claims) is first-class on every phase | draft | the anti-silent-green mechanism, generalized from the POC | settled |
| 3 | Deterministic + evidence-backed findings are `high` confidence by construction | draft | a reproducing command is proof; the confidence filter exists for opinions | settled |
| 4 | Schemas defined with TypeBox, validated at the tool boundary | draft | runtime validation is what makes output-as-tool enforceable | settled |
| 5 | Pi SDK: standardize on `@earendil-works/pi-coding-agent` 0.78.x | evidence check (2026-06-06) | confirmed successor of `badlogic/pi-mono`; the POC already runs on it | settled |
| 6 | Model routing by capability tiers; four config layers; sparse `init`; project config never names providers | review round 1 (Johan) | provider pins in shared config are broken-by-teammate | settled |
| 7 | The binding run is CI's run, with pinned routing; local runs advisory | review round 1 (Johan) | AI findings are judgments — variance is contained, not eliminated | settled |
| 8 | Model qualification earned on the eval suite; `harness.unqualified-model` warning; curated manifest + `stet models test` | review round 1 (Johan) | tier membership must be earned, not asserted | settled |
| 9 | Specialists are first-class composite-phase machinery; review is the first composite phase; "tests missing/stale" moves to review's `coverage-gaps` | review round 1 (Johan) | a panel of narrow rubrics beats one generalist; phase stays the reporting unit | settled |
| 10 | Gate cancellation classes: tests/types/build cancel, lint/format report-only; timeouts always report-only | review round 1 (Johan) | only a *failing* gate proves the code doesn't function | settled |
| 11 | Budget defaults (15 min behavioral/gates, 5 min static, 50 turns, 60 s bash) + `--budget` presets | review round 1 (Johan) | POC's *successful* web runs took ~8 min; a false "budget exceeded" costs a loop an iteration | settled |
| 12 | CLI cleanup: `--skip`/`--only`; `--severity` → `--show`; `--model` repeatable + phase-namespaced | review round 1 (Johan) | `--severity` vs `--fail-on` is a CI confusion trap | settled |
| 13 | POSIX signal exit codes (130/143, partial report written); exit 2 strictly tool error | review round 1 (Johan) | wrappers must distinguish "my timeout" from "stet broke" | settled |
| 14 | Large diffs degrade with visibility (ranked subset + `partial-coverage` warning); never chunk; never silently truncate | draft | same ethos as hygiene findings | settled |
| 15 | Result streaming deferred; run-then-read is the loop contract | review round 1 (Johan) | confirmed against ideoshi-code; NDJSON addable without touching `RunReport` | settled (deferred, §7) |
| 16 | Custom user-defined specialists deferred | draft | a config-supplied rubric is the plugin system v1 excludes | settled (deferred, §7) |
| 17 | No cross-specialist dedup/adversarial-verify in v1 | draft | specialists disjoint by rubric design; verify stage is the known fix if noisy | settled (deferred, §7) |
| 18 | Caching and SARIF deferred to v1.x | draft | see §7 | settled (deferred, §7) |
| 19 | `Audit.claims` gains a fourth bucket `outOfScope` | behavioral-engine brainstorm (Johan, 2026-06-06) | claims reaching no selected surface are a deliberate, named cut; lands with the behavioral-engine PRD | settled — pending application |
| 20 | Harness-emitted findings (`harness.*`, `<phase>.partial-coverage`, activation-time findings) attach to the report of the phase they concern; no harness pseudo-phase | review round 2 (Johan, 2026-06-07) | findings live in `PhaseReport`s; the id namespace records the emitter; `meta.emitter` is the additive fix if a field is ever needed | settled |
| 21 | CI carries pinned routing as `--model` flags in the workflow invocation; env-var layer deferred | review round 2 (Johan, 2026-06-07) | pins visible & versioned where the merge gate is defined; zero new mechanism; "never name providers" protects shared config, not CI's own invocation | settled |
| 22 | Turn ceilings follow the wall-clock class: 50 (5-min class) / 120 (15-min class) | review round 2 (Johan, 2026-06-07) | headroom where the long successful runs are; a false breach costs a loop an iteration; one principle — budgets come in two classes | settled |
| 23 | `RunReport` carries `stet` (binary semver) + `startedAt` (ISO-8601 UTC) | review round 2 (Johan, 2026-06-07) | reports travel and must self-describe; "which stet, when" answered inside the artifact; cache key excludes `startedAt` | settled |
| 24 | Harness-only build scope; the steel thread runs on two stub phases (§3.9); every real phase integrates via its own feature plan | brief direction 8 (Johan, 2026-06-06) | the harness's definition of done can't depend on another feature shipping; pluggability becomes a demonstrated fact | settled |
