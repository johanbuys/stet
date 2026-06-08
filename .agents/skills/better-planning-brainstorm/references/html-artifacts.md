# HTML Artifacts: Companions & Ephemeral Visuals

Two kinds of HTML, one design language. Both start from `assets/overview-template.html`.

## Why HTML at all

Many humans review *visually*. A 400-line markdown spec is faithful but slow; a page with the
architecture as a diagram, decisions as a green-dot table, and open questions as highlighted
boxes is reviewed in minutes and produces better feedback. The markdown stays the source of
truth; the HTML is the review surface.

## Hard rules (both kinds)

- **Self-contained, single file.** Inline CSS (and inline vanilla JS for review capture only) —
  no CDN links, no JS frameworks, no external fonts or images, no server. It must render
  identically from `file://` on any machine, forever.
- **CSS-only diagrams.** Flexbox/grid boxes, borders, and pills compose into architecture
  diagrams, timelines, ladders, state machines. No image files, no mermaid.
- **Tell the user how to open it** (`xdg-open <path>` / `open <path>`) every time you create or
  update one.

## Companion overviews (`<doc-stem>-overview.html`)

The committed review surface for a PRD or plan. Created/updated **in the same commit** as its
markdown. Structure:

1. **Header** — doc title, one-line essence, status chips (draft/review state, date, what it
   depends on, where the detail lives).
2. **Numbered sections** mirroring the doc's *ideas* (not its headings 1:1) — favor the
   diagrammable: architecture, flows, data models as nested boxes, option comparisons,
   decision tables with green/amber dots for resolved/open.
3. **Decisions table** — every decision with its resolution, traceable to the doc.
4. **"Things to poke at"** — the closing section, always present: open questions the draft
   answers implicitly or defers, each as a highlighted box with the question and why it
   matters. This is the reviewer's agenda for the next round — write it for them.
5. **Footer** — provenance: generated from `<path>` (status, date), what it supersedes/draws on.

Keep the companion honest: it must not say more than the markdown. If a diagram reveals a gap
the doc glossed over, fix the doc.

## Review capture — the companion as a feedback instrument

When a companion goes out for an async review round, make it *collect* the review instead of
just presenting: the template ships an inline-JS review block (no server, no deps — the file
still works from `file://`):

- Every "things to poke at" box — and any decision row or section worth commenting on — carries
  `data-review-id="<stable-id>"`; the script attaches a comment textarea to each.
- Typing autosaves to `localStorage` (keyed per doc stem), so an accidental refresh loses
  nothing.
- An **"Export review"** button downloads `<doc-stem>-feedback.json`:
  `{ doc, exported, comments: { <id>: <text> } }`.

The agent-side flow when the user says they've reviewed: ask where the export landed (usually
`~/Downloads/<doc-stem>-feedback.json`), read it, then walk the comments **one at a time** in
review-id order — same one-decision-at-a-time discipline as a live round, with each item getting
context → your read → recommendation → the ask if a call is needed. Batch the doc edits at the
end of the walk, update the decisions table, commit. Empty comments mean "fine as is."

Keep stable, meaningful review ids (`poke-budget-defaults`, `dec-severity-vocab`) — they appear
in the JSON and in your replies, and they let a second export after edits diff cleanly against
the first. Live conversational review stays first-class; review capture is for "let me look at
this properly and get back to you."

When the **better-planning-canvas** skill is installed, prefer its served live loop over the
export-download flow: same comment boxes, but submissions POST back to a local server, the
agent wakes automatically, and the page reloads after each round — essential when the user is
remote and `file://` is unreachable.

## Ephemeral visuals (`/tmp/better-planning/<topic>.html`)

Throwaway artifacts that exist to get **one decision** made during discussion. Use one when:

- comparing 2–3 options whose difference is structural (architectures, layouts, flows),
- a mechanism needs to be *seen* to be judged (a scheduling timeline, config precedence,
  a state machine, an escalation ladder),
- an exchange has gone back and forth twice without landing — the signal that prose isn't
  carrying the picture. Offer one proactively at that point.

Conventions: write to `/tmp/better-planning/` (create the dir), one topic per file, lead with
the question being decided as the page title, present the options side by side with the
trade-offs *on the page*, and mark your recommendation visually. Never commit these; if one
turns out to capture something durable, fold it into the relevant companion instead.

## Design language

The template carries the palette and components; reuse them so every artifact in a project
looks like one family. Available components (see template source for markup):

| Component | Use for |
|---|---|
| status chips | doc state, dates, dependencies (header) |
| cards / `.lede` | section intros, callouts |
| pills (`err/warn/info/ok/gray`) | severities, states, verdicts |
| owns-vs-contributes split | responsibility boundaries between two parties |
| nested schema boxes | data models, report structures |
| numbered sequence steps | protocols, lifecycles, guard chains |
| flow nodes + separators | pipelines, decision flows |
| gantt bars | timelines, parallel vs sequential comparisons |
| layer rows | precedence stacks (config, routing) |
| state cards (colored top border) | state machines, outcome states |
| decision table (`.dec-res` dots) | resolved (green) vs open (amber) decisions |
| ask boxes (amber left border) | "things to poke at" items |

Adapt freely — the family resemblance matters more than pixel fidelity. For accents, derive a
small set of semantic colors per project (e.g., one per phase/component) and use them
consistently across all of that project's artifacts.
