# stet — High-Level Product PRD

> **stet** — Latin: "let it stand." A proofreader's mark: it annotates the manuscript, it never
> rewrites it.

**Status:** draft — brainstormed 2026-06-05, supersedes `docs/plans/stet-prd-v1.md` (historical).
**Draws on:** `docs/research/behavioral-validation-findings.md` (the validated evidence base for
Phase 5 and the cross-cutting principles; phases 1–4 carry forward on v1's original reasoning).
**Defers to:** per-feature PRDs in `docs/prd/features/` for depth (contracts, schemas, edge cases).

---

## 1. What stet is

`stet` is an **independent code-change validation suite**: a standalone CLI that judges a change
across five dimensions — deterministic gates, spec compliance, code review, test quality, and
behavioral verification — and reports structured findings. It is invoked when work is believed
done: by a human as a pre-commit/pre-PR check, by an AI agent at the end of a task, by an
autonomous loop (e.g. ideoshi-code) as its verification gate, or by CI.

stet **reports; it never fixes.** Its output — findings with severity, confidence, and evidence —
is designed to be the *input* to whoever remediates: the calling agent, the loop, the human. stet
judges, the caller fixes, stet re-judges. There is no `--fix` (a deliberate cut from v1; see §9).

## 2. Problem

As AI writes more of the code, the bottleneck moves from writing to **verifying**. The existing
pieces each cover a slice: test runners verify against tests (not intent), linters verify style
(not semantics), type checkers verify types (not logic), review tools surface diffs (to humans).
Two gaps remain:

1. **No unified, structured judgment** of a change against its *intent* that both humans and
   agents can consume and act on.
2. **Nothing actually runs the thing.** The R&D demonstrated the decisive case: two byte-identical
   siblings differing by one missing `process.exit(1)` — green tests in both, static review passes
   both, and only *executing the program* catches the broken one. Verification that never runs the
   system inherits whatever the tests and the author missed.

A further failure mode is specific to agent loops: the author-agent grading its own work. An agent
that wrote the code, ran (some of) the tests, and read its own diff will over-claim — the POC
documented this class repeatedly. The validator must be **independent** of the author.

## 3. Design principles

1. **Findings, not fixes.** stet holds no write tools, at any phase, by construction. A verdict
   from a mutated repo is worthless (R&D D3, generalized to the whole product). Remediation is the
   caller's job, fed by stet's structured output.
2. **Independent verification.** stet does not trust the caller's claims: it runs the gates
   itself, and behavioral verification is **diff-blind** — the diff may *select which surfaces to
   exercise*, but claims derive from the **spec**, and are proven by running. The diff is never the
   source of truth for "does it work."
3. **Evidence must reach the claim.** Code shape is not proof; a mock proves the harness, not the
   product; a pipe is not a TTY; HTTP + source-reading is not proof for a client-rendered SPA.
   Take the cheapest *sufficient* rung of the evidence ladder: exit code / HTTP status → in-process
   JS execution → real browser.
4. **Blunt conservative rubrics.** A precise, permissive rule is a loophole for a weaker model; a
   blunt conservative rule is both safer and more correct. Every rubric edit is held to this.
5. **Verdicts internally, findings on the surface.** Phase 5 reaches a real verdict
   (`passed | failed | blocked | inconclusive`) backed by executable evidence; it is surfaced as
   findings (`failed → error` + reproducing command, `blocked → warning`, `inconclusive → info`)
   and gates through the same severity threshold as everything else. Decisive where earned; uniform
   where consumed.
6. **Parallel by default; sequencing is policy, not architecture.** Phases are independent. The
   scheduler runs all activated phases concurrently and cancels in-flight work when deterministic
   gates fail. Ordering is a config knob for the cost-conscious, not the product's shape.
7. **Agentic at the edges, deterministic in the loop.** LLM exploration happens once, at
   `stet init`, and writes config; the recurring run path of Phase 1 is plain process execution.
   AI phases (2–5) are agents on a shared harness.
8. **Inference over configuration.** Zero-config invocation works (scope auto-detection, gate
   heuristics); `stet init` upgrades it; config refines it. Flags override config.
9. **Model routing is configuration.** Built-in defaults are **capability tiers** (robust for
   anything touching real systems/mocks/web; fast for self-contained checks), resolved at run
   time against the providers the user actually has credentials for — teams share tier intent in
   project config, never provider pins. Tier membership is earned on the eval suite.
10. **Provisioned, never self-installed.** Anything the validator cannot self-serve at run time
    (the browser) is provisioned ahead — baked image, remote browser, or cloud provider. The
    validator never installs infrastructure mid-validation.
11. **The eval suite is the quality discipline.** The ported fixture suite + content-aware grader
    is the regression gate for every rubric edit and every model routing change ("does this model
    hold the line?"). It runs under `vp test`.

## 4. Architecture — one harness, five phase configurations

The harness owns everything common: scope detection, config, the scheduler, the agent
runner (Pi SDK), the findings schema, output-as-tool (submitting structured findings is the *only*
way for an agent phase to finish — R&D D6), output formats, and the exit-code contract.

Each phase contributes only: **a rubric (system prompt) + a toolset + a default model.**

```
            ┌─────────────────────────── harness ───────────────────────────┐
            │ scope detection · config · scheduler (parallel, fail-fast     │
            │ cancel) · agent runner · findings schema · output-as-tool ·   │
            │ formats (human/json) · exit codes                             │
            └───────────────────────────────────────────────────────────────┘
   Phase 1          Phase 2           Phase 3        Phase 4         Phase 5
   gates            spec compliance   code review    test quality    behavioral
   (no LLM:         (rubric +         (rubric +      (rubric +       (hardened rubric ×
   spawn            read-only         read-only      read-only       execution adapters:
   processes)       tools)            tools)         tools)          bash, start_service,
                                                                     pty_session, agent-browser)
```

**Scheduler.** All activated phases launch in parallel. Deterministic gates are the fastest; if
they fail, in-flight AI phases are cancelled (bounded token waste) and the run reports the gate
failures. `--continue-on-failure` disables cancellation; a `sequential` policy exists in config for
callers who prefer staged cost. Wall-clock on the happy path ≈ the slowest phase, not the sum.

**Phase 5's internal structure** is the POC architecture promoted to product: one surface-agnostic
judgment rubric × per-surface execution adapters (CLI: spawn → stdout/stderr/exit; API:
`start_service` → HTTP; web: `start_service` → `agent-browser`). Nothing in the rubric names a
surface; only adapters are surface-specific.

## 5. The five phases

### Phase 1 — Deterministic gates (the floor, not the pitch)

Runs the project's own tests, type check, lint, and (opt-in) build, from config or detection
heuristics. **No LLM in the run path.** Its value is not the checks themselves — any healthy
project has CI — but: (a) **independence**: stet's report includes "I ran the gates myself," so the
verdict never rests on the author's claim; (b) a **self-contained report**: AI findings are read
against ground truth; (c) **bootstrap** for loops dropped into unfamiliar repos.

- Missing gates are findings, not silence: "no lint configured" (warning) — a green report can
  never quietly mean "nothing was checked." Project-level hygiene ("no test runner at all") is
  flagged at init and at run time.
- Skippable (`--skip gates` / config) where the environment already guarantees them (e.g. a CI
  step that runs after the test job).
- Drift (configured command no longer exists) is an error finding suggesting `stet init --refresh`.

### Phase 2 — Spec compliance

Inputs: the diff + spec context (`--prd`, `--task`, `--issue`; see §6). A read-only agent maps the
change against stated requirements: satisfied / partial / missing, plus scope creep. Findings keyed
to specific requirements. **No spec → the phase is skipped with a clear note**; all other phases
still run.

### Phase 3 — General code review

Inputs: the diff + enough surrounding context to judge patterns. Runs as a **panel of
specialized lenses** in parallel — bugs, security, patterns, quality, coverage-gaps (where tests
should be added or updated, risk-weighted) — narrow specialists over one generalist rubric.
High-signal over nitpicks; confidence scoring is critical; fewer, more confident findings beat
exhaustive noise.

### Phase 4 — Test quality

Activates only when the diff touches test files — the tests themselves are the object of
judgment. Judges whether assertions verify behavior or mirror implementation, whether tests
would fail if the code were wrong, edge-case coverage, tautology. ("Tests missing or stale" for
changed code is review's coverage-gaps lens — that's a judgment about the *code*.)

### Phase 5 — Behavioral verification (the proven core)

Activates when the diff touches observably runnable behavior (CLI commands, HTTP handlers, UI,
jobs, migrations). The diff **selects the surfaces**; the **claims derive from the spec**; the
agent proves them by running the system — strictly read-only, in a provisioned environment.

- **Requires a spec.** Without one there is nothing independent to verify against — deriving
  claims from the diff would inherit the author's blind spot and defeat the phase. No spec → the
  phase does not run and emits a **warning finding** ("behavioral verification did not run: no
  spec provided").
- **Verdict contract:** `passed | failed | blocked | inconclusive`, with executable evidence — a
  `failed` carries the exact reproducing command. Surfaced per principle 5.
- **Hardened rubric** (carried verbatim in spirit from the R&D, guarded by the eval suite):
  evidence sufficiency, anti-mocking, interactive/TTY honesty, browser-required-for-SPA.
- **Mocks:** mocks isolate *peripheral* services; a claim *about* a mocked service is `blocked`,
  never `passed`. The behavioral config declares per-service `real | mock`.
- **Tooling** (earned by probes, not speculation): bash + curl + node cover most surfaces;
  `start_service(cmd, ready_check)` owns boot/readiness/guaranteed teardown/timeouts;
  `pty_session` covers raw-mode TTY; a **provisioned** `agent-browser` covers real SPAs.
- **Run-instructions come from config** (drafted by `stet init`, confirmed by the user): start
  command, base URL, readiness probe, credentials, per-service real/mock. stet refuses to execute
  against anything not declared.

## 6. CLI contract

Carried from v1 (still right), minus fix mode:

- **Scope:** zero-arg auto-detection (staged → working tree → branch vs default → last commit);
  explicit flags `--staged`, `--working`, `--against <ref>`, `--commit <sha>`, `--commits <range>`
  override. Nothing detectable → clear message, exit 2.
- **Spec context:** `--prd <file|-|literal>`, `--task <string>`, `--issue <n>` (delegates to `gh`;
  no built-in forge integrations — other platforms pipe to `--prd -`). Opt-in auto-discovery of
  issue refs from commit messages (`--auto-context` / config). Sources combine.
- **Output:** human-readable default; `--format json` for machines; SARIF later. `--quiet`,
  `--show <severity>` display filters. Per-phase status + overall result always shown, including
  what was skipped and why.
- **Findings schema:** severity (`error|warning|info`), confidence (`high|medium|low`), phase,
  file/line where applicable, category, message, evidence (commands/output for Phase 5).
- **Exit codes:** `0` clean at threshold · `1` findings at/above threshold · `2` tool error ·
  `130`/`143` interrupted (POSIX `128+signal`, partial report written). One knob:
  `--fail-on <severity>` (default `error`). Strict CI uses `--fail-on warning` to also gate on
  `blocked`/skipped-behavioral. AI findings below high confidence never gate.
- **Headless by design:** no TTY required, runs in a container, JSON + exit codes are the loop
  contract.
- **`stet init`** — see §7.

## 7. `stet init` — the exploration agent

The one place agentic exploration is spent so runs never spend it. A read-only agent explores the
repo (package scripts, lockfiles, CI workflows, tsconfigs, lint configs, Makefiles) and writes
`stet.config.yml`:

- **Gate commands** for Phase 1 (CI workflows are the primary evidence — they document how the
  project already verifies itself).
- **A drafted `behavioral` section** for Phase 5 — start command, port/URL, readiness — marked as
  draft for human confirmation. The hardest config in the product becomes "review what init
  drafted" instead of homework.
- **Hygiene findings** — no tests / no linter / no type checking configured — reported at init
  time with severity.
- `stet init --refresh` re-explores after project changes; run-time drift findings point at it.

Without config, stet still runs on detection heuristics (and says so); init is the upgrade, not a
requirement.

## 8. Configuration (shape, not schema)

`stet.config.yml` at the repo root holds project facts (sharable across a team); a user layer
(`~/.config/stet`) holds provider/model concretes. Precedence: flags > project > user > built-in
defaults. Concrete schemas live in feature PRDs.

```yaml
gates:        # phase 1 commands; skippable per-gate
scheduler:    # parallel (default) | sequential; continue-on-failure
phases:       # enable/disable; per-phase model routing
behavioral:   # run-instructions: start, url, ready, credentials, services: real|mock
context:      # default PRD locations; auto-context opt-in
output:       # default format, fail-on threshold
ignore:       # paths
```

## 9. Out of scope

- **`--fix` / any remediation** — cut from v1's scope entirely. stet is mutation-free by
  construction; fixing is the caller's loop. (This also deletes fix-convergence, fix-scoping, and
  "don't fix the tests" policing from the product.)
- Visual regression, performance benchmarking, license/dependency scanning.
- Multi-language beyond the TS/JS ecosystem (v1 target).
- IDE plugins (SARIF later enables third parties), watch mode, server/daemon mode, plugin system,
  distributed execution.

## 10. Roadmap

Build order follows risk and proof, not phase number — Phase 5's engine already exists as a
validated POC, so it ports early rather than last.

- **v0.x — Harness + floor.** CLI scaffolding, scope detection, config, scheduler, findings
  schema + output formats, exit codes, Phase 1 with heuristics. `stet init` (gates part).
- **v0.x — Behavioral engine port.** Port the POC engine/rubric/verdict onto the harness; eval
  suite (14 fixtures + grader) running under `vp test`; `start_service`; CLI-surface validation
  end-to-end. Browser/PTY behind provisioning docs.
- **v1.0 — Full suite.** Phases 2–4 on the harness; `init` drafts the behavioral config;
  `pty_session`; provisioned `agent-browser` path; loop-integration docs (the ideoshi-code
  contract).
- **v1.x — Polish.** SARIF, caching, routing presets, hardening from eval expansion.

## 11. Feature PRDs implied (the index below this doc)

| Feature PRD | Covers |
|---|---|
| `harness` | scheduler, agent runner, findings schema, output-as-tool, formats, exit codes |
| `deterministic-gates` | detection heuristics, gate execution, hygiene/drift findings |
| `init` | exploration agent, config drafting, refresh |
| `spec-compliance` | phase 2 rubric, context inputs, requirement mapping |
| `code-review` | phase 3 lens set (bugs, security, patterns, quality, coverage-gaps), context windowing |
| `test-quality` | phase 4 rubric, no-tests findings |
| `behavioral-engine` | rubric port, verdict contract, adapters, evidence ladder, **pins the Pi SDK package** |
| `start-service` / `pty-session` | lifecycle + raw-mode tools |
| `browser-execution` | agent-browser integration + provisioning (baked image / remote / cloud) |
| `eval-suite` | fixture port, content-aware grader, `stet models test` qualification + curated manifest |

## 12. Resolved decisions (traceability to findings §10)

| Open item (findings §10) | Resolution |
|---|---|
| Diff-blind vs diff-activated | Confirmed: diff selects surfaces; claims derive from spec (§3.2, §5). |
| Verdict vs findings, exit policy | Verdict internal; `failed→error / blocked→warning / inconclusive→info`; one `--fail-on` knob, default `error` (§3.5, §6). |
| Anti-mock vs sandbox mocks | Mocks isolate peripherals; claims about a mocked service are `blocked`. Config encodes per-service `real|mock` (§5). |
| Mutation-free vs `--fix` | Generalized: the whole product is mutation-free; `--fix` is cut (§1, §9). |
| Pi SDK variant | Default to the POC's package (`@earendil-works/pi-coding-agent`) since the engine ports directly; the `behavioral-engine` feature PRD verifies its relationship to `badlogic/pi-mono` and pins it. |
| `behavioral` config schema | Shape stated (§5, §8); concrete schema in the `behavioral-engine` feature PRD, drafted by `init` (§7). |

Decisions made beyond §10 during this PRD: no `--fix` at all (v1 had it); parallel scheduler with
fail-fast cancellation replaces the staged ladder; Phase 1 reframed as the independence floor
(deterministic run path, skippable, hygiene findings); Phase 5 requires a spec (no diff-derived
claims — warning finding when absent); `stet init` as an exploration agent that also drafts the
behavioral config.

The harness-PRD review round (2026-06-06) added: tier-based model routing with a user config
layer and eval-earned qualification (`stet models test`); review as a lens panel (test-gap
judgment moves there from Phase 4); budget presets; POSIX signal exit codes; streaming deferred.
Details and rationale in `features/harness.md`.

## 13. Success metrics

- Zero-argument verification of a typical diff completes in well under the slowest phase + small
  overhead (parallel scheduler holds).
- False-positive rate on high-confidence AI findings stays below 10%.
- The eval suite gates every rubric/model change in CI; no regression ships on the 14 fixtures.
- Adopted as the verification gate by at least one autonomous loop (ideoshi-code) within a month
  of v1.0.
- Runs headless in a container with no TTY; a wrapping script branches on exit codes alone.

## 14. Distribution

`@johanbuys/stet` on npm, binary `stet`, MIT. Requires Node, `git`; optional `gh` for `--issue`;
browser capability is provisioned per §3.10 (recipe exists in the POC: `tools/provision-browser.sh`,
`docs/PROVISIONING.md`).
