---
name: better-planning-tasks
description: "Phase ⑤ of the better-planning family — break a settled implementation plan into agent-executable tasks, each self-contained with links back to the exact PRD/plan sections it implements, files likely touched, and its own acceptance check, as <feature>-tasks.md (canonical), optionally exported to GitHub issues (one batch label) + native GitHub Milestones (one per plan milestone, one PR per milestone). Use this whenever the user wants work broken down into executable units — \"break this into tasks\", \"create the tickets\", \"make GitHub issues for this\", \"split this up so agents can build it\" — and whenever docs/better-planning/ shows a settled plan without a task breakdown."
---

# Better Planning · ⑤ Task breakdown

The family's definition of done: **"go do task 3" works cold** — an agent (or human) with no
conversation history opens the task, follows its links, builds it, and proves it done with the
task's own acceptance check. This phase converts plan milestones into units of that quality.

## The family

Five complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` — the alignment record |
| ② prd | better-planning-prd | settled `<x>-prd.md` + HTML companion |
| ③ design | better-planning-design | `<feature>-tdd.md` — technical design + HTML companion |
| ④ plan | better-planning-plan | `<feature>-plan.md` — milestones with verifiable outcomes |
| ⑤ tasks | **better-planning-tasks** (this one) | `<feature>-tasks.md` — agent-executable units |

Two companions cut across the phases: **canvas** (the interactive surface) and
**better-planning-comprehend** (the during-build loop that keeps the technical design true to the
landed code as these tasks are executed). Every family skill opens by reading
`docs/better-planning/README.md`'s status index; if the work belongs to a different phase, say so
and offer the right sibling.

## Pick up from the plan

Tasks derive from a **settled** plan — check the index on open. Plan in draft, or no plan?
Offer better-planning-plan. Never invent scope here: if breaking down a milestone reveals work
the plan doesn't cover, that's a plan gap — surface it, fix the plan (and the PRD above it if
needed), then come back. Layout conventions: `references/doc-layout.md`.

## One milestone at a time — just-in-time, gated on the revision pass

Break down **only the current milestone**, never the whole plan. The plan's far milestones are
provisional (better-planning-plan), so exploding them all into tasks now produces work that is stale
the moment the first milestone teaches you something — and the sheer volume is what drowns the human
and feeds drift. So the tasks file grows **milestone by milestone**: break M1, build it, then come
back for M2.

**Gated:** before breaking down milestone N (for N past the first), the **revision pass** for
milestone N-1 must already be recorded in the plan — lessons applied, every deferred review item
dispositioned. If it hasn't run, stop and run it first (re-open better-planning-plan at the
boundary). Never explode the next milestone over an un-revised plan: that gate is what keeps
deferred work from getting lost and the arc honest.

A maintenance milestone (`M<n>.5`) — created by the revision pass to batch deferred cleanup — is a
milestone like any other here: break it into tasks, one PR, its own accept lines.

## Task anatomy

One task ≈ **one focused agent session** of work. Bigger than that, split it; trivial enough to
be a sentence in another task, merge it. Each task is self-contained:

```markdown
# <feature> — tasks
**Status:** ready | in-progress | done — <date>
**Derived from:** <feature>-plan.md — M1 (current milestone; tasks grow milestone by milestone)
**Exported:** GitHub issues #<lo>–#<hi>, label `<label>`, milestones per PR (only if exported)

## PR strategy — one PR per milestone, stacked
<the table mapping each PR → its tasks → its merge gate; see PR strategy below>

