# Engineering Notes — non-obvious gotchas

Hard-won traps from building the harness (M1, M2) and from code review. Read this before
extending the agent runner, the schemas, or the build — each item below cost someone an hour to
discover. This is **engineering** knowledge (SDK/toolchain/library quirks); **product** decisions
live in `product/features/harness/harness-prd.md` (decisions table) and `…/harness-plan.md` §6,
which this file links to rather than restates.

Keep it curated: add an entry only when it's non-obvious AND expensive to rediscover. Delete
entries that become obvious (e.g. once a wrapper makes the trap unreachable).

---

## Pi SDK — `@earendil-works/pi-coding-agent` 0.79.x

The agent runner (`src/agent/pi-runner.ts`) is the only place that touches the SDK. M3+ extends it,
so these matter most.

- **Read cost while the session is LIVE — before `dispose()`.** `session.getSessionStats()` reads
  `this.state` (the in-memory message list); `dispose()` tears that down. Calling it after dispose
  is order-dependent and can throw. Capture stats inside the `try`, before the `finally`.
  (Bug found in T10 review.)
- **`dispose()` can throw — guard it in `finally`.** `AgentSession.dispose()` wraps its abort hooks
  but calls `cleanupSessionResources()` *unguarded* (can throw `AggregateError`). A throw in a
  `finally` supersedes the computed `Result`, breaking the never-throws contract. Always
  `finally { try { session?.dispose() } catch {} }`. (PR-review #5.)
- **`DefaultResourceLoader.reload()` is async filesystem I/O and can reject** — keep its
  construction + `await reload()` inside the `try`, not before it. (PR-review should-fix.)
- **`defineTool({ execute })` is a 5-arg signature in 0.79:**
  `(toolCallId, params, signal, onUpdate, ctx)` — not the POC's 2-arg `(id, params)`. Extra params
  are assignable so a 2-arg fn compiles, but match the real shape with `_`-prefixed unused params.
- **To actually stop the agent after submission, set `AgentToolResult.terminate: true`.** Returning
  "you are done — stop now" *text* does not stop the loop (the POC observed models submitting
  10–13×). The submit tool returns `terminate: handler.hasSubmission`. The type is defined in
  **`@earendil-works/pi-agent-core`** (re-exported by `pi-coding-agent`); semantics: "early
  termination only when *every* finalized tool result in the batch sets it true." (PR-review #4.)
- **There is no read-only `bash`.** `BashToolOptions` exposes `operations`/`commandPrefix`/
  `shellPath`/`spawnHook` but no readonly flag, so a registered `bash` is an unrestricted write
  surface — the "mutation-free" guarantee covers `edit`/`write` only. This is **decision #34**
  (tracked follow-up: sandbox / read-only mount / `spawnHook` denylist, landing with Phase 5).
- **Cost source:** `getSessionStats().tokens.{input,output}` → `inputTokens`/`outputTokens`; there's
  also `.cost` (USD) which the harness `Cost` schema has no field for (tokens are the currency).
  Measure `durationMs` yourself around the run.
- **Model resolution:** `ModelRegistry.create(AuthStorage.create()).find(provider, id)` reads
  `~/.pi/agent/auth.json` — the same auth the `pi` CLI uses. Provider names are the registry's, e.g.
  `openai-codex`, `opencode-go` — **not** bare `openai`/`anthropic`. List with `pi --list-models`.
  A model unset/undefined or absent from the registry must become `Err(ModelError)`, validated
  *before* constructing any SDK object (keeps fast-fail hermetic).
- **Version drift:** `vp add` resolved **0.79.1**, not the plan's 0.78.x (API-compatible). See
  PRD decision #5 and plan §6.

## Vite+ toolchain

- **`vp test <filter>` matches file PATHS, not `describe` names.** `vp test guards` finds nothing if
  the tests live in `submit-tool.test.ts`; use `vp test submit-tool`. (Tripped T8's accept line.)
- **`vp pack` with `dts: true` fails here** — the globally-installed vite-plus dts generator can't
  resolve the project's `typescript`. stet is a CLI (no public API), so `vite.config.ts` sets
  `dts: false`. `vp pack` is the CLI/library build; `vp build` is for web apps (it wants an
  `index.html`). (Build fix; plan §6.)
- **Importing a `.test.ts` file from another test file double-runs its tests.** The imported
  module's top-level `describe`/`it` execute again under the importer. Put shared test helpers in a
  **non-test** module — see `src/test-support/{stub-repo,io}.ts`. (Bug found in T11 review.)

## TypeBox & schemas

- **`PhaseId` pattern `^[a-z][a-z0-9-]*$` rejects dots and uppercase.** `"gates.foo"` is *invalid*
  and fails `Value.Check` before any downstream logic — don't use dotted ids in tests/fixtures.
- **Same-name value+type export merging:** schemas `export const Finding` *and* `export type
  Finding`, so a single `import { Finding }` gives both — use `Finding` directly in type position;
  never write inline `import("…/finding.js").Finding`.
- **`Type.Intersect` + `additionalProperties:false` is mutually exclusive at runtime** (each member
  rejects the other's props). Model `A & B` as one flat `Type.Object`. (See the note in
  `src/schema/report.ts`.)

## better-result / the never-throws contract

- **The contract's blind spots are code OUTSIDE the `try` in an async fn:** anything before the try
  (loader/SDK construction), anything in a `finally` (dispose), and `.value`/`.error` accessed on
  the wrong `Result` branch. When auditing a "never throws" function, check those three first.
- **Two error universes, kept separate:** `AgentError` (`NoSubmitError`/`BudgetError`/
  `CancelledError`/`ModelError`) is **runner-level** → becomes a phase `error` PhaseReport via the
  wrapper's exhaustive `matchError`. `StetError` is the **CLI-shell** union → exit codes. Don't
  merge them. The phase wrapper (`src/phases/agent-phase.ts`) is the infallible boundary: the runner
  returns a `Result`, the wrapper converts it to a `PhaseReport` and never throws.

## CLI architecture

- **Lazy-load heavy/optional deps with dynamic `import()` inside the entry-block `try`.** A static
  top-level `import` of the Pi SDK loaded it on *every* invocation (incl. `--version`, ~0.5 s) and
  put load-time throws *outside* the exit-2 boundary → Node exit 1 (which the contract reserves for
  "gating findings"). Dynamic import inside the try fixes both. (PR-review #2.)
- **`main(argv, io, phases)` takes phases as a parameter; the entry block is the only impure wiring
  layer.** This keeps `defaultPhases` a pure static value and keeps in-process tests isolated from
  entry-block changes (they pass explicit phase arrays).
- **Provenance is harness-owned, not model-owned.** The agent-phase wrapper overwrites each
  finding's `phase` with the running phase id — a model's submitted `phase` field is advisory and
  must not flow into the report/gating list. (PR-review #8.)

## Testing

- **Mock at the seam you own (`FakeAgentRunner`), never at SDK internals** — the guards' failure
  modes (`invalid submit`, `duplicate`, `no-submit`, `budget`) are *scripted*, not hoped-for. The
  real SDK is behind one adapter, covered by a keyed/skippable suite
  (`describe.skipIf(!process.env.PI_TEST_MODEL)`).
- **Run the keyed real-SDK smoke before stacking new work on the runner.**
  `PI_TEST_MODEL=openai-codex/gpt-5.4-mini vp test pi-runner.integration` exercises the live path.

## Known residual issues / watch-items

- **`bash` mutation surface** — decision #34 (above); the M2 mutation-free test asserts only the
  `edit`/`write` registration bar.
- **`fixtures/stub-repo/src/main.ts:5`** is a descriptive comment that itself contains the word
  `TODO`, so the literal `/\bTODO\b/` rubric matches **3** lines, not the "two" the comment claims.
  Harness behaves correctly; the fixture's doc-comment is self-referential. No test depends on the
  count. Tidy when convenient (reword line 5).
