---
name: better-planning-prd
description: "Phase ② of the better-planning family — write and settle PRDs (high-level product PRDs and per-feature PRDs) from a settled brainstorm brief, each with a self-contained HTML visual companion, review rounds with built-in review capture, and full decision traceability under docs/better-planning/. Use this whenever the user wants to write, draft, review, or revise a PRD, spec, or design doc — \"write the PRD\", \"draft the spec\", \"let's review the draft\", \"formalize what we discussed\" — and whenever docs/better-planning/ contains a settled brief awaiting its PRD or a PRD in draft/in-review."
---

# Better Planning · ② PRD

A draft is a *proposal*: it makes the remaining open questions concrete instead of abstract.
This phase turns the alignment reached in brainstorming into documents that claim only what's
decided or evidenced — reviewed visually, settled through one-item-at-a-time rounds, with every
decision traceable to where it was made.

## The family

Five complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` — the alignment record |
| ② prd | **better-planning-prd** (this one) | settled `<x>-prd.md` + HTML companion |
| ③ design | better-planning-design | `<feature>-tdd.md` — technical design + HTML companion |
| ④ plan | better-planning-plan | `<feature>-plan.md` — milestones with verifiable outcomes |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` — agent-executable units |

Two companions cut across the phases: **canvas** (the interactive surface) and
**better-planning-comprehend** (the during-build loop that keeps the technical design true to the
landed code). Every family skill opens by reading `docs/better-planning/README.md`'s status index; if the work
belongs to a different phase, say so and offer the right sibling. Every skill closes with a
handoff: flip the artifact's status, update the index, offer the next phase.

## Pick up from the brief

The brief is written *for* this skill. On open:

- **Settled brief exists** → its decided directions seed the PRD's decisions table verbatim,
  marked as brainstorm-made calls — never re-litigate them. Its detail-level open questions
  become the draft's "things to poke at". Its glossary seeds become glossary entries.
- **Brief exists but isn't settled** (fork-level questions still open) → say so and offer
  better-planning-brainstorm to land them first.
- **No brief, but the user arrives with clear decisions** ("I've already decided X, Y, Z —
  draft it") → don't force the ladder. Record their calls directly into the decisions table as
  user-made and draft from there; the ladder serves alignment, and they've brought it.
- **No brief, no decisions, fuzzy idea** → that's brainstorm-phase work; offer the sibling.

If `docs/better-planning/` doesn't exist yet, read `references/doc-layout.md` and create it with
the first draft.

## Draft: the document plus its companion, in one move

When drafting was the stated goal, draft — don't ask permission to start.

- **Start from the templates**: `assets/feature-prd-template.md` and
  `assets/product-prd-template.md` carry the standard section set — sticking to the shape is
  what keeps PRDs comparable across features and reviewable by anyone who learned it once.
- The **user stories** section is load-bearing: a LONG, numbered list, each "As a <user>, I
  want <capability>, so that <benefit>" — extremely extensive, covering all aspects of the
  feature including non-obvious actors (admins, API consumers, agents). If a requirement has
  no story, add the story or question the requirement.
- Layout, naming, per-layer content guides, and the **feature-PRD completeness checklist**
  (user stories, requirements, contracts, acceptance criteria, edge cases, deferrals, decisions
  table): `references/doc-layout.md`. Check the checklist before calling a draft done — edge
  cases are where ambiguity hides.
- Each layer stays at its own altitude: the high-level PRD defers schemas and contracts to
  feature PRDs by name; feature PRDs defer build mechanics to plans.
- Every PRD gets a companion `<stem>-overview.html` **in the same commit** — a self-contained
  visual walkthrough the human reviews instead of the markdown. Build from
  `assets/overview-template.html`; authoring guide in `references/html-artifacts.md`.
- The companion ends with a **"things to poke at"** section: the open questions the draft
  answers implicitly or defers — written *for* the reviewer, to focus the next round.
- Documents claim only what's decided or evidenced; mark inference as inference. The decisions
  table traces every call (open question → resolution → where), distinguishing user-made calls
  from draft-level proposals awaiting review.

## Review rounds: resolve, batch, commit

The human reviews the HTML companion and comes back with reactions — or you walk the "things to
poke at" list together, **one item at a time**: context → options with trade-offs → your
recommendation → the ask. The collaboration rules from brainstorming apply unchanged: analysis +
recommendation with the user deciding, challenge premises including your own, develop the
user's ideas to their strongest form, nothing resolves silently.

For asynchronous review, the companion doubles as the feedback instrument: its poke-at items
carry comment boxes and an "Export review" button that downloads `<stem>-feedback.json`, which
you then walk through item by item (see `references/html-artifacts.md` → Review capture). If
**canvas** is installed, serve the companion through it instead — comments post
straight back, you wake on submit, and the page reloads after each resolved round; no
export-download dance, and it works over SSH.

After a round resolves: batch-apply the edits to the markdown *and* regenerate the affected
companion sections, update the decisions table, commit with the rationale in the message. Then
surface what's still open. Repeat until everything is resolved or deliberately deferred (say
which).

## Descend a layer

A settled high-level PRD implies a feature list; each feature gets its own PRD (same process at
feature altitude — a feature complex enough to need its own brainstorm gets one). Recommend an
order with reasoning — risk and proof first, not document order. One feature doc at a time:
finish and review before starting the next, unless the user asks for parallel drafts.

When a decision under live discussion is easier seen than read, render an ephemeral visual to
`/tmp/better-planning/<topic>.html` (rules in `references/html-artifacts.md`) — offer one
proactively when an exchange goes back and forth twice without landing.

## Vocabulary discipline

Maintain `docs/better-planning/GLOSSARY.md`: every term used with a precise meaning gets an
entry — definition, **what it must not be confused with**, where it's specced — updated in the
same commit as the change that touches the term. If the vocabulary starts governing code
(schema fields, CLI flags), offer to promote the glossary to the repo root as a signpost file.

## Git hygiene

Branch per planning milestone; follow the repo's PR habits. Commit messages carry the
*rationale*. Ask before the first push to any remote; after that, follow the established rhythm.

## Handoff

When a PRD settles: flip its status header, update the README index row, commit, and offer the
next phase — "this feature PRD is settled. Want the technical design next (better-planning-design)?
It decides the architecture, data model, and stack before the plan sequences the build." For a
settled high-level PRD, the natural next step is usually the first feature PRD, not a design or
plan — descend a layer first.

## What this skill is not

- Not the brainstorm: fork-level uncertainty goes back to better-planning-brainstorm.
- Not the technical design: architecture, data model, interfaces, and stack belong to
  better-planning-design; the PRD states *what and why*, never *how*.
- Not the plan: build steps, milestones, and sequencing belong to better-planning-plan.
- Not append-only paperwork: superseded docs move to `archive/`, the README index always
  reflects reality, and a doc that no longer matches a decision is a bug to fix immediately.
