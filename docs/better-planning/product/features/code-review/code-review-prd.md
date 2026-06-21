# code-review — PRD

**Status:** settled — 2026-06-19 (canvas review round 1 resolved all open decisions)
**Depends on:** `product/stet-prd.md` §5 (Phase 3) · `features/harness/harness-prd.md` (composite phase, coordinator/judge, risk classifier, agent runner, Finding/RunReport schema, output-as-tool, budgets, exit-code gating)
**Draws on:** `research/code-review-best-practices.md` (field consensus + copyable artifacts + eval methodology) · `features/code-review/code-review-rubric-draft.md` (the concrete draft rubrics) · the 2026-06-18 live pressure test
**Companion:** `code-review-prd-overview.html`

> **Contracts flagged for downstream consumers:** this feature emits `Finding`s (harness schema) with two
> additions specced here — `meta.preexisting` and **agreement-derived `confidence`**. The
> `github-integration` feature and the `eval-suite` feature consume them. The **review eval format +
> grader contract** (§Contracts) is itself consumed by the eval-suite feature.

---

## Overview

Phase 3 is stet's **general code review**: a *composite* phase that runs a panel of read-only **specialists**
in parallel over the net diff, each emitting `Finding`s, then a **coordinator** that verifies each candidate
(agreement-based) and dedups/ranks before the phase reports. It contributes only rubrics + toolsets + model
tiers; everything structural (parallel fan-out, the coordinator/judge pass, the risk classifier, the agent
runner, the Finding schema, output-as-tool, budgets, gating) is harness machinery that already exists and is
tested. The single most important thing to understand: **review quality is settled empirically by an eval
suite that is built first** — specialist rubrics are *tuned against it*, never hand-perfected. The field has
converged on this exact finder→verify→judge shape, and a live pressure test validated it on real code.

---

## User stories

