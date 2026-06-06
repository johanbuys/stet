# behavioral-engine — brief

**Status:** brainstorming — 2026-06-06
**Next phase:** feature PRD (`behavioral-engine-prd.md`)
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

## Open questions

### Fork-level (must land before this brief settles)

3. **Rubric composition** — POC rubric embeds browser/TTY specifics, but the architecture says
   "nothing in the rubric names a surface." Verbatim monolith vs core + adapter-injected
   clauses (affects rubric versioning, which keys model qualification).
4. **Run isolation** — harness PRD §12 punts port collisions/concurrent runs to this PRD.
5. **`behavioral` config schema shape** — multi-service, multi-surface repos, credentials
   handling (partly draft-level; the fork is the multi-service/surface shape).

### Detail (the PRD draft can propose answers)

- Exact `ValidationResult` → `Finding[]`/`Audit` field mapping table.
- Submit-tool extension shape for Phase 5 (claims/checks on top of `{findings, audit}`).
- Adapter interface contract (what the engine assumes of `start_service`/`pty_session`/browser).
- Readiness/teardown expectations; what `blocked` looks like for each adapter.
- How run-instructions are rendered into the user prompt (POC `buildUserPrompt` shape).

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
- *adapter clause* — candidate term if rubric splits into core + per-adapter sections (decision 3).

## Evidence

`docs/research/behavioral-validation-findings.md` §1–§6 · POC `src/prompt.ts` (rubric),
`src/schema.ts` (verdict schema), `eval/` + `fixtures/` (the 14) · harness PRD §3–§5.
