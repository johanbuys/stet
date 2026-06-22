---
name: study
description: A personal, cross-project learning queue and tutor. Capture topics you want to understand deeply into a dumb home-dir backlog (~/.study/topics.md) from anywhere, then on demand run a guided, canvas-driven, recall-checked deep dive on any one of them. Topics can be grounded in your real code, in a sandbox the agent scaffolds, or be purely conceptual ("investing", "solving a rubik's cube"). Use whenever the user wants to learn or understand something deeply, park a rabbit hole for later, or be taught/quizzed — "add X to my study list", "I want to understand Y", "teach me Z", "quiz me on…", "let's do a deep dive", "what's on my study queue", "explain how our <thing> actually works" — and as the place other skills (e.g. better-planning-comprehend) send knowledge gaps. Works standalone; uses the canvas skill for interactive lessons when installed.
---

# Study

Relying on agents to write code (and to answer everything) quietly erodes understanding: the
rabbit holes you'd once have chased — "wait, how *does* RRULE expansion work?" — get skipped to
stay on task, and the gap compounds until you're a spectator to your own systems. `study` is the
counter-habit. It splits learning into two cheap halves: **capture now** (a frictionless backlog of
things worth understanding) and **learn later** (a guided, tested deep dive when you actually have
the time). It's general — code is its strength, not its limit; "investing" and "the Krebs cycle"
belong on the same queue.

## The home: a dumb queue, the filesystem as state

Everything lives under `~/.study/` (full protocol in `references/study-layout.md` — read it before
touching the files):

- **`~/.study/topics.md` is pure backlog** — one topic per line, nothing else. A bare topic, or a
  topic plus free-form context if the author felt like typing it. **No status tags, no dates, no
  machine fields, no parsing.** It stays short and human; anything (including you, by hand) can
  append a line.
- **A topic's state *is* its directory.** No `~/.study/<slug>/` ⇒ not started (just a queue line).
  Directory exists ⇒ picked up. Done ⇒ recorded *inside* the dir (the learning record marks it).
  Read state by looking at the filesystem, never by parsing the queue.
- **Picking a topic up graduates its line out** of `topics.md` into a fresh `~/.study/<slug>/`
  workspace that seeds the dive. The queue shrinks as you act; a topic is never in two places.

## The four verbs

The user's intent maps to one of these — do the one they asked for; don't force a dive when they
only wanted to capture.

### capture — append a line
"Add X to my study list", or a topic surfaced mid-conversation worth parking. Append one line to
`~/.study/topics.md` (create the file on first use). Keep the human's words; attach free-form
context only if it's cheap and useful (e.g. the repo + path the question came from), never machine
tags. Confirm in a sentence; do **not** start teaching. This is the GTD capture — get it out of the
head and move on.

### browse — show the queue, help pick
"What's on my study queue?" Show `topics.md` (and, if asked, the started/finished dirs from
`ls ~/.study/*/`). Help choose what to learn now — by what's quick, what's blocking real work, or
what the user's in the mood for. Recommend one, but it's their call.

### learn — scaffold and run the dive
The user picks a topic (from the queue or fresh). Derive a slug, scaffold `~/.study/<slug>/`, move
the topic line + its context out of `topics.md` into the workspace seed, then run the dive (next
section). If a workspace already exists for the slug, resume from its learning record instead of
starting over.

### record — capture what stuck, mark done
On the way out of a dive (or when the user says they're done), write/append the learning record:
what clicked, what's still fuzzy, the next thing to chase. Marking it done lives **in the dir**, not
the queue. The record is both the retention aid and the resume point for a future session.

## The dive

When a topic is picked, run a **canvas-driven, recall-checked** lesson. Full pedagogy in
`references/teaching.md`; the essentials:

- **Pick the right medium for *this* topic** — `study` is a general tutor, unusually strong at code:
  1. **Existing code** — the topic carries a repo/file pointer (common when it came from
     better-planning-comprehend): teach the concept *through the real implementation*.
  2. **Created or referenced sandbox** — a code topic with no source, or one where hands-on helps:
     scaffold a toy repo in `~/.study/<slug>/sandbox/`, or reference a known canonical repo.
  3. **No code at all** — "investing", "rubik's cube": diagrams, animations, worked scenarios,
     quizzes on the canvas; generic but cited. Never fabricate code for a non-code topic.
- **Lessons live on the canvas** (the standalone `canvas` skill) — served HTML, layered-zoom, with
  **interactive retrieval practice** (quizzes, predict-first), because retention needs *testing*,
  not re-reading. If `canvas` isn't installed, degrade: a `file://` HTML lesson, or a
  terminal-driven dive with verbal recall checks. Never block on the canvas.
- **Cite real sources; don't trust parametric knowledge.** Back lessons with references in the
  workspace's `resources.md` so the user can reach primary sources and you aren't confidently
  teaching something subtly wrong.
- **Aim at the zone of proximal development** — read the learning record (and any prior workspace)
  to pitch the lesson just past what the user already knows, not from zero each time.

## Sources — the line format is the only contract

`study` doesn't own the queue; anything that can append a line is a valid source, no import needed:
the user by hand, `study` itself, and other skills. The highest-value contributor is
**better-planning-comprehend**: when its build-time sync surfaces an architectural delta the human
doesn't grok, it offers to park it here with the repo + path as context — so the rabbit hole is
captured at the moment of friction and chased when there's time. `study` needs none of those skills
to work; they're contributors, not dependencies. (A future background agent can pre-research queued
lines into ready workspaces — the protocol allows it without status tags, since "ready" is just "a
workspace with research exists.")

## What this skill is not

- Not a code reviewer or a builder: a sandbox it scaffolds is a *teaching aid*, not production work;
  it never edits the user's real repos to "fix" something while teaching.
- Not a note dump: the queue is for things to *learn*, not a general TODO. One topic per line; if it
  isn't something to understand, it doesn't belong.
- Not a passive explainer: a dive without retrieval practice is the fluency illusion — it feels like
  learning and isn't. If the user just wants a quick answer, give it; a *dive* means testing.
- Not stateful in the queue: status never goes back into `topics.md`. The filesystem is the record.
