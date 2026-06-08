# Behavioral Validation — Discoveries & Directions (for stet)

**What this is.** A durable capture of what we learned from the `validation-agent-poc`
experimentation, framed in stet's context, so the insights and directions are not lost. This is
**research/findings, not a spec.** It is the foundation that the upcoming documents draw from:

> discoveries (this doc) → fresh high-level stet PRD → per-feature PRDs → per-feature implementation plans

**Provenance.** The POC was R&D for stet's Phase 5 (behavioral verification execution), which the
v1 PRD explicitly deferred and left under-specified. We built a working, **diff-blind, mutation-free
behavioral validator** on the Pi SDK and ran it against **14 zero-dependency fixtures** and **6
models**, plus targeted probes for interactive CLIs, raw-mode TUIs, web/API surfaces, and a real
React SPA. Artifacts live in the `validation-agent-poc` repo (`src/`, `fixtures/`, `eval/`,
`tools/`, `docs/overview.html`, `docs/PROVISIONING.md`).

**Scope of confidence.** These findings rigorously inform **behavioral verification (Phase 5) and a
few cross-cutting principles**. They do **not** re-validate stet's static phases 1–4 (deterministic
gates, spec compliance, code review, test quality) — we didn't test those.

---

## 1. The core thesis — validated

**An independent, behavior-first validator catches what static analysis and green tests cannot.**

The killer demonstration: two byte-identical sibling repos differ by **one line** — the broken one
prints the right error to stderr but is missing its `process.exit(1)`, so bad input exits `0`.
**Green tests in both.** Static review passes it (the code *contains* a try/catch; the error test
asserts the message, never the exit code). Only *running it* — `node cli.js bad.json; echo $?` →
exits 0, violating an acceptance criterion — catches it.

The validator greened one sibling and red-flagged the other with the exact reproducing command as
evidence. **That asymmetry is the entire justification for behavioral verification being a distinct,
independent phase.** Across the fixtures we pinned all four verdicts (`passed/failed/blocked/
inconclusive`) and every surface (CLI, stdin, TTY, raw-mode keys, HTTP API, server-rendered web, a
React SPA), including two *discipline traps* — one guarding against crying wolf on correct code, one
against false-passing via a mock.

---

## 2. Design philosophy that held up — and how it reconciles with stet

The POC locked seven decisions (D1–D7). The three that **diverge from stet's stated principles** are
the important ones; all three survived evaluation. Each implies a reconciliation the PRD must make.

| POC decision | Held up because | Tension with stet v1 | Reconciliation (direction) |
|---|---|---|---|
| **D1 Diff-blind independence** — never sees the diff; rediscovers the feature from task + acceptance | A validator that reads the diff inherits the author's blind spot. The "correct catch" is *only* catchable diff-blind. | stet's Phase 5 **activates on the diff** and reads it to justify the strategy. | The diff may **select which surfaces to exercise**; the check **derives its claims from the spec, not the diff**, and proves them by running. Diff ≠ source of truth for "does it work." |
| **D3 Mutation-free** — no edit/write tools; enforced by construction | A verdict from a mutated repo is worthless. | stet has `--fix`. | Behavioral verification runs **strictly mutation-free**; `--fix` is a separate step that never runs *during* validation. |
| **Verdict + executable evidence** | Execution *is* decisive — a reproducing command is proof, not a confidence-scored opinion. | stet's principle is **findings, not verdicts**. | Phase 5 reaches an internal **verdict**, then **surfaces it as findings** (`failed → error finding + repro`, `blocked → warning`, `inconclusive → info`) and drives the exit code. Decisiveness where earned; findings on the surface. |

The other decisions held without tension: **D2** single capable model + tool loop (cheap planner/
worker split deferred); **D4** caller supplies *how to run* (not *what to check*); **D5** Pi SDK;
**D6** output-as-tool (the result schema *is* a `submit_validation_result` tool's input schema — the
only way to finish); **D7** loose freetext in, rigorous JSON out.

---

## 3. The judgment layer — hardened rubric, and the one governing lesson

The validator's judgment lives in a system prompt. Beyond "be independent, prove by running, never
fix," four clauses were **forced by over-claims we actually observed** in evals. These are hard-won —
capture them so they are never relearned:

