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

**Status:** greenfield — `src/cli.ts` is a stub. The project is being (re)specified before
implementation. Start from the docs.

**Documentation:** see `docs/better-planning/README.md` for the doc map, status index, and
workflow — planning runs on the **better-planning skill family** (brainstorm → prd → plan →
tasks, canvas for review) operating on that space. Docs flow broad → specific: research/findings
→ brainstorm **briefs** → **high-level PRD** (`docs/better-planning/product/stet-prd.md`,
drafted) → per-feature PRDs → per-feature implementation plans → task breakdowns. Write them in
that order. A feature's artifacts all live together in
`docs/better-planning/product/features/<feature>/` (`<feature>-brief.md`, `<feature>-prd.md`,
`<feature>-plan.md`, `<feature>-tasks.md`; harness PRD drafted). The original PRD (`docs/better-planning/archive/stet-prd-v1.md`) is historical, superseded by the
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

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
