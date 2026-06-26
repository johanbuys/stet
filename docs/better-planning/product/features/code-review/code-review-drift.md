# code-review — Drift Ledger

**Status:** active — last sync **M5–M6 synced 2026-06-26** (full catch-up)
**Anchor:** `code-review-tdd.md` (the design of record this ledger reconciles against)
**Tracks:** `code-review-plan.md` milestones as they land (M1–M6 built; M6.5 config-wiring queued)

<!-- Build-time record maintained by better-planning-comprehend. NOT a planning artifact: it tracks
     the reconciliation between the TDD and the code that actually landed. The TDD stays canonical;
     this is the running diff of every architectural divergence and its fate. -->

## Sync checkpoints

| Checkpoint | Window (diff range) | Date | Deltas reviewed | Open fixes |
|---|---|---|---|---|
| M1–M4 synced | `c5b7c19..e529666` | 2026-06-24 | 6 | 3 → 1 (D6 #93, D4 #94 fixed same day; D5 deferred) |
| M5–M6 synced | `e529666..3136df9` | 2026-06-26 | 6 | 3 deferred → M6.5 (D7–D9 config keys); D5 still open |

> First sync was a full catch-up after time away — M1–M4 at once. Second sync (M5–M6, full)
> covered the panel + risk/config/gating window. All six moves accepted as proposed (empty-submit
> on the canvas walk). Next sync at M6.5.

## Deltas

### D1 · agreement-verify retry policy sharper than A·3's prose
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** `callVoter` splits voter errors into transient (retry once → abstain) vs
  non-transient — `BudgetError`/`CancelledError`/already-aborted abstain immediately, no retry
  (retrying a spent wall-clock window or a cancelled parent is wasted). A·3 said only "retry once,
  then abstain." Also: an `Ok` result whose submission fails the `VoterVerdict` schema → abstain
  (not retried).
- **Where:** `src/phases/verify.ts:102–153`
- **TDD section:** A·3 (failure & abstention semantics)
- **Disposition:** `intentional` → TDD A·3 updated in place; rationale appended.
- **Decided by:** human 2026-06-24 (no objection)

### D2 · both PL·2 spikes resolved with concrete choices
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** TDD §Stack carried two "lean X" spikes; the build made them concrete —
  embedding = `openai` pkg / `text-embedding-3-small` / OpenAI endpoint / cosine ≥ threshold;
  cassette key = SHA-256 of `{model, rubric, userPrompt}` (the only serialisable inputs).
- **Where:** `src/eval/grader.ts:26–45`, `src/agent/cassette-runner.ts:54–79`
- **TDD section:** §Stack / library choices; plan PL·2
- **Disposition:** `intentional` → TDD §Stack promoted from "lean" to settled.
- **Decided by:** human 2026-06-24 (no objection)

### D3 · verify degrades ⇒ the coordinator is skipped entirely  *(fork the TDD never decided)*
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** On total verify failure (no verify runner / `ConfigError`), the composite forces
  all findings to `low` + emits a `verify-degraded` warning **and skips the coordinator**. A·3
  specified the first two but said nothing about the coordinator. Reason the build added it: an
  enabled coordinator could re-raise the `low` findings to `high` and drop the warning — re-gating a
  broken-verify run.
- **Where:** `src/phases/composite.ts:367–372, 427`
- **TDD section:** none originally — undecided fork
- **Disposition:** `undecided` → **new TDD decision A·3a made now:** degrade short-circuits the
  coordinator; the conservative all-`low` roll-up + warning is final. Protects the "broken verify
  never gates" invariant A·3 is built on.
- **Decided by:** human 2026-06-24 (accepted recommendation)

### D4 · finding-path normalization is an invented heuristic  *(fork the TDD never decided)*
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** `normalizeFindingPath` strips `./` and one single-letter diff prefix
  (`a/ b/ i/ w/ c/ o/`) so a model-supplied finding path matches added-line-index keys. B·2 never
  specified how finding locations reconcile against the index across path-prefix mismatches.
  Correctness-load-bearing: a wrong match silently marks a finding `preexisting` → it stops gating.
- **Where:** `src/preexisting.ts:145–151`, used by `markPreexisting`
- **TDD section:** B·2 (deterministic pre-existing detection)
- **Disposition:** `undecided` → accepted into TDD as a B·2 detail; **flagged a test gap** (the
  "path mismatch → wrongly pre-existing → wrongly non-gating" case) → Open fix D4.
- **Decided by:** human 2026-06-24 (accepted recommendation)
- **✅ Resolved 2026-06-24 — PR #94:** `normalizeFindingPath` direct unit tests + a characterization
  test pinning the unreconcilable-path false-clean boundary (`preexisting.test.ts`, +11).

### D5 · combined diffs ⇒ every finding marked pre-existing (non-gating)  *(latent gap)*
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** `buildAddedLineIndex` skips `diff --cc`/`--combined` sections → empty added-set
  → `markPreexisting` marks every finding in those files `preexisting` → none gate. The file's own
  docstring says "full conservative handling … deferred to M4 wiring"; M4 wiring never implemented
  it. A "false clean" — the exact failure stet exists to prevent.
- **Where:** `src/preexisting.ts:60–69` + missing handling in `src/phases/composite.ts`
- **TDD section:** B·2 (scope note); plan M4
- **Disposition:** `drift` → flagged for fix, but **deferred** with a reachability note: in v1
  `--against <ref>` three-dot produces a two-way diff, so combined diffs are likely unreachable.
  → Open fix D5 (fix when combined diffs become reachable).
- **Decided by:** human 2026-06-24 (accepted "log it" recommendation)

### D6 · composite.run() has ballooned — structural decision pending  *(complexity growth)*
- **Checkpoint:** M1–M4 synced 2026-06-24
- **What changed:** `composite.run()` (~380 lines) now sequences nine concerns: cancellation, risk
  classification, added-line index, parallel fan-out, roll-up + provisional-`low` stamp, the verify
  stage (two degrade paths), the confidence-by-id index, the coordinator pass with per-id
  multiplicity protected-class reconciliation, and `markPreexisting` across **five** `completed`
  return paths. Nothing contradicts the TDD — but the complexity is real and concentrated, and M5
  (4 specialists + live coordinator) and M6 only add to it.
- **Where:** `src/phases/composite.ts` (whole `run()`)
- **TDD section:** A·1 / §NFRs (no decision covers internal decomposition)
- **Disposition:** `undecided` → **human flagged: "we need to think about the refactor before we go
  too deep."** Not resolved this sync. → Open fix D6: decide the composite.run refactor (extract
  verify-wiring / protected-class reconciliation / report-builder helpers?) **before M5**.
