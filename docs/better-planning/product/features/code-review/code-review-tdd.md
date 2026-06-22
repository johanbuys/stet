# code-review — TDD (technical design)

**Status:** draft — design walk in progress (area A of A–G), started 2026-06-22
**Depends on:** `code-review-prd.md` (settled) · `features/harness/harness-prd.md` (composite phase, coordinator, classifier, agent runner, Finding schema) · `features/harness/harness-plan.md` (built: M1–M9 + M7.5)
**Draws on:** the built harness in `src/` (`phases/composite.ts`, `phases/coordinator.ts`, `risk/classify.ts`, `schema/finding.ts`, `agent/*`)
**Companion:** `code-review-tdd-overview.html` (written when the walk completes)

> This TDD decides the *how* at architecture altitude. It does **not** re-open PRD what/why
> decisions — those are settled in `code-review-prd.md` §Decisions. It records, per area, the
> structural calls the build would otherwise make silently.

---

## Design areas (ranked by consequence × irreversibility)

| # | Area | Status |
|---|---|---|
| **A** | Agreement-verify stage + pipeline composition (net-new harness capability) | **✅ settled 2026-06-22** |
| **B** | Finding contract evolution (confidence harness-derived, `meta.preexisting`) | **next** |
| **C** | Eval-suite subsystem (milestone 1) | queued |
| D | Specialist panel wiring (rubrics/toolsets/tiers — mostly data) | brief mention |
| E | Risk classifier rules for review | brief mention |
| F | Config slice `phases.review` | brief mention |
| G | Gating integration (`deriveExit` rule) | brief mention |

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

## Decisions table

Human-made calls (canvas walk) vs draft-level proposals awaiting review.

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| A·0 | **Verify is a standalone `verify.ts` harness capability**, called by `composite.run()` between roll-up and coordinator — not folded into the coordinator | user (2026-06-22) | mirrors built composite/coordinator/classify split; independently testable; future phases inherit it | settled |
| A·1 | **Pipeline order = verify-all → coordinator dedups** (PRD-literal); deterministic pre-dedup deferred until the eval measures duplicate rate | user (2026-06-22) | keeps the net-new capability simple & PRD-faithful; cost bounded by MAX_FINDINGS + risk dial; #5 — don't optimize without measurement | settled |
| A·2 | **Voter contract** = `submit_verdict` ternary (uphold/refute/abstain + reason), read-only context toolset, independence via distinct lenses (one runner ×N); **tier (v1) = robust** | user (2026-06-22) | confidence trustworthiness is the point; decision 8 makes voter-tier a *later* dial → start at high baseline; abstain/refute = not-uphold (conservative) | settled |
| A·3 | **Partial voter failure** → retry once, else abstain (absolute threshold kept). **Total verify failure** → raw roll-up, all findings `confidence: low` + `review.verify-degraded` warning, status completed, never gates | user (2026-06-22) | a broken verify must never manufacture a gating signal; low = honest uncorroborated floor; #29 — never forfeit | settled |
| A·4 | **`confidence: high` joins the protected class** (coordinator can't silently drop a 3/3 finding; reinstated + audited). Confidence harness-stamped by id (downgrade impossible); merge keeps highest-confidence id; new separate `audit.verify` block | user (2026-06-22) | agreement is the corroboration currency; dropping a corroborated finding = missed gate, the costliest failure; reuses existing reinstatement + #48 provenance pattern | settled |

---

## Still to fill (design walk in progress)

Data model · key interfaces/contracts · technical risks & unknowns · NFRs · stack/library
choices — populated as areas A–C are walked. This section is removed when the TDD settles.
