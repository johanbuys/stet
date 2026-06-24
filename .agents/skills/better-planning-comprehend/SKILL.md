---
name: better-planning-comprehend
description: "The better-planning family's during-build comprehension loop — as agents write code, it keeps the human holding the shape of their own system instead of drifting out of it. At each plan-milestone boundary (or on demand) it refreshes the system's shape — the handful of concepts and how they connect — shows where that shape moved and where it grew more complex, has the human recall the key change before revealing it, then reconciles each move against the design of record (the TDD) — intentional change updates the living TDD, real drift is logged and flagged for fix, an undecided fork becomes a new decision. Light by default; pass `full` for a deeper catch-up after time away. Use it whenever the human is losing the thread of an agent-built system or wants to re-sync — \"catch me up\", \"what changed since last milestone\", \"am I still across this\", \"did the build drift from the design\", \"I've been away, get me back across the project\"."
---

# Better Planning · Comprehend (build-time companion)

The quiet failure of agentic coding: the agents write more and more code, and you lose your grip on
your own system — not all at once, but one unseen decision at a time, until you feel like a spectator
to your own codebase. Two things cause it: there's **too much code** to read it all, and the agents
make **architectural calls you never see**. This skill is the counter-loop. It doesn't re-read
everything. It refreshes the **shape** of your system — the handful of concepts and how they fit —
shows you where that shape moved and where it grew more complex, and makes you reconcile each move
against your design. So you keep holding the system, instead of watching it drift away from the
simple idea you started with.

It's a companion, not a step on the ladder — like the canvas, it cuts across the phases, and it's the
one family skill that runs *during* the build, not during planning.

| Phase | Skill | Output |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` |
| ② prd | better-planning-prd | `<x>-prd.md` |
| ③ design | better-planning-design | `<feature>-tdd.md` — the design of record this loop defends |
| ④ plan | better-planning-plan | `<feature>-plan.md` — its milestones are this loop's trigger points |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` |

⊕ **better-planning-comprehend** (this one) runs *after* tasks start landing. It needs a TDD — with
no design of record there's nothing to reconcile against, which is exactly why drift is invisible in
projects that never wrote one. No TDD? Offer **better-planning-design** to create the anchor first;
for a feature already mid-build without one, offer to reconstruct a TDD from the code as the
baseline, then sync forward from there.

## When it runs

- **At each milestone boundary** — a plan milestone ends in a "run X, see Y" outcome; that's the
  natural point to re-grasp the chunk of system that just became real. Offer the sync when a
  milestone's PR merges. This is the **light** default.
- **On demand** — whenever you feel drift: "catch me up", "what changed", "am I still across this?"
- **Deeper catch-up (`full`)** — pass `full` when you've been away from the project and need to
  rebuild the whole picture, not just the latest move. Same loop, fuller recall (below).

It reads three things: the **TDD** (your design of record — the anchor), the **plan's milestones**
(to know the checkpoint), and the **code that landed since the last sync** (the git diff from the
checkpoint in the drift ledger, so it knows the exact window).

## The loop — refresh the shape, then reconcile what moved

Run the canvas for the walk (see **canvas** for the serving mechanics; this skill provides the
content):

1. **Refresh the shape first.** Show the system as its handful of concepts and how they connect — the
   top level of the TDD's system map, not its detail. You re-grasp the *whole* before any single
   change. This is the part the old loop skipped, and it's why a change-by-change walk feels too low
   to follow.
2. **Show what moved — on the shape.** From the diff, keep only the changes that touch a concept, a
   boundary, a contract, or a TDD decision; summarize routine within-spec work in a line, don't walk
   it. Frame each kept change as a *move on the map* — "the coordinator grew a responsibility", "a new
   concept appeared between X and Y" — not a flat list of diffs. **Call out complexity growth
   plainly:** a new concept, or one that ballooned past its original job. That's the "did my simple
   idea get complex?" check, run every time.
3. **Recall before reveal.** For the key move, ask the human to say what they think changed *before*
   showing them. Holding the system means being able to reconstruct it, not just nod at it.
4. **Reconcile each move against the TDD**, one at a time:
   - **Intentional** → the human accepts; the **living TDD is updated in place**, rationale appended
     to its decisions table.
   - **Drift** (code diverged from a decision the human made, with no justification) → logged to the
     drift ledger and **flagged for fix**.
   - **Undecided** (a fork the TDD never covered) → it becomes a **new TDD decision, made now**.
5. **Explain it back, then close.** Before ending, have the human state the refreshed shape in a
   sentence or two — what the system is now, and what moved. That read-back is the proof they're
   holding it again, not just that they watched. Then record the checkpoint and pick up at the next
   boundary.

The output of a sync: your mental model refreshed, the TDD still matching reality, and the drift
ledger carrying a record of every divergence and what you decided about it.

**Light vs `full`.** Light (the default, right after a milestone) does the recall on the single key
move and the closing read-back — enough to confirm you're current without turning every boundary into
a quiz. `full` (when you've been away) does the recall across all the consequential moves and asks for
a fuller read-back of the whole shape — a real catch-up on the project.

### Parking what you don't grok

A move sometimes exposes something you want to understand properly but not right now — chasing "how
does RRULE expansion actually work?" mid-sync is the rabbit hole that derails the review. Offer to
park it: append one line to `~/.study/topics.md` (the **study** skill's queue) with the topic and
context — the repo and the file the move touched, so the eventual deep dive is grounded in real code.
If `study` isn't installed, note the gap in the drift ledger instead. Never stop to teach the concept
now; capture it and keep going.

## Drift handling — log + surface, you decide

When the loop finds real drift, the rule is fixed: **always log it to the ledger and always surface
it in the session.** You choose, per item, between **accept-into-TDD** (it was a good call — promote
it to intentional change) and **order-a-fix** (the code should change to match the design). **Never
auto-fix and never auto-accept** — this skill exists to keep you the decision-maker; a loop that
silently resolved drift would re-create the erosion it's there to stop. It writes no code either: a
fix becomes a flagged item the builder (or a task) picks up, under the plan's reality-disagrees
protocol.

The drift ledger format (`assets/drift-ledger-template.md`) and layout conventions live in
`references/doc-layout.md` → Drift ledger.

## Handoff

A sync ends by recording the checkpoint in the drift ledger ("M2 synced — <date>"), updating the
README status-index `comprehend` row, committing the living-TDD edits and the ledger together, and
stating what's open: the flagged fixes, if any, and the next milestone to sync at. The loop has no
"done" state — it runs as long as the build does.

## What this skill is not

- Not a code reviewer: it judges *whether the system's shape stayed true to the TDD*, not code
  quality, style, or bugs — those belong to review tooling. It asks "did the shape change, and did
  you see it?", not "is this code good?"
- Not the builder or the fixer: it flags drift; it never writes the fix. Surfacing keeps you in the
  loop; auto-fixing would push you back out.
- Not a full re-read: it ignores within-spec implementation churn on purpose. Surfacing everything is
  the same as surfacing nothing — keeping to the moves that change the shape is the point.
- Not a planning phase: it produces no plan or spec; it keeps an existing design of record honest
  while the design gets built.
