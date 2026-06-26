# code-review — TDD (technical design)

**Status:** settled — 2026-06-22 (Area A live-walked on canvas; B–G drafted then accepted in one review round, "lgtm"); **living — comprehend sync M1–M4 2026-06-24** (A·3a added; A·3/B·2/§Stack as-built notes; see `code-review-drift.md`)
**Depends on:** `code-review-prd.md` (settled) · `features/harness/harness-prd.md` (composite phase, coordinator, classifier, agent runner, Finding schema) · `features/harness/harness-plan.md` (built: M1–M9 + M7.5)
**Draws on:** the built harness in `src/` (`phases/composite.ts`, `phases/coordinator.ts`, `risk/classify.ts`, `schema/finding.ts`, `agent/*`)
**Companion:** `code-review-tdd-overview.html`

> This TDD decides the *how* at architecture altitude. It does **not** re-open PRD what/why
> decisions — those are settled in `code-review-prd.md` §Decisions. It records, per area, the
> structural calls the build would otherwise make silently.

---

## Design areas (ranked by consequence × irreversibility)

| # | Area | Status |
|---|---|---|
| **A** | Agreement-verify stage + pipeline composition (net-new harness capability) | **✅ settled** (live walk) |
| **B** | Finding contract evolution (confidence harness-derived, `meta.preexisting`) | **✅ settled** (B·1 walked; B·2/B·3 reviewed) |
| **C** | Eval-suite subsystem (milestone 1) | **✅ settled** (C·1 walked; C·2–4 reviewed) |
| D | Specialist panel wiring (rubrics/toolsets/tiers — mostly data) | **✅ settled** (review) |
| E | Risk classifier rules for review | **✅ settled** (review) |
| F | Config slice `phases.review` | **✅ settled** (review) |
| G | Gating integration (`deriveExit` rule) | **✅ settled** (review) |

---

## Area A — Agreement-verify stage

### System map (the review composite pipeline)

Grey = built & tested harness machinery. **Bold** = net-new (this feature's keystone, PRD
decisions #12/#35).

```
① Specialists ×4          bugs · security · quality · coverage-gaps
   (composite.ts, built)  parallel read-only fan-out → submit_findings
        ▼
② Roll-up                 all candidate findings, harness-tagged phase + specialist
   (composite.ts, built)
        ▼
③ VERIFY  🆕              per candidate: N=3 independent refutation voters
   (verify.ts, NEW)       agreement → confidence · 3/3 high · 2/3 medium · ≤1/3 DROPPED
        ▼
④ Coordinator             dedup · drop speculative/convention-contradicted · pre-existing
   (coordinator.ts, M7.5) tier · re-rank · constrained authority (can't drop evidence-backed)
        ▼
⑤ PhaseReport             findings + audit + cost
```

**Boundary (ratified 2026-06-22):** stage ③ is a **standalone harness capability** — a new
`src/phases/verify.ts` exposing `runAgreementVerify(...)`, called by `composite.run()` between
roll-up (②) and coordinator (④). It mirrors the existing `composite` / `coordinator` / `classify`
split: independently fake-testable, and future phases (spec, test-quality, behavioral) inherit it.
Not folded into the coordinator.

### A·1 — Pipeline order: verify-all → coordinator dedups *(PRD-literal)*

Verify runs over the **raw roll-up** (every candidate, duplicates included); the single existing
coordinator dedups/ranks **after**. Verify is a pure, independent, per-candidate stage; confidence
is established *before* any holistic editing. The coordinator stays one agent pass (already built).

- **Not chosen — coordinator-dedups-first-then-verify:** would split the coordinator into two
  agent passes (2× cost) and, worse, merge findings *before* corroboration — risking folding a
  real finding into a hallucinated one.
- **Not chosen — deterministic pre-dedup before verify:** exact-match (same normalized
  location + overlapping message) catches little across specialists (different ids/wording
  survive anyway); a heuristic the eval hasn't justified. Revisit (option iii) once the eval
  suite (area C) quantifies the duplicate rate — PRD decision #5 (don't optimize without
  measurement).