1. As a **PR author**, I want findings that name a concrete failure scenario, so that I know *why* something is wrong, not just that a tool dislikes it.
2. As a **PR author**, I want each finding located at `file:line`, so that I can jump straight to the problem.
3. As a **PR author**, I want a suggested next action on a finding, so that I know how to address it (stet never edits my code).
4. As a **PR author**, I want findings only about what *this change* introduced, so that I'm not buried in pre-existing debt I didn't touch.
5. As a **PR author**, I want issues that *do* exist in pre-existing code but are re-exposed by my change to be flagged but marked "pre-existing", so that I can see them without them blocking my merge.
6. As a **PR author**, I want the reviewer to stay silent when the change is clean, so that a green review actually means something.
7. As a **PR author**, I want it to *not* flag style/naming/import nits, so that the signal isn't drowned in noise.
8. As a **reviewing human**, I want findings grouped and severity-ranked, so that I read the important ones first.
9. As a **reviewing human**, I want a confidence signal I can trust, so that I can tell a sure bug from a maybe.
10. As a **reviewing human**, I want to see which specialist found each issue, so that I understand the lens it came from.
11. As a **reviewing human**, I want to see what the coordinator dropped and why (audit), so that I trust the filtering instead of fearing it hid something.
12. As a **security-conscious reviewer**, I want a dedicated security lens that knows framework precedents (e.g. trusted env vars), so that I get real exploit paths, not generic "validate input" noise.
13. As an **autonomous agent loop**, I want the findings as structured JSON with `gating[]`, `suggestion`, and `evidence.command`, so that I can fix issues and re-run without scraping prose.
14. As an **autonomous agent loop**, I want the review to be independent of my own claims, so that I can't pass myself by under-reviewing.
15. As a **CI/merge-gate**, I want only high-confidence findings at/above the threshold to gate, so that low-confidence opinions never break the build.
16. As a **GH App bot**, I want findings without a `location` (cross-cutting) clearly distinguished from located ones, so that I can route them to a summary vs inline comments.
17. As a **repo admin**, I want to enable/disable specific specialists in config, so that I can tune the panel to my codebase.
18. As a **repo admin**, I want to set per-specialist or global finding caps and the gating threshold, so that I control volume.
19. As a **repo admin**, I want the reviewer to honor my `CLAUDE.md` conventions and cite the exact rule when it flags a violation, so that convention findings are auditable, not opinion.
20. As a **model-routing operator**, I want specialists and the coordinator to resolve to capability tiers (fast/robust), so that cost scales with stakes.
21. As a **cost-conscious operator**, I want a deterministic risk classifier to scale the panel (and whether the coordinator runs) by the change's size/sensitivity, so that a one-line fix doesn't cost a full audit.
22. As a **cost-conscious operator**, I want large diffs trimmed to a budget with a visible partial-coverage warning, so that cost is bounded and never silently lossy.
23. As a **stet maintainer (rubric author)**, I want to edit a specialist rubric and immediately see precision/recall/SNR impact on the eval suite, so that I tune from evidence, not vibes.
24. As a **stet maintainer**, I want every rubric/model change gated by the eval suite in CI, so that no change ships that degrades review quality.
25. As an **eval/quality owner**, I want clean (bug-free) fixtures alongside buggy ones, so that I measure false-positive rate, not just recall.
26. As an **eval/quality owner**, I want findings graded into HIT / VALID-BUT-UNSEEDED / NOISE, so that a real find I didn't seed isn't punished as a miss.
27. As an **eval/quality owner**, I want the grader itself validated against a human-labeled subset, so that I trust the gate before relying on it.
28. As a **PR author on a huge PR**, I want the review to tell me which files it could not fit in budget, so that I know coverage was partial.
29. As an **operator running without model credentials**, I want the phase to report a clear "no model available" outcome rather than a false clean, so that a green report never means "nothing ran".
30. As a **maintainer**, I want the verify pass to use independent voters and surface confidence from their *agreement*, so that confidence reflects corroboration rather than a model's miscalibrated self-report.
31. As a **PR author whose change is only tests**, I want review's coverage-gaps lens to stay in its lane (the code's testedness) and leave test-quality judgment to Phase 4, so that the two phases don't double-report.
32. As a **downstream `github-integration` author**, I want a stable Finding contract (incl. `meta.preexisting` and agreement confidence), so that my PR-comment mapping doesn't break when rubrics change.

---

## Requirements / behavior

### R1 — Activation
- Phase 3 activates whenever the scope contains a **non-empty code diff** (≥1 changed non-stripped file). It does **not** require a spec (unlike Phase 2/5). A diff of only deleted files still activates (deletions can break callers).
- If, after pre-filtering, no reviewable files remain (all stripped as lockfile/vendored/generated), the phase reports `skipped` with reason `activation: no reviewable files`.

### R2 — Diff scoping (net vs base)
- Review operates on the **net diff against the merge base** (`--against <ref>` three-dot form), never a single historical commit. (Pressure-test lesson: per-commit review surfaces findings later commits already fixed.)
- The diff handed to specialists is the **pre-filtered, budget-trimmed** diff from the harness (lockfiles/minified/vendored/@generated stripped; over-budget files excluded). Specialists may also **read surrounding files** (read-only) for context — the diff anchors, but the enclosing function and direct callers are in scope.
- Over-budget exclusions surface as the harness `review.partial-coverage` warning (no silent truncation).

### R3 — The specialist panel
- **v1 specialist set:** `correctness/bugs`, `security`, `quality` (maintainability **+ performance folded in**), `coverage-gaps`. Each is a parallel, read-only sub-agent with its own rubric, its own context, and a minimally-overlapping read-only toolset (`read`, `grep`, `find`, `ls`, `bash` for inspection only, `submit_findings`). No write tools, by construction.
- Specialists **report broadly** under the shared evidence bar (do not muzzle with "only high severity" — the Opus 4.8 lesson). The shared preamble + per-specialist focuses are specced in `code-review-rubric-draft.md`.
- Severity ceilings: `bugs`/`security` may emit `error`; `quality`/`coverage-gaps` cap at `warning`.

