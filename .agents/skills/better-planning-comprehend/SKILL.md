---
name: better-planning-comprehend
description: "The better-planning family's during-build comprehension loop — as agents write code, it reconciles what actually landed against the feature's TDD so the human stays the architect instead of drifting out of their own codebase. At each plan-milestone boundary or on demand, it computes the consequential deltas between the code and the TDD, teaches each one layered-zoom on the canvas, and reconciles it — intentional evolution updates the living TDD, real drift is logged to <feature>-drift.md and flagged for fix, an undecided fork becomes a new TDD decision. Use this whenever the human is losing the thread of an agent-built system or wants to re-sync — \"catch me up\", \"what changed since last milestone\", \"am I still across this architecture\", \"did the build drift from the design\", \"reconcile the code with the TDD\" — and at each milestone boundary during a build that has a TDD."
---

# Better Planning · Comprehend (build-time companion)

Comprehension erosion is the quiet failure of agentic coding: the agents write more and more, and
the human — an engineer — loses the mental model of their own system, decision by invisible
decision, until they feel like a spectator to their own codebase. Erosion has two causes: **volume**
(too much code lands to read it all) and **invisible decisions** (agents make reasonable local
architectural calls the human never sees). This skill is the counter-loop. It doesn't re-read
everything; it surfaces only the deltas that *change the architecture*, re-teaches them, and
reconciles them against the design of record — so the human's understanding is *defended against
decay*, not just formed once and left to rot.

This is a companion, not a rung on the ladder — like the canvas, it cuts across the phases. It's
also the **first family skill that operates during the build, not during planning.**

| Phase | Skill | Output |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` |
| ② prd | better-planning-prd | `<x>-prd.md` |
| ③ design | better-planning-design | `<feature>-tdd.md` — the design of record this loop defends |
| ④ plan | better-planning-plan | `<feature>-plan.md` — its milestones are this loop's trigger points |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` |

⊕ **better-planning-comprehend** (this one) runs *after* tasks start landing. It requires a TDD —
without a design of record there is nothing to reconcile against, which is exactly why drift is
invisible in projects that never wrote one. No TDD? Offer **better-planning-design** to create the
anchor first; for a feature already mid-build without one, offer to reconstruct a TDD from the code
as the baseline, then sync forward from there.

## When it runs

Two triggers, both supported:

- **At each milestone boundary** — a plan milestone ends in a verifiable "run X, see Y" outcome;
  that's the natural checkpoint to re-sync on the chunk of architecture that just became real. Offer
  the sync when a milestone's PR merges.
- **On demand** — whenever the human feels drift: "catch me up", "what changed", "am I still across
  this?" Human-paced, no forced cadence.

It reads three things: the **TDD** (the anchor), the **plan's milestone definitions** (to know the
checkpoint), and the **code that landed since the last sync** (git diff from the checkpoint recorded
in the drift ledger, so it knows the exact window).

## The loop — teach + reconcile

When it runs (run the canvas for the walk — see **canvas** for the serving
mechanics; this skill provides the content):

1. **Compute the deltas, filtered to the consequential.** From the diff, keep only changes that
   touch a boundary, a contract, the data model, or a decision in the TDD. Routine within-spec
   implementation is summarized in a line, not walked. *(This filter is the antidote to volume —
   the human's attention goes only where the architecture actually moved.)*
2. **Teach each delta layered-zoom** on the canvas — *system shape* (where it sits) → *boundary*
   (what interface it touched) → *the decision the agent actually made, and why*, inferred from the
   code. *(This is the antidote to invisible decisions — the calls made without the human are made
   visible, in the same grammar the TDD was built in.)*
3. **Reconcile each delta against the TDD**, one at a time:
   - **Intentional evolution** → the human accepts; the **living TDD is updated in place**, rationale
     appended to its decisions table. The design of record stays true.
   - **Drift** (code diverged from a decision the human made, without justification) → logged to the
     drift ledger and **flagged for fix**.
   - **Undecided** (the agent hit a fork the TDD never covered) → it becomes a **new TDD decision,
     made now**, with the same layered-zoom treatment as a design-phase call.
4. **Bump the page; the human watches their model refresh.** Restart the watch for the next delta or
   close the session out.

The output of a sync: the human's mental model refreshed, the TDD still matching reality, and the
drift ledger carrying a running record of every architectural divergence and its disposition.

### Parking what you don't grok

Teaching a delta sometimes exposes a gap the human wants to close properly but *not now* — chasing
"how does RRULE expansion actually work?" mid-sync is the rabbit hole that derails the whole review.
When that happens, offer to park it: append one line to `~/.study/topics.md` (the **study** skill's
queue) with the topic and free-form context — the repo + the file the delta touched, so the eventual
deep dive is grounded in the real code. This is a graceful, optional integration: if `study` isn't
installed, just note the gap in the drift ledger entry instead. Never derail the sync to teach the
concept now; capture it and keep reconciling.

## Drift handling — log + surface, the human decides

When the loop finds real drift, the default is fixed and deliberate: **always log it to the ledger
and always surface it in the session.** The human chooses, per item, between *accept-into-TDD* (it
was a good call — promote it to intentional evolution) and *order-a-fix* (the code should change to
match the design). **Never auto-fix and never auto-accept** — this skill's entire purpose is keeping
the human the decision-maker; a loop that silently resolved drift would re-create the erosion it
exists to stop. It writes no implementation code either: a fix becomes a flagged item the builder
(or a task) picks up, under the plan's reality-disagrees protocol.

The drift ledger format (`assets/drift-ledger-template.md`) and layout conventions live in
`references/doc-layout.md` → Drift ledger.

## Handoff

A sync session ends by recording the checkpoint in the drift ledger ("M2 synced — <date>"), updating
the README status-index `comprehend` row, committing the living-TDD edits and the ledger together,
and stating what's open: the flagged-for-fix items, if any, and the next milestone boundary to sync
at. The loop has no "settled" terminal state — it runs as long as the build does.

## What this skill is not

- Not a code reviewer: it judges *architectural fidelity to the TDD*, not code quality, style, or
  bugs — those belong to review tooling. It asks "did the system's shape change, and did the human
  see it?", not "is this code good?"
- Not the builder or the fixer: it flags drift; it never writes the fix. Surfacing keeps the human
  in the loop; auto-fixing would push them back out.
- Not a full re-read: it deliberately ignores within-spec implementation churn. Surfacing everything
  is the same as surfacing nothing — the filter to consequential deltas is the point.
- Not a planning phase: it produces no plan or spec; it keeps an existing design of record honest
  while the design gets built.
