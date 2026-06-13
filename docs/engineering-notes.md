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

## Bash limits (`runBash`, `src/agent/budgets.ts`)

- **`shell: true` + killing the shell does NOT kill its children.** Spawning `runBash`'s command
  via `spawn(cmd, [], { shell: true })` runs `sh -c <cmd>`; killing that shell PID leaves grandchild
  processes (e.g. `yes`) alive, and they inherit the shell's stdout pipe and hold it open
  *indefinitely* → the `close` event never fires → the test (and the real phase) hangs. Fix: spawn
  with `detached: true` so the child becomes a process-group leader (pgid = child.pid), then kill the
  whole group with `process.kill(-child.pid, "SIGKILL")`. This is what makes the output-cap path
  (kill-on-cap for infinite producers) actually terminate. (T13.)
- **An already-aborted `AbortSignal` never fires its `abort` event.** Registering
  `signal.addEventListener("abort", kill)` does nothing if the signal was *already* aborted before
  the listener was attached — standard DOM semantics. `runWithWallClock` abandons the runner promise
  on timeout, so an orphaned runner issuing a bash call with the (now-aborted) wall-clock signal
  would otherwise burn the full `bashTimeoutMs` (60s) instead of dying instantly. Always check
  `signal.aborted` and `kill()` eagerly before/instead of registering the listener. Note: the
  per-tool `options.signal` that reaches `runBashForSdk` is the SDK's *session* signal, not the
  wall-clock signal directly — it only aborts because `PiAgentRunner` wires
  `inputs.signal → session.abort()` after session creation. Without that wiring (pre PR #41 review)
  the eager check was unreachable in production. (T13, PR-review.)
- **The SDK bash wrapper signals kills IN-BAND, not via `exitCode`.** `BashOperations.exec` returns
  `{ exitCode: number | null }`, and the wrapper (`core/tools/bash.js:296`) treats `exitCode === null`
  as **success** (`if (exitCode !== 0 && exitCode !== null) throw`). So returning `{ exitCode: null }`
  for a timed-out/killed command renders to the model as a clean "(no output)" success — a silent kill,
  exactly what M3 forbids. The SDK's own local ops instead **throw**: `"aborted"` → "Command aborted",
  and `` `timeout:${secs}` `` → "Command timed out after N seconds" (the wrapper string-matches these).
  The output-cap path is the exception — its marker rides inside the streamed `output`, so `exitCode: null`
  is fine there. `runBashForSdk` (the exec adapter) mirrors this: deliver output via `onData` FIRST
  (the wrapper appends status text to it), then throw `timeout:N`/`aborted`; only the cap path returns
  normally. (T13, PR-review #1.)
- **The model-supplied `timeout` is in SECONDS and must be honored as a floor, not ignored.** The bash
  tool schema advertises `timeout` (seconds) and the wrapper forwards it to `exec`. Use
  `min(model timeout × 1000, bashTimeoutMs)` so the budget stays a hard ceiling but a shorter
  model request is respected. (T13, PR-review #2.)

## Scheduler signal seam (`src/scheduler.ts`, M4/T14)

- **`FakeAgentRunner.DelayScript` always uses "aborted by wall-clock budget" as the `CancelledError` message.**
  This is a hardcoded string even when the abort was triggered by the scheduler's signal (not the wall clock).
  Tests asserting on this reason should match `/abort/i` (appears in "aborted"), NOT `/cancel/i` (does not
  appear). The status being "error" + a `CancelledError` under the hood is the meaningful distinction. (T14.)
- **`ctx.signal → wallClockController.abort()` wiring uses the same eager-abort pattern as `runBash`.**
  An already-aborted `AbortSignal` never fires its "abort" event (DOM semantics), so always check
  `ctx.signal?.aborted` first and call `wallClockController.abort()` eagerly; otherwise a pre-aborted
  scheduler signal would let the phase run until its wall-clock budget expires (10–15 min). (T14.)
- **`AbortSignal.any([external, internal])` is the right tool to merge the scheduler's external signal
  (T16 POSIX) with the internal gate-cancel controller, and it propagates the `reason` of whichever
  signal fires first.** That reason propagation is what lets an agent phase surface `"gates failed: <id>"`
  in its cancelled report — the gate's `gateController.abort("gates failed: <id>")` reason rides the
  combined signal down to `ctx.signal.reason`. (T15.)
- **`controller.abort()` called WITHOUT a string reason leaves `signal.reason` as a `DOMException`, not a
  string.** Always guard with `typeof signal.reason === "string"` before using it as a human-readable
  reason; fall back to a literal otherwise. (T15.)
- **Only `status: "completed"` + an error-severity finding counts as a gate "failure" for cancellation;
  `status: "error"` (wall-clock timeout, spawn failure) is ALWAYS report-only** regardless of `cancelClass`
  (PRD §3.4.3 — a merely-slow suite must not nuke the AI phases). Encoded in `isGateFailure`. (T15.)
- **A `kind: "ok"` `FakeAgentRunner` cannot test "was NOT cancelled" — it never reads `inputs.signal`.**
  It resolves `Result.ok` synchronously before any gate report can fire an abort, so a negative-path test
  paired with it passes even against a scheduler that cancels on every outcome. Use a `kind: "delay"`
  runner (the only script that respects `inputs.signal`): correct behavior → natural expiry → `NoSubmitError`
  → status `"error"`; a wrongful cancel → `CancelledError` + aborted signal → status `"cancelled"`. Then
  `status !== "cancelled"` has real discriminating power. (T15, PR-review.)

## POSIX signal handling (`src/signals.ts`, T16)

- **Use `process.rawListeners(sig)` to unit-test signal handlers without triggering Vitest's own
  handlers.** `process.emit("SIGINT")` fires ALL registered handlers including the test runner's,
  which may terminate the test process. `rawListeners` returns the actual function (for `on`) or
  the wrapper (for `once`); calling it directly is safe and isolated. (T16.)
- **Method signatures in interfaces cause `typescript(unbound-method)` lint warnings when
  destructured.** `interface F { foo(): void }` signals the linter that `foo` might rely on `this`
  when used as a standalone fn after destructuring. Use property-typed arrow-fn signatures instead:
  `interface F { foo: () => void }`. The runtime behavior is identical but the linter is satisfied.
  (T16.)
- **Signal exit codes are 128 + signal number (POSIX).** SIGINT (2) ⇒ 130; SIGTERM (15) ⇒ 143.
  Exit 2 stays reserved for tool errors. A second SIGINT during teardown calls `process.exit(130)`
  directly — no report is written, teardown is refused. SIGTERM has no second-signal escalation.
  (T16, PRD §3.4.4.)
- **Integration tests for signal handling need a spawned subprocess fixture.** You cannot send a
  real SIGINT to the test process from within a test without risking killing Vitest. Spawn a
  separate bun child process (`bun run fixtures/signal-test/run.ts`), wait for a "READY" line on
  stdout, then call `proc.kill("SIGINT"/"SIGTERM")`. Bun runs `.ts` files natively so no
  compilation step is needed. (T16.)

## Testing

- **Mock at the seam you own (`FakeAgentRunner`), never at SDK internals** — the guards' failure
  modes (`invalid submit`, `duplicate`, `no-submit`, `budget`) are *scripted*, not hoped-for. The
  real SDK is behind one adapter, covered by a keyed/skippable suite
  (`describe.skipIf(!process.env.PI_TEST_MODEL)`).
- **Run the keyed real-SDK smoke before stacking new work on the runner.**
  `PI_TEST_MODEL=openai-codex/gpt-5.4-mini vp test pi-runner.integration` exercises the live path.

## Config loading (`src/config/`, M5/T17)

- **TypeBox `{ additionalProperties: true }` does NOT add an index signature to the TypeScript `Static<>` type.** At the TypeScript level, `Type.Object({ failOn: ... }, { additionalProperties: true })` produces `{ failOn?: Severity }` — no `[key: string]: unknown`. Tests or callers that try to pass extra keys (e.g. `{ failOn: "error", format: "json" }`) get a `TS2353` error. Use `phases.<id>` (typed `Record<string, unknown>`) for test scenarios requiring extra keys, or cast. (T17.)
- **Plain `{ ...base, ...overlay }` silently drops base values when overlay has `undefined` entries.** The four-layer merge must skip `undefined` overlay values explicitly (iterate `Object.entries`, check `if (overlayVal === undefined) continue`) — otherwise a flag overlay that only sets `output.failOn` would wipe out any other keys that weren't specified in the flag object. (T17.)
- **`BUILT_IN_DEFAULTS` makes the "all four layers simultaneously" acceptance test concrete.** Without a non-empty built-in layer there is nothing to distinguish from "no config at all". With `output.failOn: "error"` as the built-in default, the merged config always has a `failOn` value after loading; the CLI's residual fallback (`?? BUILT_IN_DEFAULTS.output.failOn`) exists only because the TypeBox static type keeps the key optional — it references the constant, never a second literal, so the default has one source of truth. (T17.)
- **`deepMerge` must skip `__proto__`/`constructor`/`prototype` keys.** The `yaml` package (like `JSON.parse`) emits a `__proto__:` mapping as an OWN enumerable key, and `result[key] = overlayVal` on that key invokes the inherited prototype setter — swapping the merged config's prototype to config-file-controlled data (invisible to `Object.keys`/`JSON.stringify`, visible to every `config.x?.y` lookup). Verified by runtime repro during the T17/T18 review. (T17 review.)
- **`bun install` adds workspace catalog fields to `package.json` and creates `bun.lock`.** Both are gitignored (settled decision from T13 review). Revert `package.json` with `git checkout -- package.json` after installing deps. Do NOT commit `bun.lock`. (T17, recurring trap.)

## Model routing (`src/routing/`, M6/T19–T20)

- **`bun install` modifies `package.json`** — adds `workspaces.catalog` and `overrides` fields. Revert with `git checkout -- package.json` before committing. `bun.lock` is gitignored; `package.json` is not. (T20, recurring trap from T17.)
- **`qualify.ts` is pure (no I/O) by design.** `checkQualification(model, tier, entries)` takes the already-read manifest entries as a parameter. The I/O is in `readManifest(path)`. This separation means qualification logic is testable without temp files and the caller controls where the manifest comes from. (T20.)
- **Missing manifest → `Ok([])`**, not an error. An absent `fixtures/manifest.json` means zero qualification entries, which causes the `harness.unqualified-model` warning for every model. Conservative default — callers with no manifest see a warning, not a crash. (T20.)
- **Version bump invalidation is implicit.** `CURRENT_RUBRIC_VERSION` and `CURRENT_FIXTURE_SET_VERSION` are the harness's "expected" values. Bumping either constant invalidates all manifest entries that don't match, without editing the manifest itself. Entries with old versions simply stop matching `checkQualification`'s four-field equality check. (T20.)
- **`HARNESS_PHASE_ID`** is in `src/schema/finding.ts`. Import it from there in any module that emits harness findings — don't redeclare locally. (T20.)

## Known residual issues / watch-items

- **`bash` mutation surface** — decision #34 (above); the M2 mutation-free test asserts only the
  `edit`/`write` registration bar.
- **`fixtures/stub-repo/src/main.ts:5`** is a descriptive comment that itself contains the word
  `TODO`, so the literal `/\bTODO\b/` rubric matches **3** lines, not the "two" the comment claims.
  Harness behaves correctly; the fixture's doc-comment is self-referential. No test depends on the
  count. Tidy when convenient (reword line 5).