### R4 — Risk classification (the cost dial)
- A deterministic risk classifier (harness, `classify(diff, paths, riskRules)`) evaluates once before fan-out and resolves a **level** → which specialist subset runs and whether the coordinator runs.
- Draft levels: `trivial` (≤ small diff, no sensitive paths) → bugs only, no coordinator; `standard` → bugs + quality + coverage, coordinator on; `full` (large or sensitive paths, e.g. auth/crypto/migrations) → all four + security always, coordinator on. Thresholds are config-overridable and **eval-tuned**.
- Security **always runs** when the diff touches sensitive paths regardless of level (security is never cost-dialed away).

### R5 — Verification & coordination (agreement-based)
- After roll-up, each surviving candidate is **verified by N independent voters** (default **N=3**), each prompted to *refute* the finding from a distinct lens. **Confidence is derived from agreement**, replacing self-reported confidence: `3/3 → high`, `2/3 → medium`, `≤1/3 → dropped`.
- The **coordinator** then dedups, drops convention-contradicted/speculative findings, applies the pre-existing tier, and re-ranks. Its **authority is constrained** (harness contract): it MUST NOT drop or downgrade evidence-backed (`evidence.command`) or deterministic findings; attempts are reinstated. All drops/reinstatements are recorded in `audit.coordinator`.
- If the coordinator/verify step fails, the phase falls back to the raw roll-up + a `coordinator-failed` warning (harness behavior, decision #29) — never forfeits findings.

> **Harness dependency (resolved):** N-voter agreement-verify is a **harness capability**, specced in
> `harness-prd` **decision #35** (amended 2026-06-19) — the harness runs N independent refutation voters
> per candidate and derives confidence from agreement; code-review sets N=3 and supplies the refutation
> lenses. It is **built as code-review's milestone 1** (code-review is the sole driver). Future dials
> (decision 8): N-by-stakes first, voter model tier second.

### R6 — Findings
- Findings use the harness `Finding` schema. Additions: `meta.preexisting: true` for issues not introduced by this diff (re-exposed pre-existing code); such findings are **non-gating** regardless of severity and render in a separate tier.
- `confidence` is **agreement-derived** (R5), not self-reported.
- A finding's `message` must state the problem against what it violates **and** carry its concrete failure scenario; `evidence.command`/`output` when reproducible; `suggestion` when there's a clear next action.
- **Gating stays downstream** (`deriveExit`): a finding gates exit 1 iff `severityAtLeast(severity, failOn)` AND `confidence === high` AND NOT `meta.preexisting`. Specialists never decide gating.

### R7 — Conventions
- Specialists read governing `CLAUDE.md`/convention files and may flag clear violations **only** by quoting the exact rule and the exact offending line. No "spirit of the doc" inferences. Convention findings name the file + rule.

### R8 — Noise control (the precision contract)
- The shared preamble enforces: the **concrete-scenario bar** (no scenario → no finding; prefer not reporting over guessing), the **DO-NOT-FLAG blocklist** (version bumps, import add/remove, unused vars, "use a more specific exception", docstrings/comments, style/naming, restating the diff, generic "add validation", DoS/rate-limiting), **partial-context anti-hallucination** (symbols may be defined elsewhere; don't treat truncation as incomplete; don't claim breakage without the specific call site), and **abstention** (empty list is a valid result).
- Per-specialist finding cap (`MAX_FINDINGS`, default 5, config-overridable); fewer/higher-confidence beats exhaustive.

### R9 — The review eval suite (built first; its own milestone)
- A fixture suite of **diff fixtures** each paired with the findings a good reviewer *should* produce, **plus clean/bug-free fixtures** to measure false-positive rate. Fixtures tagged with severity + a **visibility tier** (in-diff / needs-surrounding-context / cross-file).
- A **content-aware grader** (LLM-judge) buckets each emitted finding into **HIT** (matches a ground-truth defect) / **VALID-BUT-UNSEEDED** (real, not seeded) / **NOISE**; matches candidate↔expected via location gate (±N lines) + embedding similarity, 1-to-1.
- Metrics: **Signal-to-Noise Ratio** = (HIT+VALID)/NOISE (headline), plus precision and recall **per visibility tier**.
- **Gate:** every rubric/model change runs the suite; the change fails if precision or SNR drops vs the prior version (clean fixtures guard FPR). The grader is validated against a human-labeled golden subset (≥0.75 κ) before it's trusted.
- Runs under `vp test` (mirrors the behavioral POC's 14-fixtures+grader discipline).

### R10 — Configuration
- `phases.review` config slice: enable/disable individual specialists; per-specialist + global `MAX_FINDINGS`; risk-rule thresholds; coordinator on/off override; verify voter count `N`; gating threshold inherited from `output.failOn`.
- Model tiers per specialist + coordinator (robust/fast) resolved by harness routing.

---

## Contracts & schemas

> Other features depend on these. Versioned and explicit.

### C1 — Composite phase configuration (consumes harness `CompositePhaseConfig`)
```
review = makeCompositePhase({
  id: "review",
  specialists: [ bugs, security, quality, coverage-gaps ],   // SpecialistConfig[]
  coordinator: { rubric, model: robust, verifyVoters: 3, agreementForHigh: 3, agreementForMedium: 2 },
  riskRules:  RiskRule[],                                     // diff/paths → level
  riskLevels: { trivial: {...}, standard: {...}, full: {...} },
  activation: (ctx) => ctx.scope has ≥1 reviewable file,
})
```

### C2 — SpecialistConfig (per specialist)
`{ id, rubric, toolset (read-only + submit_findings), model (tier), activation?, severityCeiling, maxFindings }`

### C3 — Finding additions (extends harness `Finding`)
- `meta.preexisting?: boolean` — true ⇒ non-gating, separate render tier. **Detection is deterministic** (decision 14): diff-line membership — `location.line` in the diff's added (`+`) hunks ⇒ introduced; otherwise pre-existing. Computed by the harness/coordinator from the diff, never a model judgment; re-exposed code defaults to pre-existing.
- `confidence` — **agreement-derived** (`high` = 3/3 voters, `medium` = 2/3); `≤1/3` ⇒ finding dropped, not emitted.
- `specialist` — set to the emitting specialist id (harness already supports).

### C4 — Coordinator audit (consumes harness `audit.coordinator`)
`{ received, dropped: [{id, specialist?, reason}], reinstated: [{id, specialist?}] }` — unchanged from harness; populated by the review coordinator.

### C5 — Review eval fixture + grader contract (consumed by eval-suite feature)
```
Fixture = {
  id, diff (unified, net-vs-base), baseFiles?,           // the change under review
  expected: Finding-like[] (id, severity, location, gist),
  clean: boolean,                                         // bug-free fixture (FPR guard)
  tier: "in-diff" | "needs-context" | "cross-file",
  sensitivePaths?: boolean,
}
GraderResult = per emitted finding → "HIT" | "VALID" | "NOISE", with matched expected id (if any)
Metrics = { snr, precisionByTier, recallByTier, fprOnClean }
```

### C6 — Gating rule (delegates to harness `deriveExit`)
gates exit 1 iff `severityAtLeast(severity, failOn)` ∧ `confidence === "high"` ∧ `!meta.preexisting`.

---

## Acceptance criteria

1. Running review on a diff with a real bug on a reachable path yields a `bugs` finding with severity `error`, `confidence` derived from ≥2/3 verifier agreement, a `location`, and a concrete scenario in `message`.
2. Running review on a **clean** diff yields zero findings and the phase reports `completed` with an empty findings list (abstention works).
3. Review operates on the net-vs-base diff: a defect introduced in an early commit but fixed in a later commit of the same PR is **not** reported.
4. A finding in pre-existing code re-exposed by the change carries `meta.preexisting: true` and does **not** gate exit 1 even at `error` severity.
5. A `quality` or `coverage-gaps` finding never has severity `error` (ceiling enforced).
6. The coordinator's `audit.coordinator` lists every dropped finding with a reason; an evidence-backed finding the coordinator tried to drop appears in `reinstated`.
7. A finding from a single specialist that fails verification (≤1/3 voters uphold it) is absent from the phase output.
8. With no model credentials, the phase reports a non-clean outcome (`error`/`no model available`), never a false `completed` with empty findings.
9. On a diff exceeding the context budget, the phase emits `review.partial-coverage` (warning) naming excluded files.
10. The DO-NOT-FLAG blocklist holds: a diff that bumps a dependency version and removes an unused import produces **no** findings about those.
11. A convention violation is flagged only with the quoted `CLAUDE.md` rule and the offending line; absent that, it is not flagged.
12. The risk classifier downscales a trivial diff to `bugs`-only with the coordinator off, and upscales a diff touching a sensitive path to the full panel with `security` on.
13. The eval suite runs under `vp test`, reports SNR + precision/recall per tier + FPR on clean fixtures, and **fails the run** when a rubric edit drops precision or SNR below the prior baseline.
14. The grader buckets a real-but-unseeded finding as `VALID` (not `NOISE`, not a missed `HIT`).
15. Findings are emitted only via the `submit_findings` output-as-tool; a specialist that never submits yields a `no-result` warning, not silence.

---

## Edge cases

- **Empty / whitespace-only diff** → phase `skipped` (no reviewable files).
- **Deletion-only diff** → activates; specialists check for broken callers of removed symbols.
- **Rename-only / mode-change diff** → activates but typically abstains; no findings is correct.
- **Diff touches only test files** → review's `coverage-gaps` stays on *code* testedness; the *quality of the tests themselves* is Phase 4 (test-quality), not review — no double-report.
- **Huge diff over budget** → budget-trim + `partial-coverage` warning; specialists review the included subset only.
- **Binary / generated / vendored files** → pre-filtered out by the harness before review sees them (`scope.stripped`).
- **No model credentials / model resolution fails** → phase `error` with reason; deterministic gates (Phase 1) still stand; never a false clean.
- **A specialist times out (budget)** → its findings are lost but other specialists' stand; cost still recorded; phase still completes.
- **Coordinator/verify fails** → fall back to raw roll-up + `coordinator-failed` warning (no forfeiture).
- **Verifier tie / abstentions** (e.g. 1 uphold, 1 refute, 1 abstain) → treated as `≤1/3 high`, below the medium bar → dropped (conservative).
- **All findings pre-existing** → phase `completed`, findings present but all `meta.preexisting`, exit not gated.
- **Conflicting CLAUDE.md rules** (root vs subdir) → most-specific (nearest ancestor) wins; if still ambiguous, do not flag.
- **Root commit / merge commit scope** → handled by harness scope/diff acquisition; review consumes whatever diff it's given.
- **PR-controlled refs containing `-`** → harness scope hardening (option-injection finding from the pressure test); out of review's scope but noted as a cross-cutting dependency.
- **Spec absent** → review runs normally (review needs no spec); only Phase 2/5 care.

---

## Deliberately deferred

- **Structural call-graph / cross-file impact context** — v1 uses agentic file-reading (grep + read enclosing function/callers). A persistent call-graph (Greptile/SCIP-style) is deferred; the eval suite's `cross-file` tier will quantify the gap first.
- **Few-shot examples in rubrics** — the research's top lever, but deferred until eval fixtures exist (draw the examples from real fixtures, not invented ones).
- **A dedicated `patterns`/architecture specialist** — folded into `quality` for v1; revisit if the eval shows a coverage gap the merged lens misses.
- **Performance as a separate specialist** — folded into `quality` for v1; same revisit trigger.
- **Learning from dismissals / re-review dedup** — owned by `github-integration` (it has the cross-push state); review itself stays stateless per run.
- **SARIF output** — product roadmap item; the JSON RunReport is the contract for now.
- **Mineable real-PR fixtures (CR-Bench-style transform of SWE-bench)** — v1 may start with hand-authored + a small mined set; full mining pipeline deferred to the eval-suite feature.

---

## Decisions

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| 1 | **Agreement-based confidence** (N=3 voters; 3/3→high, 2/3→medium, ≤1/3→drop) replaces self-reported | user | self-reported LLM confidence is miscalibrated (research §4); agreement corroborates | settled |
| 2 | **Net-vs-base diff scoping**, never per-commit | user | pressure test: per-commit surfaces already-fixed findings | settled |
| 3 | **`meta.preexisting` tier** — flag re-exposed pre-existing issues, non-gating | user | visibility without blocking on debt the author didn't introduce | settled |
| 4 | **Severity gating stays downstream** (`deriveExit`); specialists report broadly | user | Opus 4.8 lesson — conservative prompts suppress recall; filter, don't muzzle | settled |
| 5 | **Eval-harness-first build order** — eval suite is milestone 1; rubrics tuned against it | user | the field's rubric-settling mechanism; "tweak" needs measurement | settled |
| 6 | **v1 specialist set** = bugs, security, quality (+perf+patterns folded), coverage-gaps | user (2026-06-19) | minimal viable panel; one-prompt-per-defect-family; adding a lens later is one file | settled (eval may split later) |
| 7 | **Performance + patterns folded into `quality`** for v1, not separate specialists | user (2026-06-19) | avoid premature fan-out cost; eval reveals if `quality` misses perf/architecture, split then | settled (eval may split) |
| 8 | **Verify = refute-from-distinct-lens, N=3 uniform** for v1; future dials in order: (1) **N-by-stakes** (bugs/security 3, quality/coverage 1), (2) voter model tier | user (2026-06-19) | perspective-diverse verify; uniform N keeps "high" meaning constant in v1; dials deferred until needed | settled |
| 9 | **Security never cost-dialed away** when sensitive paths are touched | user (2026-06-19) | security misses are the costliest; small marginal cost | settled |
| 10 | **Review requires no spec** (activates on diff alone) | user (2026-06-19) | review judges the code; intent-checking is Phase 2 | settled |
| 11 | **coverage-gaps vs test-quality — the rule:** coverage-gaps fires only when *no* meaningful test touches the behavior; once any test exists for it (even weak), it is test-quality's call | user (2026-06-19) | clean non-overlapping line — *no test → coverage-gaps; test exists but weak → test-quality* | settled |
| 12 | **Agreement-verify is a harness capability — harness-prd amended now (decision #35);** built as code-review's milestone 1 (code-review is the sole driver) | user (2026-06-19) | mechanism belongs to the harness so future phases inherit it; the build folds into our effort | settled (→ harness-prd #35) |
| 13 | **Eval grader taxonomy = HIT / VALID / NOISE**, location+embedding match, SNR headline | user (2026-06-19) | CR-Bench/SWE-PRBench consensus; VALID bucket avoids punishing real unseeded finds | settled |
| 14 | **Pre-existing detection is deterministic** — diff-line membership (location in added `+` hunks → introduced; else pre-existing), computed by the harness, not the model; re-exposed code (added line calling a pre-existing bug) defaults to pre-existing | user (2026-06-19) | models are unreliable at "did this diff introduce it"; deterministic = reproducible; matches stet's ethos | settled |
| 15 | **Eval fixtures v1 = hand-authored** (visibility tiers + clean) **+ a handful mined** from public sets (SWE-PRBench, CR-Bench, Sphinx clean, SEC-bench/DebugBench), licenses checked; full mining pipeline deferred to the eval-suite feature | user (2026-06-19) | start fast with real signal without building the pipeline now | settled |

<!-- Open draft-level decisions (6–13) are the "things to poke at" for the review round. -->
</content>
