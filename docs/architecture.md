# stet — Code Architecture & Design Primer

> **Status:** living orientation doc. Reflects the codebase as of the M1–M8 harness build
> (PR #53). Read this before extending the harness. For the *product* vision see
> `docs/better-planning/product/stet-prd.md`; for build traps see `docs/engineering-notes.md`;
> for vocabulary see `GLOSSARY.md`.

---

## 1. The one-sentence mental model

> **stet is a harness that runs N independent "phases" in parallel over a git diff, collects
> their findings into one versioned report, and turns that report into an exit code — while
> never throwing, never writing, and never letting a green result mean "nothing was checked."**

Everything else is a consequence of that sentence. The core idea: the **harness** (the shared
substrate) is the whole product so far, and each of the five validation dimensions is *just a
configuration* of it. A phase contributes only three things: **a rubric (system prompt) + a
toolset + a model**. Adding a sixth phase is one new file + one `registerPhase()` call — no
harness code changes.

```mermaid
flowchart TB
    subgraph H["the harness (shared substrate)"]
        direction LR
        H1["scope detection"]
        H2["config (4-layer)"]
        H3["scheduler<br/>(parallel + fail-fast)"]
        H4["agent runner<br/>(Pi SDK seam)"]
        H5["findings schema<br/>+ output-as-tool"]
        H6["formats<br/>(human/json)"]
        H7["exit codes"]
    end
    H --> P1["Phase 1<br/>gates<br/><i>(deterministic)</i>"]
    H --> P2["Phase 2<br/>spec compliance"]
    H --> P3["Phase 3<br/>code review<br/><i>(composite)</i>"]
    H --> P4["Phase 4<br/>test quality"]
    H --> P5["Phase 5<br/>behavioral"]
    P1 -.->|"rubric + toolset + model"| H
```

---

## 2. The pipeline — one run, end to end

This is `main()` in `src/cli.ts:308`. Read it as nine sequential stages; the parallelism is
*inside* stage 5.

```mermaid
flowchart TD
    A["argv"] --> B["1. parseFlags()<br/>node:util parseArgs → ParsedFlags<br/><i>cli.ts:198</i>"]
    B -->|"unknown flag"| ERR1["Err(ConfigError) → exit 2"]
    B --> C["2. meta flags<br/>--version / --help return early"]
    C --> D["3. loadConfig()<br/>built-in → user → project → flags<br/>+ unknown-key warnings · <i>config/load.ts</i>"]
    D --> E["3b. buildSpecContext()<br/>--prd/--task → {text, sources}<br/><i>spec-context.ts</i>"]
    E --> F["4. detectScope()<br/>staged→working→branch→commit<br/><i>scope.ts</i>"]
    F --> G["4a. getScopeDiff()<br/>the unified diff text"]
    G --> H["4b. filterDiff()<br/>strip lockfiles/minified/vendored/@generated<br/>→ {filteredFiles, strippedFiles, filteredDiff}"]
    H --> I["<b>5. runPhases()</b> ◄── THE CORE<br/>parallel · fail-fast cancel · synthesizes skips<br/><i>scheduler.ts</i>"]
    I --> J["6. detect interruption<br/>signal aborted AND a phase cancelled?"]
    J --> K["7. assembleReport()<br/>roll up findings → RunReport + exitCode<br/><i>report.ts</i>"]
    K --> L["8. parseRunReport(report)<br/>self-check: our own output must validate"]
    L -->|"invalid"| ERR2["Err(SchemaError) → exit 2"]
    L --> M["9. output<br/>JSON (exactly the report) | renderHuman()"]
    M --> N["Result&lt;{exitCode: 0|1|2}, StetError&gt;"]

    style I fill:#2d4a22,stroke:#7cb342,color:#fff
    style ERR1 fill:#5a1e1e,stroke:#e57373,color:#fff
    style ERR2 fill:#5a1e1e,stroke:#e57373,color:#fff
```

The process boundary (`cli.ts:540`) wraps this in `runWithSignals`, calls `resolveExit` (the
single `Err`→exit-2 `matchError`, `cli.ts:100`), runs `teardownServices()`, and sets
`process.exitCode`.

---

## 3. The three load-bearing design decisions

Everything in the codebase is downstream of these. Understand these three and the rest reads
naturally.

### A. `better-result` — typed errors, no throws across boundaries

Every fallible function returns `Result<T, E>`. There is **exactly one** throw→exit boundary:
`resolveExit` in `cli.ts:100`, which does an exhaustive `matchError` over the `StetError` union
(`ScopeError | ConfigError | RoutingError | BudgetError | SchemaError`, all in `src/errors.ts`).
Adding a new error variant is a **compile error** until that match handles it. Errors are
first-class test targets — assert `result.isErr()` and the tag, never `expect().toThrow()`.

There's a deliberate split:

```mermaid
flowchart LR
    subgraph SE["StetError → exit 2 (stet malfunctioned)"]
        SE1["ScopeError"]
        SE2["ConfigError"]
        SE3["RoutingError"]
        SE4["BudgetError"]
        SE5["SchemaError"]
    end
    subgraph AE["AgentError → phase-level (becomes PhaseReport status:error)"]
        AE1["NoSubmitError"]
        AE2["CancelledError"]
        AE3["ModelError"]
        AE4["BudgetError"]
    end
    SE -->|"resolveExit matchError"| EXIT["exit code 2 + stderr message"]
    AE -->|"matchError in agent-phase"| REPORT["PhaseReport{status, reason, findings}"]
```

### B. The infallible phase boundary

`PhaseConfiguration.run()` **never throws and never rejects** (`phases/types.ts:72`). Any
internal failure is converted to a `PhaseReport{ status: "error", reason }`. This is what makes
`Promise.all` over phases safe — one phase blowing up can't take down the run. A phase is a pure
data value (no class, no inheritance):

```ts
interface PhaseConfiguration {
  id: PhaseId;                          // open kebab-case string, not a closed enum (decision #28)
  kind: "deterministic" | "agent";
  activation: (ctx) => boolean;         // pure predicate: should I run for this scope?
  run: (ctx) => Promise<PhaseReport>;   // INFALLIBLE — never throws, never rejects
  toolset?: string[];                   // agent phases expose their allowlist (auditable)
  cancelClass?: boolean;                // my failure cancels in-flight agents
  consumesDiff?: boolean;               // I inject the diff → respect the budget
}
```

### C. Mutation-free by construction

There is no `--fix`, anywhere, by design. The invariant is enforced at the **call boundary, not
at runtime**: a phase's `toolset` is a string array that simply never contains write tools, and
it's exposed on the registered phase so it's *auditable*. The agent runner replaces the SDK's
unrestricted `bash` with a limited custom one (`pi-runner.ts`). The one honest gap: `bash`
remains a residual write surface until Phase 5 builds a sandbox (PRD decision #34).

---

## 4. The scheduler — where "parallel by default" lives

`runPhases(phases, ctx)` in `scheduler.ts` is the heart.

```mermaid
flowchart TD
    START["runPhases(phases, ctx)"] --> LOOP{"for each phase"}
    LOOP -->|"activation() false"| SKIP["synthesize<br/>PhaseReport{status: skipped, reason}"]
    LOOP -->|"activation() true"| RUN["runPhaseGuarded()<br/>wraps exceptions, budgets diff"]
    RUN --> PALL["Promise.all<br/>(all activated phases concurrently)"]
    PALL --> GATE{"cancelClass phase<br/>completed with<br/>error finding?"}
    GATE -->|"yes"| ABORT["gateController.abort()<br/>reason: 'gates failed: id'"]
    GATE -->|"no"| COLLECT["collect PhaseReport[]"]
    ABORT --> INFLIGHT["in-flight agent phases<br/>→ status: cancelled"]
    INFLIGHT --> COLLECT
    SKIP --> COLLECT
    COLLECT --> OUT["PhaseReport[]<br/>(one per configured phase, always)"]

    EXT["external SIGINT/SIGTERM"] -.->|"AbortSignal.any"| ABORT

    style PALL fill:#2d4a22,stroke:#7cb342,color:#fff
    style GATE fill:#4a3d1e,stroke:#d4a017,color:#fff
```

Key behaviours (PRD §3.4.2):

- **All activated phases launch concurrently** via `Promise.all` → wall-clock ≈ slowest phase,
  not the sum.
- **Skips are synthesized**: a phase whose `activation()` returns false becomes a `skipped`
  report with a named reason. Every configured phase appears exactly once — a green report can
  never silently mean "this phase didn't run."
- **Fail-fast cancellation**: when a `cancelClass: true` phase (the gates) *completes with an
  error finding*, the internal `gateController` aborts; in-flight agents get the signal and
  return `cancelled`. A gate *timeout* (`status:"error"`) is **report-only** — only a gate that
  actually ran and failed proves the code is broken.
- **Signal merging**: external SIGINT/SIGTERM and the internal gate controller combine with
  `AbortSignal.any([...])`.
- **Diff budgeting**: `budgetDiff()` is computed *once* per run; only phases with
  `consumesDiff: true` receive the trimmed diff. The risk classifier deliberately does *not* set
  it — it needs the full diff so a risk-relevant file in the over-budget tail can't escape.
  Excluded files surface as a `<phase>.partial-coverage` warning — never a silent truncation.

---

## 5. The agent substrate — "output-as-tool"

The most novel mechanism. An agent phase finishes **only** by calling the `submit_findings`
tool — there is no other way to produce a result.

```mermaid
flowchart TD
    MAP["makeAgentPhase(runner, {rubric, toolset,<br/>submitSchema, budgets, model, buildUserPrompt})"]
    MAP --> WC["runWithWallClock()<br/>races runner.run() vs timer<br/>abort merges with external signal"]
    WC --> RUNNER{"AgentRunner<br/>(SDK isolation seam)"}
    RUNNER -->|"production"| PI["PiAgentRunner<br/>@earendil-works/pi-coding-agent"]
    RUNNER -->|"tests"| FAKE["FakeAgentRunner<br/>scripted, deterministic"]
    PI --> SESSION["session.prompt(userPrompt)<br/>systemPromptOverride = rubric"]
    SESSION --> TOOLS{"agent calls tools"}
    TOOLS -->|"read/grep/bash<br/>(read-only)"| TOOLS
    TOOLS -->|"submit_findings"| ST["SubmitTool — THREE GUARDS"]
    ST --> G1["1. schema-validate-or-retry<br/>bad params → 'fix and resubmit'<br/>(state NOT captured)"]
    ST --> G2["2. idempotency<br/>first valid submission wins<br/>(models submitted 10–13× in POC)"]
    ST --> G3["3. no-submit fallback<br/>never submitted → Err(NoSubmitError)<br/>→ synthesized warning finding"]
    G2 --> DONE["Ok({submission, cost})<br/>wrapper overwrites finding.phase = cfg.id"]

    style ST fill:#1e3a4a,stroke:#4fc3f7,color:#fff
    style DONE fill:#2d4a22,stroke:#7cb342,color:#fff
```

Two non-obvious but important details:

- **Provenance is harness-controlled**: after the agent submits, the wrapper *overwrites* each
  finding's `phase` field with the real phase id (`agent-phase.ts:339`). A model cannot fabricate
  a finding attributed to a phase that didn't run.
- **Budgets are two-layered** (`budgets.ts`): the *wrapper* owns wall-clock; the *runner* owns
  bash timeout + output cap. The bash runner uses `detached: true` process groups so one SIGKILL
  kills the shell *and* its children, with a 100ms grace period for background children holding
  the stdout pipe open (a real hang bug — see `engineering-notes.md`).

### Model routing (`src/routing/`)

Configuration, not code. Built-in defaults are **capability tiers** (`robust`, `fast`) →
`TIER_PREFERENCES` ordered lists → resolved at runtime against providers you actually have
credentials for. `runWithFallback` tries models in order (advancing on retryable errors),
`preflightAll` validates every phase can resolve *before* any launch, and `checkQualification`
emits a warning for any model not validated on the eval suite for the current rubric version.

---

## 6. Composite phases — the specialist panel

The richest phase shape (`composite.ts`), used by code review. One phase fans out to **N
specialists** in parallel, then optionally runs a **coordinator (judge pass)**.

```mermaid
flowchart TD
    START["composite run(ctx)"] --> CLASS["classify(diff, paths, riskRules)<br/>deterministic 'how much to spend' dial"]
    CLASS --> LEVEL["riskLevels[level] →<br/>{specialist subset, coordinator on/off}"]
    LEVEL --> FAN["Promise.all specialists<br/>(each a wall-clock-bounded agent, own budget)"]
    FAN --> SA["alpha"]
    FAN --> SB["beta"]
    FAN --> SC["gamma"]
    SA --> ROLL["roll-up<br/>tag each finding with specialist<br/>force phase = cfg.id"]
    SB --> ROLL
    SC --> ROLL
    ROLL --> COORD{"coordinator<br/>configured &<br/>not skipped?"}
    COORD -->|"no"| RAW["return raw roll-up"]
    COORD -->|"yes"| JUDGE["coordinator judge pass<br/>robust-tier agent, dedups/re-ranks"]
    JUDGE -->|"fails"| FALLBACK["raw roll-up<br/>+ coordinator-failed warning<br/>(decision #29: never forfeit findings)"]
    JUDGE -->|"succeeds"| CONSTRAIN["CONSTRAINED AUTHORITY"]
    CONSTRAIN --> C1["cannot drop/downgrade<br/>evidence-backed findings<br/>→ silently reinstated"]
    CONSTRAIN --> C2["all drops recorded in<br/>audit.coordinator<br/>{received, dropped, reinstated}"]

    style CLASS fill:#4a3d1e,stroke:#d4a017,color:#fff
    style JUDGE fill:#1e3a4a,stroke:#4fc3f7,color:#fff
    style CONSTRAIN fill:#3a1e4a,stroke:#ba68c8,color:#fff
```

The coordinator is *machinery* the harness owns; the actual review rubric is the (not-yet-built)
code-review feature's. The constraint design is the key insight: an LLM judge may *improve* the
ranking but is structurally forbidden from *hiding* a deterministic or evidence-backed problem.

---

## 7. The findings/report schema — the contract spine

Everything is TypeBox (`src/schema/`), using the same-name value+type merge pattern
(`export const Finding = Type.Object(...)` + `export type Finding = Static<typeof Finding>`), so
code reads like the wire contract.

```mermaid
flowchart TD
    RR["RunReport (version: 1, additionalProperties: false)<br/>a versioned wire contract"]
    RR --> META["stet, startedAt, scope,<br/>spec{provided, sources}"]
    RR --> PHASES["phases: PhaseReport[]<br/>one per configured phase, ALWAYS"]
    RR --> RESULT["result{exitCode: 0|1|2, failOn,<br/>gating[] ← exact findings that caused exit 1}"]
    RR --> COST["cost{totalInputTokens,<br/>totalOutputTokens, durationMs}"]
    PHASES --> PR["PhaseReport"]
    PR --> PR1["phase, status, reason?, level?"]
    PR --> PR2["findings: Finding[]"]
    PR --> PR3["audit{examined?, checks?,<br/>claims?, coordinator?}<br/>← the anti-silent-green trail"]
    PR --> PR4["cost{model?, inputTokens?, outputTokens?,<br/>durationMs, specialists?, coordinator?}"]
    PR2 --> F["Finding<br/>id, phase, specialist?, severity, confidence,<br/>message, location?, evidence{command?, output?},<br/>suggestion?, meta?"]

    style RR fill:#2d4a22,stroke:#7cb342,color:#fff
    style F fill:#1e3a4a,stroke:#4fc3f7,color:#fff
```

The **gating rule** is deterministic and lives in `exit-codes.ts`: a finding gates exit 1 iff
`severityAtLeast(severity, failOn)` **AND** `confidence === "high"`. So low-confidence AI
opinions never break your build. Severity ordering has a single source of truth — `SEVERITY_RANK`
+ `severityAtLeast` in `schema/finding.ts`.

### Exit-code contract

```mermaid
flowchart LR
    R0["0<br/>clean at threshold"]
    R1["1<br/>≥1 gating finding"]
    R2["2<br/>stet malfunctioned<br/>OR interrupted (partial report)"]
    R3["130 / 143<br/>POSIX 128+signal<br/>(process-level)"]
```

The report's `result.exitCode` stays in the `0|1|2` domain even when the *process* exits
130/143 — a JSON consumer distinguishes "clean" from "interrupted" via `exitCode:2` + cancelled
phases.

---

## 8. Scope & diff acquisition — the input layer

`scope.ts` is the zero-config front door. The auto-detection ladder:

```mermaid
flowchart TD
    START["detectScope(cwd, flags)"] --> EXPLICIT{"explicit<br/>scope flag?"}
    EXPLICIT -->|"yes"| USE["use it<br/>(--staged/--working/--against/<br/>--commit/--commits)"]
    EXPLICIT -->|"no — auto-detect"| R1{"staged changes?<br/>git diff --cached"}
    R1 -->|"yes"| S1["kind: staged"]
    R1 -->|"no"| R2{"working-tree changes?<br/>tracked + untracked vs HEAD"}
    R2 -->|"yes"| S2["kind: working"]
    R2 -->|"no"| R3{"on a named branch<br/>≠ default?"}
    R3 -->|"yes"| S3["kind: against<br/>default...HEAD (3-dot)"]
    R3 -->|"no"| R4{"HEAD resolvable?"}
    R4 -->|"yes"| S4["kind: commit<br/>last commit"]
    R4 -->|"no"| ERR["Err(ScopeError)<br/>nothing detectable → exit 2"]

    style ERR fill:#5a1e1e,stroke:#e57373,color:#fff
```

Subtle correctness work lives here: root-commit handling (no `^1` parent), untracked files via
`git diff --no-index` (mutation-free — never stages), three-dot merge-base form for branch
comparison, and a 50MB buffer for monorepos. `diff-sections.ts` then parses the unified diff
robustly (handles `noprefix`, mnemonic prefixes, quoted paths, combined diffs) and is a *total
function* — it never fails, just skips unparseable sections.

---

## 9. Config — four layers, deep-merged

`loadConfig()` merges leaf-by-leaf (`merge.ts`):

```mermaid
flowchart LR
    L1["built-in defaults<br/>BUILT_IN_DEFAULTS<br/>(failOn: error)"] -->|deepMerge| L2["user<br/>~/.config/stet"]
    L2 -->|deepMerge| L3["project<br/>./stet.config.yml"]
    L3 -->|deepMerge| L4["flags<br/>(highest priority)"]
    L4 --> OUT["merged StetConfig<br/>+ unknown-key warning findings"]

    style L4 fill:#2d4a22,stroke:#7cb342,color:#fff
```

Two things worth knowing: missing files are *no-ops* (zero-config is valid), and unknown keys
become **warning findings**, not errors (forward compat) — surfaced via a synthetic `harness`
phase in the report. The merge has explicit prototype-pollution defense
(`__proto__`/`constructor`/`prototype` keys dropped) because YAML parsers emit `__proto__` as an
own key.

---

## 10. Where the project actually is

To be precise about state (the planning docs say "greenfield," but a lot is built):

- ✅ **The harness is complete and exhaustively tested** — 32 test files, M1–M8: scope, config,
  scheduler, agent runner + Pi SDK integration, composite/coordinator, risk classifier, routing,
  spec-context, diff-filtering, output formats, exit codes, signal/teardown.
- 🚧 **The five real phases are still stubs.** `defaultPhases = [stubDet]`
  (`phases/index.ts`), plus a `stub-agent` wired in the CLI entry. The real
  `gates`/`spec`/`review`/`test-quality`/`behavioral` rubrics are each their own feature PRD, not
  yet implemented. The stubs (`stub-det` runs a shell command, `stub-agent` finds TODOs,
  `stub-composite` has alpha/beta/gamma specialists) are the *steel thread* that proves the
  machinery end-to-end.

**The chassis is finished and proven; the engines are the next build.** The first real one is
`deterministic-gates` (Phase 1) — deterministic (no LLM, lowest risk), and `stub-det` already
shows the exact shape.

---

## 11. How to read the code yourself

Trace one thread and it touches every subsystem above:

```
src/cli.ts:308  main()
   → scheduler.ts   runPhases()
       → phases/stub-det.ts   run()
   → report.ts   assembleReport()
   → output/human.ts   renderHuman()
```

| If you want to understand… | Start here |
|---|---|
| The whole run | `src/cli.ts` `main()` |
| Parallelism + cancellation | `src/scheduler.ts` `runPhases()` |
| The phase contract | `src/phases/types.ts` |
| How an agent phase works | `src/phases/agent-phase.ts` + `src/agent/runner.ts` |
| Output-as-tool guards | `src/agent/submit-tool.ts` |
| The specialist panel + judge | `src/phases/composite.ts` + `coordinator.ts` |
| The wire contract | `src/schema/report.ts` + `src/schema/finding.ts` |
| Exit-code gating | `src/exit-codes.ts` |
| Scope auto-detection | `src/scope.ts` |
| Error taxonomy | `src/errors.ts` |
</content>
</invoke>
