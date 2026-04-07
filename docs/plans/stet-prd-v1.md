# PRD: stet — Standalone Code Validation Agent

> **stet** — Latin: "let it stand." A proofreader's mark used to indicate that a correction should be ignored and the original retained.

**Package:** `@johanbuys/stet` on npm
**Binary:** `stet`
**Repository:** https://github.com/johanbuys/stet
**License:** MIT

## Overview

`stet` is a standalone CLI that validates code changes across five dimensions: deterministic checks (tests, types, lint), spec compliance (does the diff satisfy the PRD/task?), general code review (quality, bugs, security), test quality analysis (are the tests meaningful?), and behavioral verification (what should be tested end-to-end, and in v2, actually executing it). It is designed to be invoked by humans, by AI agents, by autonomous loops like ideoshi-code, or by CI systems — anywhere code needs verification before it's trusted.

The tool models itself on linters like ESLint: by default it reports findings with severity and confidence scoring, and a `--fix` flag invokes an agent to remediate fixable findings. The name comes from the proofreader's mark meaning "let it stand" — when stet approves a change, it's giving you the editorial green light to ship.

## Problem Statement

As AI-assisted coding grows, the bottleneck shifts from writing code to verifying it. Existing tools handle pieces of this:

- Test runners verify behavioral correctness against tests (but not against intent)
- Linters verify style and surface-level patterns (but not semantics)
- Type checkers verify type correctness (but not logic)
- Code review tools surface diffs to humans (but require humans)

What's missing is a unified tool that can:

1. **Auto-detect what to verify** — staged changes, branch diff, recent commits — without ceremony
2. **Validate against intent** — not just "does it compile and pass tests" but "does it satisfy the spec"
3. **Provide a structured report** that both humans and agents can consume
4. **Fix what it finds** when invoked in fix mode, scoped to its findings

This tool should slot naturally into both human workflows (as a pre-commit check or PR pre-flight) and agent workflows (as a verification gate in autonomous loops).

## Design Principles

**Linter-like ergonomics.** Same mental model as ESLint: reports findings by default, fixes with `--fix`. Severity levels are familiar (error/warning/info). Exit codes follow lint conventions (0 = clean, non-zero = findings).

**Inference over configuration.** The tool should make smart defaults so it works with no flags in the common case. Configuration is for refinement, not for basic operation.

**Deterministic before semantic.** Cheap, fast, deterministic checks run first. Expensive AI analysis runs only when the basics pass — there's no point asking an AI to review code that doesn't compile.

**Findings, not verdicts.** Except for deterministic gates (which are pass/fail), the tool surfaces findings with confidence scores. The user/agent decides what to act on. Avoiding false-positive blocking is critical for trust.

**Fix mode is scoped.** The `--fix` flag dispatches a fix agent, but the agent is constrained: it only modifies code within the diff being verified, only acts on findings above a confidence threshold, and is explicitly forbidden from "fixing" failing tests by changing the tests.

## User Stories

### US-1: Zero-config invocation

**As** a developer who just finished making changes,
**I want** to run `stet` with no arguments and have it figure out what to check,
**So that** verification has zero friction in my workflow.

**Acceptance Criteria:**

- Running `stet` with no arguments auto-detects the verification scope
- Auto-detection priority: staged changes → uncommitted working tree changes → commits on current branch vs the default branch → last commit
- The detected scope is shown clearly in the output ("Verifying: 3 staged files")
- If nothing can be detected (clean working tree, on main branch), the tool exits with a clear message rather than running on the entire codebase

### US-2: Explicit scope flags

**As** a developer or agent invoking the tool programmatically,
**I want** to specify exactly what should be verified,
**So that** I don't depend on auto-detection in scripted contexts.

**Acceptance Criteria:**

- `--staged` verifies staged changes
- `--working` verifies uncommitted working tree changes
- `--against <ref>` verifies the diff between current HEAD and `<ref>` (e.g. `--against main`)
- `--commit <sha>` verifies a specific commit
- `--commits <range>` verifies a range of commits
- Explicit flags always override auto-detection
- Conflicting flags produce a clear error

### US-3: Spec context input

**As** a developer verifying that an implementation matches its spec,
**I want** to provide spec context flexibly — from a file, from stdin, from an inline string, or from a GitHub issue,
**So that** the tool fits naturally into any workflow, whether I'm running it manually, piping from another tool, or invoking it from an autonomous loop.

