# harness — brief

**Status:** settled — 2026-06-06 (canvas walkthrough: 8 clusters re-confirmed + 1 live exchange
landing the steel-thread direction)
**Provenance:** the harness brainstorm (2026-06-05/06) predates the brief format; this brief is
**reconstructed** from `harness-prd.md` §8 (decisions table) and `stet-prd.md` §12, re-confirmed
decision-by-decision on the 2026-06-06 canvas walkthrough. Decided directions appear below only
once confirmed (or reopened and re-landed) there.
**Next phase:** better-planning-prd — `harness-prd.md` already exists (in-review); this brief
backfills the alignment record it should have drafted from.
**Depends on:** `docs/better-planning/product/stet-prd.md` §4, §6, §8
**Draws on:** `docs/better-planning/research/behavioral-validation-findings.md` · POC
`../validation-agent-poc` (`src/{validate,prompt,schema}.ts`)

## Problem

Five validation phases need the same machinery — scheduling, an agent runner, a findings
schema, output handling, budgets, config, exit codes. Built per-phase, that's five bespoke
engines drifting apart; built once, a phase reduces to a configuration (rubric + toolset +
model) and every other feature PRD gets stable contracts to write against. The harness is that
once. It is also where stet's product-wide guarantees physically live: mutation-freedom,
no-silent-green, structured findings as the only output channel.

## Current state

- **Greenfield code:** `src/cli.ts` is a stub; nothing implemented.
- **POC (proven):** the agent-runner recipe exists and works — Pi SDK session with
  `systemPromptOverride`, read-only toolset, submit-as-tool with schema validation, no-submit
  fallback; validated across 14 fixtures × 6 models.
- **Docs:** `harness-prd.md` is in-review (review round 1 resolved and folded in); the
  behavioral-engine brief is settled and inherits this PRD's contracts by name; the other eight
  feature PRDs are TODO and will all write against the harness contracts.
- **Fits the greater scheme:** the harness is the first thing built (roadmap v0.x "harness +
  floor") and the substrate every phase PRD assumes.

## Decided directions

1. **The harness is the shared substrate; a phase is a configuration of it.** One engine owns
   everything common (scope detection, config, scheduler, agent runner, findings schema,
   output-as-tool, report aggregation, formats, budgets, cost accounting, exit codes); a phase
   contributes only rubric + toolset + model (+ activation, extension, budgets) — the
   `PhaseConfiguration` contract. **Boundary rule:** needed by ≥2 phases → harness; by one →
   that phase's PRD. **Extensibility test:** adding a sixth phase touches no harness code.
   — *why:* five bespoke engines would drift apart; the POC proved the runner recipe is
   phase-agnostic (one rubric swap turned a coding agent into a validator); every downstream
   feature PRD needs stable contracts to write against. *(draft-level; re-confirmed on canvas
   2026-06-06)*
2. **Findings & report schemas: one severity vocabulary, auditable green, confidence by
   construction, TypeBox.** `error|warning|info` is the only gating vocabulary (POC's
   `critical/high/medium/low` survives as `meta.priority` — no information loss, one threshold
   mechanism). `Audit` (examined/checks/claims) is first-class on every phase — the
   anti-silent-green mechanism generalized from the POC; amendment #19 (`outOfScope` fourth
   claims bucket, behavioral-engine brainstorm) is settled-pending. Deterministic and
   evidence-backed findings are `high` confidence by construction — the confidence filter
   exists for opinions; only high-confidence findings gate. Schemas in TypeBox, validated at
   the tool boundary. — *why:* loops branch on severity and humans filter on confidence — two
   vocabularies doing one job would force every consumer to reconcile them; runtime validation
   is what makes output-as-tool a contract instead of a hope. *(draft-level + #19 by Johan;
   re-confirmed on canvas 2026-06-06)*
3. **Agent runner: Pi SDK runtime, output-as-tool with three guards, mutation-free by
   construction.** `@earendil-works/pi-coding-agent` 0.78.x (confirmed successor of
   `badlogic/pi-mono`'s coding-agent; the POC already runs on it — zero porting risk);
   `createAgentSession` per phase run with `systemPromptOverride` carrying the rubric. The only
   way for an agent phase to finish is `submit_findings`, with three eval-earned guards:
   schema-validate-or-retry, idempotency (models were observed submitting 10–13×), no-submit
   fallback (synthesized `error` report + `<phase>.no-result` warning). Edit/write tools are
   never registered — mutation-freedom is enforced at the tool-registration boundary, verified
   by a test. — *why:* the runner recipe is the POC's most battle-tested code (14 fixtures × 6
   models), so the product inherits rather than redesigns it; each guard maps to an observed
   failure mode; a guarantee enforced by construction can't be talked out of by a clever
   prompt. *(Pi SDK by evidence check 2026-06-06; rest draft-level from R&D D3/D6/D7;
   re-confirmed on canvas 2026-06-06)*
