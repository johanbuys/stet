---
name: better-planning-tasks
description: Phase ④ of the better-planning family — break a settled implementation plan into agent-executable tasks, each self-contained with links back to the exact PRD/plan sections it implements, files likely touched, and its own acceptance check, as <feature>-tasks.md (canonical), optionally exported to GitHub issues under a user-chosen label. Use this whenever the user wants work broken down into executable units — "break this into tasks", "create the tickets", "make GitHub issues for this", "split this up so agents can build it" — and whenever docs/better-planning/ shows a settled plan without a task breakdown.
---

# Better Planning · ④ Task breakdown

The family's definition of done: **"go do task 3" works cold** — an agent (or human) with no
conversation history opens the task, follows its links, builds it, and proves it done with the
task's own acceptance check. This phase converts plan milestones into units of that quality.

## The family

Four complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | better-planning-brainstorm | `<x>-brief.md` — the alignment record |
| ② prd | better-planning-prd | settled `<x>-prd.md` + HTML companion |
| ③ plan | better-planning-plan | `<feature>-plan.md` — milestones with verifiable outcomes |
| ④ tasks | **better-planning-tasks** (this one) | `<feature>-tasks.md` — agent-executable units |

Every family skill opens by reading `docs/better-planning/README.md`'s status index; if the work
belongs to a different phase, say so and offer the right sibling.

## Pick up from the plan

Tasks derive from a **settled** plan — check the index on open. Plan in draft, or no plan?
Offer better-planning-plan. Never invent scope here: if breaking down a milestone reveals work
the plan doesn't cover, that's a plan gap — surface it, fix the plan (and the PRD above it if
needed), then come back. Layout conventions: `references/doc-layout.md`.

## Task anatomy

One task ≈ **one focused agent session** of work. Bigger than that, split it; trivial enough to
be a sentence in another task, merge it. Each task is self-contained:

```markdown
# <feature> — tasks
**Status:** ready | in-progress | done — <date>
**Derived from:** <feature>-plan.md (M1–M3)
**Exported:** GitHub issues, label `<label>` (only if exported)

## M1 — <milestone goal>
- [ ] **T1 · <imperative title>**
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

## GitHub issues export — offer, don't assume

After the tasks file is written, if `gh` is available and the repo has a GitHub remote, offer
the export. If the user takes it:

1. **Prompt for the label** to stamp on every issue in the batch — suggest the feature name as
   the default, but the user picks. The label is what makes the batch findable and filterable
   in the tracker. Create the label if it doesn't exist.
2. One issue per task: title from the task, body carrying the Implements-links, files, and
   acceptance check, plus a link back to `<feature>-tasks.md`.
3. Record the export (label, issue numbers) in the tasks file header.

The markdown file stays **canonical** — the tracker is a view. If they drift, the file wins;
offer to re-sync rather than letting two truths coexist. The skill works fully without the
export; never require GitHub.

## Handoff

When the breakdown is ready: flip the status header, update the README index row, commit. This
is the end of the family's ladder — the handoff is to *building*, which is outside its scope:
"tasks are ready; `<feature>-tasks.md` T1 is the starting point, and each task proves itself
via its accept line."

## What this skill is not

- Not a scoping tool: scope lives in the PRD and plan; this phase only re-shapes settled work.
- Not a project manager: no estimates, no assignees, no sprint ceremonies — those belong to the
  team's tracker and process, not the planning space.
- Not the builder: it ends where execution begins, on purpose.