**Acceptance Criteria:**

_Core input modes:_

- `--prd <value>` accepts spec context. The value is interpreted in this order:
  1. If the value is `-`, read from stdin (e.g. `cat prd.md | stet --prd -`)
  2. If the value is a path that exists on disk, read the file
  3. Otherwise treat it as literal content (for short specs passed inline)
- `--task <description>` accepts an inline task description as a literal string only (no file/stdin overload — if it's long enough to need a file, it's really a PRD)
- Multiple context sources can be combined (e.g. `--prd auth.md --task "focus on the password reset flow"`); they are concatenated and passed together to the spec compliance phase

_GitHub convenience:_

- `--issue <number>` is a convenience wrapper that delegates to the `gh` CLI: `gh issue view <number> --json body,title,comments,url`. Stet does not implement GitHub authentication or API access directly — it inherits whatever auth and configuration the user already has set up for `gh` (including GitHub Enterprise, multiple accounts, SSO).
- If `gh` is not installed or not authenticated when `--issue` is used, the tool prints a helpful error: "The --issue flag requires the gh CLI. Install it from https://cli.github.com/ or pipe issue content directly: `gh issue view <n> --json body -q .body | stet --prd -`"
- The fetched issue is formatted by stet (combining body + relevant comments + URL) before being passed to the spec compliance phase, so findings can cite the issue URL

_Auto-discovery (opt-in):_

- If the commit messages in the verification scope contain issue references (`#N`, `Closes #N`, `Fixes #N`, `[#N]`), the tool can fetch those issues automatically
- Auto-discovery is opt-in via either the config file (`autoContext: true`) or the `--auto-context` flag — never on by default, because it shouldn't make network calls unexpectedly
- Auto-discovery uses the same `gh` delegation as `--issue` and respects the same auth

_Composition with other forges:_

- Stet does not build in support for GitLab, Bitbucket, Gitea, Linear, Jira, or other platforms — that path leads to an unmaintainable tar pit of integrations
- Users on other platforms compose with their own CLIs and pipe to `--prd -`. Examples:
  - GitLab: `glab issue view 42 -F json | jq -r .description | stet --prd -`
  - Linear: `linear issue view ENG-42 --format json | jq -r .description | stet --prd -`
  - Notion, Confluence, etc.: any tool that can dump text to stdout works
- The README should include a "composing with other tools" section showing these patterns so users don't feel like GitHub is privileged

_Fallback:_

- If no spec context is provided through any source, the spec compliance phase is skipped with a clear note in the output ("No spec context provided; skipping spec compliance phase. Pass --prd, --task, or --issue to enable.") — the tool still runs all other phases

### US-4: Phased verification

**As** a developer or agent consuming the verification report,
**I want** the tool to run multiple verification phases in a sensible order,
**So that** I get a comprehensive picture without wasting time on phases that depend on earlier ones passing.

**Acceptance Criteria:**

- The tool runs five phases: deterministic gates, spec compliance, code review, test quality analysis, and behavioral verification
- **Deterministic gates** run first: tests, type checking, linting, build (whichever exist in the project). These run in parallel where possible.
- If deterministic gates fail, the tool reports failures and stops by default. A `--continue-on-failure` flag overrides this to run all phases regardless.
- **Spec compliance, code review, test quality, and behavioral verification** are AI-driven phases that run after deterministic gates pass. They can run in parallel with each other.
- In v1, the behavioral verification phase produces suggestions only — it does not execute anything. Execution is added in v2 and requires explicit sandbox configuration.
- Each phase produces findings independently. Findings from one phase do not affect other phases.
- The tool reports per-phase status and an overall verdict.

### US-5: Test quality analysis

**As** a developer reviewing changes that include new tests,
**I want** the tool to analyze whether the tests are meaningful,
**So that** I catch the common failure mode of "tests that mirror the implementation rather than verify behavior."

**Acceptance Criteria:**

- The test quality phase activates when the diff includes added or modified test files
- It analyzes tests for: behavioral coverage vs. implementation mirroring, edge case coverage, assertion meaningfulness (not just "expect(x).toBeDefined()"), and whether tests would actually fail if the code were wrong
- Findings flag specific tests with explanations, not vague warnings
- If no tests are in the diff, the phase reports "no tests to analyze" rather than failing
- A separate finding type flags new code that has _no_ tests at all, with severity proportional to risk

