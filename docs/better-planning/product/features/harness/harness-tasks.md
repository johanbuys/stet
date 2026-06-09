# harness — tasks

**Status:** ready — 2026-06-08; **amended 2026-06-09** (Cloudflare reference review: +M7.5,
T27–T29; pre-filtering folded into T24, failback into T19); **amended 2026-06-09 (b)**
(architecture soundness review, PRD #28–#33 / plan P10: open `PhaseId` into T2, model stopgap +
explicit stub registration into T11, budget layering into T12, `scope.stripped` into T24,
coordinator fallback/authority/drop-audit into T27–T28, per-phase `riskRules` into T29) — 29
tasks.
**Derived from:** `harness-plan.md` (M1–M9, M7.5) · contracts in `harness-prd.md` §4 · methodology
in plan §2a + decisions P1/P7/P8/P9 · `research/cloudflare-ai-review-reference.md`
**Exported:** GitHub issues, label `auto-tasks` (issue numbers recorded per task after export;
T27–T29 exported 2026-06-09)

One task ≈ one focused agent session. Tasks are grouped by milestone and ordered by what
unblocks what. Each carries Implements-links to exact plan/PRD sections, the files it touches,
and its own **Accept** line — a command to run and a thing to observe — inherited from the
plan's "run X, see Y" discipline. The builder updates the checkboxes and status header as work
lands; the plan's **reality-disagrees protocol** applies (contradictions surface upstream,
never get silently absorbed into a task).

## PR strategy — one PR per milestone, stacked

Each milestone ends in a verifiable outcome, which is exactly what makes a coherent, reviewable
PR. **One PR per milestone**, each stacked on the previous (M2's branch off M1, etc., since
milestones depend on each other — see plan §5). Don't open a PR mid-milestone: a milestone's
tasks include the red→green steps that only make sense together, and the milestone's Accept line
is the PR's "it's green" gate. The two large milestones (M1, M2) carry an **optional split
point** below if the diff runs large; everything else is one PR.

| PR | Tasks | Merges when |
|---|---|---|
| PR1 · M1 spine | T1–T6 *(optional split: T1–T4 / T5–T6)* | M1 Accept passes |
| PR2 · M2 steel thread | T7–T11 *(optional split: T7–T9 / T10–T11)* | acceptance #17 (steel thread) |
| PR3 · M3 budgets | T12–T13 | M3 Accept |
| PR4 · M4 scheduler/teardown | T14–T16 | M4 Accept |
| PR5 · M5 config | T17–T18 | M5 Accept |
| PR6 · M6 routing | T19–T20 | M6 Accept |
| PR7 · M7 specialists | T21–T22 | M7 Accept |
| PR7.5 · M7.5 coordinator + classifier | T27–T29 | M7.5 Accept |
| PR8 · M8 spec context | T23–T24 | M8 Accept |
| PR9 · M9 human output | T25–T26 | M9 Accept |

