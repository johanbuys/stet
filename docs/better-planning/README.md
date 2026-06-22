# stet Planning Space — Doc Map & Status Index

This is stet's planning space, operated by the **better-planning skill family**
(① brainstorm → ② prd → ③ plan → ④ tasks, with canvas as the review surface). Read this first
if you're picking up the project: the status index below is the router — it tells any session,
human or agent, which phase each piece of work is in and which skill picks it up.

## Documentation layers (write them in this order)

Docs flow broad → specific. Each layer is a separate doc and draws on the one above it:

1. **Research / findings** (`research/`) — what we *learned* (experiments, evaluations,
   discoveries). Not a spec; the evidence base the specs draw on.
2. **Briefs** (`product/<x>-brief.md`, `product/features/<feature>/<feature>-brief.md`) — phase ①
   output: the alignment record. Decided directions with rationale, open-question queue,
   scope instincts. Structure-free; the resume point for everything downstream.
3. **High-level PRD** (`product/stet-prd.md`) — the overall product: vision, principles, the
   shape of the whole tool and its phases. Stays high-level; defers feature depth downward.
4. **Feature PRDs** (`product/features/<feature>/<feature>-prd.md`) — one per feature: the
   *what* and *why* in depth (user stories, requirements, contracts, acceptance criteria,
   edge cases, decisions table).
5. **Implementation plans** (`product/features/<feature>/<feature>-plan.md`) — one per feature:
   the *how* — build order, milestones with verifiable outcomes, test plan (TDD), sequencing.
6. **Task breakdowns** (`product/features/<feature>/<feature>-tasks.md`) — plan milestones as
   agent-executable units; the markdown is canonical even when exported to issues.

```
GLOSSARY.md                                  ← repo root: shared vocabulary for docs AND code [living]
docs/better-planning/
  README.md                                  ← this file (doc map + status index)
  research/
    behavioral-validation-findings.md        ← discoveries from the validation-agent POC
  product/
    stet-brief.md                            ← product-level brief                [to reconstruct]
    stet-prd.md                              ← high-level product PRD             [draft]
    stet-prd-overview.html                   ← its visual companion (review here)
    features/
      <feature>/                             ← ALL of a feature's artifacts, together
        <feature>-brief.md                   ← when the feature had its own brainstorm
        <feature>-prd.md                     ← the feature PRD
        <feature>-prd-overview.html          ← visual companion
        <feature>-plan.md                    ← implementation plan
        <feature>-tasks.md                   ← task breakdown
  archive/
    stet-prd-v1.md                           ← ORIGINAL PRD (historical; superseded)
```

## Conventions

- One concern per doc. Link between layers rather than duplicating.
- Every PRD and plan gets a companion `<stem>-overview.html` next to it — a self-contained
  visual walkthrough (diagrams + open review questions) used for review; the markdown stays the
  source of truth. Briefs are working docs — no HTML companion.
- Use terms as defined in the repo-root `GLOSSARY.md`, and update the glossary **in the same
  PR** that introduces, renames, or sharpens a term.
- Docs are grouped **by feature, not by document type**: everything about a feature — brief,
  PRD, plan, tasks, overviews — lives in `product/features/<feature>/`. Filenames are kebab-case
  and stem-named after the feature (`harness-prd.md`, `harness-plan.md`), so a file is
  identifiable out of context.
- Superseded docs move to `archive/` rather than being deleted.
- Each doc states its **status** and what it supersedes/depends on at the top; update this
  index in the same commit as any status change.
- A doc claims only what's been validated; mark inference vs. evidence honestly.
- Decision traceability: every open question raised anywhere eventually appears in some doc's
  decisions table as resolved or deliberately deferred. Nothing resolves silently.

## Status index

One row per artifact. The **Phase** column routes to the family skill that owns it.

