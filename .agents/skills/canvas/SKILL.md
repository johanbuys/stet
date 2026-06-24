---
name: canvas
description: "An interactive surface for agents — present any explanation, design, decision, lesson, or review as a served HTML page with comment boxes on every section, and run a live loop where the user submits feedback in the browser, the agent wakes automatically, responds or regenerates, and the page reloads itself. It also ships a diagram kit that draws a clean concept map / architecture / flow from a node-and-arrow scene, with a live legend toggling parts on and off. Use this whenever the user wants to review, learn, or brainstorm visually, or to draw a diagram of a system's shape — \"put this on a canvas\", \"make a review page\", \"let me comment on each part\", \"host the html\", \"quiz me\", \"show me\", \"diagram this\", \"draw the concept map\" — whenever an HTML artifact must be viewed from another machine (SSH/remote sessions where file:// is unreachable), and as the preferred surface for the better-planning family's review rounds and walkthroughs and for study's interactive lessons when it's installed."
---

# Canvas

A wall of terminal text is a bad review surface, and over SSH even a beautiful HTML file is
unreachable. The canvas fixes both: the page is *served* (any machine on the network can open
it), the input lives *on the page* next to the thing being discussed, and the loop is *live* —
submit wakes the agent, the agent acts, the page redraws. It turns "read my summary, then type
your reactions back" into "look at it, comment where it's wrong, watch it update."

This is shared infrastructure, not a phase — a surface several skills sit on. In the
**better-planning** family: brainstorm runs its one-decision-at-a-time loop on it, prd and plan
serve their companions through it for review rounds, **design** walks the TDD layered-zoom
(system shape → boundaries → decision) on it, and **comprehend** walks the code-vs-TDD deltas on
it during the build. **study** serves its interactive, recall-checked lessons on it. And it's
just as useful standalone — explaining an architecture, walking a diff, comparing options,
running a quiz — anywhere "let me show you" beats "let me tell you."

## The mechanics

One server script, one workspace dir, two JS blocks. Copy-paste canonical patterns live in
`references/canvas-pages.md` — read it before your first page.

1. **Workspace**: `/tmp/better-planning/canvas/<topic>/` — the page (`<topic>.html`),
   `version.json` (`{"v": 1}`), and a `feedback/` dir the server creates. Ephemeral: canvas
   pages are never committed; durable content gets folded into the real artifacts (brief,
   companion) when the session ends. **For multi-round pages, the page is a one-time copy of
   `assets/brainstorm-template.html` and each round you write only `state.json`** — never
   regenerate the markup per round (token waste, measured ~80%); see
   `references/canvas-pages.md` → The brainstorm template.
2. **Serve**: `python3 <skill-dir>/scripts/canvas_server.py --dir <workspace> --port 3119 &`
   (check the port is free first; any port works). It serves the dir on `0.0.0.0` and accepts
   `POST /feedback`, writing `feedback/<doc>-feedback.json` + a timestamped archive + a wake
   marker `feedback/<doc>.new`.
3. **Tell the user the URL** — a reachable one: prefer `tailscale ip -4` if present, else
   `hostname -I`; `localhost` only when they're on the same machine. Include the filename.
4. **Listen**: start a background watch —
   `until [ -f <workspace>/feedback/<doc>.new ]; do sleep 2; done` — so the submit itself wakes
   you. No polling, no "tell me when you're done."
5. **On wake**: delete the marker, read the latest feedback, act on it, regenerate the page,
   bump `version.json` — the user's browser reloads within seconds. Restart the watch.
