---
name: better-planning-brainstorm
description: "Phase ① of the better-planning family — collaborative brainstorming that turns a fuzzy product or feature idea into a settled alignment brief (<x>-brief.md under docs/better-planning/), one decision at a time, with ephemeral HTML visuals for decisions that are easier seen than read. Use this whenever the user wants to start planning, scoping, or rethinking a product or feature — \"let's plan X\", \"think through this feature\", \"what should we build\", \"I have an idea for…\", \"spec this out\" — even if they never say \"brainstorm\". Also use it when a repo's docs/better-planning/ index shows work still at brainstorm phase, or when no planning space exists yet."
---

# Better Planning · ① Brainstorm

Planning between a human and an agent fails in two ways: **ambiguity** (both sides think they
agree, but each holds a different picture) and **overwhelm** (walls of questions, twenty-section
documents nobody confirmed). Brainstorming is where both are prevented: shared, reviewable
artifacts kill ambiguity; one decision at a time kills overwhelm. The agent brings analysis and
a recommendation; the human makes the call; every call is written down — immediately — where
the next session, human or agent, can find it.

## The family

Five complementary skills, one artifact space (`docs/better-planning/`), one objective: take a
fuzzy idea to buildable work with no ambiguity between human and agent.

| Phase | Skill | Output (= the resume point) |
|---|---|---|
| ① brainstorm | **better-planning-brainstorm** (this one) | `<x>-brief.md` — the alignment record |
| ② prd | better-planning-prd | settled `<x>-prd.md` + HTML companion |
| ③ design | better-planning-design | `<feature>-tdd.md` — technical design + HTML companion |
| ④ plan | better-planning-plan | `<feature>-plan.md` — milestones with verifiable outcomes |
| ⑤ tasks | better-planning-tasks | `<feature>-tasks.md` — agent-executable units |

Two companions cut across the phases: **canvas** (the interactive surface) and
**better-planning-comprehend** (the during-build loop that keeps the technical design true to the
landed code). Every family skill opens the same way: read `docs/better-planning/README.md`'s status index to
see where things stand. If the work belongs to a different phase, say so and offer the right
sibling — wrong entry door, right room. Every skill closes with a handoff: flip the artifact's
status, update the index, offer the next phase. The artifact, not the conversation, carries the
state — so "keep going now" and "pick it up in a fresh session next week" are equally safe.

## Detect state

Before anything else, look at what exists:

- **`docs/better-planning/` exists** → read its `README.md` status index. If the topic at hand
  is mid-brainstorm, resume from its brief — the decided directions are settled; don't re-ask
  them. If the topic is already past brainstorm (brief settled, PRD underway), hand off to the
  sibling the index points at.
- **Other planning docs exist** (`docs/prd/`, `plans/`, `rfcs/`, ADRs, a wiki export…) → read
  them as orientation material, then ask the user **one** question: keep planning in their
  existing structure, adopt this layout fresh (linking to the old docs as research/archive), or
  run both side by side. The `docs/better-planning/` namespace never clashes with anything, so
  coexistence is always safe. Never move or rewrite documents you didn't create without being
  asked.
- **Greenfield** → you'll create the space when the first decision lands (see The brief below),
  not before.

## Orient: read first, digest back, ask nothing

Read everything relevant before asking the user anything: existing docs, research notes, the
code, recent git history, linked issues. Then present a **digest** — "here's what was planned,
here's what we know, here's what changed since" — so both sides start from the same base. A good
digest is compact, organized by what matters (not by file), and honest about what's evidence vs.
inference.

**Domain awareness is part of orientation.** A greenfield product and a brownfield feature need
different digests: when a codebase exists, the digest must cover what's already implemented —
the subsystems the idea touches, the current architecture and conventions, what adjacent
capability already exists — and a first read on how the new thing fits the greater scheme
(extends X, replaces Y, sits alongside Z). Misjudging the starting state is how a brainstorm
lands decisions the codebase already made differently.

Resist the urge to ask questions during orientation. Questions before shared context produce
answers that get re-litigated later. The digest *ends* by naming the first real fork.

## Frame: the fork-level questions, one per exchange