- **Evidence sufficiency** — evidence must reach the regime the claim is about; code shape ≠ proof.
  (A model generated a 200 MB file, saw flat memory, and over-claimed "constant memory" — but 200 MB
  fits in RAM, so it proved nothing about larger-than-RAM files.)
- **Anti-mocking** — a mock/stub/monkey-patch proves your harness, not the product. (A model
  monkey-patched `fetch` to fake a weather API and declared `passed`.)
- **Interactive / stdin** — a pipe is not a TTY; isTTY-gated behavior you can't exercise is
  `unproven`; never `failed` a prompt you couldn't reach for lack of a terminal.
- **Browser** — for SPAs/client-rendered UIs, HTTP + reading source aren't proof; drive a real
  browser.

> **The governing lesson (a measured rollback).** We once replaced the blunt anti-mock rule with a
> precise, *permissive* one ("mocking is fine for wiring, not for the result"). It **backfired** — a
> weaker model used the permission as a loophole and regressed `blocked → passed`. We reverted to the
> blunt rule. **For a validator, a blunt conservative rule beats a precise permissive one** — weaker
> models exploit any permission, and conservative is also *more correct*. Apply to every rubric edit.

---

## 4. Architecture insight — one rubric, many execution adapters

The single most reusable finding: **the judgment is surface-agnostic; only the execution adapter is
surface-specific.** Nothing in the rubric says "CLI." This is the structural backbone of Phase 5.

```
        JUDGMENT (one rubric, reused)                EXECUTION ADAPTER (per surface)
  derive claims (diff-blind) · mutation-free ·  ×    CLI : spawn → stdout/stderr/exit
  evidence-sufficiency · anti-mock · interactive·     API : start_service → curl → status/body
  browser · verdict{passed|failed|blocked|inc.}       WEB : start_service → agent-browser → DOM/net
```

**Cheapest-sufficient-evidence ladder.** Always take the highest-confidence, lowest-cost rung that
reaches the claim: `exit code / HTTP status+body → node/jsdom JS-execution → real browser`. Most
validation lives on the left; the browser rung is mandatory only for real interactive SPAs.

---

## 5. The probe-driven tooling method (a meta-finding)

Models are **far more resourceful than expected** — they reinvented PTY drivers, executed client JS
in node DOM-shims, and curled the exact endpoint a page's JS calls. So a capability is only worth a
dedicated tool when self-serve is *unreliable*. The method, which kept us from over-building:

> **Build a probe fixture → run it with the current toolset → does the model self-serve it
> *reliably*? → build a tool only where reliability fails.**

This is itself a transferable discipline for deciding stet's tooling — and the fixtures are reusable.

---

## 6. Per-surface discoveries & tool decisions

| Surface | What we found | Direction |
|---|---|---|
| **CLI / stdin line prompts** | Caught reliably with plain bash (the agent pipes input *within* the command; the harness gives the child a closed stdin). | No tool needed; rubric carries the interactive clause. |
| **TTY / raw-mode keys** | The naive `script` trick **hangs** on raw keypresses; models self-serve a python-pty driver but **unreliably** (out of 6: 4 succeeded, 1 honest miss, 1 hung with no verdict). | **A `pty_session` tool is justified** — for reliability + no-hang + cross-platform, not capability. |
| **HTTP API + server-rendered web** | **8/8 caught with no browser** — models curl the exact endpoint a page's JS uses, or execute client logic in a node DOM-shim, and honestly mark genuinely browser-only claims `unproven`. | Bash + curl + node JS-exec suffice for this large class. |
| **Real SPA (React)** | A `useCallback([])` stale-closure bug was **invisible to curl** (empty `<div id="root">`) and only catchable by **selecting + clicking in a real browser**. The validator **self-used `agent-browser` correctly** when advertised. | **Provision `agent-browser`** (a CLI built for agents — drives via the existing bash loop, ref-based, ships skills). Don't build a bespoke browser tool. |
| **Service lifecycle** | Evals leaked **orphaned servers**; bash has no default timeout. | **A `start_service(cmd, ready_check)` tool** — owns boot, readiness, **guaranteed teardown**, default timeouts. The substrate for API + web. |

---

## 7. Model findings (routing)

- A single capable model + tool loop is sufficient for v0; a cheap planner/executor split is
  **deferred** (judgment is needed most *during* execution).
- **Over-claiming is a hydra** — closing one vector (RAM over-generalization) revealed another
  (mocking). The fix is general "evidence must reach the real thing" principles, not per-case patches.