6. **Done**: kill the server, fold anything durable into committed artifacts, leave the
   feedback archives in place (they're the round-by-round record until the dir is cleaned).

If backgrounding isn't available in the environment, degrade gracefully: same page, same
server, and the user says "done" when they've submitted. If no server can run at all, fall back
to the better-planning family's `file://` review capture (export-download), described in `html-artifacts.md`.

## The live brainstorm loop

The canvas's strongest mode, pairing with better-planning-brainstorm: the page shows **one
decision** — context, options as side-by-side cards with trade-offs on the page, your
recommendation marked, one comment box. Above it, the decided log; below it, the queue (so the
user sees the shore). Each submit advances the loop:

1. wake → read the user's call,
2. record it where it's durable — **the brief is canonical, the page is a mirror** — appended
   in the same round, per the brainstorm skill's append-as-you-go rule,
3. regenerate: decision moves to the log with its rationale, the next decision takes the
   centerpiece, the queue shrinks,
4. bump the version; the page redraws in front of them.

The one-decision-per-exchange discipline carries over unchanged — the canvas just makes each
exchange *visible*: options compared side by side instead of described, the decided log
accumulating instead of scrolling away. If a submitted comment answers a different question
than the one asked, or challenges a premise — handle it the same way as in conversation:
develop it, answer honestly, reshape the queue. The canvas is a surface, not a script.

## Review pages

For doc/design/PR review rounds (prd and plan phases, or anything else): sections mirroring the
thing under review, a comment box per section and per item worth isolating, one submit bar.
On wake, walk the comments **one at a time** in review-id order — same discipline as the
family's review rounds — batch the artifact edits at the end, then either regenerate the page
for another round or close it out. Empty boxes mean "fine as is."

## Live doc review

When the user should read the *actual source* of an artifact — a PRD, a plan, any markdown —
not a summary mirror of it: `assets/docview-template.html` renders the real file live with a
comment box per `##` section and an agent-replies panel. Copy it once into the workspace, copy
the `.md` next to it, open as `docview.html?md=<file>.md`. On wake: answer questions via
`answers.json`, apply requested edits to the real document (the repo file stays canonical),
re-copy the `.md`, bump the version — the reader watches the document change in place. It
deliberately keeps scroll position and never blocks with an overlay; it pairs with a
decision/review page on the same server (watch both wake markers). Full protocol in
`references/canvas-pages.md` → Doc-review page. Offer it whenever a review round starts or the
user asks to "see the full document", "read the source", or comment while reading.

## The diagram kit

For anything whose shape is a **node-and-arrow graph** — a concept map, an architecture, a flow, a
mind map — canvas ships a shared drawing primitive: `assets/diagram-kit.js` renders clean SVG from a
structured `{nodes, edges}` scene. The agent authors only the scene (a JSON block on the page); the
kit lays it out, draws it, and renders a **live legend** — clicking a state's chip toggles its nodes
on/off (hide `base` to see only what changed), no agent round-trip. It is the visual sibling of the
comment box — comment boxes are canvas's shared *interactive* primitive, this is its shared
*drawing* primitive.

It is **generic**: it knows shapes and five visual **states** — `base`, `highlight`, `emphasis`
(grew — bigger node), `alert` (problem — dashed red), `new` — and nothing about any domain.
Consumers map their own words onto the states, both in prose and as legend labels (the better-planning
family maps drift → `alert`, ballooned → `emphasis`, and so on — see `html-artifacts.md`). Because
the scene is a *document*, not a drawing, the agent reads and edits it — which is the foundation for
a future drag-and-edit board. Full schema, layouts, states, legend, and the editable-board direction:
`references/diagram-kit.md`. A self-contained demo is `assets/diagram-demo.html`.

Keep the CSS components for *linear* shapes (pipelines, layers, state cards — they're cheaper); reach
for the kit when the shape is a 2D graph the CSS boxes can't draw.

## Page quality bar

Canvas pages follow the better-planning family's design language (`assets/overview-template.html`, component
table in `html-artifacts.md`): self-contained except for the canvas JS blocks (comment capture,
auto-reload, and the optional diagram kit); diagrams are CSS-only for linear shapes or the SVG
diagram kit for graphs; options compared *on the page* with trade-offs visible, recommendations marked.
Stable, meaningful `data-review-id`s (`decision-3-storage`, `sec-milestones`) — they appear in
the feedback JSON and in your replies, and they let consecutive rounds diff cleanly.

## What this skill is not

- Not a deployment: the server is a localhost/tailnet convenience for a session, not a hosted
  app. Kill it when the session ends; never expose it beyond the user's own network.
- Not the artifact: pages are ephemeral mirrors. The brief, PRD, plan, and their committed
  companions remain the record — if a canvas page captured something durable, fold it in
  before tearing down.
- Not a form engine: the page never becomes a questionnaire battery. One decision at the
  centerpiece; comment boxes elsewhere are invitations, not required fields.
