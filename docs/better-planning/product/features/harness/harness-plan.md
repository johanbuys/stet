# Implementation Plan: Harness

**Status:** settled — 2026-06-08; **amended 2026-06-09** (Cloudflare reference review — adds
milestone **M7.5**). Derived from the settled harness PRD (2026-06-07) and brief (2026-06-06).
Cold-reader adversarial review (2026-06-07) passed — its blocker findings folded into §2a and the
milestone clarifications. `better-result` error-handling methodology added (P7, canvas 2026-06-08).
The 2026-06-09 amendment adds **M7.5 (coordinator judge stage + risk classifier)** from PRD
decisions #25/#26 and folds semantic diff pre-filtering (#27) into M8 and the failback note into
M6 — see `research/cloudflare-ai-review-reference.md` and plan decisions P8/P9. A second
2026-06-09 amendment (architecture soundness review; PRD #28–#33) pins budget-enforcement
layering (§2a), the steel thread's pre-M6 model stopgap and explicit stub registration (§2, §2a,
M2), coordinator fallback/constrained-authority/drop-audit and per-phase risk rules (M7.5), and
`scope.stripped` (M8) — plan decision P10.
**Depends on:** `harness-prd.md` (contracts in §4, behavior in §3) · `harness-brief.md`
(rationale).
**Companion:** `harness-plan-overview.html` (milestone timeline + dependency lanes).
**Discipline:** TDD is mandatory (CLAUDE.md + the `tdd` skill) — **vertical slices**: one test →
one implementation → repeat. No horizontal slicing (never all-tests-then-all-code). Tests
exercise **behavior through public interfaces** and must survive internal refactors. Toolchain:
Vite+ (`vp test`, `vp check`); schemas in TypeBox; Pi SDK `@earendil-works/pi-coding-agent`
0.79.x (amended 2026-06-09 from 0.78.x — `vp add` resolved 0.79.1, API-compatible; §6). The
mining source is the POC at `../validation-agent-poc` (`src/{validate,prompt,
schema}.ts`).

**Error-handling methodology — `better-result` (decision P7, full discipline).** The harness uses
`better-result` (v2.9.2; `vp add better-result`) for typed error handling: **every harness
function that can fail returns `Result<T, E>`, never throws across a module boundary.** Errors are
a `TaggedError` taxonomy (§2a); composition is `Result.gen`; the **single** throw→exit boundary is
the outermost CLI shell, which maps any uncaught/returned `Err` to exit 2 + a message. This makes
stet's stated "nothing passes silently" principle a compiler-enforced guarantee rather than a
reviewed discipline, and makes error variants first-class TDD targets (`expect(r.isErr())` + the
tagged variant). The POC's `throw new Error(...)` sites become returned typed errors. The PRD is
unaffected — this is methodology below the serialized-contract line, so no PRD amendment.

---

## 1. Build order & reasoning

Risk-and-proof order, not document order. The spine first (it's the cheapest thing that
produces observable output), then the agent half through the seam, then the contracts that ride
on top.