- **Routing is task-dependent.** Robust models (gpt-5.x class) are safest for anything touching real
  external systems / mocks / web. Cheap models are viable for self-contained behavioral checks, **but
  one fast model was the lone over-claimer on dependency/mock traps** — route it off those. Make the
  model a per-phase config knob (resolves the v1 PRD's open "which model" question).

---

## 8. Provisioning discovery (the browser is the exception)

The browser is the **one capability the agent cannot self-serve at validation time.** Getting it
usable from a clean box took **four hurdles**: (1) global npm install needs root; (2) 177 MB Chrome
download; (3) missing system libs (`libatk`/`gtk`/`nss`) via apt; (4) "no usable sandbox" →
`--no-sandbox`, which is security-gated. Conclusions:

- **One-time provisioning, not per-run.** It's the standard "headless Chrome in CI" problem.
- **Never let the validator self-install a browser at validation time.** Provision ahead via a
  **baked image** (Chrome + deps + `AGENT_BROWSER_ARGS=--no-sandbox`), a **remote browser** over CDP,
  or a **cloud provider** (agent-browser ships `agentcore`/`vercel-sandbox` skills).
- `--no-sandbox` is the **accepted** config inside a container — the container is the security
  boundary; don't double-sandbox.
- A verified idempotent provisioning script + reference Dockerfile exist in the POC
  (`tools/provision-browser.sh`, `docs/PROVISIONING.md`).

---

## 9. The eval suite is a reusable discipline

The highest-leverage transferable artifact: **14 zero-dep fixtures** spanning all verdicts and
surfaces (incl. the two discipline traps), plus a **content-aware grader** that asserts the verdict
*and* that the right issue was flagged (over-claim traps accept `blocked|inconclusive`; only a false
`passed` is a real miss), plus a **runner that takes a model list as args.** This is both a CI
regression gate and a one-command "does this new model hold the line?" check. Port it into `vp test`.

---

## 10. Open tensions & decisions surfaced (to resolve in the PRD)

These are the directions discussed that need a decision when we write the fresh PRD:

- **Diff-blind vs diff-activated** (§2 D1) — the sharpest philosophical change vs v1. Confirm: diff
  selects surfaces; claims derive from spec.
- **Verdict vs findings** (§2) — confirm the `failed→error / blocked→warning / inconclusive→info`
  mapping and whether `inconclusive`/`blocked` gate a merge or just warn (exit-code policy).
- **Anti-mocking vs the sandbox's declared "mocks for external services"** (§3) — mocks are for
  **isolating peripheral** services; if a claim is *about* a mocked service, it's `blocked`, not
  `passed`. The `behavioral` config must encode "real vs mock-to-isolate" per service.
- **Mutation-free vs `--fix`** (§2 D3) — fixing never runs during validation.
- **Pi SDK variant** — the POC used `@earendil-works/pi-coding-agent`; the v1 PRD/CLAUDE reference
  `badlogic/pi-mono`. Confirm which stet standardizes on (affects the engine port).
- **`behavioral` config schema** — concretize the run-instructions (start command, base URL,
  readiness probe, credentials, per-service real/mock) — the structured form of D4.

---

## 11. Directions for stet (how this feeds the next docs)

- **Fresh high-level PRD:** should adopt the cross-cutting principle upgrades (independent + mutation-
  free behavioral verification; verdict-surfaced-as-findings; model-routing as config; the eval suite
  as a quality discipline) and keep phases 1–4 as-is unless a principle ripples into them.
- **Feature PRDs implied by these findings:** (a) Behavioral Verification engine (the rubric + verdict
  contract + diff-blind inputs); (b) `start_service` (lifecycle); (c) `pty_session` (raw-mode);
  (d) Browser execution via provisioned `agent-browser`; (e) the Eval/Regression suite. Each gets its
  own PRD then its own implementation plan.
- **Provisioning** is an operational concern that spans the browser feature and the CI/Docker story.

---

### Appendix — POC artifacts to mine

- Engine + rubric + verdict schema: `src/{validate,prompt,schema}.ts`
- Fixtures (14) + content-aware grader + runners: `fixtures/`, `eval/`
- Provisioning: `tools/provision-browser.sh`, `docs/PROVISIONING.md`
- Full technical walkthrough + all eval results: `docs/overview.html`
