# code-review — Implementation Plan

**Status:** settled — 2026-06-22 (two adversarial cold-reader passes incorporated; pass-2 verdict: M1 executable test-first, M2/M4/M6 corrected; "go build M1" is a literal next prompt)
**Depends on:** `code-review-tdd.md` (settled — cites areas A–G) · `code-review-prd.md` (settled) · the built harness (`src/phases/composite.ts`, `coordinator.ts`, `src/agent/*`, `src/risk/classify.ts`, `src/schema/finding.ts`, `src/schema/report.ts`, `src/diff-sections.ts`, `src/exit-codes.ts`, `src/config/*`)
**Companion:** `code-review-plan-overview.html`

> This plan **sequences and verifies**; it does not re-decide architecture (TDD) or requirements
> (PRD). It cites TDD decisions by id (A·1, B·2, …). A cold-reader review (independent agent, no
> session context) was run against the real codebase; its blockers/should-fixes are folded in and
> traced in the Decisions table (PL·4).

---

## Reality corrections found by the cold reader (applied upstream)

Two settled-doc claims were **false against the code** and are corrected per the reality-disagrees
protocol:
- **TDD B·2** said `diff-sections.ts` "already parses hunks." It does **not** — it splits a diff
  into per-file sections via `+++`/`---` only; no `@@` hunk or line-number parsing exists. → TDD B·2
  amended; M2 re-scopes added-line parsing as **new** code.
