---
name: better-planning-plan
description: "Phase ④ of the better-planning family — turn a settled technical design (TDD) and its PRD into an implementation plan with a reasoned build order, milestones that each end in a verifiable \"run X, see Y\" outcome, test-first test plans, and a reality-disagrees protocol, as <feature>-plan.md plus an HTML companion under docs/better-planning/. The plan cites the TDD's architecture decisions instead of re-making them. Use this whenever the user asks how to build something already specced and designed — \"write the implementation plan\", \"how do we build this\", \"plan the build\", \"what's the build order\", \"what are the milestones\" — and whenever docs/better-planning/ shows a settled TDD without a plan."
---

# Better Planning · ④ Implementation plan

The PRD says *what and why*, the TDD says *how* structurally; the plan converts them into
*verifiable, ordered work*. Done right, "go build milestone 1" works as a literal next prompt —
for a human or a coding agent — without coming back to ask what was meant. Most of a plan derives
mechanically from the PRD and TDD; the real decisions are few, and they get the same one-at-a-time
treatment as every other phase.

## The family

Five complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` — the alignment record |
| ② prd | better-planning-prd | settled `<x>-prd.md` + HTML companion |
| ③ design | better-planning-design | `<feature>-tdd.md` — technical design + HTML companion |
| ④ plan | **better-planning-plan** (this one) | `<feature>-plan.md` — milestones with verifiable outcomes |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` — agent-executable units |

Two companions cut across the phases: **canvas** (the interactive surface) and
**better-planning-comprehend** (the during-build loop that keeps the technical design true to the
landed code). Every family skill opens by reading `docs/better-planning/README.md`'s status index; if the work
belongs to a different phase, say so and offer the right sibling. Every skill closes with a
handoff: flip the artifact's status, update the index, offer the next phase.

Every family skill also reads the project's `GLOSSARY.md` — use its terms as the shared vocabulary,
add any term you coin (create the file just-in-time if absent), and don't improvise a name for
something it already names.

## Pick up from the TDD

A plan derives from a **settled** technical design — the TDD already made the architecture, data
model, and stack calls, so the plan sequences and verifies rather than re-deciding structure.
Planning against an undesigned or draft feature bakes open questions into the build order. On open,
check the index:

- **TDD settled** → read it fully — its decisions table, system map, and interfaces are the plan's
  backbone — plus the PRD and brief behind it for the *why*. Then plan, citing TDD sections instead
  of re-making architectural calls.
- **TDD in draft/in-review** → say so and offer better-planning-design to settle it first. If the
  user wants to proceed anyway, list which open design items the plan will have to assume, and mark
  those assumptions in the plan explicitly.
- **No TDD, but a settled PRD** → that's a phase-③ gap; offer better-planning-design. For a small
  feature whose architecture is obvious, the user may choose to skip it — proceed, but capture the
  few structural calls inline as the plan makes them.
- **No PRD at all** → that's upstream work; offer the sibling the index points at.

Also read the surrounding code: a plan that ignores the repo's structure, test setup, and
conventions reads plausible and fails on contact.

## Derive, then decide

Structure derives; judgment calls don't. Architecture is *not* among the calls made here — the TDD
settled the data model, boundaries, and stack, and the plan cites them. What remains are the
sequencing decisions that deserve the one-per-exchange treatment (context → options with trade-offs
→ recommendation → the ask):

- **Milestone boundaries** — what's the smallest first slice that proves the riskiest thing?
- **The v0 cut** — what does the PRD promise that the first build deliberately defers?
- **Test strategy** — what's test-first, what's covered by integration, what's manually
  verified and why that's acceptable.
- **Build order** — risk and proof first, not document order. Recommend one with reasoning.

Everything else — file breakdowns, step sequences within a milestone — propose in the draft and
let review catch disagreements.

## Plan anatomy

The completeness checklist lives in `references/doc-layout.md` → Implementation plan; check it
before calling a draft done. The two parts that make a plan trustworthy:

- **Verifiable outcomes.** Every milestone ends in "run X, see Y" — observable, not claimed.
  A milestone whose outcome can't be demonstrated isn't a milestone; it's hope.