- **Decided by:** human 2026-06-24 (decision deferred, refactor to be considered before M5)
- **✅ Resolved 2026-06-24 — PR #93:** option-1 surgical refactor — `runVerifyStage` +
  `reconcileCoordinator` extracted as pure functions; `run()` ~380→~165 lines; behavior-preserving
  (suite 1031→1042, +11 unit tests on the protected-class loop). Report-builder (seam D) left inline.

### D7 · review phase became a config-resolving wrapper  *(intentional)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** `makeReviewPhase` went from a thin `return makeCompositePhase(...)` to a hand-built
  phase whose `run()` parses the config slice, filters specialists, rebuilds risk levels, and
  constructs the composite **per run**. The review phase grew run-time config resolution.
- **Where:** `src/phases/review/review.ts` makeReviewPhase().run()
- **TDD section:** F (slice resolution) — said "merges into built 4-layer config", never described the wrapper
- **Disposition:** `intentional` → TDD F updated to describe the per-run wrapper.
- **Decided by:** human 2026-06-26 (accepted on canvas)

### D8 · config slice landed narrower than TDD F  *(drift — honest, surfaced)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** TDD F lists six knobs; only `specialists.enabled` + `coordinator` are wired.
  `maxFindings`, `verify.voters`, per-specialist `maxFindings`/`model` validate but no-op;
  `risk.thresholds` isn't even in the schema. Not silent — surfaced by D10's advisory.