| Artifact | Phase | Status |
|---|---|---|
| `../../GLOSSARY.md` (repo root) | reference | **living** — update in the same PR as term changes |
| `research/behavioral-validation-findings.md` | research | **done** — POC discoveries for behavioral verification |
| `research/cloudflare-ai-review-reference.md` | research | **done** 2026-06-09 — Cloudflare's production AI-review system as a reference impl; validated the coordinator + risk-classifier; fed harness #25–27 / M7.5 |
| `research/code-review-best-practices.md` | research | **done** 2026-06-18 — web-sourced 2024–26 field sweep; the field converged on stet's finder→verify→judge shape; copyable rubric artifacts + the eval methodology (HIT/VALID/NOISE grader, SNR, clean fixtures); feeds the `code-review` PRD |
| `archive/stet-prd-v1.md` | (legacy PRD) | historical — superseded by the fresh high-level PRD |
| `product/stet-brief.md` | brainstorm | **to reconstruct** — product brainstorm (2026-06-05) predates the brief format; rebuild from `stet-prd.md` §12 + decision record |
| `product/stet-prd.md` | prd | **draft** — fresh direction; resolves findings §10 (see its §12) |
| `features/harness/harness-brief.md` | brainstorm | **settled** 2026-06-06 — reconstructed from the PRD decision record + canvas walkthrough; adds the steel-thread direction (harness-only, stub phases) |
| `features/harness/harness-prd.md` | prd | **settled** 2026-06-07, **amended 2026-06-09 ×2** — rounds 1+2 folded in; steel-thread scoping (#24), #20–23 closed, worked examples (§4.10); Cloudflare review added coordinator judge pass (#25), risk classifier (#26), pre-filtering/failback (#27); soundness review opened `PhaseId` (#28), constrained the coordinator (#29–#31), made risk rules per-phase (#32), put stripped paths in the report (#33); **amended 2026-06-19** — agreement-based verify for composite phases (#35, from code-review PRD) |
| `features/harness/harness-plan.md` | plan | **settled** 2026-06-08, **amended 2026-06-09 ×2** — 10 milestones (M1 det. tracer → M2 steel thread → … → **M7.5 coordinator+classifier** → M9); cold-reader review passed; `better-result` (P7); M7.5 (P8/P9); soundness pins (P10: budget layering, pre-M6 model stopgap, explicit stub registration) |
| `features/harness/harness-tasks.md` | tasks | **DONE** 2026-06-21 — all 29 tasks (T1–T29) merged, one PR per milestone (M1→M9 + M7.5, PRs #38–#51); originally exported to GitHub issues #6–#31 + T27–T29 (label `auto-tasks`). Harness built end-to-end and green (721 tests, `vp check` clean). Residual follow-ups tracked below (`bash` sandboxing; issue #48 fixed 2026-06-21). Next product build is the `code-review` feature. |
| `features/behavioral-engine/behavioral-engine-brief.md` | brainstorm | **settled** 2026-06-06 — five fork-level decisions landed (canvas brainstorm) |
| `features/behavioral-engine/behavioral-engine-prd.md` | prd | TODO — drafts from the settled brief |
| `features/code-review/code-review-rubric-draft.md` | prd (pre-work) | **draft 2026-06-18** — concrete starting rubrics (shared preamble + 4 specialists + coordinator) adapted from open artifacts; to be settled against the eval suite. Architecture validated by pressure test + `research/code-review-best-practices.md` |
| `features/code-review/code-review-prd.md` | prd | **settled 2026-06-19** — Phase 3 feature PRD (+ overview.html). Composite specialists → agreement-based verify (harness #35) → constrained coordinator; eval-harness-first build order. All open decisions resolved via canvas review round 1. |
| `features/code-review/code-review-tdd.md` | design | **settled 2026-06-22** — TDD (+ overview.html). Area A (agreement-verify stage) live-walked on canvas, areas B–G drafted then accepted in one review round. Net-new `verify.ts` capability; `Finding` contract evolution (`meta.selfConfidence`, deterministic `meta.preexisting`); eval tiered split (cassettes + live). Spikes: cassette record/replay, embedding-match lib. Next: implementation plan (better-planning-plan) |
| `features/*` (rest) | prd | TODO — deterministic-gates, init, spec-compliance, test-quality, start-service/pty-session, browser-execution, eval-suite |
| `features/github-integration` | brainstorm | **TODO — follow-up feature** (scoped 2026-06-09): a GH Action wrapper + GH-App/webhook bot that *consumes* the harness `RunReport` — posts findings as PR comments, turns PR comments (`break glass`, re-check, scoped review) into harness invocations. **Out of the harness** by the boundary rule (#24); the harness is already CI-ready. Owns re-review awareness. |
| `product/consumers.md` | (parking doc) | **draft 2026-06-18** — catalogs downstream consumers (CI gate, GH App bot, agent loop, local) and parks the GH App design (App-over-Action, sandboxed CLI-subprocess + schema-typed parse, Hono/Redis on a VM, no SDK; SARIF eliminated for private repos). Deferred behind the real phases. |
| `bash` sandboxing | follow-up | **TODO — tracked (harness PRD decision #34, 2026-06-10):** mutation-freedom is enforced for `edit`/`write` at tool registration, but `bash` is an unrestricted residual write surface (the Pi SDK has no read-only bash). Real enforcement (sandbox / read-only mount / `bash` spawn-hook denylist) lands with the **Phase 5 execution** milestone, which builds a controlled exec surface anyway. Surfaced by M2 PR-review. |
| `features/*/*-plan.md` | plan | TODO — one per settled feature PRD |
| `features/*/*-tasks.md` | tasks | TODO — one per settled plan |

## Pointers a fresh session needs

- **The R&D prototype** lives in the sibling repo **`../validation-agent-poc`** (relative to this
  repo). Mine it for the engine/rubric/verdict schema (`src/`), the 14 fixtures + content-aware
  grader (`fixtures/`, `eval/`), the browser provisioning recipe (`tools/provision-browser.sh`,
  `docs/PROVISIONING.md`), and the full walkthrough (`docs/overview.html`).
- **What's validated vs. not:** the POC rigorously informs **behavioral verification (Phase 5) and
  cross-cutting principles** — NOT the static phases 1–4.
- **Open decisions** from `research/behavioral-validation-findings.md` §10 are all **resolved** —
  traceability table in `product/stet-prd.md` §12.
- **Provenance note:** this space was migrated from stet's original `docs/` layout on 2026-06-06
  (same tree shape, new namespace + brief layer). The product- and harness-level brainstorms
  predate the brief format; their briefs are *reconstructions* from the PRD decision records,
  marked as such in their headers.
