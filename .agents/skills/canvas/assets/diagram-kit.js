/* canvas diagram kit — render a {nodes, edges} scene as a clean SVG concept map.
 *
 * Self-contained, zero dependencies, vanilla DOM. GENERIC: it knows shapes
 * (node, edge) and visual STATES (base/highlight/emphasis/alert/new) — it does
 * NOT know any domain. Consumers map their own words onto the states (e.g. the
 * better-planning family maps drift -> alert, ballooned -> emphasis). Authoring
 * guide + scene schema: references/diagram-kit.md.
 *
 * The scene is a structured document, not a drawing — it is the source of truth
 * an agent reads, writes, and (later) a browser editor edits. Keep it that way.
 *
 * The kit renders an interactive legend: each present state is a chip the user
 * can click to toggle that state's nodes (and any edge touching them) on/off —
 * e.g. hide `base` to see only what changed.
 *
 * Usage (declarative, auto-init): put a container with the scene inline —
 *   <div class="dk" data-diagram>
 *     <script type="application/json">{ "layout":"radial", "nodes":[...], "edges":[...] }</script>
 *   </div>
 * and include this file once. Every [data-diagram] renders on DOMContentLoaded.
 * Programmatic: DiagramKit.render(containerEl, scene).
 */
(function (global) {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var ORDER = ["base", "highlight", "emphasis", "alert", "new"];

  // Generic visual states. Colors track the family design tokens (--ink,
  // --accent, --warn, --err, --ok) so a diagram looks like the rest of a page.
  var STATES = {
    base:      { stroke: "#5b6678", fill: "#ffffff", width: 1.6, dash: "",    text: "#1a2233", scale: 1 },
    highlight: { stroke: "#0f62fe", fill: "#eef4ff", width: 2.4, dash: "",    text: "#0b3ea8", scale: 1 },
    emphasis:  { stroke: "#d97706", fill: "#fff7ed", width: 2.6, dash: "",    text: "#9a4d05", scale: 1.22 },
    alert:     { stroke: "#dc2626", fill: "#fef2f2", width: 2.2, dash: "7 4", text: "#b91c1c", scale: 1 },
    "new":     { stroke: "#059669", fill: "#ecfdf5", width: 2.2, dash: "",    text: "#047857", scale: 1 }
  };

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function stateOf(s) { return STATES[s] || STATES.base; }
  function stateKey(s) { return STATES[s] ? s : "base"; }

  // One injected stylesheet so the legend looks right on any host page.
  function ensureStyles() {
    if (document.getElementById("dk-styles")) return;
    var s = document.createElement("style");
    s.id = "dk-styles";
    s.textContent =
      ".dk-svg{width:100%;height:auto;display:block}" +
      ".dk-legend{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}" +
      ".dk-key{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none;" +
        "font:650 12.5px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "color:#5b6678;background:#fff;border:1px solid #e3e8f0;border-radius:999px;padding:6px 12px}" +
      ".dk-key:hover{border-color:#c9d6ea;background:#f7fafd}" +
      ".dk-key.off{opacity:.45;text-decoration:line-through}" +
      ".dk-sw{width:13px;height:13px;border-radius:4px;border:2px solid}" +
      ".dk-count{color:#8b94a6;font-weight:700}";
    document.head.appendChild(s);
  }

  function nodeSize(n, st) {
    var label = n.label || n.id || "";
    var longest = label.split(/\s+/).reduce(function (m, w) { return Math.max(m, w.length); }, 0);
    var w = n.w || Math.max(104, 30 + Math.max(label.length, longest * 1.6) * 7.4);
    var h = n.h || (label.length > 18 ? 60 : 46);
    return { w: w * st.scale, h: h * st.scale };
  }

  // Place nodes: explicit x/y wins; otherwise lay out by the scene hint.
  function layout(scene, W, H) {
    var nodes = scene.nodes, i, n;
    var mode = scene.layout;
    var anyXY = nodes.some(function (m) { return typeof m.x === "number" && typeof m.y === "number"; });
    if (!mode) mode = anyXY ? "free" : "radial";

    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      var size = nodeSize(n, stateOf(n.state));
      n._w = size.w; n._h = size.h;
    }

    if (mode === "free") {
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n._cx = typeof n.x === "number" ? n.x : W / 2;
        n._cy = typeof n.y === "number" ? n.y : H / 2;
      }
    } else if (mode === "row") {
      var gap = W / (nodes.length + 1);
      for (i = 0; i < nodes.length; i++) {
        nodes[i]._cx = gap * (i + 1);
        nodes[i]._cy = H / 2;
      }
    } else { // radial: first node is the hub, the rest ring around it (elliptical
      // so the wider canvas spreads the ring out instead of crowding the hub)
      var cx = W / 2, cy = H / 2, Rx = W * 0.36, Ry = H * 0.37;
      if (nodes.length) { nodes[0]._cx = cx; nodes[0]._cy = cy; }
      var ring = nodes.length - 1, start = -Math.PI / 2;
      for (i = 1; i < nodes.length; i++) {
        var a = start + (i - 1) / Math.max(ring, 1) * Math.PI * 2;
        nodes[i]._cx = cx + Math.cos(a) * Rx;
        nodes[i]._cy = cy + Math.sin(a) * Ry;
      }
    }
  }

  // Point where the segment from a node's center toward (tx,ty) crosses its border.
  function border(n, tx, ty) {
    var dx = tx - n._cx, dy = ty - n._cy;
    if (dx === 0 && dy === 0) return { x: n._cx, y: n._cy };
    var hw = n._w / 2 + 2, hh = n._h / 2 + 2;
    var sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    var sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    var s = Math.min(sx, sy);
    return { x: n._cx + dx * s, y: n._cy + dy * s };
  }

  function byId(nodes) {
    var m = {}; nodes.forEach(function (n) { m[n.id] = n; }); return m;
  }

  function wrap(label) {
    if (label.length <= 18 || label.indexOf(" ") < 0) return [label];
    var words = label.split(" "), a = "", b = "", half = label.length / 2;
    for (var i = 0; i < words.length; i++) {
      if (a.length < half) a += (a ? " " : "") + words[i];
      else b += (b ? " " : "") + words[i];
    }
    return b ? [a, b] : [a];
  }

  function markers() {
    var d = svgEl("defs");
    ORDER.forEach(function (key) {
      var m = svgEl("marker", { id: "dk-arrow-" + key, viewBox: "0 0 10 10", refX: "8.5", refY: "5",
        markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
      m.appendChild(svgEl("path", { d: "M0.5,0.8 L9,5 L0.5,9.2 L3,5 Z", fill: STATES[key].stroke }));
      d.appendChild(m);
    });
    return d;
  }

  function legend(container, svg, scene, nodeReg, edgeReg) {
    var present = ORDER.filter(function (s) {
      return scene.nodes.some(function (n) { return stateKey(n.state) === s; });
    });
    if (scene.legend === false || !present.length) return;

    var counts = {};
    present.forEach(function (s) { counts[s] = 0; });
    scene.nodes.forEach(function (n) { counts[stateKey(n.state)]++; });
    var labels = (scene.legend && typeof scene.legend === "object") ? scene.legend : {};
    var hidden = {};

    function apply() {
      Object.keys(nodeReg).forEach(function (id) {
        var disp = hidden[nodeReg[id].state] ? "none" : "";
        nodeReg[id].els.forEach(function (el) { el.style.display = disp; });
      });
      edgeReg.forEach(function (ed) {
        var fs = nodeReg[ed.from] && nodeReg[ed.from].state;
        var ts = nodeReg[ed.to] && nodeReg[ed.to].state;
        var off = hidden[ed.state] || (fs && hidden[fs]) || (ts && hidden[ts]);
        ed.els.forEach(function (el) { el.style.display = off ? "none" : ""; });
      });
    }

    var bar = document.createElement("div");
    bar.className = "dk-legend";
    present.forEach(function (s) {
      var key = document.createElement("button");
      key.type = "button"; key.className = "dk-key";
      key.title = "Toggle " + (labels[s] || s);
      var sw = document.createElement("span");
      sw.className = "dk-sw";
      sw.style.borderColor = STATES[s].stroke; sw.style.background = STATES[s].fill;
      var txt = document.createElement("span"); txt.textContent = labels[s] || s;
      var cnt = document.createElement("span"); cnt.className = "dk-count"; cnt.textContent = counts[s];
      key.appendChild(sw); key.appendChild(txt); key.appendChild(cnt);
      key.addEventListener("click", function () {
        hidden[s] = !hidden[s];
        key.classList.toggle("off", !!hidden[s]);
        apply();
      });
      bar.appendChild(key);
    });
    container.insertBefore(bar, svg);
  }

  function render(container, scene) {
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!scene || !scene.nodes) return;
    ensureStyles();
    var W = scene.width || 860, H = scene.height || 520;

    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "dk-svg",
      xmlns: NS, "font-family": "-apple-system, Segoe UI, Roboto, sans-serif" });
    svg.appendChild(markers());
    var ink = svgEl("g", {});      // shapes + edges
    var labels = svgEl("g", {});   // text, drawn on top
    svg.appendChild(ink); svg.appendChild(labels);

    layout(scene, W, H);
    var idx = byId(scene.nodes);
    var nodeReg = {};   // id  -> { state, els:[] }
    var edgeReg = [];   // [ { from, to, state, els:[] } ]

    // Edges first, straight line border-to-border, so nodes sit on top.
    (scene.edges || []).forEach(function (e) {
      var a = idx[e.from], b = idx[e.to];
      if (!a || !b) return;
      var st = stateOf(e.state), key = stateKey(e.state);
      var p1 = border(a, b._cx, b._cy), p2 = border(b, a._cx, a._cy);
      var path = svgEl("path", {
        d: "M" + p1.x + "," + p1.y + " L" + p2.x + "," + p2.y,
        fill: "none", stroke: st.stroke, "stroke-width": st.width,
        "stroke-dasharray": e.dashed ? "7 4" : st.dash,
        "stroke-linecap": "round", "marker-end": "url(#dk-arrow-" + key + ")"
      });
      ink.appendChild(path);
      var els = [path];
      if (e.label) {
        var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, lw = e.label.length * 6.6 + 10;
        var rect = svgEl("rect", { x: mx - lw / 2, y: my - 10, width: lw, height: 17, rx: 4, fill: "#fafbfd", opacity: "0.92" });
        var et = svgEl("text", { x: mx, y: my + 2.5, "text-anchor": "middle", "font-size": "11.5", fill: "#5b6678" });
        et.textContent = e.label;
        labels.appendChild(rect); labels.appendChild(et);
        els.push(rect, et);
      }
      edgeReg.push({ from: e.from, to: e.to, state: key, els: els });
    });

    // Nodes.
    scene.nodes.forEach(function (n) {
      var st = stateOf(n.state);
      var x = n._cx - n._w / 2, y = n._cy - n._h / 2;
      var shape;
      if (n.shape === "ellipse") {
        shape = svgEl("ellipse", { cx: n._cx, cy: n._cy, rx: n._w / 2, ry: n._h / 2 });
      } else {
        shape = svgEl("rect", { x: x, y: y, width: n._w, height: n._h, rx: 10 });
      }
      shape.setAttribute("fill", st.fill);
      shape.setAttribute("stroke", st.stroke);
      shape.setAttribute("stroke-width", st.width);
      if (st.dash) shape.setAttribute("stroke-dasharray", st.dash);
      ink.appendChild(shape);
      var els = [shape];

      var lines = wrap(n.label || n.id);
      var lh = 15.5, y0 = n._cy - (lines.length - 1) * lh / 2 + 4.5;
      lines.forEach(function (line, i) {
        var t = svgEl("text", { x: n._cx, y: y0 + i * lh, "text-anchor": "middle",
          "font-size": st.scale > 1 ? "14.5" : "13", "font-weight": "650", fill: st.text });
        t.textContent = line;
        labels.appendChild(t);
        els.push(t);
      });
      nodeReg[n.id] = { state: stateKey(n.state), els: els };
    });

    container.appendChild(svg);
    legend(container, svg, scene, nodeReg, edgeReg);
  }

  function autoInit() {
    document.querySelectorAll("[data-diagram]").forEach(function (c) {
      var holder = c.querySelector('script[type="application/json"]');
      if (!holder) return;
      var scene;
      try { scene = JSON.parse(holder.textContent); } catch (e) { c.textContent = "diagram: bad JSON — " + e.message; return; }
      render(c, scene);
    });
  }

  global.DiagramKit = { render: render, STATES: STATES };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
  else autoInit();
})(typeof window !== "undefined" ? window : this);
