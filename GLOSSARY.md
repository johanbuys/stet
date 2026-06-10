# stet Glossary

**Status:** living document. Update it **in the same PR** as the doc or code that introduces,
renames, or sharpens a term. Created 2026-06-06, after "chassis"→"harness" and
"lens"→"specialist" showed that naming drift is real and cheap to fix early.

**Purpose:** one shared vocabulary for humans and agents working on stet. Each entry: the term,
its precise meaning, the thing it must **not** be confused with (⚠), and where it's specced (→).
If a doc and this glossary disagree, one of them is wrong — fix it in the same change.

---

## The product & its parts

- **stet** — the validation CLI itself. Latin "let it stand": a proofreader's mark that annotates
  the manuscript and never rewrites it. stet reports findings; it never fixes (no `--fix`).
  → `docs/better-planning/product/stet-prd.md`
- **POC** — the `validation-agent-poc` sibling repo: the R&D prototype that proved behavioral
  verification. Evidence base, not product code. → `docs/better-planning/research/behavioral-validation-findings.md`
- **harness** — the shared substrate all phases run on: scheduler, agent runner, findings schema,
  output-as-tool, budgets, output formats, exit codes. A phase is a _configuration_ of the
  harness. ⚠ the Pi SDK also calls itself an "agent harness" — in stet docs, "the harness"
  unqualified always means stet's. → `docs/better-planning/product/features/harness/harness-prd.md`
- **phase** — one of the five validation dimensions: gates, spec, review, test-quality,
  behavioral. The **reporting unit**: every configured phase appears in every RunReport.
  ⚠ phases run in _parallel_ by default — "phase" does not imply sequence. → harness PRD §1, §3.4
- **specialist** — a parallel, narrowly-scoped sub-agent _inside_ a phase (own rubric, own
  activation); findings roll up to the parent phase. The **execution unit**. Review is the first
  composite phase (bugs, security, patterns, quality, coverage-gaps). Formerly "lens" in early
  drafts. ⚠ a specialist never gets its own PhaseReport — it rolls up. → harness PRD §3.3