4. **Model routing: capability tiers, never provider pins; the binding run is CI's;
   qualification is earned.** Built-in defaults are tiers (`robust` for behavioral/review,
   `fast` for structured phases), resolved at run time against the user's credentialed
   providers; project config speaks tiers only (pins are the user-layer/flag exception); no
   provider satisfying a required tier ⇒ preflight failure. Local runs are advisory; the merge
   gate is CI with pinned routing in its own user layer; `cost.model` makes divergence
   diagnosable. Tier membership is earned on the eval suite, keyed *(model × rubric version ×
   fixture-set version)* — an unqualified model serving a tier emits `harness.unqualified-model`
   (warning; strict CI gates it via `--fail-on warning`). — *why:* provider pins in shared
   config are broken-by-teammate; judgment variance is contained (one binding run), not
   pretended away; "robust" asserted without a scorecard is marketing, not engineering.
   *(review round 1, Johan; re-confirmed on canvas 2026-06-06)*
5. **Specialists: composite phases as first-class machinery; review is the first panel.** A
   phase may declare parallel narrow sub-agents, each the same configuration shape (rubric +
   toolset + model + activation); the phase stays the *reporting* unit, specialists the
   *execution* unit, with uniform mechanics (own `submit_findings` + all three guards,
   per-specialist cost, emitting specialist on each finding, one failing never loses the
   others' findings). Review's panel: bugs, security, patterns, quality, coverage-gaps — and
   "tests missing/stale" judgment moved from Phase 4 to `coverage-gaps` (it judges the code,
   not the tests). Deferred: custom user-defined specialists (the plugin system v1 excludes)
   and cross-specialist dedup/adversarial-verify (disjoint by rubric design; verify stage is
   the known fix if noisy). — *why:* a panel of narrow rubrics beats one kitchen-sink
   generalist, but only with uniform machinery — bespoke fan-out per phase would re-create the
   five-bespoke-engines problem inside a phase; consumers never need to know a phase was
   composite. *(review round 1, Johan + draft-level deferrals; re-confirmed on canvas
   2026-06-06)*
6. **Scheduler: parallel by default; only failing tests/types/build cancels; teardown is
   total.** All activated phases launch concurrently (wall-clock ≈ slowest phase);
   `sequential` is a config policy for cost-conscious callers; `--continue-on-failure`
   disables cancellation. Gates split into a cancel class (tests/types/build — the code
   doesn't function) and a report-only class (lint/format — the code is untidy), overridable
   per gate; a gate *timeout* is always report-only. Cancellation — gate-triggered or
   interrupt — disposes sessions, kills process groups, tears down services, and still writes
   the partial report with `cancelled` statuses (second Ctrl-C force-kills). — *why:* phases
   are independent by construction, so v1's staged ladder paid latency for nothing; "doesn't
   function" and "untidy" deserve different blast radii; an interrupted verification should
   still tell you what it learned. *(parallel default draft-level from stet-prd principle 6;
   gate classes review round 1, Johan; re-confirmed on canvas 2026-06-06)*
7. **Budgets on by default; flags are escape hatches; POSIX exit codes; visible degradation.**
   Limits (5 min static / 15 min gates+behavioral wall-clock, 50 turns, 60 s bash, 32 KB
   output) are defaults, bundled as `--budget fast|default|thorough`; every breach is a named
   `error` with partial audit — never a silent hang or kill; the behavioral ceiling carries
   real headroom (successful POC web runs ≈ 8 min — a false breach costs a loop an iteration).
   CLI: `--skip`/`--only` generalize v1's ad-hoc flags; `--severity` renamed `--show` (display)
   vs `--fail-on` (gating) — a CI confusion trap otherwise; `--model [<phase>=]<id>` repeatable,
   specific beats general; zero-config `stet` runs everything on tier defaults. Interrupts exit
   `128+signal` (130/143) after writing the partial report; exit 2 stays strictly "stet
   malfunctioned." Large diffs: analyze the highest-churn subset + `<phase>.partial-coverage`
   warning naming exclusions — never chunk, never silently truncate. — *why:* every limit
   default traces to an observed eval failure; a silent kill is indistinguishable from a pass
   to a loop; loops branch on exit codes while humans filter display — the vocabulary split
   keeps those from colliding; stet may do less than everything but must never quietly claim
   more than it did. *(review round 1, Johan; large-diff rule draft-level; re-confirmed on
   canvas 2026-06-06)*
8. **Harness-only focus; the steel thread runs on stub phases.** This brief and the harness
   PRD/plan cover *only* harness machinery — no real phase, not even Phase 1, is in the
   harness's build scope. The steel thread / tracer bullet is a zero-config `stet` run
   end-to-end through stub phases: one stub deterministic phase and one stub agent phase (a
   *real* Pi SDK run with a trivial rubric, so output-as-tool guards, budgets, and the cancel
   path carry genuine traffic) → findings → `RunReport` → exit code. Every harness contract is
   proven before any real phase exists; each real phase (deterministic-gates, behavioral, …)
   then integrates via its own feature plan — each one a fresh proof of the "new phase touches
   no harness code" criterion. init is not needed for the thread (inference over
   configuration: zero-config is the floor, init the upgrade). Known limitation, accepted:
   stub rubrics won't surface eval-grade failure modes; that proof burden stays with the
   behavioral-engine and eval-suite features. — *why:* keeps the harness PRD/plan honest to
   the boundary rule (the harness's own definition of done can't depend on another feature
   shipping) and makes phase-pluggability a demonstrated fact rather than a design intention.
   *(Johan, canvas live exchange 2026-06-06)*
9. **Deliberately deferred, with reasons:** result streaming (NDJSON event mode) — run-then-read
   is the loop contract, confirmed against ideoshi-code; addable later without touching
   `RunReport` *(round 1, Johan)*. Caching (scope hash × phase-config hash) and SARIF — v1.x,
   both enabled by the stable schema, neither needed for first adoption *(draft-level)*.
   Custom user-defined specialists and cross-specialist dedup/verify — see direction 5.
   *(re-confirmed on canvas 2026-06-06)*

## Open questions

### Fork-level (must land before this brief settles)

*(none — settled 2026-06-06. The one reopened item on the walkthrough — steel-thread scoping —
landed as decided direction 8.)*

### Detail (the PRD draft can propose answers — tracked in `harness-prd.md` §8)

*All four resolved in PRD review round 2 (canvas, 2026-06-07):* **#20** harness-emitted
findings attach to the concerned phase's report (no pseudo-phase) · **#21** CI pins routing
via `--model` flags in the workflow invocation (env-var layer deferred) · **#22** turn
ceilings follow the wall-clock class (50 / 120) · **#23** `RunReport` carries `stet` semver +
`startedAt` (cache key excludes the timestamp). Details and rationale: `harness-prd.md` §8.

## Scope instincts

**In:** everything needed by ≥2 phases — phase lifecycle + scheduler, agent runner, findings
schema + aggregation, output-as-tool guards, scope detection, spec-context plumbing, config
loading/precedence, output formats, progress streaming, exit codes, budgets, cost accounting —
plus the **stub phases** (one deterministic, one trivial-rubric agent) that constitute the
steel thread and remain as harness test fixtures (direction 8).
**Out (with why):** *all real phases* — including Phase 1 — integrate via their own feature
plans against the `PhaseConfiguration` contract (direction 8: the harness's definition of done
can't depend on another feature shipping). Gate detection/execution (`deterministic-gates`),
the `init` exploration agent (`init` — an ownership exclusion, not a cut; it runs on the
harness's runner, and the thread doesn't need it because zero-config inference is the floor),
all phase rubrics (each phase PRD), behavioral execution tools
(`start-service`/`pty-session`/`browser-execution`), the eval suite (`eval-suite`).

## Glossary seeds

All already promoted to the repo-root `GLOSSARY.md` (harness, phase, specialist, gate,
cancel/report-only class, activation, scope, finding, severity/confidence/priority, gating,
audit, `Check`, RunReport/PhaseReport, output-as-tool, hygiene finding, tier, qualification,
manifest, binding run, project/user config, sparse config, budget/preset).

## Evidence

- `docs/better-planning/research/behavioral-validation-findings.md` — D3 (mutation-free), D6
  (output-as-tool), D7 (loose in / rigorous out), budget hangs observed in evals.
- POC `../validation-agent-poc` — the runner recipe, `ValidationResultSchema` (generalized into
  `Finding`/`Audit`/`PhaseReport`), observed duplicate-submission behavior (10–13× on some
  models).
- npm/GitHub evidence check (2026-06-06) — `@earendil-works/pi-coding-agent` is the maintained
  successor of `badlogic/pi-mono`'s coding-agent.
