# `~/.study/` layout & protocol

The home for `study`. It lives in the user's home dir (not under `~/.claude/`) because the learning
queue is **personal and cross-project** — it outlives any one repo. Everything below is the contract;
other skills and the user write to it by following the format, nothing imports `study`.

## The tree

```
~/.study/
  topics.md                 ← the dumb backlog: one topic per line, no state
  <slug>/                   ← a topic that's been picked up (existence = "started")
    TOPIC.md                ← the seed: topic, why, source/context, started date
    lessons/                ← HTML lessons, ordered NN-<name>.html (canvas-served, or file://)
    resources.md            ← cited sources backing the lessons
    learning-record.md      ← what stuck, what's fuzzy, the done marker
    sandbox/                ← optional toy/example repo, when hands-on helps
```

## `topics.md` — the dumb queue

The single most important rule: **`topics.md` carries no state.** One topic per line. A line is a
bare topic, or a topic followed by free-form context the author chose to type — never a status tag,
date, priority, or any machine-parsable field.

```
how does RRULE expansion actually work
token refresh race in our auth client — taskpilot src/auth/refresh.ts
investing
solving a rubik's cube
```

- **Append-only by convention** for sources; the user may edit it freely by hand.
- **No pattern-matching.** Nothing reads `topics.md` to determine progress — progress is read from
  the filesystem (which `<slug>/` dirs exist, and what their records say). Keeping the queue dumb is
  what lets any tool or human append safely.
- Blank lines and `#` comment lines are ignored, so the user can group/annotate if they want.

## Filesystem as state

| Question | How it's answered |
|---|---|
| Not started yet? | A line in `topics.md` with **no** matching `~/.study/<slug>/` dir. |
| Started / in progress? | `~/.study/<slug>/` exists; its `learning-record.md` is not marked done. |
| Done? | `~/.study/<slug>/learning-record.md` carries a canonical `**Done:** <date>` line. |

To list everything: `topics.md` = not-yet-started, `ls ~/.study/*/` = started-or-done, each dir's
record says which. Never duplicate that state back into the queue.

## Slugs & graduating

When a topic is picked up:

1. **Derive a slug** — kebab-case, from the topic's essential words, short and stable
   (`how does RRULE expansion actually work` → `rrule-expansion`). Drop filler; keep what makes it
   identifiable in a dir listing. On collision with an existing dir for a *different* topic, suffix
   `-2`, `-3`; if the same topic, resume that dir instead.
2. **Scaffold `~/.study/<slug>/`** from the templates (`assets/topic-template.md` →`TOPIC.md`,
   `assets/learning-record-template.md` → `learning-record.md`; create `lessons/`, `resources.md`).
3. **Graduate the line:** remove it from `topics.md` and fold its text + free-form context into
   `TOPIC.md`. The topic now lives in exactly one place — its workspace. The queue shrinks.

Graduating means `study` *edits* `topics.md` (removes a line) — that's correct queue behavior; the
line is relocated, not lost.

## The append contract (for other sources)

Any skill or tool contributing a topic appends **one line** to `~/.study/topics.md` (creating the
file if absent). The line is the human-readable topic; optional free-form context after an em dash or
two spaces is encouraged when it helps grounding (a repo name + path, a URL, a one-clause why). Do
**not** invent status fields, IDs, or front-matter — the dumb-queue rule is the whole reason the
contract stays open. Example a contributor might write:

```
token refresh race in our auth client — taskpilot src/auth/refresh.ts (comprehend, M2 delta)
```

That parenthetical is just human context; `study` reads it as prose when grounding the dive, not as
machine metadata.
