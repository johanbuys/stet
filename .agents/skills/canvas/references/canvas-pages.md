# Canvas Pages: Authoring & Protocol

A canvas page is a self-contained HTML page (family design language — see
`assets/overview-template.html` and the component table in the family's `html-artifacts.md`)
plus two small JS blocks: **comment capture** (input on the page, posted to the server) and
**auto-reload** (the page redraws itself when the agent regenerates it). Everything below is
copy-paste canonical — reuse it rather than reinventing per page.

## Server protocol (scripts/canvas_server.py)

| | |
|---|---|
| `GET /<file>` | static files from the canvas dir, always `Cache-Control: no-store` |
| `POST /feedback` | body `{ doc, ...anything }` → saved as `feedback/<doc>-feedback.json` (latest) + timestamped archive, and touches the wake marker `feedback/<doc>.new` |

The `doc` field names the page (its stem); it keys the feedback files, the wake marker, and the
localStorage autosave, so several pages can share one server.

## Server lifecycle — don't leak a port

The server is started detached (`… &`), so nothing ties its life to your session. Three habits keep
it from sticking around:

- **Reap before you start.** Free the target port first so stale servers don't pile up across
  sessions: `pkill -f "canvas_server.py.*--port <port>"` (or `lsof -ti :<port> | xargs -r kill`).
- **Idle self-shutdown (automatic).** The server exits itself after `--idle-timeout` seconds with
  no request (default **900 = 15 min**). The page polls `version.json` every ~3s, so an open tab
  keeps it alive; once the tab/session is gone, the clock runs out and the process stops on its own.
  This is the safety net for "user just closed the session" — pass `0` to disable in the rare case
  you want a long-lived server.
- **Kill explicitly when done.** `pkill -f canvas_server.py`, or by port. The idle-timeout is the
  fallback, not a substitute.

For guaranteed cleanup on normal session exits, a harness **SessionEnd hook** can run the `pkill`
above — belt-and-suspenders on top of the idle-timeout, but it's per-machine `settings.json` config
and won't fire on a hard close/crash, which is exactly why the idle-timeout exists.

## Comment capture block

Give every commentable element `data-review-id="<stable-meaningful-id>"`. Include once before
`</body>` (set `DOC` to the page stem):

```html
<script>
(function () {
  var DOC = "my-page";                      // page stem — keys feedback + autosave
  var KEY = "bp-canvas:" + DOC;
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}

  document.querySelectorAll("[data-review-id]").forEach(function (el) {
    var id = el.getAttribute("data-review-id");
    var label = document.createElement("label");
    label.textContent = "Your comments — " + id;
    var ta = document.createElement("textarea");
    ta.placeholder = "Empty = fine as is.";
    ta.value = saved[id] || "";
    if (ta.value) el.classList.add("has-text");
    ta.addEventListener("input", function () {
      saved[id] = ta.value;
      el.classList.toggle("has-text", !!ta.value.trim());
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
    });
    el.appendChild(label);
    el.appendChild(ta);
  });

  document.getElementById("submit").addEventListener("click", function () {
    var status = document.getElementById("status");
    var comments = {};
    Object.keys(saved).forEach(function (k) {
      if (saved[k] && saved[k].trim()) comments[k] = saved[k].trim();
    });
    status.className = ""; status.textContent = "Submitting…";
    fetch("/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: DOC, exported: new Date().toISOString(), comments: comments })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      status.className = "ok";
      status.textContent = "Submitted " + Object.keys(comments).length + " comment(s) — the agent is on it.";
      localStorage.removeItem(KEY); saved = {};   // round delivered; next round starts clean
    }).catch(function (e) {
      status.className = "err";
      status.textContent = "Submit failed (" + e.message + ") — comments are still saved locally.";
    });
  });
})();
</script>
```

With the matching fixed submit bar:

```html
<div class="submit-bar"><div class="submit-inner">
  <button id="submit">Submit</button>
  <span id="status">Comments autosave locally as you type.</span>
</div></div>
```

CSS for `.submit-bar`, `.rv`, `.has-text` etc. is in any prior canvas page or the template —
keep the family look: dashed boxes that turn green when they hold text, fixed bottom bar.

## Auto-reload block

The canvas dir holds `version.json` (`{"v": 1}`). The agent bumps `v` after regenerating the
page; the open browser reloads within ~3s. Include once before `</body>`:

```html
<script>
(function () {
  var current = null;
  setInterval(function () {
    fetch("version.json?t=" + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (current === null) current = j.v;
        else if (j.v !== current) location.reload();
      })
      .catch(function () {});   // server gone — page just stops updating
  }, 3000);
})();
</script>
```

Because comments autosave to localStorage keyed by `DOC`, a reload mid-typing loses nothing —
the capture block restores them.

## The brainstorm template — write state, not markup

For any page that will be redrawn across rounds (brainstorm loops above all), do **not**
regenerate HTML each round — that re-emits ~300 lines of unchanged CSS/JS per redraw (~10k
output tokens a round; measured ~80% waste). Use `assets/brainstorm-template.html` instead:

1. Copy the template **once** into the workspace as `<topic>.html`. Never edit it again.
2. Each round, write only `state.json` (the data: chips, decided log, current decision,
   queue — schema documented at the top of the template's script) and bump `version.json`.
3. The page re-renders **in place** from the new state — no full reload.

The template also bakes in the round-trip UX rules (below), so you get them for free.

## Round-trip UX rules (any live canvas page)

Learned from the first dogfood session — both were user-reported friction:

- **Visible waiting state — a full-page overlay.** After a successful submit, show a
  full-page overlay (dimmed background, centered spinner, "Recorded — the agent is working")
  so it's unambiguous the page is non-interactive until the next round renders. A status-bar
  spinner alone is missable; a static page after submit reads as "nothing happened." Lift the
  overlay when the new state renders (and on server-lost errors).
- **Scroll reset on redraw.** Browsers restore the last scroll position, so a redrawn page
  opens at the bottom where the user last was. Set `history.scrollRestoration = "manual"` and
  `window.scrollTo(0, 0)` after every render — each round reads top-down.

## Page shapes

**Review page** — sections mirroring the thing under review (use the template's diagrams,
decision tables, poke-at boxes); a `data-review-id` per section and per item worth isolating;
one submit bar. The shape used for doc/design/PR reviews.

**Brainstorm page** — the one-decision-at-a-time discipline, on a canvas. Three zones:
1. *Decided log* (top, compact): every landed decision with its one-line rationale — the
   page-side mirror of the brief.
2. *Current decision* (the centerpiece): context → options as side-by-side cards with
   trade-offs on the page → your recommendation marked → ONE comment box
   (`data-review-id="decision-<n>-<slug>"`) for the user's call.
3. *Queue* (bottom, dimmed): upcoming decisions by title, so the user sees the shore.
Each submit advances the loop: record the call (page log AND the real brief — the artifact
stays canonical), regenerate with the next decision, bump the version.

**Explainer page** — no decision pending, just "look at this": architecture, a diff's story, a
pipeline. Comment boxes on each section invite reactions; the live loop turns reactions into a
conversation. When the thing to look at is a node-and-arrow graph (a concept map, an architecture,
a system shape), draw it with the **diagram kit** (`references/diagram-kit.md`) rather than
hand-authoring SVG — its live legend lets the reader toggle parts of the diagram on and off, and a
comment box beside it captures their reaction like any section.

**Doc-review page** — the full markdown source of a real artifact (a PRD, a plan, any doc),
rendered live with a comment box per `##` section. Built from `assets/docview-template.html`
(self-contained: embedded minimal markdown renderer — headings, nested lists, tables, fences,
quotes, inline). Protocol:

1. Copy the template once into the workspace (e.g. as `docview.html`) — never edit it.
2. Copy the source `.md` next to it; open as `docview.html?md=<file>.md` (optional `&doc=`,
   `&title=` params; the feedback key defaults to `<stem>-doc`, so it never collides with a
   decision-loop page on the same server).
3. On wake: answer questions in `answers.json` (`{"round":"…","replies":[{"where":"…","html":"…"}]}`
   — rendered as a green "Agent responses" panel at the top), apply requested edits to the
   REAL document (the repo file stays canonical), then re-copy the `.md` into the workspace
   and bump `version.json`.

Two deliberate UX deviations from the brainstorm template: no full-page overlay after submit
(reading continues while the agent works) and no scroll reset on redraw (the reader keeps
their place; new replies appear at the top). Pairs naturally with a decision page on the same
server — the structured loop carries the round, the doc view carries "let me read the real
thing and poke at it"; watch BOTH wake markers.

## Reaching the page

Bind is `0.0.0.0`, so the page is reachable from other machines — find an address the *user*
can reach, in order of preference: `tailscale ip -4` (if present), `hostname -I | awk '{print $1}'`,
plain `localhost` when they're local. Pick a port with `fuser <port>/tcp` first (default 3119;
any free port is fine). Always print the full URL including the page filename.