| # | Milestone | Proves | Risk it retires |
|---|---|---|---|
| **M1** | Deterministic tracer — `stub-det` end-to-end | the report/exit spine: scope → activation → scheduler → phase → `RunReport` → exit codes | "does a zero-config run produce a correct, parseable report at all" |
| **M2** | `AgentRunner` + `stub-agent` + output-as-tool guards | the agent half, the three guards, the **steel thread** (acceptance #17) | the external dependency (Pi SDK) and the completion contract — the project's core bet |
| **M3** | Budgets & safety limits | wall-clock/turn/bash/output limits as named `error` outcomes | "no silent hangs" — the POC's 300s failure mode |
| **M4** | Scheduler: cancellation classes & teardown | cancel vs report-only gates; total teardown; partial reports; signal exit codes | concurrent-failure correctness — the hardest control-flow in the harness |
| **M5** | Config loading & precedence | four-layer deep merge; malformed/unknown-key handling | "the same repo config behaves predictably across machines" |
| **M6** | Model routing — tiers & qualification check | tier→provider resolution; preflight failure; `unqualified-model` warning | "a zero-config run resolves a model or fails fast with a useful message" |
| **M7** | Specialists — composite phases | parallel sub-agents; roll-up; per-specialist cost; one-fails-others-survive | the review phase's machinery (first consumer is the code-review PRD) |
| **M7.5** | Coordinator judge stage + risk classifier | the judge pass over the roll-up (dedup/drop/re-rank); deterministic `classify → level` scaling fan-out + coordinator | noise/false-positives at scale (Cloudflare's top filter); the cost dial for the expensive judge |
| **M8** | Spec context & large-diff visibility | `--prd`/`--task` combining; `partial-coverage` warning; semantic diff pre-filtering | input plumbing the AI phases consume |
| **M9** | Human output & display polish | grouping, severity color, `--quiet`/`--show`, cost footer | the human-facing surface (loops already work via JSON from M1) |

**M1→M2 is the critical path** (the steel thread). M3–M8 each depend on the seam and report
spine but are largely independent of each other (see §3). M9 is last because loops — the
primary consumer — read JSON from M1; humans get progress on stderr from M2 onward.

## 2. Architectural seams (decided on canvas 2026-06-07)

- **`AgentRunner` interface (decision 1).** The harness owns a deep-module seam: `(rubric,
  toolset, budgets, inputs) → { submission, cost, audit }`. Harness tests drive a **scripted
  fake** that emits chosen tool-call/submission sequences (happy, duplicate-submit,
  never-submit, hang). The Pi-SDK-backed implementation (`PiAgentRunner`) is one adapter behind
  it — lifted from the POC's `runValidation()` — covered by a **keyed, skippable** integration
  suite (`describe.skipIf(!process.env.PI_TEST_MODEL)`) plus the steel-thread demo. This is the
  `tdd` skill's own rule: mock at the architectural boundary you own, never at SDK internals.
- **Stub phases are real product surface (PRD §3.9), not test scaffolding-only.** `stub-det`
  and `stub-agent` live in `src/`, ship in the codebase permanently, and are the fixtures the
  steel thread runs on — never in a released binary's default phase set. **Registration
  forward-compat (pinned 2026-06-09):** the steel-thread integration test registers the stubs
  *explicitly* via `registerPhase` (in-process CLI invocation), never by relying on the default
  phase set — so the thread keeps passing unchanged when real phases later displace the stubs
  from that set. (While the harness is the only thing built, the default set may well *be* the
  stubs; the test must not depend on that coincidence.)

## 2a. Concrete contracts the milestones assume

The cold-reader review (2026-06-07) surfaced contracts a builder needs pinned before M1; they
live here so each milestone can reference them. Shapes are illustrative TypeScript — the
authoritative runtime schemas are TypeBox per PRD §4.

**The error taxonomy (`src/errors.ts`, established M1).** A `TaggedError` hierarchy; each maps
to an exit code or a finding. Illustrative:

```ts
import { TaggedError } from "better-result";

class ScopeError   extends TaggedError("ScopeError")<{ message: string }>() {}      // → exit 2
class ConfigError  extends TaggedError("ConfigError")<{ path: string; message: string }>() {}  // → exit 2
class RoutingError extends TaggedError("RoutingError")<{ tier?: string; message: string }>() {} // → exit 2 (preflight) or phase error
class BudgetError  extends TaggedError("BudgetError")<{ limit: string; message: string }>() {}   // → phase "error", reason
// AgentError is the runner's failure union (below)
type AgentError = NoSubmitError | BudgetError | CancelledError | ModelError;
```

The CLI shell's `matchError` over the top-level error union is the single place an `Err` becomes
an exit code + message — exhaustive, so a new error variant is a compile error until handled.

**The `AgentRunner` interface (M2, decision P1).** A deep module with one method, returning a
`Result` (no throws across the seam); the fake and the Pi adapter both implement it:

```ts
import { Result } from "better-result";

interface AgentRunInputs {
  rubric: string;                 // system-prompt override (the phase's persona)
  userPrompt: string;             // per-run inputs: diff summary, spec context, run-instructions
  toolset: string[];              // allowlist; NEVER contains edit/write (mutation-free)
  submitSchema: TSchema;          // the submit_findings parameter schema (findings + audit + extension)
  budgets: { wallClockMs: number; turns: number; bashTimeoutMs: number; bashOutputCap: number };
  model?: string;                 // resolved "provider/id"; undefined ⇒ adapter resolves via routing (M6)
  cwd: string;                    // repo under validation (agent cwd)
  onTool?: (toolName: string) => void;   // progress → stderr
  signal?: AbortSignal;           // scheduler cancellation (M4)
}
interface AgentRunSuccess {
  submission: unknown;            // the validated submit payload
  cost: { model?: string; inputTokens?: number; outputTokens?: number; durationMs: number };
}
// AgentError = NoSubmitError | BudgetError | CancelledError | ModelError — each carries its cost+reason
interface AgentRunner { run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>>; }
```

The runner returns `Ok(submission)` or a typed `Err`; turning that into a `PhaseReport` (applying
the §3.1 guards, synthesizing the no-submit fallback from `NoSubmitError`) is the **phase
wrapper's** job, so the guards are tested independently of any runner. The wrapper `matchError`s
the `AgentError` union exhaustively into the corresponding `PhaseReport` status/reason.
`FakeAgentRunner` is constructed with a script (an ordered list of tool-call/submission/timing
events) and needs no SDK or key.

**Budget-enforcement layering (M3; pinned 2026-06-09, soundness review).** The budgets in
`AgentRunInputs` are enforced at two layers, split by who can see the resource:
- The **phase wrapper** owns the per-phase **wall clock** — a race against the runner promise;
  on expiry it aborts via `signal` and reports the breach. Tested with a fake that simply
  delays past the test budget.
- The **runner** owns what only it can observe: the **turn count** and the **bash-level limits**
  (60 s timeout, 32 KB output cap), surfacing breaches as `Err(BudgetError)`. In wrapper tests
  these are exercised by a fake *scripted to return* `Err(BudgetError)` — the fake doesn't
  re-implement enforcement; the real enforcement is covered in `PiAgentRunner`'s own tests and
  the keyed suite.
Either way the wrapper's `matchError` produces the same `PhaseReport{ status: "error", reason:
"budget exceeded" }` with partial audit — one outcome, two enforcement homes.

**Phase registration (M1; satisfies acceptance #1).** A phase is a `PhaseConfiguration` value
(PRD §4.1). The harness exposes `registerPhase(config)` writing to an internal registry; the
default phase set is an explicit array in `src/phases/index.ts`. A test repo's stub phases are
registered the same way. "Adding a sixth phase touches no harness code" = adding one
`registerPhase(...)` line + a new file under `src/phases/`, nothing else.

**`fixtures/stub-repo/` (M1).** A committed directory initialized as a **real git repo** (a
`setup.sh` or test `beforeAll` runs `git init` + an initial commit + a staged change, so scope
detection has real state to read — no mocked git). Contains: a couple of source files (one with
two `// TODO` comments for `stub-agent`), and a `stet.config.yml` declaring `stub-det`'s command
(e.g. `echo ok` for pass / `exit 1` for the forced-fail variant). Two variants or an env toggle
give the pass and fail cases.

**Small constants the PRD leaves to the plan:**
- **`stub-agent` rubric** — "find lines matching `/\bTODO\b/` in changed files; submit one
  `info` finding per match with its `file:line`." Deterministic enough to assert against,
  real enough to exercise a full submit round-trip. Refinable in PR review.
- **bash truncation marker** — the exact string `\n…[stet: output truncated at 32KB]` appended
  to capped output; tests and agents match on it.
- **context budget (M8)** — character count of the concatenated diff; default `200_000`. Over
  it ⇒ include changed files in `git diff --stat` order until the budget fills, warn naming the
  rest. (Churn ranking sharpens this later — §4.)
- **`PI_TEST_MODEL`** — opt-in env var holding a `provider/id` (e.g.
  `anthropic/claude-haiku-4-5`). Unset ⇒ the keyed integration suite **skips** (expected in
  local/keyless CI, not a failure); set ⇒ those tests run against the real SDK. **It is also the
  steel thread's model source until M6** (pinned 2026-06-09): tier routing doesn't exist before
  M6, so from M2 the CLI resolves an agent phase's model from `PI_TEST_MODEL` when no `--model`
  is given — the documented stopgap M6's resolution replaces. Unset at the CLI ⇒ the agent phase
  reports `error` ("no model available", named reason) and the deterministic half still runs.
- **severity colors (M9)** — error = red, warning = yellow, info = dim/grey, via a tiny ANSI
  helper; auto-disabled when stdout isn't a TTY or `NO_COLOR` is set. Tests assert on the
  rendered text content, not the escape codes.

## 3. Milestones

Each milestone: **goal · ordered steps (each step is a red→green cycle or a tight group of
them) · files touched · test plan (test-first) · verifiable outcome**. Within a milestone,
write one test, make it pass, move on — the step list is the intended *order of behaviors*, not
a license to write them all first.

### M1 — Deterministic tracer (`stub-det` end-to-end)

**Goal:** zero-config `stet` in a fixture repo runs one deterministic stub phase through the
whole spine and emits a correct `RunReport`. No agent code yet.

**Build order (behavior by behavior):**
0. **`better-result` dependency + `src/errors.ts` taxonomy** — `vp add better-result`; define
   the `TaggedError` classes (§2a) and the CLI shell's `Err → exit 2 + message` mapping. First
   test: a function returning `Err(new ConfigError(...))` is surfaced by the shell as exit 2
   with the message; an `Ok` path exits per the report. This is the spine's error convention,
   in place before anything else returns a `Result`.
1. **`RunReport`/`PhaseReport`/`Finding`/`Audit` TypeBox schemas** (PRD §4.2–4.5). First test:
   a hand-built valid `RunReport` validates; a malformed one is rejected (a validation failure
   is `Err(SchemaError)`, not a throw). Port shapes from POC `schema.ts`, generalized per the PRD.
2. **Exit-code derivation** — pure function `(report, failOn) → exitCode` (PRD §4.8): a
   high-confidence error ⇒ 1; same at medium ⇒ 0; `--fail-on warning` gates warnings;
   `result.gating` names the responsible findings. Pure, fully deterministic — many small tests.
3. **Scope detection** (PRD §3.6) — `(git state) → Result<Scope, ScopeError>`: staged →
   working → branch → last commit priority; conflicting explicit flags ⇒ `Err(ScopeError)`;
   nothing detectable ⇒ `Err(ScopeError)` (both surface as exit 2 via the shell). Tested
   against throwaway git repos in a tmp dir (real `git`, no mocks — behavior through the real
   interface), asserting `isErr()` + the variant for the failure cases.
4. **`stub-det` phase** — runs a configured trivial command, maps exit code → a `Finding` +
   `Check` in its `PhaseReport`.
5. **Minimal scheduler** — activates configured phases, runs them, aggregates into a
   `RunReport`. (Parallel machinery is trivial with one phase; real concurrency lands in M4.)
6. **CLI entry + JSON output** — `stet --format json` writes exactly the `RunReport` on stdout
   (schema-validated in the test), human chrome/progress on stderr; exit code from step 2.

**Files:** `src/errors.ts` (the `TaggedError` taxonomy), `src/schema/{finding,report,config}.ts`,
`src/scope.ts`, `src/exit-codes.ts`, `src/scheduler.ts`, `src/phases/stub-det.ts`,
`src/phases/index.ts` (registry + default set), `src/cli.ts` (the throw→exit shell),
`src/report.ts` + co-located `*.test.ts`. A `fixtures/stub-repo/` for end-to-end runs.

**Test plan (test-first):** unit tests for schema validation, exit-code derivation, scope
detection (against real tmp git repos). One **integration test** invoking the CLI in-process
against `fixtures/stub-repo/` asserting the emitted JSON parses to a `RunReport` with the
expected phase and exit code.

**Verifiable outcome:** `cd fixtures/stub-repo && node ../../dist/cli.mjs --format json` prints
a valid `RunReport` containing one `stub-det` phase (kind `deterministic`), exit `0` on pass /
`1` on the forced-fail fixture variant. `vp test` green. *(Runnable `stet`, day-scale.)*

### M2 — `AgentRunner` + `stub-agent` + output-as-tool guards (closes the steel thread)

**Goal:** the agent half through the owned seam; the three §3.1 guards; acceptance #17 (the
steel thread) closes here.