## M1 — <milestone goal> · PR1
- [ ] **T1 · <imperative title>**  (#<issue>)
  Implements: plan §M1 steps 1–2 · PRD §"occurrence contract"
  Files: `src/schedule/rrule.ts`, `tests/schedule/`
  Accept: `vp test schedule` passes; creating a daily task generates 7 occurrences for the next week
```

What makes each field matter:

- **Implements-links point at exact sections**, not whole docs — they're how a cold agent finds
  the why without reading the entire paper trail.
- **Accept is the task's own verifiable outcome** — a command to run and a thing to observe,
  inherited from the plan's "run X, see Y" discipline. A task without one can be claimed done
  but never proven done.
- **Ordering follows plan dependencies** — group tasks under their milestone; within one, order
  by what unblocks what. Note tasks that can proceed in parallel.

The builder updates the checkboxes and status header as work lands — the tasks file stays the
live record. The plan's reality-disagrees protocol applies during building: contradictions
surface upstream, never get silently absorbed into a task.

## PR strategy — one PR per milestone, stacked

The plan already cut the work into milestones, each ending in a verifiable "run X, see Y"
outcome — and that outcome is *exactly* what makes a coherent, reviewable PR. So the default is
**one PR per milestone**, stacked (M2's branch off M1, etc., following the plan's dependency
order). This isn't inventing process; it's mapping the plan's existing milestone boundaries onto
the tracker. The reasoning, worth stating to the user because the extremes are tempting:

- **All tasks in one PR** — the whole feature in one diff; unreviewable. No.
- **One PR per task** — too granular: a single task is often a red→green step mid-milestone (a
  guard without its runner, a schema without its consumer) that isn't independently meaningful.
  Floods the reviewer with half-built states. No.
- **One PR per milestone** ✓ — coherent, green at the boundary (the milestone's Accept *is* the
  merge gate), and it stacks naturally. Split a milestone's PR only if its diff runs large; note
  the split point in the tasks file.

Record it as a table in the tasks file (PR → its tasks → its merge gate), and note which PRs can
branch in parallel vs. must stack (straight from the plan's dependency section). Don't open a PR
mid-milestone.

## GitHub export — issues + milestones, offer don't assume

After the tasks file is written, if `gh` is available and the repo has a GitHub remote, offer the
export. The tracker mirrors the file's two-level structure with its two native primitives:

- **One label for the whole batch** (`<label>`, user picks — feature name is a good default):
  batch identity, so every task for this effort is findable with one filter. Create it if absent.
- **One native GitHub *Milestone* per plan milestone** — *not* labels. Tasks are one-to-many
  (each task in exactly one milestone), which is precisely what Milestones model and labels
  don't; you also get a free per-milestone progress bar as issues close, and it pairs 1:1 with
  the one-PR-per-milestone strategy. Title each milestone to encode its PR (e.g. `M1 ·
  <goal> (PR1)`).

Export issues for the **current milestone only** — the next milestone's issues are created at its
boundary, after the revision pass. (Creating milestone *placeholders* for the whole arc up front is
fine; creating all the issues now is not — that rebuilds the monster.)

Export steps:

1. Create the label and this milestone (`gh api repos/:owner/:repo/milestones -f title=...`).
2. **Create issues in task order** — so issue number ascends with task order, and
   `sort_by(.number)` *is* the dependency/build order with no extra metadata. One issue per task:
   title from the task, body carrying PR/milestone, Implements-links, files, the Accept line, and
   a link back to `<feature>-tasks.md`. Stamp the label; assign the milestone
   (`gh issue edit <n> --milestone "<title>"`).
3. Record the export in the tasks file header (label, issue range, "milestones per PR") and the
   issue number on each task line.

The markdown file stays **canonical** — issues and milestones are a view. If they drift, the file
wins; offer to re-sync. The skill works fully without the export; never require GitHub.

### Pointing agents at the work

Milestones are the unit you hand to an agent. The shape that holds up:

- **One agent per milestone, not per task.** A milestone is one coherent session + one PR; its
  tasks share scaffolding (the guards build on the runner the same session built), so a per-task
  agent would thrash re-deriving shared context. The agent's brief: "work milestone M<n> in
  order, TDD per each Accept line, open one PR for the milestone, close each issue as it lands,
  and surface anything that contradicts the plan (reality-disagrees protocol)."
- **The query that feeds it** (build order = issue-number order):
  `gh issue list --milestone "<title>" --json number,title,body --jq 'sort_by(.number)'`.
- **Respect the stacking.** Fan parallel agents out *only* across milestones the plan marks
  independent, and only once their shared prerequisite PR has merged — encode each milestone's
  prerequisites in its description so a cold agent sees them without reading the plan.

## Handoff

When the breakdown is ready: flip the status header, update the README index row, commit. This
is the end of the family's *planning* ladder — the handoff is to *building*: "tasks are ready;
`<feature>-tasks.md` T1 is the starting point, and each task proves itself via its accept line."

Building is no longer where the family lets go, though — and this skill no longer hands off the
*whole* breakdown. As the current milestone lands, the **boundary loop** runs:
**better-planning-comprehend** reconciles the code against the TDD (you stay across the
architecture), then the plan's **revision pass** adjusts the arc and dispositions the milestone's
deferred items — and only then do you come back here for the next milestone's tasks. Offer it at the
first boundary: "M1's landed — want to run comprehend + the plan revision before we break down M2?"

## What this skill is not

- Not a scoping tool: scope lives in the PRD and plan; this phase only re-shapes settled work.
- Not a whole-plan exploder: it breaks **one milestone at a time**, gated on the revision pass —
  never the full arc up front.
- Not a project manager: no estimates, no assignees, no sprint ceremonies — those belong to the
  team's tracker and process, not the planning space. (Milestones and PR boundaries are the
  exception that proves the rule: they aren't invented process, they're the plan's own milestone
  structure projected onto the tracker — so they carry no scheduling, only grouping.)
- Not the builder: it ends where execution begins, on purpose.
