# Canvas Diagram Kit: clean concept maps from a scene

The kit draws a **node-and-arrow graph** — a concept map, an architecture, a flow, a mind map —
in clean SVG, from a structured `{nodes, edges}` scene. It is the visual companion to the comment
boxes: those are canvas's shared *interactive* primitive, this is its shared *drawing* primitive.
It renders a **live legend** with the diagram (see *The legend* below) — one click hides or shows a
whole state, so the user can focus the picture without the agent regenerating it.

Two things make it different from hand-authored SVG, and both matter:

- **The scene is a document, not a drawing.** The agent reasons about *the graph* (`this connects
  to that`), not pixels. It writes the scene, reads it back, edits it. That is the foundation a
  future in-browser editor builds on (see *Future: the editable board*).
- **It is generic.** The kit knows shapes and five visual **states** — it knows nothing about any
  domain. Consumers map their own words onto the states (the better-planning family's mapping is in
  `html-artifacts.md` → *Diagram states*).

`scripts/` ships nothing for this; the renderer is `assets/diagram-kit.js`, a single self-contained
vanilla file, no dependencies.

## Putting it on a page

Two parts: a container holding the scene as inline JSON, and the renderer script. Every
`[data-diagram]` on the page renders on load.

```html
<div class="dk" data-diagram>
  <script type="application/json">
  {
    "layout": "radial",
    "nodes": [
      { "id": "composite", "label": "composite.run", "state": "emphasis" },
      { "id": "verify",     "label": "agreement-verify", "state": "highlight" },
      { "id": "coordinator","label": "coordinator", "state": "alert" }
    ],
    "edges": [
      { "from": "composite", "to": "verify",  "label": "fans out" },
      { "from": "verify",    "to": "coordinator", "label": "feeds" }
    ]
  }
  </script>
</div>

<script src="diagram-kit.js"></script>
```

**Copy `assets/diagram-kit.js` into the canvas workspace** next to the page (the server serves it
like any file) — same one-time copy as a template. For a page redrawn across rounds, the scene can
live in `state.json` and you re-render via `DiagramKit.render(containerEl, scene)` rather than
re-emitting markup.

## Scene schema

```
{
  layout?: "radial" | "row" | "free",   // default: "free" if any node has x/y, else "radial"
  width?:  number,                       // viewBox width  (default 860)
  height?: number,                       // viewBox height (default 520)
  legend?: false | { <state>: string },  // false = no legend; object = per-state labels (below)
  nodes: [
    {
      id:     string,                    // unique; referenced by edges
      label?: string,                    // shown; defaults to id. Wraps to 2 lines if long
      state?: "base"|"highlight"|"emphasis"|"alert"|"new",   // default "base"
      shape?: "box" | "ellipse",         // default "box"
      x?, y?: number,                    // center, in viewBox units — only for layout "free"
      w?, h?: number                     // override auto size
    }
  ],
  edges: [
    { from: id, to: id, label?: string, state?: <same set>, dashed?: boolean }
  ]
}
```

## The five states (generic)

| state | reads as | look |
|---|---|---|
| `base` | unchanged / the default | muted gray, white fill |
| `highlight` | touched / changed this pass | accent blue, heavier stroke |
| `emphasis` | grew / matters more | amber, **larger node** |
| `alert` | something's wrong here | red, dashed border |
| `new` | just appeared | green |

Colors track the family tokens (`--ink`, `--accent`, `--warn`, `--err`, `--ok`) so a diagram looks
like the rest of the page. A consumer never invents a sixth state — it maps its vocabulary onto
these.

## Layouts

- **`radial`** (default for coordinate-free scenes) — the **first node is the hub**, the rest ring
  around it elliptically. Best for "one concept and what it connects to".
- **`row`** — evenly spaced left-to-right, vertically centered. Best for a pipeline / flow. Give a
  smaller `height` (e.g. 200).
- **`free`** — you place every node with `x`/`y` (center, in viewBox units). Use when the topology
  is specific and auto-layout won't read right.

Auto-layout is deliberately just these three — a *handful of concepts* is the scale this serves. A
big graph that needs real layout is a signal the diagram is trying to say too much; split it.

## The legend (interactive)

The kit renders a legend with the diagram — a chip per state **that actually appears** in the
scene, each with a count. The legend is **live**: clicking a chip hides that state's nodes (and any
edge touching them), clicking again restores them. So the user can toggle `base` off to see only
what changed, or isolate the `alert` items — all client-side, no agent round-trip.

Label the chips with `legend`:

- omitted → chips read the generic state names (`base`, `highlight`, …).
- `legend: { base: "unchanged", emphasis: "grew", alert: "drift" }` → chips read the consumer's
  words. This is where the family's mapping shows up: comprehend passes
  `{ base:"unchanged", highlight:"moved", emphasis:"ballooned", alert:"drift", new:"new" }`.
- `legend: false` → no legend (e.g. a single-state diagram where it adds nothing).

## The look

Clean straight lines and rounded node boxes — no drawing library, no wobble. Text is drawn in a
separate layer above the shapes so it stays crisp. If a sketchy/hand-drawn aesthetic is ever wanted,
`rough.js` can be vendored and swapped in behind the same scene format, with no change to how scenes
are authored.

## Future: the editable board

The scene is built to grow into a collaborative whiteboard, turn-based on canvas's existing loop:

1. **Now** — the agent authors the scene, the kit renders it read-only, the user comments.
2. **Later** — the browser makes shapes draggable and adds an arrow/rename tool; on submit it posts
   the *edited scene* back through `POST /feedback` instead of (or alongside) comments. The agent
   reads the new scene, edits it, bumps the version, the board re-renders. The likely move is to
   **embed tldraw or excalidraw as the editor**, bridged to this same `{nodes, edges}` document.

The point of keeping the scene a clean structured document *now* is that this is purely additive —
no rewrite. Real-time co-editing (CRDTs) is explicitly out: turn-based satisfies "we both edit the
same board" without that complexity.

## What it is not

- Not a chart library — no axes, scales, or data series; that's a different primitive.
- Not an auto-layout engine — three simple layouts, by design.
- Not domain-aware — it never hears the words "drift" or "ballooned"; consumers map those on.
