# Doc Layout & Conventions

Shared by the better-planning family (brainstorm → prd → plan → tasks). The planning space is
namespaced under `docs/better-planning/` so it never clashes with an existing repo's
documentation. Everything the process produces lives here (one exception: the glossary may be
promoted to repo root — see below).

## The tree

```
docs/better-planning/
  README.md                       ← the map: layout, conventions, status index. Maintain it.
  GLOSSARY.md                     ← living vocabulary (see SKILL.md → Vocabulary discipline)
  research/
    <topic>-findings.md           ← evidence: experiments, prior art, user research, POC results
  product/
    <product>-brief.md            ← phase ① output: the alignment record
    <product>-prd.md              ← the high-level PRD (one per product)
    <product>-prd-overview.html   ← its visual companion
    features/
      <feature>/                  ← ALL of a feature's artifacts together
        <feature>-brief.md        ← only when the feature had its own brainstorm
        <feature>-prd.md
        <feature>-prd-overview.html
        <feature>-plan.md
        <feature>-plan-overview.html
        <feature>-tasks.md        ← phase ④ output; canonical even when exported to issues
  archive/
    <superseded-doc>.md           ← retired docs move here; never delete planning history
```

A brief lives next to where its PRD will live: product-level brainstorms in `product/`,
feature-level ones in the feature's directory.

Why group by feature, not by document type: the real access pattern is "everything about
feature X", not "all the plans". One directory is one feature's full paper trail, `git log` on
the directory is the feature's history, and new artifact types (decision notes, schema sketches)
land in the directory without inventing new conventions.

## Naming rules

- Kebab-case, **stem-named** after the feature/product (`harness-prd.md`, not `prd.md`) so a
  file is identifiable out of context (editor tabs, search results, diffs).
- Companions: `<doc-stem>-overview.html`, always next to their doc.
- Signpost files (README, GLOSSARY) are UPPERCASE/standard-case; content docs are lowercase.
- A signpost lives at the root of the scope it governs: the planning README at
  `docs/better-planning/`, and the glossary promoted to repo root only when its terms govern
  code, not just docs.

## Document headers

Every doc opens with a status block — this is what lets a fresh session resume without
re-litigating:

```markdown
**Status:** draft | in-review | settled | superseded — with date.
**Depends on:** <upstream doc + sections>
**Draws on:** <research/evidence docs>
**Companion:** <stem>-overview.html
**Supersedes:** <doc> (if any — move the old one to archive/)
```

## Phase tracking: the README status index

The status index is what lets any skill in the family — or a fresh session — resume without
re-litigating. One row per artifact, grouped by feature:

```markdown
| Artifact | Phase | Status |
|---|---|---|
| product/shelfwise-brief.md | brainstorm | settled 2026-06-06 |
| product/shelfwise-prd.md | prd | in-review |
| features/inventory-sync/inventory-sync-plan.md | plan | draft |
```

Update the index in the same commit as any status change. The index *is* the router: every
family skill reads it on open to know whether to proceed or hand off to a sibling.

## Per-layer content guides

**Brief** (`<x>-brief.md`) — phase ①'s output, the alignment record. Contents: problem
statement; **current state** (brownfield: what's already implemented that this touches, and how
the idea fits the greater scheme; greenfield: say so); decided directions, each with its
rationale (the *why* travels downstream, not just the *what*); the open-question queue, split
into fork-level vs detail; scope instincts (in/out, with why); glossary seeds; links to
evidence. Hard boundary: **no document sections, no
schemas, no acceptance criteria** — the moment structure is needed to express something,
brainstorming is over and the PRD phase takes it from there. Written append-as-you-go: each
landed decision is recorded in the same exchange, so a dead session loses nothing. Settled when
the open queue contains no fork-level questions. Briefs are working docs — no HTML companion.

**Research / findings** (`research/`): what was *learned*, not what is decided. State scope of
confidence explicitly ("this validates X, NOT Y"). End with an "open tensions/decisions"
section — the downstream PRD must resolve every item on it, with traceability.

**High-level PRD** (`product/<product>-prd.md`): vision, problem, design principles, the shape
of the whole (architecture at one diagram's depth), per-feature one-paragraph summaries, scope
cuts (what's deliberately out and *why*), roadmap by risk/proof order, an index of implied
feature PRDs, and a **resolved-decisions table** tracing every open item from research and the
brief to its resolution. Stays high-level: any topic needing schemas or contracts defers to a
feature PRD by name.

**Feature PRD** (`features/<feature>/<feature>-prd.md`): the what and why in depth. The
better-planning-prd skill ships templates (`assets/feature-prd-template.md`,
`assets/product-prd-template.md`) — start drafts from them and stick to the shape; that's what
keeps PRDs comparable across features. A feature PRD is complete only when it has ALL of these
sections — check before calling a draft done:

- [ ] **user stories** — a LONG, numbered list, each as "As a <user>, I want <capability>,
      so that <benefit>". Extremely extensive, covering all aspects of the feature — including
      non-obvious actors (admins, API consumers, agents, operators).
- [ ] requirements / behavior, in depth
- [ ] the contracts/schemas other features consume (flagged at the top if others depend on them)
- [ ] acceptance criteria — testable, numbered
- [ ] **edge cases** — a dedicated section, not semantics scattered through prose. Edge cases
      are where ambiguity hides; a PRD without them reads agreed-upon and ships surprises.
- [ ] deliberately deferred items, with reasons
- [ ] decisions table for calls made at this level (user-made calls distinguished from
      draft-level calls awaiting review)

**Implementation plan** (`features/<feature>/<feature>-plan.md`): the how, derived from a
settled PRD. A plan is complete only when it has ALL of these — check before calling it done:

- [ ] build order with reasoning (risk and proof first, not document order)
- [ ] milestones — each with: goal, ordered steps, files/modules touched, test plan
      (test-first), and a **verifiable outcome** — "run X, see Y" — so done is observable,
      not claimed
- [ ] dependencies between milestones, and what can proceed in parallel
- [ ] a **reality-disagrees protocol** section addressed to the builder: if implementation
      contradicts a PRD decision, stop and surface it — the PRD gets amended and its decisions
      table updated; never silently deviate. This keeps the docs true after building starts.
- [ ] deliberately deferred work, with reasons

A good plan lets someone start coding within minutes of reading it; "go build milestone 1"
should work as a literal next prompt.

**Task breakdown** (`features/<feature>/<feature>-tasks.md`): plan milestones converted into
agent-executable units. One task ≈ one focused agent session. Each task carries: a checkbox and
title; links to the exact PRD/plan sections it implements; files likely touched; its own
acceptance check (how the builder proves it done). The markdown file is canonical even when
exported to an issue tracker — see the tasks skill for the export protocol.

## Conventions that keep the space healthy

- **One concern per doc; link, don't duplicate.** Duplicated facts drift apart silently.
- **Status index in the README** — see Phase tracking above; the index *is* the resume point.
- **Archive, never delete.** Superseded docs are part of the decision record.
- **Decision traceability.** Every "open question" raised anywhere must eventually appear in
  some doc's decisions table as resolved or deliberately deferred. Nothing resolves silently.
- **Claim only what's validated.** Mark inference vs. evidence honestly; a PRD that overstates
  certainty poisons every doc below it.