- **coordinator (judge pass)** — an optional `robust`-tier agent on a composite phase that runs
  _after_ its specialists, reads all their findings, and dedups / drops convention-contradicted
  /speculative findings / re-ranks — its submission _replaces_ the raw roll-up as the phase's
  findings. Harness machinery; the review coordinator's rubric is the code-review PRD's.
  Authority is constrained: it cannot drop or downgrade deterministic / evidence-backed findings
  (#30); its drops are recorded in `audit.coordinator.dropped` (#31); if its run fails the phase
  falls back to the raw roll-up + a `coordinator-failed` warning (#29).
  ⚠ not a specialist (it runs after them and sees all their output); ⚠ never invents a phase.
  → harness PRD §3.3a; decisions #25, #29–#31; `research/cloudflare-ai-review-reference.md`
- **risk classifier / level** — a deterministic harness step `classify(diff, paths, rules) → level`
  evaluated once per declaring phase before fan-out, over the pre-filtered diff; the `level`
  scales _how much_ a composite phase spends (specialist subset, coordinator on/off). Harness
  owns the mechanism + the level→fan-out wiring; the rules/thresholds are declared per phase
  (`riskRules`) and specced in the consuming feature PRD. ⚠ not **activation** (on/off) — this is
  "how much"; ⚠ deterministic, never an AI judgment; ⚠ no run-global level — two phases may weigh
  the same change differently. → harness PRD §3.4.1a; decisions #26, #32
- **gate** — one deterministic Phase-1 check (tests, types, lint, build, …). ⚠ distinct from
  _gating_ (a finding causing exit 1) and from **`Check`** (an audit entry). → harness PRD §3.4.3
- **cancel class / report-only class** — gates whose _failure_ cancels in-flight AI phases
  (tests/types/build: "the code doesn't function") vs. gates that only produce findings
  (lint/format: "the code is untidy"). Gate **timeouts** are always report-only. → harness PRD §3.4.3
- **activation** — the predicate deciding whether a phase or specialist runs for this scope.
  Non-activated ⇒ `skipped` with the rule named. → harness PRD §3.4.1
- **stub phase** — one of two harness-owned trivial phases (`stub-det`, and `stub-agent` — a
  _real_ Pi SDK run with a trivial rubric) that prove every harness contract and remain as
  permanent test fixtures; never in a released binary's default phase set. ⚠ not a mock of a
  real phase — the agent stub makes real model calls. → harness PRD §3.9
- **steel thread** — the harness's tracer bullet: zero-config `stet` end-to-end through the two
  stub phases, proving every contract before any real phase exists. Real phases integrate later
  via their own feature plans. ⚠ a build-scope decision (#24), not a runtime mode.
  → harness PRD §3.9; harness brief direction 8
- **scope** — what is being verified: staged | working | against `<ref>` | commit | commits;
  auto-detected unless flagged. → harness PRD §3.6

## Findings & the report

- **finding** — one structured observation (id, severity, confidence, message, evidence, …); the
  unit every consumer acts on, and the input to whoever fixes. → harness PRD §4.2
- **severity** — `error | warning | info`. The **one** gating vocabulary. ⚠ not confidence, not
  priority. → harness PRD §4.2
- **confidence** — `high | medium | low`: the opinion filter. Only high-confidence findings can
  gate. Deterministic and evidence-backed findings are high _by construction_. ⚠ not severity.
  → harness PRD §4.6
- **priority** — Phase 5's finer `critical|high|medium|low` granularity, preserved in
  `meta.priority`. Informational; never gates. ⚠ not severity. → harness PRD §4.2
- **gating (a finding)** — causing exit 1: `severity ≥ failOn` **and** `confidence == high`.
  The responsible findings are listed in `result.gating`. → harness PRD §4.8
- **audit** — the per-phase record of what was actually examined (files, checks, claims). The
  anti-silent-green mechanism: a green report always shows what was checked. → harness PRD §4.3
- **`Check`** — one audit entry: a concrete command run, with status and evidence. ⚠ schema type;
  not a gate, not a colloquial "check". → harness PRD §4.3
- **RunReport / PhaseReport** — the versioned aggregate (the only thing on stdout in JSON mode) /
  one phase's entry in it. Phase statuses: `completed | skipped | cancelled | error`, the last
  three always with reasons. → harness PRD §4.4–4.5
- **output-as-tool** — agent runs finish _only_ by calling `submit_findings`, whose parameter
  schema is the findings schema (R&D D6). Three guards: validate-or-retry, idempotency,
  no-submit fallback. → harness PRD §3.1
- **hygiene finding** — a finding about the project's _capacity to be verified_ ("no test runner
  configured"), emitted at init and at run time. → stet PRD §5, §7

## Phase 5 (behavioral verification)

- **verdict** — Phase 5's internal result: `passed | failed | blocked | inconclusive`, surfaced
  as findings (`failed→error`, `blocked→warning`, `inconclusive→info`). ⚠ "findings, not
  verdicts" is the product _surface_; the verdict exists inside Phase 5. → stet PRD §3.5
- **failed vs blocked vs inconclusive vs skipped** — _failed_: executable evidence contradicts a
  claim (must carry the reproducing command). _blocked_: couldn't reach a testable state (names
  exactly what's needed). _inconclusive_: ran, nothing decisively proved or disproved.
  _skipped_: never activated (e.g. no spec provided). → harness PRD §4.4; findings doc §1
- **claim** — a behavior derived **from the spec** that must be proven by running. Buckets:
  derived / proven / unproven. ⚠ a claim you cannot test is _unproven_ — never silently passed.
- **diff-blind** — the diff may select which _surfaces_ to exercise; claims derive from the
  spec. The diff is never the source of truth for "does it work."
- **mutation-free** — no file-mutation tools (`edit`/`write`) are registered for any agent phase,
  enforced at tool registration and verified by a test. Applies to the whole product, not just
  Phase 5. **Caveat:** `bash` _is_ registered and is not yet sandboxed (the SDK has no read-only
  bash), so mutation-freedom is _enforced_ for file tools but currently only _instructed_ (via
  rubric) for `bash`; sandboxed enforcement of the `bash` surface is a tracked follow-up (harness
  PRD decision #34).
- **spec** — _what to verify against_: PRD/task/issue content via `--prd`/`--task`/`--issue`.
  ⚠ not run-instructions.
- **run-instructions** — _how to run the product_: start command, base URL, readiness probe,
  credentials, per-service real/mock. Caller-supplied, init-drafted (R&D D4). ⚠ tells the
  validator how to run, never what to check.
- **surface** — an externally observable interface the diff touches (CLI, HTTP API, web UI,
  raw-mode TTY, job, migration). Selects execution adapters.
- **execution adapter** — the surface-specific run mechanics (spawn / `start_service`+HTTP /
  `agent-browser`). The judgment rubric is surface-agnostic; only adapters know surfaces.
- **evidence ladder** — take the cheapest _sufficient_ rung: exit code / HTTP status+body →
  in-process JS execution → real browser. The browser rung is mandatory only for real SPAs.

## Models & routing

- **tier** — the capability class a phase requires: `robust | fast`. Project config speaks
  tiers; run-time resolution picks a concrete model from the user's credentialed providers.
  ⚠ not a model id. → harness PRD §3.2
- **qualification** — evidence (an eval-suite scorecard) that a model holds the line for a tier;
  keyed _(model × rubric version × fixture-set version)_. Running an unqualified model ⇒
  `harness.unqualified-model` warning. → harness PRD §3.2; eval-suite PRD
- **manifest** — the curated, shipped table of qualified models per tier — the tier preference
  table _with receipts_. No web service; community additions via PR.
- **binding run** — the run whose exit code enforces the merge: **CI's run, with pinned
  routing**. Local runs are advisory pre-flight. → harness PRD §3.7

## Configuration

- **project config / user config** — `stet.config.yml` (checked in: project facts + tier intent;
  never names providers) / `~/.config/stet` (machine facts: provider preferences, local
  qualifications). Precedence: flags > project > user > built-in defaults, resolved per-setting.
  → harness PRD §3.7
- **sparse config** — init writes only facts that have no built-in default plus evidenced
  deviations; never restates defaults (which would freeze them), never pins models.
- **budget / preset** — per-phase limits (wall clock, turns, bash timeout, output cap), bundled
  as `--budget fast|default|thorough`. A breach is always a named `error` — never a silent hang
  or kill. → harness PRD §3.5

## Quality discipline

- **eval suite** — the ported fixtures + content-aware grader + runner: the regression gate for
  every rubric edit and model change; runs under `vp test`; powers `stet models test`.
- **fixture** — a standalone zero-dependency repo with freetext `task.md`/`run.md` and a known
  correct outcome.
- **over-claim trap** — a fixture where the only wrong answer is a false `passed`; conservative
  `blocked`/`inconclusive` are accepted. Encodes "blunt conservative beats precise permissive."
- **content-aware grader** — asserts the verdict **and** that the right issue was flagged
  (pattern match over named result fields).

## External names

- **Pi SDK** — `@earendil-works/pi-coding-agent`: the agent runtime stet builds on. Successor of
  `badlogic/pi-mono`'s coding-agent (repo transferred to `earendil-works/pi`; the old
  `@mariozechner` npm scope is deprecated). → harness PRD §3.2
- **agent-browser** — the browser-automation CLI (built for agents) used for SPA validation.
  Provisioned ahead of time; never self-installed during validation.
- **`start_service` / `pty_session`** — harness-provided execution tools: service lifecycle with
  readiness + guaranteed teardown / raw-mode TTY driving. → their feature PRDs
- **ideoshi-code** — the autonomous coding loop that is stet's first target integration.
- **github-integration** — a planned **follow-up feature** (not the harness): a GH Action wrapper +
  GH-App/webhook bot that _consumes_ the harness `RunReport` — posts findings as PR comments and
  turns PR comments (`break glass`, re-check, scoped review) into harness invocations. ⚠ out of the
  harness by the boundary rule (#24); the harness is already CI-ready. → README status index
- **vp / Vite+** — the project's own toolchain (`vp test`, `vp check`); also where the eval
  suite runs.