**Build order:**
1. **`AgentRunner` interface + scripted `FakeAgentRunner` + the phase wrapper** — the seam
   (§2a). First test: a fake scripted to "submit once with N findings", run through the phase
   wrapper, yields a `PhaseReport` carrying them. (The §3.1 guards below live in the wrapper,
   not the runner — they are the *completion* contract; resource *budgets* are a separate
   concern built in M3.)
2. **Guard: schema-validate-or-retry** — fake submits invalid input → rejected at the tool
   boundary, retry observed; then valid → recorded.
3. **Guard: idempotency** — fake submits 3× → first wins, duplicates get "already recorded"
   (POC pattern, `validate.ts:48`).
4. **Guard: no-submit fallback** — fake returns `Err(NoSubmitError)` → wrapper synthesizes an
   `error` `PhaseReport` + `<phase>.no-result` warning (PRD §3.1, POC `validate.ts:115`). The
   wrapper's `matchError` over `AgentError` is the exhaustive runner-error → report mapping.
5. **`stub-agent` phase** — trivial rubric ("count TODO comments in changed files, submit as
   info findings"); runs through the real `AgentRunner` interface (fake in unit tests).
6. **`PiAgentRunner` adapter** — port POC `runValidation()` behind the interface:
   `createAgentSession`, `systemPromptOverride`, mutation-free toolset, in-memory managers,
   `tool_execution_start` → stderr progress.
7. **Keyed integration suite** — `describe.skipIf(!process.env.PI_TEST_MODEL)`: `stub-agent`
   via `PiAgentRunner` against `fixtures/stub-repo/`, asserting a real submission round-trips.

**Files:** `src/agent/runner.ts` (interface + types), `src/agent/fake-runner.ts`,
`src/agent/pi-runner.ts`, `src/agent/submit-tool.ts` (the guards), `src/phases/stub-agent.ts` +
tests.

**Test plan:** the three guards are unit-tested against `FakeAgentRunner` (the failure modes
are *scripted*, not hoped-for from a real model). The adapter has the keyed/skippable suite. A
**mutation-free assertion test**: the registered toolset for any agent phase contains no
edit/write tool (PRD acceptance #2).

**Verifiable outcome:** **the steel thread (acceptance #17)** — `cd fixtures/stub-repo &&
PI_TEST_MODEL=anthropic/claude-haiku-4-5 node ../../dist/cli.mjs` (zero args, both stubs
registered; the env var is the pre-M6 model stopgap, §2a) runs both phase kinds end-to-end and
prints a `RunReport` with `stet` + `startedAt`, correct exit code. `vp test` green (fake-driven);
`PI_TEST_MODEL=anthropic/claude-haiku-4-5 vp test` additionally green (real SDK round-trip).

### M3 — Budgets & safety limits

**Goal:** every limit (PRD §3.5) is a named `error` outcome — no silent hangs/kills.

**Build order:** per-phase wall-clock (5/15-min class) → turn count (50/120 by class, PRD #22)
→ bash timeout (60s, output-so-far returned) → bash output cap (32KB, truncation marked).
Enforcement layering per §2a: the wrapper owns the wall clock (race + abort); the runner owns
turns + bash limits (`Err(BudgetError)`). Each: a deliberately-hanging/over-budget
`FakeAgentRunner` script → phase `error` with reason "budget exceeded", partial audit preserved
(PRD acceptance #7).

**Files:** `src/agent/budgets.ts`, wired into the runner; `src/phases/*` budget overrides.

**Test plan:** fake runner scripted to exceed each limit; assert the named outcome and preserved
partial audit. A `sleep`-based bash-timeout test. *(Default limit set only; presets deferred —
§4.)*

**Verifiable outcome:** a fixture phase scripted to hang 20s under a 1s test-budget yields a
`PhaseReport{ status: "error", reason: "budget exceeded" }` with its partial audit; `vp test`
green.

### M4 — Scheduler: cancellation classes & teardown

**Goal:** parallel execution; cancel-class (tests/types/build) vs report-only (lint/format)
gates; total teardown; partial report; signal exit codes (PRD §3.4).

**Build order:**
1. **Real parallel execution** — all activated phases concurrently; wall-clock ≈ slowest (PRD
   acceptance #4, measured with stub phases timed via fakes).
2. **Cancel-class gate failure** cancels in-flight agent phases → `cancelled` status + gate
   named (acceptance #5); report-only gate failure cancels nothing.
3. **Gate timeout is always report-only** regardless of class (PRD §3.4.3).
4. **Teardown** — cancellation disposes agent sessions and kills child process groups; the
   partial report is written to stdout (JSON mode) / stderr-flushed before exit, with
   `cancelled` statuses. *(Phase 5 service teardown is delegated to `start_service`'s contract
   in the behavioral-engine PRD; the stub phases here own no services, so teardown for this
   plan is sessions + process groups only — the seam for service teardown is left as a no-op
   hook the behavioral phase fills later.)*
5. **Signal handling** — SIGINT⇒130, SIGTERM⇒143, partial report first; second Ctrl-C
   force-kills (acceptance #9).

**Files:** `src/scheduler.ts` (expanded), `src/signals.ts`, `src/teardown.ts` + tests.

**Test plan:** fakes with controllable durations and a forced cancel-class failure; assert
in-flight phases land `cancelled`. Signal tests drive the process with real SIGINT/SIGTERM in a
child-process harness, asserting exit code + a written partial report.

**Verifiable outcome:** a run with a failing `stub-det` (cancel class) and a slow `stub-agent`
prints a report where the agent phase is `cancelled (gates failed: …)`, exit `1`; a SIGTERM
mid-run exits `143` with a partial report on disk.

### M5 — Config loading & precedence

**Goal:** `flags > project > user > built-in`, deep-merged per-setting (PRD §3.7, §4.9).

**Build order:** built-in defaults → project `stet.config.yml` overlay → user
`~/.config/stet/config.yml` overlay → flag overlay; malformed YAML ⇒ exit-2 with path+error;
unknown keys ⇒ warning, not error. **Merge semantics (PRD §3.7):** resolution is per-setting
deep merge — nested keys resolve leaf-by-leaf, never whole-section replacement (so a user
`phases.review.tier` and a project `phases.review.enabled` both survive); a scalar at a higher
layer overrides the same leaf below it. Tested with a setting defined at every layer at once.

**Files:** `src/config/{load,merge,schema}.ts` + tests.

**Test plan:** table-driven precedence tests (a setting defined at each layer resolves to the
highest); malformed-file (`Err(ConfigError)` → exit 2) and unknown-key (warning) cases. Real
temp config files, no mocks; load returns `Result<Config, ConfigError>`.

**Verifiable outcome:** a `stub-repo` with a project config setting `failOn: warning` flips a
warning-only run from exit 0 to exit 1; a malformed config exits 2 naming the line.

### M6 — Model routing: tiers & qualification check

**Goal:** tier→concrete-model resolution against credentialed providers; preflight failure;
`harness.unqualified-model` warning (PRD §3.2).

**Build order (two distinct checks, both in M6):** (a) **resolution** — tier → provider
preference → concrete model (against the SDK's registry/auth); no-provider-for-tier ⇒ preflight
failure before any phase launches (acceptance #13); single-phase resolution failure ⇒ that
phase `error`, others run. (b) **qualification** — once resolved, check the model against a
manifest; unqualified ⇒ `harness.unqualified-model` warning (acceptance #15, never blocks by
default). `--model [<phase>=]<id>` overrides, specific beats general.

**Fixture manifest (this plan only).** The real manifest format/command is the eval-suite PRD's;
M6 builds only the *reader + check* against a minimal fixture file
`fixtures/manifest.json`: `{ entries: [{ model: "provider/id", tier: "robust|fast",
rubricVersion: string, fixtureSetVersion: string }] }`. The check: a resolved model serving a
tier is qualified iff an entry matches `(model, tier, current rubricVersion, current
fixtureSetVersion)`. A version bump ⇒ no match ⇒ the warning. The harness owns this contract;
eval-suite later supplies the populated manifest and the `stet models test` writer.

**Failback (added 2026-06-09, decision #27):** resolution returns an *ordered* list (the tier
preference order, not a single model); on a *retryable* provider error the runner advances to the
next qualified model before reporting `error`; non-retryable errors (auth/context-overflow) surface
immediately. No new config — the chain is the existing preference order. One added test: a fake
provider scripted to return a retryable error then succeed on the next model.

**Files:** `src/routing/{resolve,qualify}.ts`, `src/routing/manifest.ts` (reader only) + tests.

**Test plan:** routing tested with a fake provider/auth registry (the SDK's registry is an
injected dependency, not reached into); resolution returns `Result<ResolvedModel,
RoutingError>` — no-provider is `Err(RoutingError)` surfaced as a preflight exit-2, tested via
`isErr()` + variant. Manifest is a fixture file. *(`stet models test`, scorecards, real
manifest format are the eval-suite PRD's — §4.)*

**Verifiable outcome:** zero-config run with a fake "only provider X credentialed" resolves the
`robust` tier to X's model; with no provider, preflight fails with the actionable message and
exit 2 before any phase runs.

### M7 — Specialists (composite phases)

**Goal:** a phase declares parallel sub-agents that roll up to one `PhaseReport` (PRD §3.3).

**Build order:** specialist config shape → parallel execution of N specialists via the
`AgentRunner` seam → roll-up (each finding carries its `specialist`; per-specialist cost in
`cost.specialists`) → one specialist failing doesn't lose the others (acceptance #14). A
specialist's budget breach is the *same* M3 outcome (`error`, reason "budget exceeded")
surfaced per-specialist — M7 reuses M3's mechanism, it doesn't reinvent it (so M7 depends on M3
for the budget-failure case; the happy/error-without-budget cases don't). Uses a
**`stub-composite`** phase with 2–3 trivial specialists as the fixture.

**Files:** `src/phases/composite.ts`, `src/phases/stub-composite.ts` + tests.

**Test plan:** fakes per specialist, one scripted to fail; assert surviving findings + per-
specialist cost + emitting-specialist on each finding.

**Verifiable outcome:** `stub-composite` with three specialists (one forced to error) yields one
`PhaseReport` with the two survivors' findings, each tagged, with per-specialist cost.

### M7.5 — Coordinator judge stage + risk classifier (added 2026-06-09)

**Goal:** a composite phase can run an optional **coordinator** (judge pass) over its specialist
roll-up, and a deterministic **risk classifier** can scale fan-out + coordinator activation (PRD
§3.3a, §3.4.1a; decisions #25/#26). This is the Cloudflare-validated noise filter and its cost
dial — see `research/cloudflare-ai-review-reference.md`.

**Build order (behavior by behavior):**
1. **Coordinator config + judge run** — extend the composite phase (M7) with an optional
   `coordinator` ({rubric, model=robust}); after specialists submit, run a single agent through the
   **existing `AgentRunner` seam** whose user prompt is the specialists' findings, whose
   `submit_findings` output **replaces** the raw roll-up as the phase's `findings`. First test: a
   `FakeAgentRunner`-scripted coordinator that merges two duplicate findings into one and drops a
   planted nitpick → the phase report carries the merged set.
2. **Provenance + cost + drop audit** — surviving findings keep their originating `specialist`;
   coordinator model/tokens land in `cost.coordinator` (PRD §4.4); a coordinator-raised finding
   carries no `specialist`; the harness records roll-up-minus-survivors in
   `audit.coordinator.dropped` (PRD #31 — computed by the harness, never judge-self-reported).
   The three §3.1 guards apply to the coordinator run unchanged.
3. **Failure fallback (PRD #29)** — a coordinator run failing (scripted `Err(NoSubmitError)`,
   budget breach reusing M3's outcome, model error) leaves the phase with the **raw roll-up** as
   its `findings` plus a `<phase>.coordinator-failed` warning naming the reason — specialist
   findings are never forfeited to a failed judge.
4. **Constrained authority (PRD #30)** — a planted deterministic / evidence-backed finding
   (carrying `evidence.command`) survives a coordinator scripted to drop or downgrade it: the
   harness reinstates it unchanged post-submission and records it in
   `audit.coordinator.reinstated`.
5. **Risk classifier mechanism** — a deterministic `classify(diff, paths, rules) → level` (pure,
   many small tests), evaluated once per `riskRules`-declaring phase before fan-out, over the
   **pre-filtered** diff (PRD #32; until M8 lands, the fixture diffs are trivially "already
   filtered" — the contract is pinned now, the filter arrives in M8); each resolved `level`
   echoed in the run output. No real thresholds here — the **fixture rule set** is a trivial
   `lines > N ⇒ "full" else "trivial"` declared on `stub-composite`; real rules are the
   code-review PRD's.
6. **level → fan-out/coordinator wiring** — a phase declaring `riskLevels` runs a reduced
   specialist subset and/or skips its coordinator at a lower level, the full set + coordinator at
   the top. With no `riskRules` declared the mechanism is inert (full panel runs).

**Files:** `src/phases/composite.ts` (coordinator extension), `src/phases/coordinator.ts`,
`src/risk/classify.ts`, `src/phases/stub-composite.ts` (gains a coordinator + level rules) + tests.

**Test plan:** coordinator tested against a scripted `FakeAgentRunner` (dedup/drop/re-rank,
failure modes, and the drop/downgrade attempt on a protected finding are all *scripted* outcomes,
not hoped-for from a real model); classifier is pure-function table tests; wiring tested with
`stub-composite` + two synthetic diffs (small/large) asserting the specialist subset and
coordinator-on/off per level. A budget breach in the coordinator reuses M3's outcome — and lands
in the #29 fallback, not a phase `error`.

**Verifiable outcome:** `stub-composite` with a declared coordinator, `riskRules`, and
`riskLevels` — on a small diff runs 1 specialist, no judge; on a large diff runs all specialists +
the judge, whose merged findings (one dedup, one drop) are the phase's `findings`, with
`cost.coordinator` present, the drop recorded in `audit.coordinator.dropped`, and the resolved
`level` in the output; a scripted judge failure leaves the raw roll-up + the
`coordinator-failed` warning. `vp test` green.

### M8 — Spec context & large-diff visibility

**Goal:** `--prd`/`--task` combine and reach phases that consume spec; `partial-coverage`
warning when a diff exceeds a phase's context budget (PRD §3.6).

**Build order:** `--prd <file|-|literal>` + `--task` concatenation → handed to phases declaring
spec consumption → **semantic diff pre-filtering** (strip lockfiles/minified/sourcemaps/vendored/
`@generated`-except-migrations, PRD §3.6, decision #27; stripped paths recorded in
`report.scope.stripped` (#33) and the human scope echo; the classifier consumes the filtered
diff — PRD #32) →
over-budget diff ⇒ analyze highest-signal subset + emit `<phase>.partial-coverage` naming
exclusions. *(`--issue`/`gh`, `--auto-context`, churn ranking deferred — §4; subset starts as file
order.)*

**Files:** `src/spec-context.ts`, `src/phases/coverage.ts` (subset+warning) + tests.

**Test plan:** combining sources; a synthetic over-budget diff asserts the warning names what
was excluded (no silent truncation).

**Verifiable outcome:** a run with `--prd spec.md --task "do X"` shows both in
`report.spec.sources`; an oversized diff emits a `partial-coverage` warning listing excluded
files.

### M9 — Human output & display polish

**Goal:** the human surface (PRD §3.8) — loops already work via JSON since M1.

**Build order:** findings grouped by phase, severity-colored, `file:line` → per-phase status
lines (skipped/cancelled reasons) → cost footer → `--quiet`, `--show <severity>` (display
filter, distinct from `--fail-on`).

**Files:** `src/output/human.ts` + tests (snapshot-style on the rendered string, asserting
content not layout).

**Verifiable outcome:** `stet` (no `--format json`) on `stub-repo` prints grouped, colored,
located findings + a cost footer; `--quiet` suppresses passing phases; `--show error` filters
display without changing the exit code.

## 4. Deliberately deferred (the v0 cut, confirmed 2026-06-07)

**Out of this plan entirely:**
- **`stet models test`, N-run scorecards, the real manifest format** — the eval-suite PRD owns
  them (harness PRD says so). M6 builds only the resolution-time *check* against a fixture
  manifest.
- **Everything PRD §7 defers** — NDJSON streaming, caching, SARIF, custom user specialists,
  cross-specialist dedup/verify, the env-var routing layer.

**Late within scope (named milestone above defers to a later one or to a follow-up):**
- `--issue` via `gh` + `--auto-context` → after M8's `--prd`/`--task` core.
- `sequential` scheduler policy → config sugar after M4's cancellation semantics exist.
- Budget presets (`fast`/`thorough`) → a multiplier table over M3's default set.
- Churn-ranked large-diff subsetting → M8 ships file-order subsetting + the visibility warning;
  ranking sharpens later.

Each deferral was chosen because **no other milestone depends on it** — nothing here blocks the
steel thread, the guards, cancellation, budgets, config, routing, or specialists.

## 5. Dependencies & parallelism

- **M1 → M2** is the critical path (steel thread). Nothing parallelizes M1; it's the spine.
  M2's three guards are the *completion* contract (validate/idempotency/no-submit) and carry no
  budget logic, so M2 does **not** depend on M3.
- After **M2**, the seam + report spine exist, and **M5, M6, M8 are mutually independent** —
  any order or parallel across sessions.
- **M3 (budgets)** depends on M2 (needs the runner to bound). **M4 (scheduler/teardown)**
  depends on M2; M3 and M4 don't depend on each other's code (different concerns: limits vs
  cancellation).
- **M7 (specialists)** depends on M2 (the seam) for the happy/error cases, and on **M3** for
  the per-specialist budget-breach case (it reuses M3's outcome) — so schedule M7 after M3.
- **M7.5 (coordinator + classifier)** depends on **M7** (it judges M7's roll-up) and reuses M2's
  seam + M3's budget outcome; the classifier half depends only on M1 (pure function over scope
  inputs) so it can land independently. Nothing earlier depends on M7.5.
- **M9** depends on the `RunReport` shape (M1) and progress events (M2); do it last so it
  renders the final field set.

## 6. Reality-disagrees protocol (read this, builder)

This plan and the PRD are the current best understanding, not ground truth. **If
implementation contradicts a PRD decision** — a contract that can't be built as specified, a
budget default that's wrong in practice, an SDK API that differs from the POC, a guard that
needs a fourth case — **stop and surface it**. Do not silently deviate:

1. Name the contradiction precisely (which PRD section/decision, what reality shows).
2. Bring it back for a call — the PRD gets **amended** and its **decisions table updated** in
   the same change; this plan follows.
3. Only then continue building.

The docs are designed to follow reality deliberately. A silent deviation makes every downstream
doc lie. Specifically likely contradiction points to watch: the Pi SDK 0.78.x API vs the POC's
0.78.0 usage (toolset names, `createAgentSession` signature); whether 120 turns is actually
enough for `stub-agent` under budget; whether scope detection's git-state priority survives
detached HEAD / shallow clones (PRD §6 edge cases).

**Surfaced during M2 build (2026-06-09), reality-disagrees protocol applied:**
- **Pi SDK version.** `vp add @earendil-works/pi-coding-agent` resolved **0.79.1**, not 0.78.x. The
  core API the adapter uses is unchanged (`createAgentSession`, `session.prompt`, `session.subscribe`,
  `session.getSessionStats`, `defineTool`, `DefaultResourceLoader`, in-memory managers) — the adapter
  compiles and the steel thread runs. PRD §3.2 + decision #5 amended to 0.79.x. One real API note:
  `defineTool.execute` is 5-arg in 0.79 (`(toolCallId, params, signal, onUpdate, ctx)`); the adapter
  uses the first two, the rest are ignored (extra params are assignable). Cost is read via
  `session.getSessionStats().tokens` (the `SessionStats` accessor), while the session is live.
- **Build / `dts`.** `vp pack` with `dts: true` cannot run here (the globally-installed vite-plus dts
  generator fails to resolve the project's typescript). stet is a CLI binary (no `types` field, no
  importable API), so `.d.ts` output is unneeded — `vite.config.ts` sets `dts: false`; the bundle
  builds and `node dist/cli.mjs` runs. Not a design change; recorded here for the M3+ builder.
- **Mutation-free vs `bash` (PR-review #1 → decision #34).** The PRD §3.2 claim "no code path can
  mutate the repo" was falsified: `bash` is registered and the Pi SDK has no read-only bash, so a
  live model *could* mutate. Resolution (Johan, 2026-06-10): **keep `bash`** (agents need it,
  Phase 5 especially), **amend the claim to the honest posture** (file tools `edit`/`write` barred
  at registration + test-verified; `bash` read-only by rubric only), and **open a tracked follow-up
  for real enforcement** (sandbox / read-only mount / `bash` spawn-hook denylist), naturally landing
  with the Phase 5 execution milestone that builds a controlled exec surface anyway. The M2
  mutation-free test correctly asserts only the `edit`/`write` registration bar — it does not claim
  bash-safety.

## 7. Decisions (plan-level)

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| P1 | Harness owns an `AgentRunner` interface; tests use a scripted fake; Pi SDK behind one adapter with a keyed/skippable suite | canvas 2026-06-07 (Johan) | mock at the boundary you own (tdd skill); the guards' failure modes become scriptable, not hoped-for; SDK churn contained | settled |
| P2 | M1 is a deterministic tracer (`stub-det`); the steel thread closes at end of M2 | canvas 2026-06-07 (Johan) | the report/exit spine is the cheapest observable slice; M2 then wrestles exactly one new thing (the SDK) | settled |
| P3 | v0 cut per §4 | canvas 2026-06-07 (Johan) | every deferral is depended-on by nothing; two "out" items have external deps | settled |
| P4 | Stub phases live in `src/` as permanent fixtures, never in a released default phase set | draft (from PRD §3.9) | they ARE the steel-thread surface; #24 makes them product, not scaffolding | settled |
| P5 | Build M1→M2 critical path; M5/M6/M8 parallelizable after M2; M3 before M7; M4 ∥ M3 | draft | risk-and-proof order; the seam unblocks the independent contracts | draft — confirm in review |
| P6 | §2a concrete contracts (AgentRunner signature, phase registration, stub-repo fixture, constants) pinned in the plan | cold-reader review (2026-06-07) | a cold builder was blocked without the interface signature, fixture state, and registration mechanism; budgets/guards sequencing was ambiguous | settled — fixed directly |
| P7 | `better-result` adopted as the error-handling methodology — **full discipline**: every harness function returning `Result<T,E>`, a `TaggedError` taxonomy, one throw→exit boundary at the CLI shell | canvas 2026-06-08 (Johan) | stet's "nothing passes silently" principle becomes compiler-enforced not reviewer-policed; error variants become first-class TDD targets; a half-applied methodology is the worst of both. PRD untouched (methodology below the contract line) | settled |
| P8 | New milestone **M7.5** (coordinator judge stage + risk classifier) after M7; coordinator runs through the existing AgentRunner seam, classifier is a pure function over scope inputs | Cloudflare reference review (Johan, 2026-06-09) | the judge layers naturally over M7's roll-up; reuses M2 seam + M3 budget outcome; blocks nothing earlier; implements PRD #25/#26 | settled |
| P9 | Fixture rule sets only for M7.5's classifier + M8's pre-filtering; real thresholds/rules are the consuming feature PRD's (code-review) | Cloudflare reference review (Johan, 2026-06-09) | same harness-owns-mechanism / PRD-owns-rules split as activation and the manifest reader (M6); keeps #24 intact | settled |
| P10 | Soundness-review pins: budget layering (wrapper = wall clock; runner = turns + bash limits, §2a); `PI_TEST_MODEL` doubles as the steel thread's pre-M6 model source; the steel-thread test registers stubs explicitly, never via the default phase set | soundness review (2026-06-09) | the M3 builder would stall on which layer enforces what (the plan said both "wired into the runner" and "wrapper wiring"); the M2 zero-arg demo had no model source before M6 routing exists; the thread must survive real phases displacing the stubs from the default set | settled |
