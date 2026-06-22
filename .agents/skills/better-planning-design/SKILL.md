---
name: better-planning-design
description: "Phase ③ of the better-planning family — turn a settled feature PRD into a technical design (a TDD) before the plan — system map, data model, interfaces/contracts, the major architectural decisions with alternatives and rationale, technical risks, NFRs, and stack choices, as <feature>-tdd.md plus an HTML companion under docs/better-planning/. Its defining move is keeping the human the architect — each area is walked layered-zoom (system shape → boundaries → the decision), one consequential decision at a time, so understanding stays high instead of being rubber-stamped. Use this whenever the user wants to design the technical approach, decide architecture, choose a stack, or weigh technical trade-offs before building — \"design the architecture\", \"how should this be built technically\", \"write the technical design\", \"what's the data model\", \"which approach/stack\" — and whenever docs/better-planning/ shows a settled feature PRD without a TDD."
---

# Better Planning · ③ Technical design

The PRD says *what and why*; the plan says *in what order*. Between them sits the *how* at
architecture altitude — the decisions that, left implicit, get made inside an agent's head during
the build and quietly erode the human's grip on their own system. This phase makes them explicit,
deliberate, and **the human's**. Its real product is two things at once: a TDD the plan can build
on, and a human who still understands the architecture they're about to have built.

## The family

Five complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` — the alignment record |
| ② prd | better-planning-prd | settled `<x>-prd.md` + HTML companion |
| ③ design | **better-planning-design** (this one) | `<feature>-tdd.md` — technical design + HTML companion |
| ④ plan | better-planning-plan | `<feature>-plan.md` — milestones with verifiable outcomes |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` — agent-executable units |

Two companions cut across the phases: **canvas** (the interactive surface) and
**better-planning-comprehend** (the during-build loop that reconciles landed code against this TDD
and keeps it living). Every family skill opens by reading `docs/better-planning/README.md`'s status
index; if the work belongs to a different phase, say so and offer the right sibling. Every skill
closes with a handoff: flip the artifact's status, update the index, offer the next phase.

## Pick up from the PRD

A TDD derives from a **settled** feature PRD — designing against a draft bakes its open questions
into the architecture. On open, check the index:

- **PRD settled** → read it fully (and the brief behind it, for rationale), then design.
- **PRD in draft/in-review** → say so and offer better-planning-prd to settle it first. If the user
  wants to proceed, list which open PRD items the design must assume answers to, and mark those
  assumptions in the TDD explicitly.
- **No PRD, fuzzy idea** → that's upstream work; offer the sibling the index points at.

Also read the surrounding code: an architecture that ignores the repo's real structure, frameworks,
and conventions reads plausible and fails on contact. A brownfield design states what already exists
that it builds on or changes.

## The defining move — layered zoom, one decision at a time

This is the family's one-decision-at-a-time discipline applied to architecture, and it's what keeps
comprehension high. Don't dump a finished design for approval — **walk it**, so the human rebuilds
the mental model as they go and owns each call:

1. **The map first.** Lay out the full set of technical areas in one cheap screen — nothing
   invisible. (Seeing the whole shape is itself the antidote to feeling lost.)
2. **Rank by consequence × irreversibility**, not by feature order. Walk the few areas where the
   decision is expensive or hard to reverse (data model, key boundaries, risky integrations) deep;
   mention the rest briefly. The human can pull any area into focus at any time.
3. **For each area, zoom in layers** — *system shape* (where it sits, as a canvas diagram) →
   *boundaries* (the module split and the interfaces between them) → *the decision* (your
   recommendation, the roads not taken, and **why**). The human stops at whatever depth they trust:
   ratify at the system level, or drill into one interface when it matters.
4. **Write the call immediately**, with rationale, into the TDD's decisions table — append-as-you-go,
   so a dead session loses nothing.

You bring the analysis and a recommendation; the human makes the call. Challenge premises including
your own; develop the human's alternative to its strongest form before comparing. Nothing resolves
silently.

## TDD anatomy

The completeness checklist lives in `references/doc-layout.md` → Technical design; check it before
settling. The content set, ranked into the walk above: **system map · data model · key
interfaces/contracts · major decisions (with alternatives + rationale) · technical-risks/unknowns
register · NFRs (perf/security/scale targets) · stack/library choices with rationale · a decisions
table** distinguishing human-made calls from draft-level proposals.

The TDD gets a companion `<feature>-tdd-overview.html` in the same commit (template in `assets/`,
guide in `references/html-artifacts.md`) — the system map and boundaries as CSS-only diagrams, each
major decision as a card with its alternatives visible and the recommendation marked. Review rounds
work exactly as in phase ②: walk items one at a time, batch edits, commit with rationale — served
through **canvas** when it's installed (the layered-zoom walk runs live, works over
SSH).

## Handoff

When the TDD settles: flip its status header, update the README index row, commit, and offer the
next phase — "the technical design is settled; the architecture, data model, and stack are decided.
Want the implementation plan next (better-planning-plan)? It'll cite these decisions instead of
re-making them." The plan consumes the TDD: it sequences and verifies, it doesn't re-decide
structure.

## What this skill is not

- Not the PRD: requirements and scope go back up to better-planning-prd — the TDD never quietly
  answers a what/why question the PRD left open; it only decides *how*.
- Not the plan: build order, milestones, and "run X, see Y" outcomes belong to better-planning-plan.
  The TDD decides structure; the plan decides sequence.
- Not the builder: this skill writes no implementation code. It makes the architecture a deliberate,
  understood, human-owned decision — that's the whole job.
- Not a rubber stamp: a TDD the human nodded through without engaging defeats the point. If they're
  ratifying every layer without pause, slow down and surface the consequential fork they're skipping.
