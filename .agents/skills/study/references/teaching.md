# Teaching — how the dive works

The goal of a dive is **storage strength**: understanding that survives, not a session that *feels*
productive. Re-reading and nodding along is the fluency illusion — it reads as learning and leaves
nothing. So a dive is built around testing, grounding, and citation, pitched just past what the user
already knows.

## Pick the medium for the topic

`study` is a general tutor; choose how to teach *this* topic rather than defaulting to one mode.
Modes are mixable.

1. **Existing code** — the topic carries a repo/file pointer (common when it came from
   better-planning-comprehend, or when the user names a system). Teach the concept *through the real
   implementation*: open the actual files, trace the actual call, and explain the general principle
   where it lives in their code. This is the anti-de-skilling case — "understand the thing you've
   been relying on."
2. **Created or referenced sandbox** — the topic is code-shaped but has no source in front of you,
   or hands-on practice would cement it. Scaffold a *minimal* toy in `~/.study/<slug>/sandbox/` (the
   smallest runnable thing that exhibits the idea), or point at a known canonical repo/example. The
   sandbox is a teaching aid — keep it tiny and disposable.
3. **No code at all** — conceptual topics ("investing", "rubik's cube", "the Krebs cycle"). Teach
   with diagrams, animations, worked scenarios, and quizzes on the canvas. **Never fabricate code**
   for a non-code topic to look technical.

## Retrieval practice — the core mechanism

A dive *tests*, it doesn't just present. Weave active recall throughout:

- **Predict-first.** Before revealing an answer, ask the user to predict — "what do you think happens
  when two refreshes race?" — then show where their model matched or missed. The gap is the lesson.
- **Quizzes with care.** Short retrieval checks after each chunk. Match answer lengths/formats so the
  shape of an option doesn't leak the answer. Prefer "why/what-happens-if" over recall-the-term.
- **Space and interleave.** Across a multi-session topic, revisit earlier points instead of marching
  linearly — return to M1's idea while teaching M3's. The learning record tracks what to resurface.
- **Make it interactive on the canvas** — a predicted answer typed into a box, a quiz scored live, a
  diagram the user manipulates beats a paragraph they skim.

## Cite sources; don't trust parametric knowledge

Lessons are backed by **real references**, recorded in the workspace's `resources.md`. Cite primary
sources (specs, papers, authoritative docs, the actual library source) so (a) the user can go deeper
than the lesson and (b) you are not confidently teaching something subtly wrong from memory. When a
claim is your inference rather than something a source backs, say so. A lesson littered with
citations is more trustworthy and more useful as a later reference.

## Pitch at the zone of proximal development

Don't teach from zero every time. On `learn`, read `TOPIC.md` and any existing `learning-record.md`
(and prior related workspaces) to gauge what the user already holds, then aim the lesson just past
it — challenging enough to require thought, not so far that it's noise. A returning session resumes
from the record, not the beginning.

## The learning record

`learning-record.md` is the durable output of a dive — append to it as you go and on the way out:

- **What clicked** — the ideas that landed, in the user's framing where possible.
- **Still fuzzy** — what to revisit; this seeds spacing and the next session's ZPD.
- **Threads** — adjacent topics worth their own queue line (offer to capture them).
- **Done marker** — when the user is satisfied, stamp `**Done:** <date>`; that, in the dir, is what
  marks the topic finished. Nothing goes back to `topics.md`.

Keep lessons (`lessons/*.html`) beautiful and self-contained enough to revisit as reference later —
the same design language as the rest of the stack (`references/html-artifacts.md`,
`assets/overview-template.html`).