- **Where:** `src/phases/review/review.ts` ReviewConfigSchema / run()
- **TDD section:** F
- **Disposition:** `drift` → TDD F marks wired/deferred; `risk.thresholds` **cut**; three keys
  deferred to **M6.5** (open fixes below). Honest drift — D10 makes it visible.
- **Decided by:** human 2026-06-26 (accepted on canvas)

### D9 · risk classifier was reading the budget-trimmed diff  *(fork the TDD never decided)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** review set `consumesDiff: true` (for partial-coverage), which made the scheduler
  trim `ctx.diff` — and `classify()` read the trimmed diff, so a large long-line diff could be
  downgraded (full→trivial). The TDD never decided how trimming interacts with classification.
- **Where:** `src/phases/types.ts`, `src/scheduler.ts`, `src/phases/composite.ts` classify()
- **TDD section:** none originally — undecided fork
- **Disposition:** `undecided` → **new TDD decision E′:** the classifier reads the untrimmed
  `ctx.fullDiff`; prompt-budget trimming never changes the resolved level. Fixed PR #99.
- **Decided by:** human 2026-06-26 (accepted recommendation on canvas)

### D10 · new harness finding `review.config-ignored`  *(intentional)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** a non-gating advisory (confidence `low`) naming recognized-but-unwired config
  keys, prepended like `partial-coverage`. Makes D8 honest rather than a silent no-op.
- **Where:** `src/phases/review/review.ts` findIgnoredConfigKeys / configIgnoredFinding
- **TDD section:** none originally → folded into F + NFRs
- **Disposition:** `intentional` → TDD F + NFR "No silent config" added; glossary term added.
- **Decided by:** human 2026-06-26 (accepted on canvas) · PR #99

### D11 · runner-map drift guard  *(intentional, minor)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** `REVIEW_SPECIALISTS` single source of truth + `makeReviewRunners`; CLI builds its
  runner map through it. Prompted by a real bug — #96 shipped a 2-of-4 runner map and the composite
  threw on `security`.
- **Where:** `src/phases/review/review.ts`, `src/cli.ts`
- **TDD section:** D
- **Disposition:** `intentional` → one-line note added to TDD D.
- **Decided by:** human 2026-06-26 (accepted on canvas) · PR #97

### D12 · stale TDD decision row (D6 refactor)  *(doc drift)*
- **Checkpoint:** M5–M6 synced 2026-06-26
- **What changed:** the TDD decisions table still listed the `composite.run()` refactor as
  "open — decide before M5", though it was resolved (PR #93) and recorded done in this ledger.
- **Where:** `code-review-tdd.md` decisions table
- **TDD section:** decisions table
- **Disposition:** `drift` (doc only) → row updated to resolved, cites PR #93.
- **Decided by:** human 2026-06-26 (accepted on canvas)

## Open fixes

- [x] **D6** — `composite.run()` refactor — **done 2026-06-24, PR #93** (extracted `runVerifyStage` + `reconcileCoordinator`; `run()` 380→165 lines)
- [x] **D4** — test for the path-mismatch → wrongly-pre-existing → wrongly-non-gating case — **done 2026-06-24, PR #94**
- [ ] **D5** — combined-diff conservative handling (mark findings gating, not pre-existing) — deferred until reachable — flagged 2026-06-24
- [ ] **D7a (→ M6.5 T21)** — wire `phases.review.maxFindings` (top + per-specialist): rebuild rubric per run with the configured cap; remove its detector from `findIgnoredConfigKeys` — flagged 2026-06-26
- [ ] **D8b (→ M6.5 T22)** — `verify.voters`: **needs a design decision first** (generate/select the Nth lens so `voters === lenses` holds — `verify.ts` throws otherwise); not a clean task — routes to design before it's a task — flagged 2026-06-26
- [ ] **D9c (→ M6.5 T23)** — per-specialist `specialists.<n>.model` routing (review passes one model to all today); remove its detector from `findIgnoredConfigKeys` — flagged 2026-06-26

> **When each key is wired**, delete its detector entry from `findIgnoredConfigKeys` in
> `src/phases/review/review.ts` so the advisory stops flagging it.
