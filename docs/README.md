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
  research/
    behavioral-validation-findings.md        ← discoveries from the validation-agent POC
  prd/
    stet-prd.md                              ← high-level product PRD            [TODO]
    features/
      <feature>.md                           ← one PRD per feature               [TODO]
  plans/
    stet-prd-v1.md                           ← ORIGINAL PRD (historical; being superseded)
    <feature>-plan.md                        ← one implementation plan per feature [TODO]
```

## Conventions

- One concern per doc. Link between layers rather than duplicating.
- Filenames are kebab-case. Feature docs share a stem across layers (e.g.
  `prd/features/start-service.md` ↔ `plans/start-service-plan.md`).
- Each doc states its **status** and what it supersedes/depends on at the top.
- A doc claims only what's been validated; mark inference vs. evidence honestly.

## Current status & index

| Doc | Layer | Status |
|---|---|---|
| `research/behavioral-validation-findings.md` | research | **done** — POC discoveries for behavioral verification |
| `plans/stet-prd-v1.md` | (legacy PRD) | historical — solid on phases 1–4; Phase 5 deferred/under-specified. To be superseded by the fresh high-level PRD. |
| `prd/stet-prd.md` | high-level PRD | **next** — fresh, incorporating the findings |
| `prd/features/*` | feature PRDs | TODO — implied features: behavioral-verification engine, `start_service`, `pty_session`, browser execution (agent-browser), eval/regression suite |
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