### US-5b: Behavioral verification suggestions (v1) → execution (v2)

**As** a developer or agent verifying a change that affects runtime behavior,
**I want** stet to recommend an end-to-end verification strategy for the change,
**So that** I know what to actually test in the running system, not just what looks correct in the diff.

**v1 Acceptance Criteria (suggestions only):**

- When the diff touches code that affects observable runtime behavior (HTTP handlers, UI components, CLI commands, background jobs, database migrations), the phase activates
- The phase produces a finding of type "e2e-suggestion" describing what should be verified end-to-end: which user flows or API calls to exercise, what inputs to use, what outcomes to expect
- Suggestions are concrete and actionable — "POST /api/login with valid credentials should return 200 and a session cookie; with invalid credentials should return 401" — not vague — "test the login flow"
- Suggestions include confidence scoring; the agent should be honest when it can't determine the right strategy from the diff alone
- If the project already has e2e tests covering the change, the phase notes this and suggests additions rather than duplicates
- The phase **does not execute** anything in v1 — it only recommends. Execution is explicitly out of scope for v1.
- A `--suggest-only` flag is implicit in v1 (since execution doesn't exist yet); in v2 this flag will let users opt out of execution while keeping suggestions

**v2 Acceptance Criteria (execution, sandboxed):**

- The phase can execute the suggested verification strategy against a running system
- Execution requires an explicit sandboxed environment declared in the config file: test database connection string, base URL for the running app, credentials for test accounts, list of safe-to-call external services (or mocks for them)
- stet refuses to execute if no sandbox configuration is present — falling back to suggestions-only mode with a clear message
- The execution is performed via a browser automation tool (Playwright or similar) for UI flows and an HTTP client for API flows
- All execution is scoped to the sandbox: stet will not call external URLs, will not send real emails, will not write outside the test database
- A pre-execution dry-run shows the user what stet _would_ do before doing it (when invoked interactively)
- Findings from execution are first-class — same severity/confidence model as other phases
- A `--no-behavioral` flag disables this phase entirely for users who want to manage e2e separately

### US-6: Linter-style findings output

**As** a developer or agent consuming the report,
**I want** findings in a familiar, structured format with severity and confidence,
**So that** I can filter, prioritize, and act on them programmatically.

**Acceptance Criteria:**

- Each finding has: severity (error/warning/info), confidence (high/medium/low), phase, file path, line range (when applicable), rule/category, message, and suggested fix (when applicable)
- Default output is human-readable with color and grouping by file
- `--format json` produces structured JSON for programmatic consumption
- `--format sarif` produces SARIF for IDE/CI integration (stretch goal — note in scope if not v1)
- `--quiet` suppresses passing phases, shows only findings
- `--severity <level>` filters findings at or above the specified severity

### US-7: Exit codes for scripting

**As** an automation author wiring this tool into a loop or CI system,
**I want** predictable exit codes,
**So that** I can branch on the result without parsing output.

**Acceptance Criteria:**

- Exit 0: clean — no findings at or above the configured severity threshold, all deterministic gates passed
- Exit 1: findings present at or above the threshold, OR a deterministic gate failed
- Exit 2: tool error (couldn't detect scope, couldn't fetch context, agent invocation failed, etc.)
- The threshold for what counts as "blocking" is configurable via `--max-severity` (default: error)
- AI findings never produce exit 1 unless they have high confidence AND severity at or above the threshold — false positives should not break automation

### US-8: Fix mode

**As** a developer who has reviewed findings and wants them fixed automatically,
**I want** to run `stet --fix` to dispatch an agent that addresses fixable findings,
**So that** I don't have to manually apply suggested fixes.

**Acceptance Criteria:**

- `--fix` runs the verification phases, then dispatches a fix agent for findings marked as fixable
- The fix agent is scoped: it can only modify files within the verified diff
- The fix agent will not modify test files to make tests pass — fixing failing tests requires fixing the code under test
- Only findings above a confidence threshold are auto-fixed (default: high confidence only; configurable via `--fix-confidence`)
- After fixing, the tool re-runs verification to confirm fixes worked
- If the fix loop doesn't converge after N attempts (default 2), it stops and reports remaining findings
- A `--fix-dry-run` mode shows what would be fixed without applying changes
- The fix agent's modifications are shown in a diff at the end

### US-9: Configuration file

**As** a developer adopting this tool in a project,
**I want** to configure project-specific defaults in a config file,
**So that** my team doesn't have to remember which flags to pass.

**Acceptance Criteria:**

- The tool reads `stet.config.yml` (or similar) from the repo root if present
- Configurable: which gates to run, paths to common PRD locations, default severity threshold, custom rules per phase, fix mode confidence threshold, paths to ignore
- CLI flags override config file values
- A `--init` command generates a starter config based on what it detects in the project (test runner, linter, type checker, PRD location)

### US-10: Integration with autonomous loops

**As** a developer running an autonomous coding loop (like ideoshi-code),
**I want** to invoke `stet` as a verification gate after the agent commits,
**So that** my loop benefits from the same validation logic without re-implementing it.

**Acceptance Criteria:**

- The tool can be invoked headlessly inside a Docker container
- JSON output mode (`--format json`) provides machine-readable results
- Exit codes are reliable enough that a wrapping bash script can branch on them without parsing
- The tool does not require interactive input or TTY for any operation
- Documentation includes a "wrapping in autonomous loops" section with example bash invocation

## Phase Details

### Phase 1: Deterministic Gates

Discovers and runs the project's existing tooling. Detection logic:

- Test runner: presence of `package.json` test script, `bun test`, `vitest`, `jest`, or similar markers
- Type checker: presence of `tsconfig.json` triggers `tsc --noEmit` (or `bun tsc --noEmit`)
- Linter: presence of ESLint config triggers `eslint` on changed files; presence of biome config triggers biome
- Build: presence of `package.json build` script — opt-in only since builds can be slow

Runs in parallel where independent. Fails fast unless `--continue-on-failure`.

### Phase 2: Spec Compliance

Inputs: the diff being verified, the spec context (PRD/task/issue).

The phase invokes an AI agent (model TBD — likely Haiku for cost, Sonnet for quality on opt-in) with read-only access. The agent:

- Reads the spec to understand requirements and acceptance criteria
- Reviews the diff to understand what was actually changed
- Identifies requirements that are satisfied, partially satisfied, or missing
- Flags scope creep — changes that aren't called for in the spec
- Outputs findings keyed to specific requirements

Findings have severity: error if a stated requirement is unmet, warning for partial satisfaction or scope creep, info for observations.

### Phase 3: General Code Review

Inputs: the diff, plus enough surrounding code context for the agent to understand patterns.

Categories the agent reviews:

- **Bugs**: clear logic errors, off-by-one, null handling, race conditions
- **Security**: injection risks, auth issues, secret leakage, unsafe deserialization
- **Quality**: dead code, duplication, overly complex functions, naming
- **Patterns**: consistency with surrounding code, adherence to project conventions visible in nearby files

Findings should be high-signal — the tool should err on the side of fewer, more confident findings rather than nitpicks. Confidence scoring is critical here.

### Phase 4: Test Quality Analysis

Activates when the diff modifies test files. Inputs: the new/modified tests, plus the code they test.

The agent analyzes:

- Whether assertions verify behavior or just structure
- Whether tests would fail if the code under test were buggy (mutation-style reasoning)
- Whether edge cases are covered
- Whether tests are tautological (testing the implementation by mirroring it)

Separately, when new code has _no_ tests, that's flagged as its own finding type with severity based on the code's apparent risk (auth code with no tests = error; trivial getter = info).

### Phase 5: Behavioral Verification

Activates when the diff touches code that affects observable runtime behavior — HTTP route handlers, UI components, CLI commands, background jobs, database migrations, anything that the user or another system can observe externally.

**v1 — Suggestions only.** Inputs: the diff, the spec context (if available), and a read of nearby code to understand the application's shape (routing conventions, auth patterns, database access patterns).

The agent produces an end-to-end verification strategy as a finding: which flows to exercise, what inputs to use, what outcomes to assert. Strategies should be concrete enough that a developer or another agent could execute them by hand. The agent explicitly notes when it lacks enough context to design a confident strategy.

If the project already has e2e tests covering similar surface area (detected by file path heuristics — `e2e/`, `tests/e2e/`, `*.e2e.ts`, etc.), the agent reads them and suggests _additions_ rather than duplicates.

**v2 — Sandboxed execution.** The phase gains the ability to actually run the suggested strategy. This requires:

- A `behavioral` section in `stet.config.yml` declaring the sandbox: base URL of the running app, test database connection string, test account credentials, list of external services with their mock endpoints
- A browser automation tool (Playwright or similar) bundled or detected
- A pre-flight check that confirms the sandbox is reachable and isolated from production
- Strict refusal to execute against any URL, database, or service not declared in the config

If sandbox config is missing, the phase falls back to v1 behavior (suggestions only) with a clear message: "Behavioral execution is configured but no sandbox is declared. Add a `behavioral` section to stet.config.yml to enable execution."

A `--no-behavioral` flag disables the phase entirely, for users who prefer to manage e2e separately.

## Out of Scope (v1)

These are explicitly deferred to v2 or later:

- **Behavioral verification execution** — v1 ships with suggestions only; v2 adds sandboxed execution (see Phase 5)
- **Visual regression testing** — image diffing, browser snapshots; depends on Phase 5 execution being in place first
- **Performance benchmarking** — runtime perf comparison vs. baseline
- **License/dependency scanning** — Snyk-style supply chain checks
- **Multi-language support beyond TS/JS** — v1 targets the TypeScript ecosystem
- **IDE plugins** — CLI only in v1; SARIF output enables third-party integration
- **Server mode / daemon** — v1 is invocation-per-run
- **Custom rules** — no plugin system in v1; phases are fixed
- **Distributed execution** — single machine only

## Roadmap

**v0.x — Foundation**

- CLI scaffolding, scope detection, config file loading
- Phase 1 (deterministic gates) fully working
- Findings format and output modes (human, JSON)
- Exit code contract

**v1.0 — AI Phases**

- Phase 2 (spec compliance), Phase 3 (code review), Phase 4 (test quality)
- Phase 5 in suggestions-only mode
- Fix mode for high-confidence findings
- Integration documentation for autonomous loops

**v1.x — Polish**

- SARIF output
- Configuration `--init` command
- Performance optimization (caching, parallel phase execution)

**v2.0 — Behavioral Execution**

- Phase 5 gains sandboxed execution capability
- Sandbox configuration schema in `stet.config.yml`
- Browser automation integration (Playwright)
- Pre-flight sandbox isolation checks
- Dry-run mode for execution previews

**Beyond v2** (no commitments)

- Visual regression, perf benchmarking, multi-language support, plugin system

## Distribution

- Published to npm as `@johanbuys/stet` (personal scope due to npm name similarity restrictions on the unscoped `stet` name)
- Install: `npm install -g @johanbuys/stet` or `bun install -g @johanbuys/stet`
- Binary name: `stet` (set via the `bin` field in package.json, so the daily-use command is unaffected by the scope)
- Requires: Node.js or Bun runtime, `git`, optionally `gh` CLI for issue fetching
- Uses pi for llm
  - https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent
  - https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
  - https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/sdk
- Source repository: https://github.com/johanbuys/stet
- License: MIT

## Success Metrics

- A developer can verify a change with zero arguments in under 30 seconds for a typical diff
- False positive rate on AI findings stays below 10% at high-confidence threshold
- Fix mode converges (passes verification after fix attempt) for at least 70% of fixable findings
- Adopted by at least one autonomous loop (ideoshi-code) as the verification gate within one month of v1
- Can be invoked from a bash script in a Docker container without TTY or interactive prompts

## Open Questions

- Which AI model(s) for which phases? Haiku is cheap and fast but may miss nuance in code review. Sonnet is better but slower and more expensive. Possibly: Haiku for spec compliance and test analysis (more structured tasks), Sonnet for general code review (more judgment-heavy). Configurable via config file.
- How does the tool handle very large diffs that exceed context windows? Chunking strategy, or graceful degradation with a warning?
- Should there be a "watch" mode that re-verifies on file changes? Tempting but probably out of scope for v1.
- How does fix mode interact with version control? Should it commit the fixes itself, leave them staged, or leave them in the working tree? Probably: leave in working tree by default, with a `--fix-commit` flag to commit them.