After M2, PR3/PR4/PR5/PR6/PR8 are mutually independent (plan §5) and may branch off M2 in parallel
rather than strictly stacking; PR7 (specialists) stacks on PR3 (reuses M3's budget outcome).
**PR7.5 (M7.5) stacks on PR7** — the coordinator judges M7's roll-up; its classifier half depends
only on M1 and could split out if the PR runs large. *(Added 2026-06-09 — Cloudflare reference
review; see `research/cloudflare-ai-review-reference.md` and plan M7.5.)*

---

## M1 — Deterministic tracer (`stub-det` end-to-end) · PR1

- [x] **T1 · `better-result` foundation + error taxonomy + CLI throw→exit shell**  ([#6](https://github.com/johanbuys/stet/issues/6))
  Implements: plan §2a (error taxonomy), M1 step 0 · PRD §4.8 (exit codes) · decision P7
  Files: `package.json`, `src/errors.ts`, `src/cli.ts` (shell only)
  Accept: `vp add better-result` done; a unit test where a function returns
  `Err(new ConfigError(...))` is surfaced by the CLI shell as exit 2 + the message; an `Ok` path
  exits per the report. `vp test` green.

- [x] **T2 · Findings & report TypeBox schemas**  ([#7](https://github.com/johanbuys/stet/issues/7))
  Implements: plan M1 step 1 · PRD §4.2–4.5 (Finding/Audit/PhaseReport/RunReport)
  Files: `src/schema/{finding,report}.ts` + tests
  Accept: `vp test schema` — a hand-built valid `RunReport` (incl. `stet`, `startedAt`)
  validates; a malformed one yields `Err(SchemaError)` (not a throw). `PhaseId` is an open
  pattern-validated identifier, not an enum — a report whose phase is `stub-det` validates
  (PRD #28).

- [x] **T3 · Exit-code derivation (pure)**  ([#8](https://github.com/johanbuys/stet/issues/8))
  Implements: plan M1 step 2 · PRD §4.6 (confidence), §4.8 (gating)
  Files: `src/exit-codes.ts` + tests
  Accept: `vp test exit` — a high-confidence error ⇒ 1; same at medium ⇒ 0;
  `--fail-on warning` gates warnings; `result.gating` names the responsible findings.

- [x] **T4 · Scope detection**  ([#9](https://github.com/johanbuys/stet/issues/9))
  Implements: plan M1 step 3 · PRD §3.6, §6 (edge cases)
  Files: `src/scope.ts` + tests (real tmp git repos, no mocks)
  Accept: `vp test scope` — staged→working→branch→last-commit priority resolves correctly;
  conflicting flags and nothing-detectable each return `Err(ScopeError)`; detached HEAD /
  shallow clone degrade as PRD §6 specifies.

- [x] **T5 · `stub-det` phase + phase registry**  ([#10](https://github.com/johanbuys/stet/issues/10))
  Implements: plan M1 step 4, §2a (phase registration) · PRD §3.9, §4.1, acceptance #1
  Files: `src/phases/stub-det.ts`, `src/phases/index.ts` (registry + default set) + tests
  Accept: `vp test phases` — `registerPhase(stubDet)` adds it to the set; `stub-det` runs a
  configured command and maps its exit code to a `Finding`+`Check` in its `PhaseReport`.

- [x] **T6 · Minimal scheduler + CLI JSON output (closes M1)**  ([#11](https://github.com/johanbuys/stet/issues/11))
  Implements: plan M1 steps 5–6 · PRD §3.4 (activation/aggregation), §4.5, §4.8
  Files: `src/scheduler.ts`, `src/report.ts`, `src/cli.ts`, `fixtures/stub-repo/` + an
  end-to-end integration test
  Accept: `cd fixtures/stub-repo && node ../../dist/cli.mjs --format json` prints a valid
  `RunReport` with one `stub-det` phase (kind `deterministic`); exit `0` on pass / `1` on the
  forced-fail fixture variant; JSON is the only thing on stdout.

**M1 verifiable outcome (PR1 merge gate):** the command in T6 produces a valid report and
correct exit code; `vp test` green.

## M2 — `AgentRunner` + `stub-agent` + guards (closes the steel thread) · PR2

- [ ] **T7 · `AgentRunner` interface + `FakeAgentRunner` + phase wrapper**  ([#12](https://github.com/johanbuys/stet/issues/12))
  Implements: plan §2a (AgentRunner), M2 step 1 · PRD §3.2 · decision P1
  Files: `src/agent/runner.ts`, `src/agent/fake-runner.ts`, `src/phases/agent-phase.ts` (wrapper)
  Accept: `vp test agent` — a fake scripted to "submit once with N findings", run through the
  wrapper, yields a `PhaseReport` carrying them; the wrapper returns `Ok`/typed `Err`, never throws.

- [ ] **T8 · The three output-as-tool guards**  ([#13](https://github.com/johanbuys/stet/issues/13))
  Implements: plan M2 steps 2–4 · PRD §3.1 (validate-or-retry, idempotency, no-submit fallback)
  Files: `src/agent/submit-tool.ts`, wrapper `matchError` over `AgentError` + tests
  Accept: `vp test guards` — invalid submit rejected at the tool boundary + retry observed;
  3× submit ⇒ first wins, duplicates get "already recorded"; `Err(NoSubmitError)` ⇒ synthesized
  `error` `PhaseReport` + `<phase>.no-result` warning.

- [ ] **T9 · `stub-agent` phase**  ([#14](https://github.com/johanbuys/stet/issues/14))
  Implements: plan §2a (stub-agent rubric), M2 step 5 · PRD §3.9
  Files: `src/phases/stub-agent.ts` + tests (fake-driven)
  Accept: `vp test` — `stub-agent` (rubric: one `info` finding per `/\bTODO\b/` match in changed
  files) produces the expected findings against the fixture's two-TODO file via `FakeAgentRunner`.

- [ ] **T10 · `PiAgentRunner` adapter (port the POC)**  ([#15](https://github.com/johanbuys/stet/issues/15))
  Implements: plan M2 step 6 · PRD §3.2 · POC `validate.ts`
  Files: `src/agent/pi-runner.ts` + tests
  Accept: `vp check` clean; the adapter implements `AgentRunner` (createAgentSession,
  `systemPromptOverride`, mutation-free toolset, in-memory managers, `tool_execution_start` →
  stderr) and returns `Result<AgentRunSuccess, AgentError>`.

- [ ] **T11 · Keyed integration suite + mutation-free test + steel thread (closes M2)**  ([#16](https://github.com/johanbuys/stet/issues/16))
  Implements: plan M2 step 7 · PRD acceptance #2, #17, §3.9
  Files: `src/agent/pi-runner.integration.test.ts`, a mutation-free assertion test
  Accept: **the steel thread** — `cd fixtures/stub-repo &&
  PI_TEST_MODEL=anthropic/claude-haiku-4-5 node ../../dist/cli.mjs` (zero args, both stubs
  registered; the env var is the pre-M6 model stopgap, plan §2a/P10) runs both phase kinds
  end-to-end → `RunReport` with `stet`+`startedAt`, correct exit code. The integration test
  registers the stubs **explicitly** via `registerPhase`, never via the default phase set (plan
  §2/P10). `vp test` green (fake-driven); `PI_TEST_MODEL=anthropic/claude-haiku-4-5 vp test`
  additionally green (real SDK round-trip). A test asserts no agent phase's registered toolset
  contains an edit/write tool.

**M2 verifiable outcome (PR2 merge gate):** acceptance #17 holds — the zero-arg steel thread runs
both phase kinds; mutation-free test passes.

## M3 — Budgets & safety limits · PR3

- [ ] **T12 · Phase-level budgets (wall-clock + turns)**  ([#17](https://github.com/johanbuys/stet/issues/17))
  Implements: plan M3 · PRD §3.5, acceptance #7, decision #22
  Files: `src/agent/budgets.ts`, wrapper wiring + tests
  Accept: `vp test budgets` — a `FakeAgentRunner` that delays past the wall clock (wrapper-
  enforced: race + abort) or returns a scripted `Err(BudgetError)` for the turn count (runner-
  enforced — layering per plan §2a/P10) yields `PhaseReport{ status:"error", reason:"budget
  exceeded" }` with partial audit preserved.

- [ ] **T13 · Bash-level limits (timeout + output cap)**  ([#18](https://github.com/johanbuys/stet/issues/18))
  Implements: plan M3 · PRD §3.5, plan §2a (truncation marker)
  Files: `src/agent/budgets.ts` (bash), tool plumbing + tests
  Accept: `vp test` — a `sleep`-based command hits the 60s timeout (output-so-far returned to
  the agent); output over 32KB is capped with the exact marker
  `\n…[stet: output truncated at 32KB]`.

## M4 — Scheduler: cancellation classes & teardown · PR4

- [ ] **T14 · Real parallel execution**  ([#19](https://github.com/johanbuys/stet/issues/19))
  Implements: plan M4 step 1 · PRD §3.4.2, acceptance #4
  Files: `src/scheduler.ts` (expanded) + tests
  Accept: `vp test scheduler` — with fakes of controlled duration, total wall-clock for an
  all-pass run is within 10% of the slowest single phase.

- [ ] **T15 · Cancellation classes**  ([#20](https://github.com/johanbuys/stet/issues/20))
  Implements: plan M4 steps 2–3 · PRD §3.4.3, acceptance #5
  Files: `src/scheduler.ts`, gate-class config + tests
  Accept: `vp test` — a cancel-class gate failure (tests/types/build) cancels in-flight agent
  phases → `cancelled` + gate named; a report-only gate (lint/format) cancels nothing; a gate
  *timeout* is always report-only.

- [ ] **T16 · Teardown & signal handling**  ([#21](https://github.com/johanbuys/stet/issues/21))
  Implements: plan M4 steps 4–5 · PRD §3.4.4, acceptance #9
  Files: `src/signals.ts`, `src/teardown.ts` + tests (child-process harness with real signals)
  Accept: `vp test` — SIGINT⇒130, SIGTERM⇒143, each after writing the partial report with
  `cancelled` statuses; a second Ctrl-C force-kills; exit 2 stays reserved for tool errors.
  (Service teardown is a no-op hook here — stubs own no services.)

## M5 — Config loading & precedence · PR5

- [ ] **T17 · Four-layer load + deep merge**  ([#22](https://github.com/johanbuys/stet/issues/22))
  Implements: plan M5 · PRD §3.7, §4.9
  Files: `src/config/{load,merge,schema}.ts` + tests (real temp config files)
  Accept: `vp test config` — a setting defined at every layer resolves `flags > project > user >
  built-in`; nested keys merge leaf-by-leaf (never whole-section replacement); load returns
  `Result<Config, ConfigError>`.

- [ ] **T18 · Malformed & unknown-key handling**  ([#23](https://github.com/johanbuys/stet/issues/23))
  Implements: plan M5 · PRD §3.7
  Files: `src/config/load.ts` + tests
  Accept: `vp test` — malformed YAML ⇒ `Err(ConfigError)` → exit 2 naming the path/line;
  unknown keys ⇒ warning finding, not error.

## M6 — Model routing: tiers & qualification check · PR6

- [ ] **T19 · Tier→model resolution + preflight**  ([#24](https://github.com/johanbuys/stet/issues/24))
  Implements: plan M6 (a) · PRD §3.2, acceptance #13
  Files: `src/routing/resolve.ts` + tests (fake provider/auth registry, injected)
  Accept: `vp test routing` — a tier resolves to a model from the credentialed providers;
  no-provider-for-tier ⇒ `Err(RoutingError)` surfaced as a preflight exit-2 before any phase
  launches; a single phase's resolution failure ⇒ that phase `error`, others run;
  `--model [<phase>=]<id>` overrides, specific beats general. **Failback (#27):** resolution returns
  the ordered tier-preference list; a retryable provider error advances to the next model;
  non-retryable (auth/context-overflow) surfaces immediately — one fake-provider test covers it.

- [ ] **T20 · Qualification check + manifest reader**  ([#25](https://github.com/johanbuys/stet/issues/25))
  Implements: plan M6 (b), §2a (fixture manifest) · PRD §3.2, acceptance #15
  Files: `src/routing/{qualify,manifest}.ts`, `fixtures/manifest.json` + tests
  Accept: `vp test` — a resolved model with no matching `(model, tier, rubricVersion,
  fixtureSetVersion)` entry ⇒ `harness.unqualified-model` warning; a matching entry suppresses
  it; a version bump invalidates the match.

## M7 — Specialists (composite phases) · PR7

- [ ] **T21 · Specialist config + parallel execution + roll-up**  ([#26](https://github.com/johanbuys/stet/issues/26))
  Implements: plan M7 · PRD §3.3, §4.1 (specialists), acceptance #14 (roll-up half)
  Files: `src/phases/composite.ts`, `src/phases/stub-composite.ts` + tests
  Accept: `vp test specialists` — `stub-composite` runs N specialists in parallel via the
  `AgentRunner` seam; findings roll up to one `PhaseReport`, each tagged with its `specialist`;
  per-specialist cost appears in `cost.specialists`.

- [ ] **T22 · Specialist failure isolation**  ([#27](https://github.com/johanbuys/stet/issues/27))
  Implements: plan M7 · PRD §3.3, acceptance #14 (isolation half)
  Files: `src/phases/composite.ts` + tests
  Accept: `vp test` — with one specialist forced to error (and one to a budget breach, reusing
  M3's outcome), the surviving specialists' findings are preserved in the report.

## M7.5 — Coordinator judge stage + risk classifier · PR7.5 *(added 2026-06-09)*

- [ ] **T27 · Coordinator judge pass (config + run + roll-up replacement)**  ([#33](https://github.com/johanbuys/stet/issues/33))
  Implements: plan M7.5 steps 1–3 · PRD §3.3a, §4.1 (`coordinator`), §4.4 (`cost.coordinator`),
  acceptance #18 · decisions #25, #29
  Files: `src/phases/composite.ts`, `src/phases/coordinator.ts` + tests
  Accept: `vp test coordinator` — a composite phase with a declared `coordinator` runs its
  specialists, then a single `robust`-tier judge through the `AgentRunner` seam (FakeAgentRunner
  scripted to merge two duplicate findings and drop a planted nitpick); the judge's submission
  **replaces** the raw roll-up as the phase's `findings`; survivors keep their `specialist`;
  `cost.coordinator` is populated; the three §3.1 guards apply to the judge run. A judge run that
  **fails** (scripted `Err(NoSubmitError)` / budget breach / model error) leaves the phase with
  the **raw roll-up** plus a `<phase>.coordinator-failed` warning naming the reason (PRD #29) —
  specialist findings are never lost to a failed judge. A composite phase with no coordinator
  keeps the plain roll-up unchanged.

- [ ] **T28 · Coordinator rubric fixture + provenance/gating interaction**  ([#34](https://github.com/johanbuys/stet/issues/34))
  Implements: plan M7.5 steps 2, 4 · PRD §3.3a, §4.2 (coordinator-emitted findings), §4.3
  (`audit.coordinator`), §4.6/§4.8 · decisions #30, #31
  Files: `src/phases/coordinator.ts`, `src/phases/stub-composite.ts` (gains a coordinator) + tests
  Accept: `vp test` — a coordinator-raised finding (no single specialist owned it) carries no
  `specialist` and `phase ==` the composite phase; dropped findings vanish from `findings` but are
  recorded in `audit.coordinator.dropped` ({id, specialist, message} — harness-computed as roll-up
  minus survivors, PRD #31); re-ranked severity/confidence flow into `result.gating` correctly
  (the judge can downgrade a specialist's **AI-judgment** `error` and it stops gating). A planted
  **deterministic / evidence-backed** finding (carrying `evidence.command`) survives a judge
  scripted to drop or downgrade it — reinstated unchanged by the harness and recorded in
  `audit.coordinator.reinstated` (PRD #30).

- [ ] **T29 · Deterministic risk classifier + level→fan-out/coordinator wiring**  ([#35](https://github.com/johanbuys/stet/issues/35))
  Implements: plan M7.5 steps 5–6 · PRD §3.4.1a (classifier), §4.1 (`riskRules`/`riskLevels`),
  acceptance #19 · decisions #26, #32
  Files: `src/risk/classify.ts`, `src/phases/composite.ts` (level wiring),
  `src/phases/stub-composite.ts` (level rules) + tests
  Accept: `vp test risk` — `classify(diff, paths, rules) → level` is a pure function (table tests,
  fixture rule `lines > N ⇒ "full" else "trivial"` declared as `riskRules` on `stub-composite` —
  rules are per-phase, evaluated once per declaring phase before fan-out, PRD #32); a phase
  declaring `riskLevels` runs a reduced specialist subset and/or skips its coordinator at the low
  level, the full set + coordinator at the top; each resolved `level` appears in the run output;
  with no `riskRules` declared the mechanism is inert (full panel runs). Real thresholds are the
  code-review PRD's, not built here (plan P9).

**M7.5 verifiable outcome (PR7.5 merge gate):** `stub-composite` with a declared coordinator,
`riskRules`, and `riskLevels` runs 1 specialist / no judge on a small diff and all specialists +
judge on a large diff, the judge's merged findings (one dedup, one drop) becoming the phase's
`findings`, with `cost.coordinator`, `audit.coordinator.dropped`, and the resolved `level`
present; a scripted judge failure leaves the raw roll-up + the `coordinator-failed` warning;
`vp test` green.

## M8 — Spec context & large-diff visibility · PR8

- [ ] **T23 · Spec-context combining**  ([#28](https://github.com/johanbuys/stet/issues/28))
  Implements: plan M8 · PRD §3.6, acceptance (spec sources)
  Files: `src/spec-context.ts` + tests
  Accept: `vp test spec` — `--prd <file|-|literal>` + `--task` concatenate and reach phases
  declaring spec consumption; `report.spec.sources` lists each source.

- [ ] **T24 · Large-diff visibility + semantic pre-filtering**  ([#29](https://github.com/johanbuys/stet/issues/29))
  Implements: plan M8, §2a (context budget) · PRD §3.6, acceptance (partial-coverage) · decision #27
  Files: `src/phases/coverage.ts`, `src/diff-filter.ts` + tests
  Accept: `vp test` — semantic pre-filtering strips lockfiles/minified/sourcemaps/vendored/
  `@generated`-except-migrations and records stripped paths in `report.scope.stripped` (PRD #33)
  plus the human scope echo; the risk classifier consumes the filtered diff (PRD #32); then a diff
  over the 200k-char budget is reduced to a `git diff --stat`-order subset; a
  `<phase>.partial-coverage` warning names the excluded files (no silent truncation).
  *(Pre-filtering added 2026-06-09, #27; report field + classifier input 2026-06-09 (b).)*

## M9 — Human output & display polish · PR9

- [ ] **T25 · Human render**  ([#30](https://github.com/johanbuys/stet/issues/30))
  Implements: plan M9 · PRD §3.8, §2a (severity colors)
  Files: `src/output/human.ts` + tests
  Accept: `vp test output` — `stet` (no `--format json`) on `stub-repo` prints findings grouped
  by phase, severity-colored (red/yellow/dim, auto-off when not a TTY or `NO_COLOR`), `file:line`
  located, with per-phase status lines (skipped/cancelled reasons) and a cost footer.

- [ ] **T26 · Display filters**  ([#31](https://github.com/johanbuys/stet/issues/31))
  Implements: plan M9 · PRD §3.8
  Files: `src/output/human.ts`, flag wiring + tests
  Accept: `vp test` — `--quiet` suppresses passing phases and progress; `--show <severity>`
  filters *display* only (the exit code, derived from `--fail-on`, is unchanged).
