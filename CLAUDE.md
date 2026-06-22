# CLAUDE.md

## What This Is

`stet` is a standalone CLI that validates code changes across five dimensions: deterministic checks (tests, types, lint), spec compliance (does the diff satisfy the PRD/task?), general code review (quality, bugs, security), test quality analysis (are the tests meaningful?), and behavioral verification (what should be tested end-to-end, and in v2, actually executing it). It is designed to be invoked by humans, by AI agents, by autonomous loops like ideoshi-code, or by CI systems — anywhere code needs verification before it's trusted.

## Development Discipline: TDD (Required)

Use the tdd skill.

## Error Handling: `better-result` (Required)

The harness uses [`better-result`](https://better-result.dev) for typed error handling
(`vp add better-result`). **Full discipline:** every function that can fail returns
`Result<T, E>` and **never throws across a module boundary**; errors are a `TaggedError`
taxonomy in `src/errors.ts`; compose with `Result.gen`; the **only** throw→exit boundary is the
outermost CLI shell, which `matchError`s the top-level error union into an exit code + message
(tool errors → exit 2). This makes stet's "nothing passes silently" principle compiler-enforced.
Error variants are first-class TDD targets — assert `result.isErr()` and the tagged variant, not
a thrown exception. Rationale and scope: `docs/better-planning/product/features/harness/harness-plan.md`
§2a + decision P7.

## Project Direction & Documentation (read before starting)

**Status:** the **harness is built** — all milestones in `harness-plan.md` (M1–M9 + M7.5) are
merged and `src/cli.ts` is a working CLI (det. tracer → steel thread → budgets → scheduler →
config precedence → model routing → composite specialists → coordinator + risk classifier →
spec context → human output). The next build is the **Phase 3 `code-review` feature** (its PRD is
settled; next artifact is the implementation plan). Still start from the docs — `harness-prd.md`
and `harness-plan.md` describe what the code implements.

**Documentation:** see `docs/better-planning/README.md` for the doc map, status index, and
workflow — planning runs on the **better-planning skill family** (brainstorm → prd → plan →
tasks, canvas for review) operating on that space. Docs flow broad → specific: research/findings
→ brainstorm **briefs** → **high-level PRD** (`docs/better-planning/product/stet-prd.md`,
drafted) → per-feature PRDs → per-feature implementation plans → task breakdowns. Write them in
that order. A feature's artifacts all live together in
`docs/better-planning/product/features/<feature>/` (`<feature>-brief.md`, `<feature>-prd.md`,
`<feature>-plan.md`, `<feature>-tasks.md`; harness feature fully built, code-review PRD settled).
The original PRD (`docs/better-planning/archive/stet-prd-v1.md`) is historical, superseded by the
fresh high-level PRD. Every PRD has a companion `<name>-overview.html` for visual review.

**Terminology:** `GLOSSARY.md` is the shared vocabulary (harness, phase, specialist,
finding, tier, …). Use those terms exactly, and update the glossary in the same change that
introduces or renames a term.

**Engineering gotchas:** `docs/engineering-notes.md` collects non-obvious, rediscovery-expensive
traps from building the harness — Pi SDK 0.79.x quirks (dispose/cost/terminate/no-readonly-bash),
Vite+ toolchain (`vp test` filters by path, `dts: false`, test-file double-import), TypeBox/schema
and never-throws blind spots. **Read it before extending the agent runner, the schemas, or the
build.** Add an entry when you hit a new trap.

**Behavioral verification (Phase 5) R&D is done.** A prototype in the sibling repo
**`../validation-agent-poc`** proved a diff-blind, mutation-free behavioral validator. Findings are
captured in **`docs/better-planning/research/behavioral-validation-findings.md`** — read it before writing any
behavioral-verification spec. Mine the POC for the engine/rubric/verdict schema, 14 fixtures + a
content-aware grader, and the browser provisioning recipe.

**Principle upgrades from that R&D** (now baked into the fresh PRD): behavioral verification is
**diff-blind** (derives claims from the spec, not the diff) and **mutation-free** (no write tools
anywhere — `--fix` was cut from the product entirely; stet reports, the caller fixes); it reaches
a **verdict** surfaced as **findings**; a **blunt conservative rubric beats a precise permissive
one**; and the **browser must be provisioned**, never self-installed at validation time. Caveat:
the R&D validated Phase 5 + cross-cutting principles, NOT the static phases 1–4. The findings doc
§10 open decisions are all **resolved** — traceability table in `docs/better-planning/product/stet-prd.md` §12.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->
