# stet — Consumers (draft / parking doc)

**Status:** draft, 2026-06-18. A holding place for *downstream consumer* designs while the harness +
phases are built. Nothing here is on the current build path — it's parked so the decisions aren't lost.
**Depends on:** `stet-prd.md` §6 (CLI contract), the harness `RunReport` schema (`src/schema/report.ts`).
**Boundary:** harness PRD decision **#24** — consumers live *outside* the harness and consume its output;
the harness needs no change to support any of them.

---

## 1. What a "consumer" is

A consumer is anything that **invokes stet and acts on its output**. The contract is deliberately tiny
and already exists:

- **Invoke:** the `stet` CLI (headless, no TTY) — typically `stet --format json --against <base>`.
- **Consume:** the validated `RunReport` JSON (stdout) + the **exit code** (`0` clean · `1` gating finding
  · `2` malfunction · `130/143` interrupted).
- **Type-safety (optional):** import stet's `RunReport` TypeBox schema/type for a typed parse — a pure,
  dependency-light import, *not* a runtime SDK.

The rule that keeps this clean: **consume the report; don't reach into the harness.** No stet code changes
per consumer. There is intentionally **no SDK** — invoke as a (sandboxed) subprocess; the "API" is the
data contract, not a code library. (stet's `main(argv, io, phases, signal)` core is already separated from
its process entry, so an in-process seam *exists* if a future consumer ever truly needs it — but subprocess
is the recommended path: reviews take minutes, so spawn cost is noise, and stet *executes* code/agents/bash,
which you want isolated.)

---

## 2. Consumer catalog

| Consumer | Trigger | How it consumes | Status | Notes |
|---|---|---|---|---|
| **CI merge-gate** (GH Action + Checks) | `pull_request` | runs CLI, exit code → required check; findings → annotations | candidate first surface | free on private repos (within Actions minutes); no paid product |
| **GitHub App review bot** | webhook (PR + comments) | runs CLI as sandboxed subprocess; maps `RunReport` → Checks/PR comments | **parked — see §4** | the conversational/always-on surface |
| **Autonomous agent loop** (e.g. ideoshi-code) | task complete | runs CLI, reads JSON (`gating[]`, `suggestion`, `evidence.command`), fixes, re-runs | near-free once phases exist | no GitHub layer at all; must *not* substitute for an independent gate |
| **Local on-demand review** (human) | manual `stet` before opening a PR | reads human output in terminal | free, falls out of CLI | the *useful* local use — not a deterministic pre-push hook |
| **SARIF → GitHub Code Scanning** | CI upload | stet emits SARIF; GitHub ingests | **deferred** | **eliminated for our case**: GitHub code scanning needs paid GHAS on *private* repos. Only viable for public repos. |

The A/B/C scenario reasoning behind this catalog is recorded in the build-priority decision (auto-memory
`stet-build-priority`): **B** (independent PR review/merge-gate) is the universal target; **A** (local
deterministic) is engine-room infra, not a marketed product; **C** (agent self-check) is a free downstream
of B and must never replace it.

---

## 3. Surface decision (settled for our constraints)

Constraints: **no GitHub paid plan, private repos, a VM available, prior GH-App experience, no need for a
hard merge-block** (merge control is handled manually for now).

- **SARIF / Code Scanning — out.** Paywalled on private repos.
- **GitHub App — chosen** over the bare Action: the Action's one advantage (zero hosting) is moot given the
  VM, and the App unlocks the always-on / comment-triggered / conversational surface. (Capabilities like
  annotations + PR comments are *free* on private repos for both; the App's only real cost is hosting +
  build effort, not a GitHub plan.)

---

## 4. Parked: GitHub App review bot — design notes

Pick this up **after** the review payload is real (see §5). Captured decisions:

- **Separate project/repo** from stet (it's a consumer, by #24) — not a stet milestone.
- **Skeleton:** the Hono + Redis pattern (cf. the Vercel code-review-bot guide), **but adapted to run as a
  persistent worker on the VM, not serverless** — reviews take minutes, need a real working tree (clone the
  PR), and spawn subprocesses; serverless timeouts + ephemeral/read-only FS fight all three.
  - **Webhook handler (Hono):** thin — verify signature, enqueue.
  - **Worker (persistent, on the VM):** clone PR → ephemeral workdir → spawn `stet --format json
    --against <base>` (**sandboxed**: container / cgroup / temp dir, time-boxed) → parse `RunReport`
    (typed via stet's schema import) → map → Checks API annotations + PR comment → tear down workdir.
  - **Redis:** the two stateful jobs the App owns — (1) a **job queue** to serialize/throttle expensive
    reviews (protect the VM and the model budget under concurrent PRs); (2) **re-review dedup** state
    (fingerprint findings per PR so a re-push doesn't re-spam — the thing SARIF would have given free).
- **Consumption shape:** sandboxed CLI subprocess + JSON; type the parse by importing stet's `RunReport`
  schema. **No SDK.**
- **Mapping `RunReport` → GitHub:**
  - `result.exitCode` → check-run conclusion (informational; no hard block needed for now).
  - findings *with* `location` → inline annotations (Checks API; batch ≤50/request).
  - findings *without* `location` (gates, behavioral verdicts, harness/config warnings) → grouped
    markdown **summary** (annotations can't anchor them).
  - surface `evidence.command` + `suggestion` in the comment body — the most actionable fields, which the
    *human* CLI renderer currently omits (the bot reads JSON, so it can include them).
  - severity → annotation level (error→failure, warning→warning, info→notice); respect stet's
    confidence-gating intent (only high-confidence ≥ threshold is "blocking").
- **Spec sourcing (open):** Phases 2/5 need intent. Source from PR body / linked issue (`--issue`) /
  auto-context from commit messages. Design when those phases land.
- **Security:** sandbox the subprocess — it runs `bash` (residual write surface, #34) and reads private
  code; an ephemeral, time-boxed, least-privilege child process is the right blast radius.

---

## 5. What unblocks any of this

The surface work is small and well-understood; the gate is the **payload**. Until the real phases exist,
every consumer renders stub findings. Prerequisite order (from `stet-build-priority`):

1. **Phase 1 — gates** (deterministic; cheap; infra for B and C).
2. **Phase 3 — code review** (the value payload for B and C; rides machinery already built —
   composite/coordinator/risk/runner).
3. Then thicken: Phase 2 (spec) + spec sourcing, Phase 4 (test-quality), Phase 5 (behavioral), and only
   then the conversational App features.

Translation: **keep building the core.** Consumers are a thin, deferred wrapper around a contract that's
already done.