**Cost envelope:** worst case (full panel, sensitive large diff) ≈ 4 specialists × `MAX_FINDINGS`
5 = 20 candidates × N=3 = **~60 voter calls**, bounded by `MAX_FINDINGS` and the risk dial
(trivial → bugs-only, coordinator off → 0 voter calls). The worst case is exactly the high-stakes
case the spend is warranted on.

### A·2 — Voter contract & tier

A voter reads context like a specialist (`read`, `grep`, `find`, `ls`, `bash` for inspection)
but emits a **verdict**, not findings, via a `submit_verdict` output-tool. **Independence comes
from the distinct lenses, not from distinct models** — one `AgentRunner` is invoked N times, each
a fresh stateless conversation handed a different refutation angle; same model + same prompt would
merely correlate.

```ts
// src/phases/verify.ts
interface VoterVerdict { verdict: "uphold" | "refute" | "abstain"; reason: string }

interface VerifyConfig {
  voters: number;        // N, default 3
  lenses: string[];      // length N — review supplies the angles (rubric data, area D)
  model?: string;        // v1 = robust tier (this decision)
  budgets?: AgentBudgets;
}

runAgreementVerify(
  runner: AgentRunner,   // invoked N× per candidate (stateless ⇒ independent)
  candidates: Finding[],
  cfg: VerifyConfig,
  ctx: { cwd: string; diff?: string; signal?: AbortSignal },
): Promise<{ verified: Finding[]; audit: VerifyAudit }>
```

- **Aggregation:** `upholds = count(verdict === "uphold")`; `refute` and `abstain` both count as
  not-uphold (conservative, per PRD edge case "verifier tie/abstentions → dropped"). Thresholds
  (`agreementForHigh: 3`, `agreementForMedium: 2`) come from coordinator config (PRD C1), **not**
  derived from N — so changing N doesn't silently move what "high" means.
- **Tier (v1) = robust.** Confidence trustworthiness is the entire point; a voter too weak to
  judge corrupts the agreement signal before the eval (area C) can measure whether weaker is safe.
  PRD decision 8 names voter-tier as a *later* dial → v1 is the high baseline you dial **down**
  from. *Not chosen:* fast (noisy votes, optimizing the unmeasured); inherit-coordinator-tier
  (couples two independently-tunable stages — decision 8 wants them separate).
- **Example v1 lenses** (the strings are area-D rubric data, shown for concreteness): (1)
  reproduction/soundness, (2) partial-context skepticism, (3) scope/blocklist — mapping to the
  PRD R8 noise-control concerns.

### A·3 — Failure & abstention semantics

Two distinct failure modes, both resolved conservatively so a broken verify never manufactures a
gating-grade signal:

- **Partial** (1 of N voters errors on budget/model): **retry once**, then count the voter as
  **abstain** (= not-uphold). The **absolute** threshold is preserved — so a candidate whose voter
  permanently fails can attain at most 2/3 (medium). Transient blips don't poison the count;
  behaviour stays reproducible.