- **The reality-disagrees protocol**, written *into the plan*, addressed to the builder: if
  implementation contradicts a PRD decision, stop and surface it — the PRD gets amended and its
  decisions table updated; never silently deviate. This is what keeps the planning space true
  after building starts: the docs follow reality, deliberately.

The plan gets a companion `<feature>-plan-overview.html` in the same commit (template in
`assets/`, guide in `references/html-artifacts.md`) — milestones as a timeline (the template's
gantt bars), dependencies as lanes, the v0 cut visible. Review rounds work exactly as in phase
②: poke-at items, review capture for async, one item at a time, batch edits, commit with
rationale — served through **canvas** when it's installed (live loop, works
over SSH).

## The rolling horizon — the arc is provisional, revised at each boundary

The plan lays out the **full** milestone arc, so the destination is visible — but only the **next**
milestone is a firm commitment. Everything past it is a sketch, not a contract: building teaches
things the plan can't know yet, so the far milestones *will* change. Mark them provisional in the
plan, explicitly.

What keeps the arc honest is a **revision pass at every milestone boundary** — and it is **gated**:
better-planning-tasks will not break down the next milestone until this pass is recorded. It pairs
with **better-planning-comprehend** — same boundary, two directions:

- comprehend looks back at the **code** — does it still match the TDD? (updates the living design)
- the revision pass looks forward at the **plan** — does the remaining arc still hold? (adjusts it)

### The revision pass (at each boundary, before the next milestone's tasks)

1. **Apply the lessons.** What did the milestone that just landed teach? Re-order, resize, add, or
   drop the provisional milestones to match what you now know.
2. **Disposition every deferred item** from the milestone's review — pull the open follow-up issues
   for the milestone *and* the plan's Carry-forward list. Each item gets exactly one of:
   - **fold into the next milestone** (its tasks absorb it),
   - **batch into an `M<n>.5` maintenance milestone** — a first-class milestone made of deferred
     cleanup, planned and built like any other,
   - **accept as debt** — explicitly, with a reason; it stays tracked, it does not silently vanish.

   (Accept-as-debt matters: without it the gate would force you to schedule everything and you'd
   rebuild the very monster plan this design exists to kill.)
3. **Record it.** Update the milestone arc and the plan's **Carry-forward** section — the live list
   of deferred items and where each one went. Nothing crosses the boundary undispositioned; that is
   the gate's whole job.

## Adversarial review — the cold-reader stress test

The plan's real consumer is an agent (or human) with none of this session's context — so before
the plan settles, test it against exactly that reader. Offer it: "let me have the plan reviewed
cold and fix any issues." Spawn an independent agent with **no session context** — give it only
the repo and the artifact paths (plan, PRD, brief) — instructed to try to *break* the plan:

- steps a cold builder couldn't execute without coming back to ask what was meant,
- milestones whose outcome can't actually be verified as written,
- contradictions with the PRD, or scope the milestones miss,
- dependencies and sequencing that don't hold against the real codebase.

Triage what comes back: fix clear defects directly, bring judgment calls to the user one at a
time, and record material changes in the decisions table. A warm review can't catch
context-dependence — the author's session fills gaps invisibly; the cold reader is the test the
plan must pass, because it's the condition the plan will actually be used under.

## Handoff

When the plan settles: flip its status header, update the README index row, commit, and offer
the next phase — "plan's settled; the full arc is visible but only the first milestone is
committed. Want tasks for the **first milestone** next (better-planning-tasks)? After it lands,
comprehend and the revision pass run at the boundary before the next milestone is broken down."
A small feature with a tight one- or two-milestone plan can go straight to building; anything
larger runs the milestone-at-a-time loop.

## What this skill is not

- Not the spec: requirements questions go back to the PRD (and its skill) — the plan never
  quietly answers a what/why question the PRD left open.
- Not the technical design: architecture, data-model, and stack questions go back to the TDD
  (better-planning-design) — the plan cites those decisions, it doesn't re-open them.
- Not the builder: this skill writes no implementation code. The plan's job is to make starting
  trivially easy, not to start.