- **PRD #5 & #12** both literally say "milestone 1" (eval vs verify) — an internal contradiction. →
  PRD decisions table amended to record the capability-first reconciliation (this plan's PL·1).

---

## Build order & reasoning

**Capability-first** (PL·1, reconciles PRD #5 ↔ #12). The deterministic, fake-testable keystones
(verify, contract) come first; the eval harness lands **before any rubric is tuned**; then a thin
end-to-end slice, the full panel tuned against the eval, and the cost/config/gating integration.

```
M1 verify ──┐
M2 contract─┴─► M4 thin slice ─► M5 full panel+tune ─► M6 risk/config/gating
M3 eval scaffold ────────────────┘ (needed to tune M5)
   (parallel with M1/M2)              ▲
M2 ─────────────────────────────────┘  (deriveExit gating reads M2's meta.preexisting, open meta)
```

Why: risk + proof first. Verify (TDD-A) is highest-novelty but fully unit-testable with fakes — so
it's proven without a model (M1). The eval (TDD-C) carries the two real unknowns (cassette infra,
embedding lib) and is the rubric-settling mechanism, so it lands early (M3) before tuning (M5) —
exactly what PRD #5 protects. The model enters at M3+.

---

## Milestones

Test-first (CLAUDE.md → tdd skill). Each ends in an observable outcome.

### M1 — Agreement-verify stage (`src/phases/verify.ts`)
**Goal:** the net-new harness capability (TDD A·0–A·4). Standalone; not yet wired into the composite.
**Files:** NEW `src/phases/verify.ts`, `src/agent/submit-verdict.ts`, `src/phases/verify.test.ts`;
touch `src/agent/fake-runner.ts` (step 0a), `src/schema/report.ts` + `report.test.ts` (step 0b).

**Prerequisite steps (cold-reader B1, B4 — these are load-bearing and were missing):**
- **0a · Extend `FakeAgentRunner` to a per-call script queue.** Today it holds one `RunScript` and
  returns it on *every* `run()` (`fake-runner.ts:92-110`) — so it **cannot** produce N differing
  voter verdicts (the unbuilt "T8 multi-step" seam). Add an ordered queue (one `RunScript` per
  `run()` call) or a `(inputs, callIndex) => RunScript` form. Its own test. **Without this, M1's
  medium/abstain/tie tests are unwritable.** (Harness-wide enabler; benefits future phases.)
- **0b · Add `VerifyAudit` to the `Audit` schema.** `Audit` is closed (`additionalProperties:false`,
  `report.ts`), and the CLI runs `parseRunReport` as a self-check → exit 2 on any unknown key
  (`cli.ts`). So `audit.verify` must be a typed member *before* anything emits it: add
  `verify?: VerifyAudit` (new sub-object, `additionalProperties:false`) with a `report.test.ts`
  assertion. (The unit test in step 4 doesn't hit `parseRunReport`, so this is the forcing
  function, not the unit test.)

**Steps (test-first):**
1. `submit_verdict` tool + schema `{ verdict: "uphold"|"refute"|"abstain", reason }` (mirror `submit-tool.ts`).
2. `runAgreementVerify(runner, candidates, cfg, ctx)` — **concrete loop** (B2): for each candidate,
   N sequential calls; per call rebuild `AgentRunInputs` with `lens[i]` carried in `rubric`/`userPrompt`
   (the only free-text seam, `runner.ts:26-50`), a **fresh `AbortController` per call** (`budgets.ts`:
   "one per call — never reuse"), via `runWithWallClock`. Aggregate upholds; stamp confidence
   (3→high, 2→medium); drop ≤1 (A·2).
3. Failure semantics (A·3): voter error → retry once → abstain; absolute threshold preserved (tested
   via the step-0a queue: call-1-err, call-2-err → abstain).
4. `audit.verify = { received, dropped:[{id, specialist?, upholds, verdicts}] }` (A·4).
**Verifiable:** `vp test src/phases/verify.test.ts` green — 3-uphold→high, 2→medium, 1→dropped+audited;
voter erroring twice → abstain; and `vp test src/schema/report.test.ts` confirms a report with
`audit.verify` passes `parseRunReport`. No model required.

### M2 — Finding contract evolution
**Goal:** TDD-B — `SpecialistSubmission` split, `meta.selfConfidence`, deterministic `meta.preexisting`.
**Files:** `src/schema/finding.ts` (add `SpecialistSubmission`; `meta.preexisting` / `meta.selfConfidence`
as **conventional keys in the *open* `meta`** — `meta` stays `additionalProperties:true` per TDD B·3, **no
narrowing**, F1); NEW `src/preexisting.ts`; tests.
**Steps:**
1. `SpecialistSubmission` = Finding minus `confidence`/`specialist`/`phase` (model-facing form, B·1/B·3).
2. **NEW hunk-line parsing** (B5 — *not* "extend diff-sections"; it has no hunk parser): `buildAddedLineIndex(diff)`
   → `Map<file, Set<line>>` by parsing each `@@ -a,b +c,d @@` header and walking the body (increment
   the new-file counter on context/added lines, skip removed). Test matrix: multi-hunk file, added vs
   context vs removed, the `@@` offset, the classic off-by-one.
3. `markPreexisting(findings, addedLineIndex)` (B·2): line ∈ added → introduced; else
   `meta.preexisting`; no `location.line` → unchanged (still gates).
4. `meta.preexisting` is a **conventional key in the open `meta`** (TDD B·3); M6's `deriveExit` reads it
   with a **runtime check** (`finding.meta?.preexisting === true`). Narrowing `meta` to a closed object
   would break the Phase-5 open-meta tests (`finding.test.ts:144/160`, `report.test.ts:171`) — so we don't (F1).
**Verifiable:** `vp test` — finding on an added line not pre-existing; on a context line pre-existing;
no-location not marked; a 3-hunk fixture maps line numbers correctly.

### M3 — Eval harness scaffolding *(both spikes; split a/b)*
**Goal:** TDD-C — fixtures, grader, metrics, cassettes, baseline; tiered execution (C·1).
> **Recording dependency (cold-reader S1):** real specialist cassettes can't exist until M4/M5 run
> live. So M3 proves the machinery against **synthetic** cassettes (hand-written `{inputs→submission}`);
> the **real-quality numbers arrive at M5's `eval:live`**. M3's `vp test` green = "machinery + grader
> are deterministic," not "review is good."

**M3a — cassette seam (spike):** `CassetteRunner implements AgentRunner` replaying recorded
`{key → submission, cost}`; record mode writes them. **Key design is the spike:** `AgentRunInputs`
holds a `TSchema`, `AbortSignal`, `onTool` (non-serializable) — so key = a stable hash of
`(model, rubric, userPrompt)`. Pin and document the key so cassettes are portable. Provable with a
trivial synthetic submission, no specialists needed.
**M3b — grader + metrics (spike):** LLM-judge HIT/VALID/NOISE; location gate ±N **then** embedding
match — **pin the exact package + model id + endpoint + cosine threshold** (no hand-wave); 1-to-1.
Metrics SNR + per-tier P/R + clean-FPR; `baseline.json`; regression gate (fail if precision/SNR drop
> ε); golden-subset κ≥0.75 check. Wire default `vp test` → cassettes; **add an `eval:live` script to
`package.json`** (F6 — it doesn't exist today; `vp run eval:live` → real models, keyed, updates `eval-baseline.json`).
**Verifiable:** `vp test` eval green from **synthetic** cassettes, no creds; `vp run eval:live` emits
SNR/precision and updates the baseline.

### M4 — Thin review slice (1 specialist, end-to-end)
**Goal:** wire `verify` into the composite and stand up a real `review` phase with **bugs** only.
**Files:** NEW `src/phases/review/review.ts`; touch `src/phases/composite.ts` (the riskiest edit —
see sub-steps); register in `src/phases/registry.ts`/`index.ts`.
**Steps:**
1. **Wire verify into `composite.run` — this is delicate surgery (cold-reader S3), not a one-liner:**
   - (i) insert `runAgreementVerify` after the roll-up loop (`composite.ts:308`) and before the
     coordinator block (`:312`); build verify's ctx as `{ cwd: ctx.cwd, diff: ctx.diff, signal: ctx.signal }`
     — note the coordinator seam passes **no diff**, but verify's lenses need it (S4);
   - (ii) stamp confidence **by id** onto findings from the verify result, surviving the coordinator's
     id-based re-attribution (`composite.ts:360-371`);
   - (iii) extend the **protected-class** predicate (A·4): today only `evidence.command` is protected
     (`:397`); add `confidence === "high"` into the multiplicity-reconciliation loop (`:384-438`,
     the hardest function in the codebase — carries the #48/#30/#31 invariants). **Own test matrix (F4):**
     high+no-evidence dropped → reinstated; high+no-evidence downgraded-to-medium → reinstated-in-place;
     high+evidence (both predicates) → still **one** reinstatement not two; existing evidence-only
     `coordinator.test.ts` cases stay green;
   - (iv) **regression-guard** the full existing `composite.test.ts` + `coordinator.test.ts` suites stay green.
2. bugs `SpecialistConfig` (rubric from `code-review-rubric-draft.md`; read-only toolset;
   `submitSchema = SpecialistSubmission`; ceiling `error`; `maxFindings` 5; 3 verify lenses).
3. `review` phase factory + registration + activation (≥1 reviewable file, R1).
4. `markPreexisting` applied as a **single finalization wrapping all five `completed` return paths** in
   `composite.run` (`:321/340/442/468/479`) — **not** just the coordinator-OK path (F2). Otherwise a
   pre-existing finding on the **no-coordinator** (trivial-level) path gates and violates AC#4. Computed
   on the *final*, post-coordinator location (the coordinator may rewrite it — S5).
5. **Wire the live `runners` map + register the phase (F5):** build the per-specialist + `"coordinator"`
   + per-voter `runners` from `PiAgentRunner` (mirror `cli.ts:585`), register `review` into the default
   phase set (`index.ts` `defaultPhases` / `registerDefaultPhases`), **gated on credential resolution**
   (`routing/resolve.ts`) — no creds ⇒ phase `error`, never a registered-but-silent clean.
**Verifiable:** `stet --against <ref>` (the three-dot net-vs-base surface exists, `scope.ts:273-278`)
on a seeded-bug fixture → a `review.bug` finding (severity error, agreement confidence, location,
concrete scenario); a defect introduced then fixed in a later commit of the same range is **not**
reported (PRD AC#3); a clean diff → zero findings, `completed`; **with no model credentials → phase
reports `error`/`no model available`, never `completed`+empty (AC#8, F3)**.

### M5 — Full panel + tune against the eval
**Goal:** TDD-D — add security, quality, coverage-gaps; shared preamble; tune against M3.
**Files:** `src/phases/review/` specialists + shared preamble; expand `src/eval/` fixtures (incl. a
convention-violation fixture for AC#11 and a clean fixture for FPR).
**Steps:** add 3 specialists; shared preamble (concrete-scenario bar, DO-NOT-FLAG blocklist,
anti-hallucination, abstention — R8); convention findings quote the exact `CLAUDE.md` rule + line
(R7/AC#11) — fixture-verified; iterate rubrics against the eval until per-tier precision/SNR ≥ baseline.
**Verifiable:** `vp run eval:live` → SNR + per-tier precision/recall ≥ baseline, clean-FPR low;
`vp test` eval (cassettes) green; a convention fixture yields a finding only when it quotes the rule.

### M6 — Risk dial + config + gating *(depends on M2)*
**Goal:** TDD-E/F/G — the cost dial, config slice, gating rule.
**Files:** review `riskRules`+`riskLevels` (uses `src/risk/classify.ts`); a **review-local config-slice
validator** (N1 — `phases` is `Type.Record(String, Unknown)` in `config/schema.ts`; each phase parses
its own slice, `types.ts`); `src/exit-codes.ts`.
**Steps:**
1. Risk levels trivial/standard/full (size thresholds + sensitive-path globs; **security-always**
   override on sensitive paths, R4/#9). Report the resolved level via the **existing** `PhaseReport.level`
   (`report.ts:160`, F7 — don't re-add it).
2. `phases.review` slice validator (enable specialists, `maxFindings`, `verify.voters`, coordinator
   override) + precedence (rides the built 4-layer merge).
3. **Gating (B3 — a harness-global change, not review-local):** `deriveExit` (`exit-codes.ts:31`,
   the shared primitive used by all phases) gains `∧ finding.meta?.preexisting !== true` — a **runtime
   check on the open `meta`** (F1, no schema narrowing). Additive + regression-guarded against `exit-codes.test.ts`.
**Verifiable:** trivial diff → bugs-only/no-coordinator; sensitive path → full panel + security on;
a high non-pre-existing `error` gates exit 1, a pre-existing `error` does not; `review.partial-coverage`
warning names excluded files on an over-budget diff (AC#9/#28); disabling a specialist in config drops it.

---

## Dependencies & parallelism

- **M1 (verify)** ∥ **M2 (contract)** — independent. (M1 step 0a fake-runner extension is internal to M1.)
- **M3 (eval scaffold)** — loosely needs M2's `SpecialistSubmission`/expected-finding shape (N3);
  otherwise parallel with M1/M2; **required by M5**.
- **M4** depends on M1 + M2. **M5** depends on M4 + M3. **M6** depends on M4 **and M2** (the
  `meta.preexisting` convention for `deriveExit`, B3/F1).
- **Critical path:** M1/M2 → M4 → M5 → M6, with M3 alongside M1/M2.

---

## v0 cut — deliberately deferred (with reasons)

- **N-by-stakes & voter-tier dials** (PRD decision 8) — v1 uniform N=3 robust.
- **Deterministic pre-dedup** (TDD A·1) — until the eval measures the duplicate rate (#5).
- **`meta.selfConfidence` operational use** (TDD B·1) — recorded only; eval studies it later.
- **Tiny live smoke-set per commit** (TDD C·1 open) — default cassettes; revisit if drift bites.
- **Full fixture-mining pipeline** (PRD #15) — hand-authored + a handful mined; full pipeline → the `eval-suite` feature.
- **Structural call-graph / few-shot rubric examples** (PRD deferred).

---

## Reality-disagrees protocol (for the builder)

If, while building, the implementation **contradicts a PRD or TDD decision** — a contract that can't
hold, a milestone outcome that can't be produced as written, an architecture call that fights the
real code — **stop and surface it.** Do not silently deviate.
- contradicts a **PRD** decision (*what/why*) → amend `code-review-prd.md` decisions table.
- contradicts a **TDD** decision (*how*) → amend `code-review-tdd.md` decisions table.
- the plan's **sequencing/outcome** is wrong → amend this plan.
The docs follow reality, deliberately. (This pass already exercised the protocol: TDD B·2 and PRD #5/#12.)

---

## Decisions table

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| PL·1 | **Build order = capability-first** — verify (M1) + contract (M2) first; eval (M3) before tuning (M5). Reconciles PRD #5 ↔ #12; **PRD decisions table amended** to record it (not left silently softened). | user (2026-06-22) | risk+proof first; eval's purpose (rubrics measured, never hand-perfected) preserved | settled |
| PL·2 | **Spikes split across M3a/M3b** — cassette seam + a documented `(model,rubric,userPrompt)` hash key; grader embedding pinned (exact package/model/threshold) | draft | the two unknowns sized separately; portable cassettes need a stated key | proposed |
| PL·3 | **Thin slice (bugs only) at M4** before the full panel | draft | proves the verify-wired pipeline end-to-end on one lens before fan-out | proposed |
| PL·4 | **Cold-reader pass 1 folded in** — added M1 prereqs (fake-runner per-call queue B1; `VerifyAudit` schema B4); re-scoped M2 added-line parsing as new code (B5, TDD corrected); split M3 + synthetic-cassette caveat (S1); expanded M4 verify-wiring sub-steps + diff-threading + post-coordinator `markPreexisting` (S3/S4/S5); made gating harness-global + M6→M2 dep (B3); config slice is review-local (N1); added AC#3/#9/#11/#28 coverage (N2); fixed dep graph (N3) | agent + user | independent cold reader found 5 blockers / 5 should-fixes against the real code; verdict had been "not buildable as written" | applied |
| PL·5 | **Cold-reader pass 2 folded in** — M1 confirmed buildable. Fixed F1 (`meta` stays **open**; `meta.preexisting` read via runtime check, not a narrowed type — aligns with TDD B·3, avoids breaking Phase-5 meta tests); F2 (`markPreexisting` wraps **all five** completed return paths, not just coordinator-OK — else trivial-level pre-existing findings gate, AC#4); F3 (AC#8 no-creds verifiable); F4 (protected-class test matrix); F5 (CLI `runners`-map wiring + phase registration step); F6 (`eval:live` script); F7 (reuse `PhaseReport.level`) | agent + user | pass 2 verified pass-1 fixes hold and found 2 new blockers (one a contradiction the pass-1 revision introduced) + 3 should-fixes; verdict: M1 executable, M2/M4/M6 now corrected | applied |
