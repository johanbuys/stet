# behavioral-engine — brief

**Status:** settled — 2026-06-06 (all five fork-level decisions landed; canvas brainstorm)
**Next phase:** feature PRD (`behavioral-engine-prd.md`) — drafts from this brief
**Depends on:** `docs/product/stet-prd.md` §5 (Phase 5), §12 · `features/harness/harness-prd.md` (all contracts)
**Draws on:** `docs/research/behavioral-validation-findings.md` · POC `../validation-agent-poc` (`src/{schema,prompt,validate}.ts`, 14 fixtures)

## Problem

Port the proven POC behavioral validator onto the stet harness as Phase 5 — the engine PRD must
concretize what the high-level PRD deliberately deferred: the rubric port, the verdict→findings
mapping mechanics, the execution-adapter structure, surface selection, claim scoping, run
isolation, and the `behavioral` config schema.

## Current state

- **POC (proven):** standalone validator on Pi SDK — `ValidationResultSchema` (verdict, claims
  buckets, checks, failures w/ repro, blockers), one hardened rubric (~76 lines, incl. embedded
  browser/TTY clauses), tool posture `read/bash/grep/find/ls/submit`, no-submit fallback.
  Validated: 14 fixtures × 6 models, all four verdicts, all surfaces, two discipline traps.
- **Harness PRD (settled contracts the engine writes against):** `PhaseConfiguration` (rubric +
  toolset + tier + extension + budgets), `Finding`/`Audit`/`PhaseReport` schemas (claims buckets
  → `Audit.claims`, POC severity → `meta.priority`), output-as-tool guards, activation
  "diff touches runnable surfaces AND spec present", robust tier, 15-min budget.
- **Not this PRD:** `start_service`/`pty_session` (own PRD), browser provisioning
  (`browser-execution`), eval-suite port (`eval-suite`). The engine PRD defines what it
  *consumes* from them, not their internals.

## Decided directions

*(inherited — settled upstream, not re-litigated here: diff-blind w/ diff-selects-surfaces;
mutation-free; verdict internal, surfaced failed→error/blocked→warning/inconclusive→info;
spec required else skipped + `behavioral.not-run` warning; mocks isolate peripherals only,
claims about mocked services are blocked; blunt-conservative rubric discipline; Pi SDK
`@earendil-works/pi-coding-agent`; single capable agent, no planner/worker split (R&D D2);
evidence ladder; robust tier.)*

1. **Diff exposure & surface selection — option A: fully diff-blind agent; harness owns the
   mapping.** The harness resolves changed paths → surfaces deterministically (path→surface
   mapping drafted by `stet init`, heuristic fallback); the agent receives **surfaces only** —
   never file paths, never patch hunks. Activation and surface selection are one mechanism.
   Over-selection is acceptable (token cost, never a wrong verdict); under-selection is an
   init/config hygiene finding. — *why:* this is the exact posture the 14-fixture POC evidence
   validates (zero author-bias leakage), and the harness's pre-launch activation contract
   requires a deterministic map regardless — one mechanism, not two. (user call, 2026-06-06)