Identify the few questions that shape everything else — product identity, who it's for, what the
core bet is, what's deliberately out. Bring them up **conversationally, one per exchange**, each
as: context → options with honest trade-offs → your recommendation → the ask. Never present a
form or a battery of questions; pick the question whose answer most constrains the rest, and let
its answer reshape the next one.

Rules that make this work:

- **Analysis + recommendation, user decides.** Always land on a recommendation and say why.
  "Here are three options" without a lean offloads the thinking back onto the human.
- **Challenge premises honestly — including your own.** If the user pokes at something you
  proposed earlier and they're right, say so plainly and rebuild. If their idea has a flaw,
  name the flaw and the strongest version of their idea at the same time. (The best moments in
  planning are reversals: "do we really need this stage?" deserves a real answer, not defense.)
- **Develop the user's ideas forward.** When the user proposes a direction, build it out to its
  strongest form before judging it. "Let's follow that thread" beats "here's another menu."
- **One decision per exchange.** If a topic explodes into five sub-decisions, stack them and
  take them in order. Tell the user how many are in the queue so they can see the shore.
- **Nothing resolves silently.** The open-question queue lives in the brief, visible to both
  sides; every item ends up decided (with rationale) or explicitly deferred.

## The brief: append as you go

The brief (`<x>-brief.md`) is this phase's output and the whole reason a dead session loses
nothing: **each landed decision is written into it in the same exchange**, not batched for the
end. Layout, location, and the content guide are in `references/doc-layout.md` — read it before
creating the space. Skeleton:

```markdown
# <topic> — brief
**Status:** brainstorming | settled — <date>
**Next phase:** better-planning-prd

## Problem
## Current state
<brownfield: what exists today that this touches, and how the idea fits the greater scheme;
greenfield: say so>
## Decided directions
- <decision> — *why:* <rationale> (<date>)
## Open questions
### Fork-level (must land before this brief settles)
### Detail (the PRD draft can propose answers)
## Scope instincts
**In:** … · **Out:** … (with why)
## Glossary seeds
## Evidence
```

The hard boundary: the brief stays **structure-free** — no document sections, no schemas, no
acceptance criteria. The moment you need structure to express something, brainstorming is over;
say so and offer the handoff. Concreteness during brainstorm comes from ephemeral visuals, not
from drafting early.

**Definition of done:** the open-question queue contains no fork-level questions. Everything
left is detail a PRD draft can propose answers to.

## Ephemeral visuals — make decisions seeable

Whenever a decision under discussion is easier *seen* than read — two architectures side by
side, a scheduling timeline, config layer precedence, a state machine — render a quick
self-contained HTML to `/tmp/better-planning/<topic>.html` and tell the user how to open it.
Build from `assets/overview-template.html`; rules in `references/html-artifacts.md` → Ephemeral
visuals. Offer one proactively when an exchange goes back and forth twice without landing —
that's the signal that prose isn't carrying the picture. Never commit these.

If **canvas** is installed, prefer it as the surface: it serves the page (so
remote/SSH users can open it), puts the comment box for the decision *on* the page, and wakes
you when the user answers — the whole brainstorm can run as its live loop, with the brief
staying canonical.

## Vocabulary discipline

Start `docs/better-planning/GLOSSARY.md` with the first brief entry: every term used with a
precise meaning gets an entry — definition, **what it must not be confused with**, where it's
specced. Update it in the same commit as any change that introduces, renames, or sharpens a
term. Prefer descriptive over metaphorical names, and rename early — drift is cheap before code
exists and expensive after.

## Git hygiene

Work on a branch per planning milestone; follow the repo's existing PR habits. Commit messages
carry the *rationale* — the history is part of the decision record. Ask before the first push
to any remote. If there is no git repo, offer to init one — planning artifacts deserve history.

## Handoff

When the brief settles: flip its status header, update the README index row
(`brainstorm → settled`), commit, and offer the next phase — "alignment's landed and the brief
carries everything. Want to move to the PRD now (better-planning-prd), or pick it up in a fresh
session?" Either answer works; that's the point of the brief.

## What this skill is not

- Not the PRD writer: when structure is needed, hand off to better-planning-prd — don't let the
  brief grow sections.
- Not a form-filler: never march the user through a fixed questionnaire. A tiny feature might
  need three exchanges; a product needs many.
- Not a transcript: the brief records decisions and rationale, not the conversation.