- **Total** (verify can't produce verdicts at all — rare, since specialists already ran so the
  model worked): fall back to the **raw roll-up**, stamp every finding **`confidence: low`**, emit
  a `review.verify-degraded` warning, status `completed` (PRD #29 — never forfeit findings). Low is
  the honest "uncorroborated" floor: findings stay visible (display filters on severity, not
  confidence) but **never gate** (gating needs `high`), so a broken signal can't break the build.
  *Not chosen:* medium (overstates corroboration that didn't happen); keep-self-reported
  (reintroduces the miscalibrated signal area B removes, and could let a degraded run gate).
- **Out of scope:** *no model credentials at all* → the phase errors **before** specialists run
  (PRD acceptance #8, "never a false clean"); a phase-level concern, not verify's.

> **A·3a — Total verify failure short-circuits the coordinator** *(added 2026-06-24, comprehend
> sync M1–M4; drift D3).* On degrade the conservative all-`low` roll-up + `verify-degraded` warning
> is **final**: a configured coordinator is **skipped**. Rationale: an enabled coordinator could
> re-raise the `low` findings back to `high` and drop the warning, re-gating a broken-verify run —
> which would defeat the "broken verify never manufactures a gating signal" guarantee A·3 is built
> on. (`composite.ts:367–372, 427`.)
>
> **A·3 retry refinement** *(as-built, comprehend D1):* voter errors split transient vs
> non-transient — `BudgetError`/`CancelledError`/already-aborted → abstain **immediately** (no
> retry: a spent wall-clock window or a cancelled parent will only fail again); other transient
> `AgentError` → retry once → abstain. An `Ok` whose submission fails the `VoterVerdict` schema →
> abstain (not retried). Sharper than the original "retry once, then abstain" but the same intent.

### A·4 — Confidence-on-merge, the protected class, and audit

Two mechanisms come **for free** by reusing the harness-controlled-provenance pattern (the same
id-based re-stamping hardened in issue #48):

- **Confidence is harness-stamped by id** from verify; the coordinator cannot overwrite it →
  **downgrade is impossible by construction** (no rule needed).
- **Merge keeps the highest-confidence id** — a coordinator *rubric* instruction (area D), so dedup
  and drop-protection (below) don't fight: a legitimate merge survives under the strongest id
  rather than being reinstated as a near-duplicate.

The one fork: **agreement-`high` joins the protected class.** The coordinator's constrained
authority (built, M7.5) already forbids dropping/downgrading `evidence.command` and deterministic
findings; we **add `confidence: high` (3/3 agreement-verified)**. A high finding the coordinator
drops entirely (its id absent from output) is reinstated + recorded in
`audit.coordinator.reinstated`, exactly like evidence-backed today (reuses the existing
multiplicity reinstatement). Rationale: agreement is the corroboration currency this feature
introduces; since gating needs `high`, silently deleting a 3/3 finding is a **missed gate** — the
costliest failure. *Not chosen:* trust-the-coordinator (a miscalibrated judge could drop a
corroborated gating bug, undercutting the whole point of verify).

**Audit surface.** Verify gets its **own** `audit.verify` block, separate from
`audit.coordinator`, so mechanical agreement-drops read distinctly from judgment-drops:

```ts
PhaseReport.audit = { verify?: VerifyAudit; coordinator?: CoordinatorAudit }
VerifyAudit = {
  received: number;
  dropped: { id: string; specialist?: string; upholds: number; verdicts: VoterVerdict[] }[];
}
```

This closes Area A.

---

## Area B — Finding contract evolution

> **Settled.** B·1 (confidence ownership) was live-walked on canvas; B·2/B·3 were drafted and
> accepted in the review round (2026-06-22).

### B·1 — Confidence ownership *(settled 2026-06-22)*

Two fields, two owners:

- **Operative `confidence`** (top-level on `Finding`; gating, display, and `github-integration`
  all read it) → **harness-owned**, stamped by verify (Area A). A model can never supply it.
- **`meta.selfConfidence`** (`"high" | "medium" | "low"`, optional) → the specialist's *self-rating*,
  explicitly labeled, **never shown to voters** (preserves independence), used for **nothing
  operationally** in v1, recorded so the eval (Area C) can test whether it predicts agreement.

This splits the **submit schema** from the final **Finding**: a specialist fills a
`SpecialistSubmission` that has no top-level `confidence` (and no `specialist`/`phase` — both
harness-stamped); the harness assembles the final `Finding`. Non-verify phases (e.g. deterministic
`gates`) set their own operative confidence — for `gates` that's always `high` (deterministic).

### B·2 — Deterministic pre-existing detection *(settled — review)*

Per PRD decision #14, `meta.preexisting` is **deterministic**, computed by the harness from the
diff — never a model judgment. Mechanism (**correction, cold-reader 2026-06-22:** `src/diff-sections.ts`
splits a diff into per-file sections via `+++`/`---` only — it does **not** parse `@@` hunks or line
numbers, so added-line parsing is **new** code, not a reuse):

1. From the net diff, build an **added-line index**: per file, the set of line numbers in added
   (`+`) hunks. Computed **once** per run.
2. For each final finding with a `location.{file,line}`: if that line ∈ the file's added set →
   **introduced** (not pre-existing); otherwise → **`meta.preexisting: true`** (the change
   re-exposed pre-existing code). A finding pointing at a pre-existing buggy line that an added
   line merely *calls* lands on the pre-existing line ⇒ correctly pre-existing.
3. **No `location.line`** (cross-cutting finding) → **not** marked pre-existing — we only mark when
   we can prove the location sits outside added lines; a finding about the change as a whole gates
   normally. (Conservative: never silently non-gate something we can't localize.)

Placement: a harness finalization step `markPreexisting(findings, addedLineIndex)` applied to the
final finding set just before the `PhaseReport` is built (after the coordinator). Deterministic and
location-based, so order vs the coordinator doesn't matter.

> **B·2 as-built notes** *(comprehend sync M1–M4, 2026-06-24):*
> - **Path normalization (drift D4).** `markPreexisting` reconciles model-supplied finding paths
>   against index keys via `normalizeFindingPath` — strips `./` and one single-letter diff prefix
>   (`a/ b/ i/ w/ c/ o/`). The design hadn't specified this reconciliation; accepted as a B·2
>   detail. It is correctness-load-bearing (a wrong match silently marks a finding `preexisting` →
>   it stops gating) → **a regression test for the path-mismatch case is an open fix (ledger D4).**
> - **Combined-diff gap (drift D5).** `buildAddedLineIndex` skips `diff --cc`/`--combined` sections
>   → empty added-set → those findings all mark `preexisting` → none gate (a "false clean"). The
>   conservative handling the code's docstring promised "deferred to M4 wiring" was **not** built.
>   Logged + deferred: likely unreachable in v1 (`--against <ref>` three-dot yields a two-way diff).
>   → ledger D5.

### B·3 — Schema mechanics *(settled — review)*

`Finding` stays the shared, versioned wire contract. `meta` stays **open**
(`additionalProperties:true`) — `preexisting` and `selfConfidence` are **conventional keys within
it**, documented but *not* a narrowed schema (narrowing would break the Phase-5 open-`meta` tests,
cold-reader F1). Consumers (incl. `deriveExit`) read them with a **runtime check**
(`meta?.preexisting === true`). The new `SpecialistSubmission` schema is review-local (the
model-facing form). `confidence` stays a
**required** field on `Finding` (every emitted finding has an operative confidence by the time it's
a `Finding`), satisfied by verify for review and by per-phase rules elsewhere.

---

## Area C — Eval-suite subsystem (milestone 1)

> **Settled.** C·1 (execution model) was live-walked on canvas; C·2–4 were drafted and accepted in
> the review round (2026-06-22). This is the highest-unknown area — risks are tracked in the register
> below and carry into the plan as spikes.

### C·1 — Execution model = tiered split *(settled 2026-06-22)*

The eval serves **two distinct jobs**, each in its own mode:

- **`vp test` (default, every commit, CI-safe)** → runs against **cassettes** (recorded model
  responses). Fast, deterministic, free, no creds. Guards job (a): the harness/grader/metrics
  machinery and a frozen fixture set still grade the same.
- **`vp run eval:live` (opt-in, keyed)** → real model calls. Re-measures real SNR/precision,
  validates the grader, **updates the committed baseline**. Job (b): "did review quality regress?"
  — run on rubric/model changes and before shipping, not per commit.

*Not chosen:* live-every-run (slow/costly/flaky/needs keys — punishes every commit for a job most
don't need); cassette-only (silently stops answering the quality question the eval exists for).
**Open (review):** whether to also run a *tiny live smoke-set* each commit — deferred to the review
round; cassette staleness is managed by periodic re-record (the baseline is a committed file, so
quality changes show up as a reviewable diff).

### C·2 — Grader *(settled — review)*

Content-aware **LLM-judge** (mine the `../validation-agent-poc` grader). Per emitted finding →
**HIT** (matches a ground-truth defect) / **VALID** (real but unseeded) / **NOISE**. Candidate↔expected
matching: **location gate** (±N lines, default N=3) **then** embedding-similarity over the gist,
**1-to-1** (each expected matched at most once). Validated against a human-labeled **golden subset**
(PRD #13: Cohen's κ ≥ 0.75) before the gate is trusted — a live-mode meta-check.

### C·3 — Metrics & regression gate *(settled — review)*

Headline **SNR = (HIT + VALID) / NOISE**; plus **precision & recall per visibility tier**
(in-diff / needs-context / cross-file) and **FPR on clean fixtures**. Baseline = a committed
`eval-baseline.json` (metrics per fixture set). The live gate **fails** when precision or SNR drops
below baseline beyond a small tolerance ε (clean-fixture FPR guards false positives). PRD R9/AC#13.

### C·4 — Fixtures & layout *(settled — review)*

Fixture shape per PRD C5 (`{ id, diff, baseFiles?, expected[], clean, tier, sensitivePaths? }`).
v1 set = hand-authored across the three visibility tiers + clean fixtures + a handful mined from
public sets (PRD #15); full mining pipeline deferred to the standalone `eval-suite` feature. Lives
under `src/eval/` (fixtures, grader, runner, baseline); cassettes alongside.

---

## Area D — Specialist panel wiring *(settled — assembling built machinery)*

Four `SpecialistConfig`s built on the existing composite machinery; **rubric text is data**
sourced from `code-review-rubric-draft.md` (tuned by Area C, not designed here):

| specialist | severity ceiling | toolset | tier (v1) |
|---|---|---|---|
| `bugs` | `error` | read, grep, find, ls, bash(inspect), submit_findings | robust |
| `security` | `error` | + (always runs on sensitive paths) | robust |
| `quality` (+perf+patterns folded) | `warning` | read-only set | fast→robust (eval-tuned) |
| `coverage-gaps` | `warning` | read-only set | fast |

Shared preamble (concrete-scenario bar, DO-NOT-FLAG blocklist, partial-context anti-hallucination,
abstention) from the rubric draft, applied to all. `submitSchema = SpecialistSubmission` (B·1, no
`confidence`). `maxFindings` default 5 (R8). The **3 verify lenses** (A·2) are supplied here as
review config. Coordinator rubric includes the **"merge keeps highest-confidence id"** rule (A·4).

**As-built (M5, comprehend):** the panel derives from a single `REVIEW_SPECIALISTS` list and
`makeReviewRunners` builds the runner map from it, so the CLI runner map can't drift from the panel
(fix after #96 shipped a 2-of-4 runner map — PR #97).

---

## Area E — Risk classifier rules *(settled — config data, eval-tuned)*

`classify()` already exists; review supplies `riskRules` + `riskLevels`:

- **Levels:** `trivial` (small diff, no sensitive paths) → `bugs` only, coordinator **off**;
  `standard` → bugs + quality + coverage, coordinator on; `full` (large, or sensitive paths) →
  all four + `security`, coordinator on.
- **Predicates:** line-count thresholds (eval-tuned placeholders) + sensitive-path globs
  (`**/auth/**`, crypto, `**/migrations/**`, …). **`security` always runs** when sensitive paths
  are touched, regardless of level (PRD R4/#9) — encoded as a per-level override, not a threshold.

Thresholds are **config-overridable** and settled empirically by Area C, not in this TDD.

**Classifier input (decided M6, comprehend M5–M6):** `classify()` reads the **untrimmed** diff
(`ctx.fullDiff`), never the budget-trimmed `ctx.diff` that a `consumesDiff` phase receives. The
scheduler forwards `fullDiff` unconditionally; `composite.ts` classify reads it. This decouples
"inject a budget-trimmed diff into prompts" from "classify on every file" — prompt-budget trimming
can never downgrade the resolved risk level (the bug PR #99 fixed).

---

## Area F — Config slice `phases.review` *(wired subset M6; rest deferred to M6.5)*

Extends the existing config schema/load/merge (built M5), resolved **per run** inside the
review-phase wrapper: `makeReviewPhase().run()` parses the slice, filters specialists, and rebuilds
the composite each run (the slice is dynamic, so the composite is constructed at run time, not at
registration — this is the responsibility the review phase grew in M6, comprehend M5–M6).

```ts
phases.review = {
  specialists?: Record<string, { enabled?: boolean; maxFindings?: number; model?: Tier }>,
  maxFindings?: number,                 // global default (5)
  verify?: { voters?: number },         // N (default 3)
  coordinator?: boolean,                // on/off override
  // gating threshold inherited from output.failOn (not duplicated here)
}
```

**Wired (M6):** `specialists.<n>.enabled` (drop from panel) · `coordinator` (force off at every level).
**Deferred to M6.5** — validated + accepted but not yet applied (ledger D7–D9): `maxFindings`
(top + per-specialist) · `verify.voters` · per-specialist `model`. **Cut:** `risk.thresholds`
(YAGNI in v1 — predicates are eval-tuned code, not user config; comprehend M5–M6).

**No silent no-op (M6, comprehend M5–M6):** a recognized-but-unwired key surfaces as a non-gating
`review.config-ignored` finding (confidence `low`) naming it — the no-silent-pass principle applied
to our own config; it never gates a build. Wired keys and genuinely-unknown forward-compat keys are
not flagged.

Precedence rides the built 4-layer merge; no new mechanism.

---

## Area G — Gating integration *(settled — one rule addition)*

`deriveExit` (built, `src/exit-codes.ts`) gains two conjuncts for review findings — a finding gates
exit 1 **iff**:

```
severityAtLeast(severity, failOn)  ∧  confidence === "high"  ∧  meta.preexisting !== true
```

Both inputs are harness-controlled (confidence from verify, `meta.preexisting` from B·2), so gating
stays fully downstream and deterministic (PRD R6/C6, decision #4). Specialists never decide gating.

---

## Data model

| Entity | Owner | Notes |
|---|---|---|
| `Finding` | harness (shared) | + `meta.preexisting?`, `meta.selfConfidence?`; `confidence` required, harness-set |
| `SpecialistSubmission` | review | model-facing form: no `confidence`/`specialist`/`phase` |
| `VoterVerdict` | verify | `{ verdict: uphold\|refute\|abstain, reason }` |
| `VerifyAudit` / `CoordinatorAudit` | harness | `PhaseReport.audit = { verify?, coordinator? }` |
| `Fixture` / `GraderResult` / `Metrics` | eval | PRD C5; consumed by the `eval-suite` feature |
| `eval-baseline.json` | eval | committed; the regression gate's reference |

## Key interfaces / contracts

- **`runAgreementVerify(runner, candidates, cfg, ctx)`** (Area A·2) — the net-new harness capability.
- **`SpecialistSubmission`** schema + **`Finding`** additions (B) — the wire contract
  `github-integration` and `eval-suite` consume.
- **`markPreexisting(findings, addedLineIndex)`** (B·2) — deterministic harness finalization.
- **Fixture + grader contract** (C·4) — consumed by the `eval-suite` feature (PRD C5).

## Technical risks & unknowns

| Risk | Mitigation / spike |
|---|---|
| Verify cost (~60 calls worst case) | bounded by MAX_FINDINGS + risk dial; eval measures duplicate rate → maybe deterministic pre-dedup (A·1) |
| Cassette staleness silently hides quality drift | committed baseline diff + periodic re-record; open: tiny live smoke-set per commit (C·1) |
| Grader trust | golden-subset κ ≥ 0.75 gate before the eval gate is relied on (C·2) |
| Embedding-match library choice | **spike** — see stack choices; affects determinism under cassettes |
| `meta.selfConfidence` hypothesis | recorded, not used; eval settles it (B·1) |

## NFRs

- **Mutation-free:** no write tools on any specialist/voter/coordinator (built guard); `bash` is
  inspect-only (residual sandboxing tracked harness-side).
- **Cost:** scales with risk level; trivial diffs cost ~1 specialist, no voters.
- **Determinism:** default `vp test` is fully deterministic (cassettes); live mode is not, by design.
- **Bounded coverage:** over-budget diffs → `review.partial-coverage` warning (no silent truncation).
- **No silent config:** recognized-but-unwired `phases.review` keys → non-gating `review.config-ignored`
  finding (Area F). Config never no-ops in silence.

## Stack / library choices

Both spikes **resolved as-built** (comprehend sync M1–M4, 2026-06-24; drift D2) — promoted from
"lean" to settled:

- **Cassette mechanism** — record/replay at the **AgentRunner seam** (the single model boundary), as
  leaned. Lookup key = **SHA-256 of `{model, rubric, userPrompt}`** — the only serialisable inputs
  (`AgentRunInputs` also holds a `TSchema`, `AbortSignal`, `onTool`, which can't appear in a portable
  key). On-disk: JSON keyed by 64-char hex. (`src/agent/cassette-runner.ts`.)
- **Embedding similarity** (grader) — provider endpoint, as leaned: **`openai` pkg ·
  `text-embedding-3-small` · OpenAI endpoint**, cosine ≥ threshold **after** the ±N line gate,
  greedy 1-to-1. Injectable `EmbedFn` so tests supply a fake. (`src/eval/grader.ts`.)

---

## Decisions table

Human-made calls (canvas walk) vs draft-level proposals awaiting review.

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| A·0 | **Verify is a standalone `verify.ts` harness capability**, called by `composite.run()` between roll-up and coordinator — not folded into the coordinator | user (2026-06-22) | mirrors built composite/coordinator/classify split; independently testable; future phases inherit it | settled |
| A·1 | **Pipeline order = verify-all → coordinator dedups** (PRD-literal); deterministic pre-dedup deferred until the eval measures duplicate rate | user (2026-06-22) | keeps the net-new capability simple & PRD-faithful; cost bounded by MAX_FINDINGS + risk dial; #5 — don't optimize without measurement | settled |
| A·2 | **Voter contract** = `submit_verdict` ternary (uphold/refute/abstain + reason), read-only context toolset, independence via distinct lenses (one runner ×N); **tier (v1) = robust** | user (2026-06-22) | confidence trustworthiness is the point; decision 8 makes voter-tier a *later* dial → start at high baseline; abstain/refute = not-uphold (conservative) | settled |
| A·3 | **Partial voter failure** → retry once, else abstain (absolute threshold kept). **Total verify failure** → raw roll-up, all findings `confidence: low` + `review.verify-degraded` warning, status completed, never gates | user (2026-06-22) | a broken verify must never manufacture a gating signal; low = honest uncorroborated floor; #29 — never forfeit | settled |
| B·1 | **Operative `confidence` is harness-owned** (from verify); the specialist's self-rating is kept as labeled **`meta.selfConfidence`** — never shown to voters (preserves independence), used for nothing in v1, recorded so the eval (area C) can measure whether it predicts agreement | user (2026-06-22) | self-reported confidence is the miscalibrated thing voting replaces (decision 1) + anchoring voters breaks independence; but discard-vs-use is empirical → measure it (#5) | settled |
| A·4 | **`confidence: high` joins the protected class** (coordinator can't silently drop a 3/3 finding; reinstated + audited). Confidence harness-stamped by id (downgrade impossible); merge keeps highest-confidence id; new separate `audit.verify` block | user (2026-06-22) | agreement is the corroboration currency; dropping a corroborated finding = missed gate, the costliest failure; reuses existing reinstatement + #48 provenance pattern | settled |
| C·1 | **Eval execution = tiered split** — default `vp test` runs cassettes (fast/deterministic/CI-safe); opt-in `eval:live` (keyed) re-measures quality + updates a committed baseline | user (2026-06-22) | the eval has two jobs (machinery vs quality); each in its own mode = green CI *and* a real gate; tiny-live-smoke-set per commit deferred to review | settled |
| B·2 | Pre-existing detection = deterministic diff added-line membership; cross-cutting (no line) ⇒ not pre-existing. **Corrected 2026-06-22 (cold reader):** added-line/`@@`-hunk parsing is **new** code — `diff-sections.ts` only splits by file, it does not parse hunks | draft → user review | PRD #14 — deterministic, reproducible; conservative on un-localizable findings | settled (review 2026-06-22) |
| B·3 | Split `SpecialistSubmission` (no `confidence`) from shared `Finding`; additions `meta`-namespaced | draft → user review | non-breaking wire contract; harness owns operative confidence | settled (review 2026-06-22) |
| C·2–4 | LLM-judge grader (location+embedding, 1-to-1, HIT/VALID/NOISE; κ≥0.75 golden gate); SNR + per-tier P/R + clean-FPR; committed baseline; fixtures under `src/eval/` | draft → user review | mirrors POC + PRD R9/C5/#13/#15 | settled (review 2026-06-22) |
| D–G | Specialist panel (4 configs, rubric=data), risk rules (levels + sensitive-path overrides), `phases.review` config slice, `deriveExit += high ∧ !preexisting` | draft → user review | assembling built machinery + eval-tuned data; minimal new architecture | settled (review 2026-06-22) |
| A·3a | **Total verify failure short-circuits the coordinator** (degrade roll-up is final) | user (2026-06-24, comprehend D3) | a coordinator could re-raise degraded `low` findings to `high` + drop the warning → re-gate a broken-verify run; protects A·3's "broken verify never gates" | settled |
| B·2′ | **Path normalization** (`normalizeFindingPath`) reconciles finding paths to index keys; **combined-diff gap** logged + deferred | user (2026-06-24, comprehend D4/D5) | path match is correctness-load-bearing (needs a test — ledger D4); combined diffs likely unreachable in v1 (ledger D5) | settled (with open fixes) |
| §Stack′ | **Spikes resolved:** cassette key = SHA-256{model,rubric,userPrompt}; embedding = openai/text-embedding-3-small/cosine | user (2026-06-24, comprehend D2) | both as the TDD leaned; promote "lean" → settled | settled |
| D6 | **`composite.run()` refactor** — surgically extract pure helpers | user (2026-06-24, comprehend D6) | function had ballooned to ~380 lines / 9 concerns / 5 return paths; complexity concentrated | **resolved — PR #93** (`runVerifyStage` + `reconcileCoordinator` extracted; 380→165 lines) |
| E′ | **Risk classifier reads the untrimmed `fullDiff`**, never the budget-trimmed `ctx.diff`; prompt-budget trimming can't downgrade the resolved level | user (2026-06-26, comprehend M5–M6) | a `consumesDiff` phase trims `ctx.diff` for prompts; classifying on it could downgrade a large diff (full→trivial) — exactly when partial-coverage fires | settled (PR #99) |
| F′ | **Config slice ships a wired subset** (`enabled`, `coordinator`); `maxFindings`/`verify.voters`/per-specialist `model` deferred to M6.5 (ledger D7–D9); `risk.thresholds` cut; unwired keys surface a non-gating `review.config-ignored` advisory | user (2026-06-26, comprehend M5–M6) | no-silent-pass applied to config; voters/model carry real blockers (lens count, per-specialist routing) | settled (with deferred fixes) |
| D′ | **Review panel derives from one `REVIEW_SPECIALISTS` list**; runner map built from it via `makeReviewRunners` | user (2026-06-26, comprehend M5–M6) | CLI shipped a 2-of-4 runner map (#96); single source prevents recurrence | settled (PR #97) |

> **Spikes flagged for the plan:** cassette record/replay at the AgentRunner seam; embedding-match
> library. Both in §Technical risks / §Stack.
