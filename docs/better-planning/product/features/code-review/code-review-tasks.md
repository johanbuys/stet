# code-review — Tasks

**Status:** ready — 2026-06-22
**Derived from:** `code-review-plan.md` (M1–M6, settled) · cites `code-review-tdd.md` (A–G) · `code-review-prd.md`
**Exported:** not yet (offer pending)

One task ≈ one focused agent session. Build order = task-number order within a milestone. Each task
proves itself via its **Accept** line (a command + an observable). The plan's reality-disagrees
protocol applies: anything that contradicts the plan/TDD/PRD surfaces upstream, never absorbed silently.

## PR strategy — one PR per milestone, stacked

| PR | Milestone | Tasks | Merge gate (the milestone's verifiable outcome) | Stacks on |
|----|-----------|-------|--------------------------------------------------|-----------|
| **PR1** | M1 verify | T1–T4 | `vp test` — agreement→confidence, drops, `audit.verify`; no model | — (parallel) |
| **PR2** | M2 contract | T5–T6 | `vp test` — added-line=introduced, context=pre-existing; `SpecialistSubmission` | — (parallel) |
| **PR3** | M3 eval scaffold | T7–T10 | `vp test` eval green from synthetic cassettes (no creds); `vp run eval:live` emits SNR | — (parallel; loosely needs M2 shape) |
| **PR4** | M4 thin slice | T11–T14 | `stet --against <ref>` on a seeded-bug fixture → `review.bug`; no-creds→error | **PR1 + PR2** |
| **PR5** | M5 panel+tune | T15–T16 | `vp run eval:live` → per-tier precision/SNR ≥ baseline | **PR4 + PR3** |
| **PR6** | M6 risk/config/gate | T17–T20 | trivial→bugs-only; sensitive→full+security; gating = high ∧ !preexisting | **PR4 + PR2** |

**Parallelism:** PR1 ∥ PR2 ∥ PR3 may start immediately. PR4 after PR1+PR2 merge. PR5 after PR4+PR3. PR6 after PR4+PR2.

---

## M1 — Agreement-verify stage · PR1  *(no model — fake runners)*

- [ ] **T1 · Extend `FakeAgentRunner` to a per-call script queue**
  Implements: plan §M1 step 0a (cold-reader B1) · TDD A·2
  Files: `src/agent/fake-runner.ts`, `src/agent/fake-runner.test.ts`
  Accept: a fake scripted `[uphold, uphold, refute]` returns those across three successive `run()` calls (today it returns one fixed script every call); `vp test src/agent/fake-runner.test.ts` passes. *(Prereq for T4's medium/abstain tests.)*

- [ ] **T2 · Add typed `VerifyAudit` to the closed `Audit` schema**
  Implements: plan §M1 step 0b (cold-reader B4) · TDD A·4
  Files: `src/schema/report.ts`, `src/schema/report.test.ts`
  Accept: `audit = { verify?, coordinator? }` with `VerifyAudit = { received, dropped:[{id, specialist?, upholds, verdicts}] }` (`additionalProperties:false`); a `PhaseReport` carrying `audit.verify` passes `parseRunReport` (else the CLI self-check exits 2); `vp test src/schema/report.test.ts`.

- [ ] **T3 · `submit_verdict` output-tool**
  Implements: plan §M1 step 1 · TDD A·2
  Files: `src/agent/submit-verdict.ts`, `src/agent/submit-verdict.test.ts`
  Accept: parses `{ verdict: "uphold"|"refute"|"abstain", reason }`; rejects an unknown verdict (mirror `submit-tool.ts`).

- [ ] **T4 · `runAgreementVerify` — aggregation, drop, audit, failure**
  Implements: plan §M1 steps 2–4 · TDD A·2/A·3/A·4
  Files: `src/phases/verify.ts`, `src/phases/verify.test.ts`
  Accept: per candidate, N sequential voter calls (lens in `rubric`/`userPrompt`, fresh `AbortController` per call); `vp test` shows 3-uphold→high, 2→medium, 1→dropped (in `audit.verify`); a voter erroring twice → abstain (absolute threshold preserved). No model. *(Uses T1, T2, T3.)*

## M2 — Finding contract · PR2  *(unit; parallel with M1)*

- [ ] **T5 · `SpecialistSubmission` schema + open-`meta` keys**
  Implements: plan §M2 steps 1,4 (cold-reader F1) · TDD B·1/B·3
  Files: `src/schema/finding.ts`, `src/schema/finding.test.ts`
  Accept: `SpecialistSubmission` = Finding minus `confidence`/`specialist`/`phase`; `meta` stays **open** (`additionalProperties:true`) with `preexisting`/`selfConfidence` as conventional keys (existing open-`meta` tests stay green — no narrowing); `vp test src/schema/finding.test.ts`.

- [ ] **T6 · Deterministic pre-existing detection (`@@`-hunk parsing + mark)**
  Implements: plan §M2 steps 2,3 (cold-reader B5) · TDD B·2
  Files: `src/preexisting.ts`, `src/preexisting.test.ts`
  Accept: `buildAddedLineIndex(diff)` parses each `@@ -a,b +c,d @@` header and walks the body → `Map<file, Set<line>>` (this is **new** code; `diff-sections.ts` parses file sections only). `markPreexisting`: finding on an added line → introduced; on a context line → `meta.preexisting`; no `location.line` → unchanged. `vp test` covers multi-hunk + off-by-one.

## M3 — Eval scaffold · PR3  *(cassettes + live; parallel; loosely needs M2 shape)*

- [ ] **T7 · `CassetteRunner` (record/replay at the AgentRunner seam)**
  Implements: plan §M3a (spike PL·2) · TDD C·1
  Files: `src/agent/cassette-runner.ts`, tests
  Accept: replays recorded `{key → submission, cost}` deterministically; record mode writes them; **key = documented hash of `(model, rubric, userPrompt)`** (the non-serializable `TSchema`/`signal`/`onTool` are excluded). Provable with a synthetic submission, no specialists.

- [ ] **T8 · Fixture type + synthetic fixtures**
  Implements: plan §M3 · PRD C5/#15
  Files: `src/eval/fixture.ts`, `src/eval/fixtures/`
  Accept: `Fixture = { id, diff, baseFiles?, expected[], clean, tier, sensitivePaths? }`; a handful hand-authored across the three visibility tiers + clean; they load under test.

- [ ] **T9 · Grader (LLM-judge HIT/VALID/NOISE) + pin embedding lib**
  Implements: plan §M3b (spike) · TDD C·2 · PRD #13
  Files: `src/eval/grader.ts`, tests
  Accept: buckets each emitted finding HIT/VALID/NOISE via location gate ±N **then** embedding match (1-to-1); **the embedding package + model id + cosine threshold are pinned** (no hand-wave); runs against synthetic cassettes.

- [ ] **T10 · Metrics + baseline + regression gate + `eval:live` script**
  Implements: plan §M3b · TDD C·3 · PRD R9/AC#13
  Files: `src/eval/metrics.ts`, `src/eval/runner.ts`, `src/eval/baseline.json`, `package.json`
  Accept: SNR + per-tier P/R + clean-FPR; committed `baseline.json`; gate fails on precision/SNR drop > ε; golden-subset κ≥0.75 check; **add an `eval:live` script** (it doesn't exist today). `vp test` eval green from synthetic cassettes (no creds); `vp run eval:live` emits metrics + updates baseline.

## M4 — Thin review slice (bugs only) · PR4  *(model; stacks on PR1 + PR2)*

- [ ] **T11 · Wire `verify` into `composite.run` + extend the protected class**
  Implements: plan §M4 step 1 (cold-reader S3/S4/F4) · TDD A·1/A·4
  Files: `src/phases/composite.ts`, `src/phases/composite.test.ts`, `src/phases/coordinator.test.ts`
  Accept: `runAgreementVerify` inserted between the roll-up loop (`:308`) and the coordinator block (`:312`), with verify ctx `{cwd, diff: ctx.diff, signal}`; confidence stamped **by id** surviving coordinator re-attribution; `confidence === "high"` added to the protected predicate (`:397`). **Test matrix:** high+no-evidence dropped→reinstated; high downgraded→reinstated-in-place; high+evidence→one reinstatement not two; existing `composite`/`coordinator` suites stay green.

- [ ] **T12 · `markPreexisting` wraps all five completed return paths**
  Implements: plan §M4 step 4 (cold-reader F2) · TDD B·2 · PRD AC#4
  Files: `src/phases/composite.ts` (+tests)
  Accept: a single finalization applies `markPreexisting` to every `completed` return (`:321/340/442/468/479`), computed on the post-coordinator location; a pre-existing `error` on the **no-coordinator** (trivial) path is non-gating.

- [ ] **T13 · `bugs` specialist + `review` phase factory + activation**
  Implements: plan §M4 steps 2,3 · TDD D · `code-review-rubric-draft.md`
  Files: `src/phases/review/review.ts`, rubric text
  Accept: `bugs` `SpecialistConfig` (`submitSchema = SpecialistSubmission`, ceiling `error`, `maxFindings` 5, 3 verify lenses); `review` phase activates on ≥1 reviewable file (R1); unit-tested with fakes.

- [ ] **T14 · CLI `runners`-map wiring + phase registration + creds gate**
  Implements: plan §M4 step 5 (cold-reader F5/F3) · PRD AC#8/AC#3
  Files: `src/cli.ts`, `src/phases/index.ts`, `src/phases/registry.ts`
  Accept: build the per-specialist + `"coordinator"` + per-voter `runners` from `PiAgentRunner` (mirror `cli.ts:585`), register `review` into `defaultPhases`, gate on credential resolution. `stet --against <ref>` on a seeded-bug fixture → a `review.bug` finding (error, agreement confidence, location, scenario); a later-fixed defect in the same range **not** reported (AC#3); clean → 0; **no creds → `error`/`no model available`, never `completed`+empty (AC#8)**.

## M5 — Full panel + tune · PR5  *(model; stacks on PR4 + PR3)*

- [ ] **T15 · Add security, quality, coverage-gaps specialists + shared preamble**
  Implements: plan §M5 · TDD D · PRD R3/R7/R8 · `code-review-rubric-draft.md`
  Files: `src/phases/review/` specialists + shared preamble
  Accept: 4 specialists fan out; ceilings enforced (quality/coverage cap at `warning`); shared preamble (concrete-scenario bar, DO-NOT-FLAG blocklist, anti-hallucination, abstention); a convention finding quotes the exact `CLAUDE.md` rule + line, else not flagged (AC#11).

- [ ] **T16 · Tune rubrics against the eval to baseline**
  Implements: plan §M5 · PRD R9/AC#13
  Files: rubric text, `src/eval/fixtures/`, `src/eval/baseline.json`
  Accept: iterate rubrics; `vp run eval:live` → per-tier precision/SNR ≥ the committed baseline; clean-fixture FPR low; `vp test` eval (cassettes) green.

## M6 — Risk dial + config + gating · PR6  *(stacks on PR4 + PR2)*

- [ ] **T17 · Risk rules + levels**
  Implements: plan §M6 step 1 (cold-reader F7) · TDD E · PRD R4/#9
  Files: review `riskRules` + `riskLevels`
  Accept: levels trivial/standard/full (size thresholds + sensitive-path globs); **security-always** on sensitive paths; resolved level reported via the existing `PhaseReport.level`. `vp test`: trivial→bugs-only/no-coordinator; sensitive→full+security.

- [ ] **T18 · `phases.review` config-slice validator + precedence**
  Implements: plan §M6 step 2 (cold-reader N1) · TDD F · PRD R10
  Files: review-local config-slice validator
  Accept: a review-local validator parses `{ specialists, maxFindings, verify.voters, coordinator }` (the `phases` record is `Type.Unknown` at the seam); rides the built 4-layer merge; disabling a specialist in config drops it.

- [ ] **T19 · `deriveExit` gating rule (harness-global, runtime `meta` check)**
  Implements: plan §M6 step 3 (cold-reader B3/F1) · TDD G · PRD R6/C6
  Files: `src/exit-codes.ts`, `src/exit-codes.test.ts`
  Accept: `deriveExit` gains `∧ finding.meta?.preexisting !== true` (runtime check on open `meta`, no narrowing); a high non-pre-existing `error` gates exit 1, a pre-existing `error` does not; existing `exit-codes.test.ts` stays green.

- [ ] **T20 · `review.partial-coverage` warning surfaced**
  Implements: plan §M6 verifiable · PRD R2/AC#9/AC#28
  Files: `src/phases/review/` (+ wherever budget-trim exclusions surface)
  Accept: an over-budget diff yields a `review.partial-coverage` warning naming the excluded files (no silent truncation). *(Confirm during build whether the harness already emits this — reality-disagrees if so.)*

---

## Pointing agents at the work

One agent per **milestone** (= one PR), working its tasks in order, TDD per Accept line, surfacing
reality-disagrees. Start PR1/PR2/PR3 in parallel; gate PR4 on PR1+PR2, PR5 on PR4+PR3, PR6 on PR4+PR2.
