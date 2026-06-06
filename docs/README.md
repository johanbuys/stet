# stet Documentation Map

How stet's documentation is organized, and the workflow for adding to it. Read this first if
you're picking up the project.

## Documentation layers (write them in this order)

stet's design docs flow from broad to specific. Each layer is a separate doc and draws on the one
above it:

1. **Research / findings** (`docs/research/`) — what we *learned* (experiments, evaluations,
   discoveries). Not a spec; the evidence base the specs draw on.
2. **High-level PRD** (`docs/prd/stet-prd.md`) — the overall product: vision, principles, the
   shape of the whole tool and its phases. Stays high-level; defers feature depth downward.
3. **Feature PRDs** (`docs/prd/features/<feature>.md`) — one per feature: the *what* and *why* for
   that feature in depth (requirements, acceptance criteria, contracts, edge cases).
4. **Implementation plans** (`docs/plans/<feature>-plan.md`) — one per feature: the *how* — the
   build steps, milestones, file/module breakdown, test plan (TDD), sequencing.

```
docs/
  README.md                                  ← this file (doc map + workflow)
  GLOSSARY.md                                ← shared vocabulary: terms, disambiguations [living]
  research/
    behavioral-validation-findings.md        ← discoveries from the validation-agent POC
  prd/
    stet-prd.md                              ← high-level product PRD            [draft]
    stet-prd-overview.html                   ← its visual companion (review here)
    features/
      <feature>.md                           ← one PRD per feature               [harness: draft]
      <feature>-overview.html                ← visual companion per feature PRD
  plans/
    stet-prd-v1.md                           ← ORIGINAL PRD (historical; superseded)
    <feature>-plan.md                        ← one implementation plan per feature [TODO]
```

## Conventions

- One concern per doc. Link between layers rather than duplicating.
- Every PRD gets a companion `<name>-overview.html` next to it — a self-contained visual
  walkthrough (diagrams + open review questions) used for review; the markdown stays the source
  of truth.
- Use terms as defined in `GLOSSARY.md`, and update the glossary **in the same PR** that
  introduces, renames, or sharpens a term.
- Filenames are kebab-case. Feature docs share a stem across layers (e.g.
  `prd/features/start-service.md` ↔ `plans/start-service-plan.md`).
- Each doc states its **status** and what it supersedes/depends on at the top.
- A doc claims only what's been validated; mark inference vs. evidence honestly.

## Current status & index

| Doc | Layer | Status |
|---|---|---|
| `GLOSSARY.md` | reference | **living** — shared vocabulary; update in the same PR as term changes |
| `research/behavioral-validation-findings.md` | research | **done** — POC discoveries for behavioral verification |
| `plans/stet-prd-v1.md` | (legacy PRD) | historical — solid on phases 1–4; Phase 5 deferred/under-specified. To be superseded by the fresh high-level PRD. |
| `prd/stet-prd.md` | high-level PRD | **draft** — fresh direction; resolves findings §10 (see its §12) |
| `prd/features/harness.md` | feature PRD | **draft** — the shared substrate; all other feature PRDs write against its contracts |
| `prd/features/*` (rest) | feature PRDs | TODO — deterministic-gates, init, spec-compliance, code-review, test-quality, behavioral-engine, start-service/pty-session, browser-execution, eval-suite |
| `plans/*-plan.md` | impl plans | TODO — one per feature PRD |

## Pointers a fresh session needs

- **The R&D prototype** lives in the sibling repo **`../validation-agent-poc`** (relative to this
  repo). Mine it for the engine/rubric/verdict schema (`src/`), the 14 fixtures + content-aware
  grader (`fixtures/`, `eval/`), the browser provisioning recipe (`tools/provision-browser.sh`,
  `docs/PROVISIONING.md`), and the full walkthrough (`docs/overview.html`).
- **What's validated vs. not:** the POC rigorously informs **behavioral verification (Phase 5) and
  cross-cutting principles** — NOT the static phases 1–4.
- **Open decisions** to settle while writing the high-level PRD are listed in
  `research/behavioral-validation-findings.md` §10.
