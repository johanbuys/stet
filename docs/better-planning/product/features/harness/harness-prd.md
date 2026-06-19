# Feature PRD: Harness

**Status:** settled — 2026-06-07; **amended 2026-06-09** (Cloudflare reference review); **amended
2026-06-09 (b)** (architecture soundness review). Review round 1 (2026-06-06) and round 2
(2026-06-07, canvas) resolved and folded in. Round 2 landed the harness-only steel-thread scoping
(brief direction 8, decision #24), closed #20–23, and added the worked contract examples (§4.10).
The first 2026-06-09 amendment folds in two mechanisms validated by Cloudflare's production system
(`research/cloudflare-ai-review-reference.md`): a **coordinator judge pass** on composite phases
(§3.3a, amends #17 deferred→designed-in) and a **deterministic risk classifier** mechanism
(§3.4.1a), plus semantic diff pre-filtering (§3.6). Restructured to the standard feature-PRD shape
along the way. The second 2026-06-09 amendment closes gaps found in a four-doc soundness review:
`PhaseId` opened to an extensible identifier (#28), coordinator failure fallback (#29) +
constrained authority over evidence-backed findings (#30) + drops recorded in the audit (#31),
per-phase risk rules over the pre-filtered diff (#32), and stripped paths carried in the report
(#33).

**Amended 2026-06-19** (code-review PRD review): added **agreement-based verification** for composite
phases — AI-judgment confidence is derived from an N-voter refutation pass, not model self-report
(§3.3a, §4.6, decision #35).
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

27. As a security-conscious adopter, I want file-mutation tools (`edit`/`write`) barred at tool
    registration and verified by a test, and a clear path to full mutation-freedom (sandboxing the
    `bash` escape hatch — decision #34), so I can point stet at a repo with a bounded, documented
    write surface rather than an unbounded one.
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
(Mario Zechner), MIT. stet standardizes on `@earendil-works/pi-coding-agent` (**0.79.x** —
amended 2026-06-09 from 0.78.x: `vp add` resolved 0.79.1, API-compatible, the M2 adapter
compiles and runs on it; see decision #5 and plan §6); zero porting risk — the POC already runs
on it. The runner:

- `createAgentSession` per phase run, with `systemPromptOverride` replacing the coding-agent
  persona entirely with the phase rubric; user prompt carries the per-run inputs (diff summary,
  spec context, run-instructions) as freetext.
- **Mutation-free at the tool-registration boundary:** the session's tool list is the phase's
  allowlist (`read`, `bash`, `grep`, `find`, `ls`, `submit_findings`, plus Phase 5's execution
  tools). **No file-mutation tool (`edit`/`write`) is ever registered** — a test asserts this on
  every registered agent phase (acceptance #2). **Caveat (surfaced at M2 build, 2026-06-09 —
  decision #34):** `bash` *is* registered and the Pi SDK exposes no read-only bash mode, so a model
  that disregards its rubric *could* mutate the repo via a shell command. The registration-boundary
  guarantee therefore covers `edit`/`write`, **not** `bash`; near-term the agent is held read-only
  by rubric instruction, and **real enforcement — a sandbox / read-only mount / a `bash`
  spawn-hook denylist — is a tracked follow-up** (decision #34), naturally tied to the milestone
  that introduces Phase 5 execution (which needs a controlled exec surface anyway). See plan §6.
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
- **Failback (added 2026-06-09):** on a *retryable* provider error (transient API/5xx), a tier may
  fall back to the next qualified model in its preference table before the phase reports `error`;
  non-retryable errors (auth missing, context overflow) do not retry — they surface immediately.
  Cloudflare's per-tier failback chains (`research/cloudflare-ai-review-reference.md`) informed
  this; the chain is just the existing tier preference order, no new config.

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
rubric is the plugin system v1 explicitly excludes.

### 3.3a Coordinator (the judge pass) — amended 2026-06-09

A composite phase may declare an optional **coordinator**: a single `robust`-tier agent that runs
*after* its specialists submit, reads all their findings, and produces the phase's final finding
set. This is the mechanism stet originally deferred (old decision #17, "specialists are disjoint by
rubric design"); Cloudflare's production system
(`research/cloudflare-ai-review-reference.md`) makes it their single most load-bearing
noise-reduction stage — they spend their most expensive model on this role alone — so stet adopts
it as designed-in harness machinery rather than a v1.x "if it proves noisy" fix. The coordinator:

- **Deduplicates** overlapping findings, **drops** convention-contradicted / speculative / nitpick
  findings ("reasonableness filtering"), and may **re-rank or re-categorise** severity/confidence.
- Consumes the specialists' findings as input and emits the **same `Finding` schema** (§4.2). It is
  itself an agent run through the same `AgentRunner` seam with all three §3.1 guards; its own
  `submit_findings` payload *replaces* the raw specialist roll-up as the phase's `findings`.
- **Provenance is preserved:** a surviving finding keeps its originating `specialist`; the
  coordinator records its own model in `cost` (a `coordinator` sub-entry, §4.4).
- **Drops are recorded, not silent (decision #31):** the harness computes the set difference
  between the raw specialist roll-up and the coordinator's surviving set, and records each dropped
  finding's summary (`id`, `specialist`, `message`) in the phase's `audit.coordinator.dropped`
  (§4.3). Computed by the harness, never self-reported by the judge — "why didn't stet flag X?"
  stays answerable from the artifact without resurrecting the noise into `findings`.
- **Constrained authority (decision #30):** the coordinator may not drop, nor lower the severity
  or confidence of, **deterministic findings or findings carrying executable evidence**
  (`evidence.command`) — §4.6 makes those high-confidence *by construction*, and proof is not the
  judge's to overrule. Enforced by the harness after the judge submits: a protected finding
  missing or downgraded in the submission is reinstated unchanged (and the reinstatement is
  visible in `audit.coordinator`). The judge's authority covers AI-judgment findings — the ones
  the confidence filter exists for.
- **Failure falls back, never forfeits (decision #29):** if the coordinator run itself fails —
  no-submit, budget breach, model error — the phase keeps the **raw specialist roll-up** as its
  `findings`, plus a `<phase>.coordinator-failed` warning naming the reason. §3.3's guarantee
  ("one specialist failing never loses the others' findings") extends to the judge: a failed
  filter degrades to an unfiltered report, visibly — it never discards what the specialists found.
- Is **opt-in per phase**: solo (non-composite) phases never run a coordinator; a composite phase
  without a declared coordinator keeps the plain roll-up (§3.3). Whether `review` uses one, and its
  rubric, is the **code-review feature PRD's** to define — the harness owns the *mechanism*.
- **Cost dial:** because the coordinator is the expensive (`robust`) pass, the risk classifier
  (§3.4.1a) may gate whether it runs at all for a given change.

**Amended 2026-06-19 (decision #35):** composite phases now run a **per-finding refutation panel** — the
N-voter agreement-verify pass that sets AI-finding confidence (§4.6). It runs *before* the coordinator's
reasonableness filter: voters set confidence from agreement, then the coordinator dedups/re-ranks the
survivors. The harness owns the N-voter mechanism; the per-phase voter count and refutation lenses are the
consuming feature PRD's (code-review uses N=3). The earlier v1 deferral of this panel is superseded.

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

#### 3.4.1a Risk classification — amended 2026-06-09

Activation answers *whether* a phase runs (on/off). A **risk classifier** answers *how much* it
runs. The harness owns a deterministic step `classify(diff, paths, rules) → level` whose output
(an opaque ordered `level`, e.g. `trivial | standard | full`) lets a composite phase scale **which
specialists fan out** and **whether its coordinator (§3.3a) runs**. This is the cost dial
Cloudflare's system pivots on — a deterministic rule engine (line/file thresholds, path
sensitivity) sized the AI budget *before any model ran*
(`research/cloudflare-ai-review-reference.md`).

The split is the same one activation uses: **the harness owns the classifier *mechanism* and the
`level → (specialist subset, coordinator on/off)` wiring; the consuming phase owns the actual
*rules and thresholds***, declared per phase as `riskRules` in its `PhaseConfiguration` (§4.1) and
specced in that phase's feature PRD (decision #32). Baking "≥100 lines or touches `auth/`" into
the substrate would violate the boundary rule (#24) — those are review-specific; and two phases
may legitimately weigh the same change differently, so there is no single run-global level — the
harness evaluates each declaring phase's rules once, before fan-out (the function is pure and
cheap; per-phase evaluation costs nothing). Like activation predicates, the rules are part of the
phase's registered configuration — the same change that registers the phase declares its risk
sensitivity. The classifier is deterministic (so a `high`-confidence input, never an AI judgment),
and its diff input is the **pre-filtered** diff (§3.6) — lockfile or generated-file churn must not
inflate a change's risk. Each phase's resolved `level` is echoed in the run output for
diagnosability. Default with no `riskRules`: a single `level` ⇒ the full panel runs (today's
behavior), so the mechanism is inert until a phase declares rules.

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
- **Semantic diff pre-filtering** (added 2026-06-09): before any phase — or the risk classifier
  (§3.4.1a) — sees the diff, the harness strips files that are noise to a reviewer — lock files,
  minified assets, source maps, vendored dependencies, and `// @generated` files **except**
  database migrations (which are reviewable). Validated by Cloudflare's system
  (`research/cloudflare-ai-review-reference.md`); it both reduces token waste and removes a class
  of false positives. Stripped paths are carried in the report (`scope.stripped`, §4.5 — machine
  consumers see them too, decision #33) and listed in the human scope echo, never silently
  dropped; the rule set is config-overridable (`ignore` / an allow-back list).
- **Large diffs:** v1 left this open; decision — **degrade with visibility, don't chunk** (v1
  scope). When the (pre-filtered) diff exceeds a phase's context budget, the phase analyzes the
  highest-signal subset (changed files ranked by churn) and the harness emits
  `<phase>.partial-coverage` (warning) naming what was excluded. No silent truncation — same ethos
  as hygiene findings.

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
  id          PhaseId — open kebab-case identifier (see below). Built-in product set:
              "gates" | "spec" | "review" | "test-quality" | "behavioral";
              stub phases register "stub-det" | "stub-agent" | "stub-composite" (§3.9)
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
  coordinator optional (composite phases): a judge-pass config
              { rubric, model (default tier robust) } — see §3.3a. When present, its
              submission replaces the raw specialist roll-up as the phase's findings;
              if its run fails, the phase falls back to the raw roll-up (#29).
  riskRules   optional: the phase's deterministic risk rules (§3.4.1a) —
              (diff, paths) → level. Thresholds are the consuming feature PRD's;
              the harness evaluates them once before fan-out (#32).
  riskLevels  optional: mapping of the resolved `level` to
              { specialists: subset, coordinator: on|off }. The harness applies the mapping.
}
```

**`PhaseId` is an open identifier, not a closed union (decision #28).** The schema validates a
kebab-case pattern (`/^[a-z][a-z0-9-]*$/`), not an enum: the five product phases are the
documented built-in set, and the stub phases (§3.9) are equally valid registrations. A closed
union would make every new phase a schema edit — contradicting acceptance #1 ("adding a sixth
phase touches no harness code") and unable to even validate the steel thread's own reports.
`Finding.phase` and `PhaseReport.phase` use the same open `PhaseId`.

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

**Coordinator-emitted findings** (decision #25, 2026-06-09): when a composite phase runs a
coordinator (§3.3a), the phase's `findings` are the coordinator's output. A surviving finding keeps
its originating `specialist`; a finding the coordinator *itself* raises (e.g. a cross-cutting issue
no single specialist owned) carries no `specialist`. The coordinator never invents a phase — its
findings are `Finding.phase == ` the composite phase. Dropped findings simply do not appear; the
`audit` still reflects what the specialists examined.

### 4.3 Audit (first-class, every phase)

The POC's `checks[]` + claims buckets are what make a verdict *auditable* — generalized to all
phases as the anti-silent-green mechanism: a green report always shows what was actually examined.

```ts
Audit = {
  examined?: string[]                         // files/surfaces/requirements considered
  checks?:   Check[]                          // every concrete command run
  claims?:   { derived: string[], proven: string[], unproven: string[] }   // Phase 5
  coordinator?: {                             // composite phases that ran a judge (§3.3a) —
                                              // harness-computed, never judge-self-reported
    received:   number                        // findings in the raw specialist roll-up
    dropped:    { id: string, specialist?: string, message: string }[]  // roll-up minus survivors (#31)
    reinstated: { id: string, specialist?: string }[]                   // protected findings the judge
                                              // tried to drop/downgrade, restored by the harness (#30)
  }
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
Cost = { model?: string, inputTokens?: number, outputTokens?: number, durationMs: number }

PhaseReport = {
  phase:    PhaseId
  status:   "completed"      // ran to the end and submitted (may contain findings)
          | "skipped"        // activation rule or config said don't run — reason names why
          | "cancelled"      // scheduler cancelled it (gate failure / Ctrl-C) — never silent
          | "error"          // the phase itself broke (model unavailable, budget exhausted …)
  reason?:  string            // required for skipped | cancelled | error
  findings: Finding[]
  audit:    Audit
  cost:     Cost & {
              specialists?: Record<string, Cost>,    // composite phases: per-specialist breakdown
              coordinator?: Cost }                   // §3.3a judge pass, when one ran
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
             ref?: string, files: string[],
             stripped?: string[] }            // paths removed by semantic pre-filtering (§3.6, #33)
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
- **AI-judgment findings** (phases 2–4, and Phase 5 inconclusives) gate only at `"high"`
  (high-level PRD §6: sub-high-confidence AI findings never cause exit 1).
- **Agreement-derived confidence (composite phases — amended 2026-06-19, decision #35):** on a
  composite phase, AI-judgment confidence is **not** model-self-reported but set by an **N-voter
  refutation pass** (N=3 default): each candidate is independently re-judged by N voters prompted to
  refute it — `"high"` at 3/3 agreement, `"medium"` at 2/3, and `≤1/3 ⇒ dropped` before the
  coordinator. Verbalized self-confidence is miscalibrated; agreement corroborates. Deterministic and
  evidence-backed findings stay `"high"` by construction (above) and skip the vote. The harness owns
  the mechanism; voter count and lenses are the consuming feature PRD's.

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
18. **Coordinator (§3.3a):** a composite phase declaring a coordinator runs its specialists, then a
    single `robust`-tier judge pass whose submission becomes the phase's `findings`; duplicates are
    merged and a planted convention-contradicted/nitpick finding is dropped; surviving findings keep
    their `specialist`; `cost.coordinator` records the judge's model/tokens; dropped findings appear
    in `audit.coordinator.dropped` (#31). A planted **evidence-backed** finding survives a scripted
    drop/downgrade attempt unchanged, recorded in `audit.coordinator.reinstated` (#30). A
    coordinator run that fails (no-submit / budget / model error) leaves the phase with the **raw
    roll-up** plus a `<phase>.coordinator-failed` warning (#29). A composite phase *without* a
    coordinator keeps the plain roll-up. Verified with `stub-composite`.
19. **Risk classifier (§3.4.1a):** the deterministic `classify(diff, paths, rules) → level` is
    evaluated once per `riskRules`-declaring phase before fan-out, over the **pre-filtered** diff
    (#32); a phase declaring `riskLevels` runs a reduced specialist subset and/or skips its
    coordinator at a lower level and the full set at the top level; each resolved `level` appears
    in the run output. With no `riskRules` declared the mechanism is inert (full panel runs).
    Verified with a stub phase and two synthetic diffs (small vs large).

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
- **Per-finding adversarial-verify panel** — *beyond* the coordinator judge pass (§3.3a, now in
  scope). The coordinator's reasonableness filter is the v1 dedup/false-positive mechanism; a
  separate N-skeptic refutation vote per finding remains a later option if the judge proves
  insufficient. *(Amended 2026-06-09: the cross-specialist dedup/verify item previously deferred
  here is now the coordinator — decision #25.)*
- **Re-review awareness** — feeding prior findings + resolution status into a re-run so resolved
  items aren't re-raised. Cloudflare does this in their coordinator; for stet it can live caller-side
  (the `github-integration` feature filters output) in v1, with a harness input added later.
- **GitHub / CI integration surface** — the harness is already CI-ready (headless CLI, `--format
  json`, exit codes, stories 15–17). A GH Action wrapper and a GH-App/webhook bot that posts
  findings as PR comments and turns PR comments into harness invocations are a **separate
  follow-up feature** (`github-integration`), not harness machinery.

## 8. Decisions

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| 1 | One gating severity vocabulary (`error/warning/info`); POC `critical/high/medium/low` survives as `meta.priority` | draft | no information loss; one threshold mechanism | settled |
| 2 | `Audit` (examined/checks/claims) is first-class on every phase | draft | the anti-silent-green mechanism, generalized from the POC | settled |
| 3 | Deterministic + evidence-backed findings are `high` confidence by construction | draft | a reproducing command is proof; the confidence filter exists for opinions | settled |
| 4 | Schemas defined with TypeBox, validated at the tool boundary | draft | runtime validation is what makes output-as-tool enforceable | settled |
| 5 | Pi SDK: standardize on `@earendil-works/pi-coding-agent` 0.79.x (amended 2026-06-09 from 0.78.x) | evidence check (2026-06-06); version amended at M2 build (2026-06-09) | confirmed successor of `badlogic/pi-mono`; the POC already runs on it. M2: `vp add` resolved 0.79.1 (API-compatible with 0.78.x — `createAgentSession`/`session.prompt`/`getSessionStats`/`defineTool`/`DefaultResourceLoader` unchanged); adapter compiles + steel thread runs. Reality-disagrees protocol applied (plan §6) | settled |
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
| 17 | ~~No cross-specialist dedup/adversarial-verify in v1~~ → **superseded by #25** | draft, **amended 2026-06-09** | the deferred "known fix" became designed-in once Cloudflare showed the judge pass is their most load-bearing filter, not a tail case | superseded by #25 |
| 18 | Caching and SARIF deferred to v1.x | draft | see §7 | settled (deferred, §7) |
| 19 | `Audit.claims` gains a fourth bucket `outOfScope` | behavioral-engine brainstorm (Johan, 2026-06-06) | claims reaching no selected surface are a deliberate, named cut; lands with the behavioral-engine PRD | settled — pending application |
| 20 | Harness-emitted findings (`harness.*`, `<phase>.partial-coverage`, activation-time findings) attach to the report of the phase they concern; no harness pseudo-phase | review round 2 (Johan, 2026-06-07) | findings live in `PhaseReport`s; the id namespace records the emitter; `meta.emitter` is the additive fix if a field is ever needed | settled |
| 21 | CI carries pinned routing as `--model` flags in the workflow invocation; env-var layer deferred | review round 2 (Johan, 2026-06-07) | pins visible & versioned where the merge gate is defined; zero new mechanism; "never name providers" protects shared config, not CI's own invocation | settled |
| 22 | Turn ceilings follow the wall-clock class: 50 (5-min class) / 120 (15-min class) | review round 2 (Johan, 2026-06-07) | headroom where the long successful runs are; a false breach costs a loop an iteration; one principle — budgets come in two classes | settled |
| 23 | `RunReport` carries `stet` (binary semver) + `startedAt` (ISO-8601 UTC) | review round 2 (Johan, 2026-06-07) | reports travel and must self-describe; "which stet, when" answered inside the artifact; cache key excludes `startedAt` | settled |
| 24 | Harness-only build scope; the steel thread runs on two stub phases (§3.9); every real phase integrates via its own feature plan | brief direction 8 (Johan, 2026-06-06) | the harness's definition of done can't depend on another feature shipping; pluggability becomes a demonstrated fact | settled |
| 25 | **Coordinator (judge pass) is first-class composite-phase machinery** (§3.3a): an optional `robust`-tier agent that dedups, drops convention-contradicted/speculative findings, and re-ranks; its submission replaces the specialist roll-up. Harness owns the mechanism; review's coordinator rubric is the code-review PRD's | Cloudflare reference review (Johan, 2026-06-09) | their single most load-bearing noise filter — not the "if it proves noisy" tail #17 assumed; reuses the AgentRunner seam + existing tiers | settled (supersedes #17; refined by #29–#31) |
| 26 | **Deterministic risk classifier is a harness mechanism** (§3.4.1a): `classify(diff, paths, rules) → level` scales specialist fan-out + coordinator on/off; harness owns the mechanism + the level→fan-out wiring, the consuming feature PRD owns thresholds/rules (same split as activation) | Cloudflare reference review (Johan, 2026-06-09) | activation is on/off; this is the missing "how much" dial and the cost gate for #25's expensive judge; baking thresholds into the substrate would violate #24 | settled (amended by #32) |
| 27 | Semantic diff pre-filtering (strip lockfiles/minified/sourcemaps/vendored/`@generated`-except-migrations) + model failback on retryable errors | Cloudflare reference review (Johan, 2026-06-09) | removes a class of false positives and token waste; failback is just the existing tier preference order | settled (extended by #33) |
| 28 | **`PhaseId` is an open identifier** (kebab-case pattern, not a closed union); the five product phases are the documented built-in set, stub ids equally valid | soundness review (2026-06-09) | the closed union contradicted acceptance #1 ("sixth phase touches no harness code") and could not validate the steel thread's own stub-phase reports (§3.9) | settled |
| 29 | **Coordinator failure falls back to the raw roll-up** + `<phase>.coordinator-failed` warning; specialist findings are never forfeited to a failed judge | soundness review (2026-06-09) | §3.3's "one specialist failing never loses the others' findings" extends to the judge — otherwise the coordinator is a single point of failure that discards everything; degrade-with-visibility, same ethos as budgets | settled |
| 30 | **Coordinator authority is constrained:** it may not drop or downgrade deterministic / evidence-backed findings; harness reinstates protected findings post-submission (visible in `audit.coordinator.reinstated`) | soundness review (2026-06-09) | §4.6 makes evidence high-confidence *by construction* — proof is not an AI judge's to overrule; a guarantee enforced by construction can't be talked out of (brief direction 3) | settled |
| 31 | **Coordinator drops are recorded** in `audit.coordinator.dropped` ({id, specialist, message}), computed by the harness as roll-up minus survivors | soundness review (2026-06-09) | a judge silently filtering findings is a new silent channel; "why didn't stet flag X?" must stay answerable from the artifact — without resurrecting the noise into `findings` | settled |
| 32 | **Risk rules are declared per phase** (`riskRules` in `PhaseConfiguration`); classify is evaluated once per declaring phase, over the **pre-filtered** diff | soundness review (2026-06-09) | one run-global level can't serve two phases with different sensitivities, and "rules belong to the consuming PRD" requires a per-phase home — same shape as activation predicates; pre-filtered input keeps lockfile churn from inflating risk | settled (amends #26) |
| 33 | **Stripped paths are in the report:** `scope.stripped` in `RunReport`, not just the human scope echo | soundness review (2026-06-09) | machine consumers (loops, CI) are the primary audience — visibility that exists only in human chrome is invisible to them | settled (extends #27) |
| 34 | **Mutation-freedom is enforced for `edit`/`write` (registration boundary, test-verified), but `bash` is a known residual write surface** held read-only by rubric only; sandboxed enforcement (read-only mount / spawn-hook denylist / repo copy) is a tracked follow-up tied to the Phase 5 execution milestone | M2 build review (2026-06-10) | PR-review #1 showed the §3.2 "no code path can mutate" claim was falsified by the unrestricted `bash` tool (the SDK has no read-only bash); `bash` is needed (esp. Phase 5), so the honest near-term posture is "file tools barred at registration, bash instructed-not-enforced" with enforcement scheduled where a controlled exec surface is built anyway. Reality-disagrees protocol (plan §6) | **open — follow-up** (amends user story 27, §3.2; M2 keeps bash) |
| 35 | **Agreement-based verification for composite phases:** AI-judgment confidence is derived from an N-voter refutation pass (N=3 default; 3/3→high, 2/3→medium, ≤1/3→dropped), not model self-report; the harness owns the N-voter mechanism, per-phase voter count/lenses are the consuming PRD's | code-review PRD review (Johan, 2026-06-19) | verbalized LLM confidence is miscalibrated (code-review research §4); agreement corroborates. Supersedes the §3.3a v1 deferral of a per-finding refutation panel | settled (amends §3.3a, §4.6) |