2. **Claim scoping — option B: derive from the whole provided spec; exercise what reaches the
   selected surfaces; name the cut.** Claims that don't reach a selected surface land in a new
   explicit audit bucket — **out-of-scope-this-run** — never silently dropped, never
   fake-"unproven". When the spec is ticket-sized (the normal case, and the POC's only mode)
   the bucket is empty and the run behaves exactly like the classic workflow: QA verifies the
   ticket's AC. The rule only bites when a caller hands more than a ticket (whole product PRD).
   *Ripple:* a fourth claims bucket (`outOfScope`) in the harness PRD's `Audit.claims` — amend
   it in the same change as the engine PRD. — *why:* cost bounded by the change, not the spec;
   derivation stays independent (agent reads the full spec before any narrowing); the cut is
   deliberate and visible — same anti-silent-green ethos as hygiene findings. Maps onto the
   classic dev→ticket→QA workflow Johan anchored on. (user call, 2026-06-06)
3. **Rubric composition — option C: judgment core verbatim + injected tool briefs.** The core
   keeps ALL judgment from the POC rubric — independence, mutation-free, verdicts, evidence
   sufficiency, anti-mock, **TTY honesty, SPA-needs-browser** — verbatim and always-on; only
   operational how-to (agent-browser usage/`--no-sandbox`, pty_session usage, start_service
   usage) splits into per-tool **briefs**, injected when the tool is available. Qualification
   keys on the core version alone; tool briefs change without invalidating judgment
   qualifications. *Ripples:* (a) one-time eval re-baseline of the slimmed core at port time;
   (b) high-level PRD §4 architecture line softens to "no *operational* surface knowledge in
   the rubric" — the TTY/SPA clauses are judgment, not surface mechanics, and must hold even
   (especially) when the tool isn't provisioned. — *why:* the SPA-needs-browser rule protects
   exactly the no-browser run from a false `passed` on curl; moving it out with the adapter
   (option B) would remove it when it's load-bearing. (user call, 2026-06-06)
4. **Run isolation — option A: in place, with three deterministic guards.** (1) **Port
   templating:** init drafts `start: "PORT={{port}} npm start"` + `url: "…:{{port}}"`;
   `start_service` resolves a free port per run. (2) **Per-repo run lock:** a second concurrent
   behavioral run reports `blocked` ("another stet behavioral run holds the lock") — never a
   flaky collision. (3) **Disk-state honesty:** scope behind the working tree ⇒ `blocked` with
   reason; before/after `git status` snapshot ⇒ `behavioral.run-side-effects` warning naming
   anything the product under test wrote. Workspace (git-worktree) isolation deferred; config
   key shaped for it (`behavioral.isolation`). — *why:* every collision class becomes a free
   port, an honest `blocked`, or a named warning — deterministic, in the loop; worktree mode's
   per-run dependency install would routinely eat the 15-min budget. *Reference (Johan):*
   [portless.sh](https://portless.sh/) — same mechanism proven in dev tooling (injects `PORT`
   env, auto-adds `--port`/`--host` flags for frameworks that ignore it); its framework-aware
   fallback is worth mining for init's start-command drafting; possible future integration,
   not a dependency. (user call, 2026-06-06)
5. **Config schema shape — option B: named services + surfaces that reference them.**
   `behavioral.services.<name>` = processes (start w/ `{{port}}`, url, ready, `mode: real|mock`);
   `behavioral.surfaces.<name>` = interfaces (the D1 `paths` selection keys, backing `service`,
   `browser: true` where needed); `credentials` as env-var **references only**, never values;
   `isolation: in-place` (D4, `workspace` reserved). Single-service repos get shorthand sugar
   (draft-level). — *why:* the settled vocabulary already separates services from surfaces; B is
   the only shape where every decided mechanism has an obvious home (path→surface map = surfaces'
   `paths`; `{{port}}` lives on the service; "mock stripe" is addressable by name). **portless
   follow-up (Johan asked twice — answered):** integrate by *detection, not dependency* — if a
   repo already uses portless, `init` detects it and drafts service URLs as the stable
   `*.localhost` names; stet's own default stays `{{port}}` templating because the binding run
   is headless CI where a global root-port-443 HTTPS proxy (Node 24+) is an extra moving part
   stet must not require ("provisioned, never self-installed" applies to proxies too).
   (user call, 2026-06-06)

## Open questions

### Fork-level (must land before this brief settles)

*(none — all five landed; see Decided directions)*

### Detail (the PRD draft can propose answers)

- Exact `ValidationResult` → `Finding[]`/`Audit` field mapping table.
- Submit-tool extension shape for Phase 5 (claims/checks on top of `{findings, audit}`).
- Adapter interface contract (what the engine assumes of `start_service`/`pty_session`/browser).
- Readiness/teardown expectations; what `blocked` looks like for each adapter.
- How run-instructions are rendered into the user prompt (POC `buildUserPrompt` shape).
- Single-service config shorthand sugar (D5); portless detection in `init` (D4/D5 note).
- Upstream amendments to carry with the PRD: harness PRD `Audit.claims` gains `outOfScope`
  (D2); high-level PRD §4 architecture line softens to "no *operational* surface knowledge in
  the rubric" (D3); GLOSSARY gains *judgment core*, *tool brief*, *out-of-scope-this-run*,
  *path→surface map*.

## Scope instincts

**In:** rubric port + composition, verdict→finding mapping, surface selection, claim scoping,
adapter structure, isolation, `behavioral` config schema. **Out (own PRDs):** tool internals
(`start-service`/`pty-session`), browser provisioning, eval-suite/grader port, `init` drafting
mechanics (consumes the schema this PRD defines).

## Glossary seeds

- *surface selection* — the harness's deterministic diff→surfaces mapping (config'd
  path→surface map + heuristics); same mechanism as Phase 5 activation. Decided: D1.
- *path→surface map* — the `behavioral` config section mapping repo paths to surfaces,
  drafted by `stet init`.
- *out-of-scope-this-run* — claims derived from the spec that reach no selected surface;
  recorded in the audit as a deliberate, named cut (4th claims bucket). Decided: D2.
- *judgment core* — the always-on, POC-verbatim judgment rubric (one version; keys model
  qualification). Decided: D3. Replaces the earlier "adapter clause" candidate term.
- *tool brief* — per-tool operational prompt section (usage, env quirks), injected when the
  tool is available; owned by the tool's feature PRD. Decided: D3.

## Evidence

`docs/research/behavioral-validation-findings.md` §1–§6 · POC `src/prompt.ts` (rubric),
`src/schema.ts` (verdict schema), `eval/` + `fixtures/` (the 14) · harness PRD §3–§5.
