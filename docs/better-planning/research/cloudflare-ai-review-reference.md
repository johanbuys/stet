# Reference implementation: Cloudflare's AI code review system

**Status:** reference — captured 2026-06-09 from a public engineering write-up.
**Source:** `https://blog.cloudflare.com/ai-code-review/` (Cloudflare blog).
**Why this doc exists:** Cloudflare independently built and ran *at production scale* a system
that is, structurally, stet's harness — a composable orchestrator that fans out specialised AI
reviewers and aggregates structured findings. It is the closest real-world reference point we
have. This doc records what they built, what it confirms about stet's design, where it diverges,
and exactly which divergences we folded into the harness (vs. deferred to later features).
**Feeds:** `product/features/harness/harness-prd.md` (decisions #17 amended, #25/#26 added) ·
`product/features/harness/harness-plan.md` (milestone M7.5) · the `github-integration` follow-up
feature (README roadmap).
**Caveat:** this is a *single-vendor field report*, not a controlled study. Treat its numbers as
"a serious team's production experience," not as benchmarks. We adopt its **shapes**, not its
thresholds.

---

## 1. What they built

A CI-native orchestrator that, on each merge request, deterministically scopes the change, fans
out up to **seven specialised reviewers** (security, performance, code quality, documentation,
release management, compliance), and then runs a **coordinator** that merges and filters their
output into a single verdict posted on the MR.

```
  deterministic            parallel specialist           coordinator             verdict on the MR
  risk classifier   ──▶    reviewers (N by risk)   ──▶   judge pass        ──▶   approve /
  (rules: lines,           each: one rubric,             (top-tier model:        approve_with_comments
   files, paths)           structured XML output          dedup, drop FPs,       (+ posted comments)
                                                          re-rank, re-categorise)
```

## 2. Architecture, component by component

- **Plugin orchestrator.** A `ReviewPlugin` interface with bootstrap / configure / postConfigure
  lifecycle hooks; plugins contribute through a controlled `ConfigureContext` rather than reaching
  into the final config. → **stet's `PhaseConfiguration` + registry.** Same composable substrate.
- **Agent framework: OpenCode.** Chosen for a *server-first* architecture — programmatic session
  creation via SDK rather than CLI scraping. → **stet chose the Pi SDK for the identical reason**
  (`createAgentSession`, not CLI hacks). Independent convergence on "drive the agent through a
  real session API."
- **Model tiering.** Three tiers: top (Opus-class / GPT-5-class) reserved for the **coordinator**;
  standard (Sonnet-class) for the heavy-lifting sub-reviewers; lightweight (Kimi-class) for
  text-heavy tasks like docs. → **stet's capability tiers (`robust`/`fast`).** stet has two tiers;
  the coordinator maps cleanly to `robust`, specialists to `fast`.
- **Deterministic risk classifier.** A rule engine computes a tier *before any model runs*:
  line-count thresholds (≤10 / ≤100), file-count thresholds (≤20 / >50), and path rules (anything
  touching `auth/`, `crypto/`, or security-sounding paths → full review). The tier sets **how many
  reviewers** run and **which coordinator model** judges. The AI never picks its own budget.
  | Tier | Scope | Agents | Coordinator |
  |---|---|---|---|
  | Trivial | ≤10 lines, ≤20 files | 2 | Sonnet |
  | Lite | ≤100 lines | 4 | Opus |
  | Full | >100 lines or security-sensitive | 7+ | Opus |
- **Specialist reviewers.** Each is one narrow rubric with an explicit **"What NOT to Flag"**
  section (e.g. security ignores "theoretical risks requiring unlikely preconditions"; no "consider
  using library X" suggestions). Output is structured XML with severity (`critical`/`warning`/
  `suggestion`). → **stet's specialist panel + conservative-rubric principle + one severity vocab.**
- **Coordinator (judge pass).** A top-tier agent reads all seven reviewers' output and:
  **deduplicates** findings, **filters out false positives**, **re-categorises**, and applies
  **"reasonableness filtering"** where "speculative issues, nitpicks, false positives, and
  convention-contradicted findings get dropped." It also receives prior findings + resolution
  status on re-reviews to avoid re-flagging. → **the mechanism stet had deferred (old decision
  #17); now folded in as harness milestone M7.5.**
- **Diff pre-processing.** Strips lock files, minified assets, source maps, vendored deps; excludes
  `// @generated` files **unless they are DB migrations**. Per-file patches so a sub-reviewer reads
  only its relevant diff slice; shared context files to avoid 7× token duplication. → **stet §3.6
  gains semantic diff pre-filtering (was budget-overflow only).**
- **Verdict & human controls.** Strong **approval bias** — a single warning yields
  `approved_with_comments`, not a block. A `break glass` PR comment forces approval (hotfix escape
  hatch). → in stet these are **caller-side** concerns: stet reports findings + an exit code; the
  *caller* (CI gate, or a future GH bot) owns the merge decision and any override. Confirms stet's
  mutation-free / report-only boundary.
- **Resilience.** Per-tier circuit breakers with failback chains (e.g. Opus 4.7 → 4.6) on
  *retryable* errors only — auth failures and context overflow do not retry. Inactivity detection
  kills sessions idle >60 s. A control-plane Worker can reshape routing without a deploy. →
  **stet M6 gains a small failback note;** the control plane is out of scope.
- **Operational details.** JSONL streaming (flush every 100 lines / 50 ms); `stdin` for prompts to
  dodge `ARG_MAX`; 30 s "model is thinking" heartbeats to prevent false timeouts. → informs stet's
  stderr-progress + budget-timeout design (M2/M3).

## 3. What it confirms about stet (convergence)

Eight independent design matches, from a team that then ran the design 131k times:

| stet decision | Cloudflare's production choice |
|---|---|
| Phase = a `PhaseConfiguration`; a new phase touches no harness code (#24) | `ReviewPlugin` interface; contribute via a controlled context API |
| Specialist panel beats one generalist (#9) | up to 7 specialised reviewers, one rubric each |
| Capability tiers, never provider pins (#6) | 3-tier model routing |
| Rubric = constant system prompt, cacheable (§4.1) | **85.7% prompt-cache hit rate**, "saving an estimated five figures" |
| Programmatic session API over CLI hacks → Pi SDK | chose OpenCode for "server-first … SDK rather than CLI hacks" |
| Conservative rubric; only high-confidence gates (§4.6) | explicit "What NOT to Flag"; approval bias |
| One severity vocabulary, structured output (§4.2) | XML findings: critical / warning / suggestion |
| Budget ceilings generous (5-min static / 15-min behavioral) | median review **3m39s** — under the static ceiling |

## 4. Where it diverges — and what we did about it

| Divergence | stet's response | Lands in |
|---|---|---|
| **Coordinator judge pass** is their most load-bearing noise filter; stet had deferred it (old #17) | **Adopt as first-class harness machinery** (optional aggregation/judge sub-stage on composite phases). Amends #17 deferred→designed-in. | harness PRD §3.3a, §4.1; plan **M7.5**; tasks **T27–T28** |
| **Deterministic risk classifier** scales fan-out + coordinator model by diff risk; stet's activation is on/off only | **Adopt the *mechanism* in the harness, leave *thresholds* to the code-review PRD** — the same harness-vs-PRD split activation uses | harness PRD §3.4.1a; plan **M7.5**; task **T29** |
| **Semantic diff pre-filtering** (strip lockfiles/generated) | Cheap add to scope detection | harness PRD §3.6; task **T30** |
| **Model failback chains** | Small resilience note on routing | harness PRD §3.2; M6 |
| **Re-review awareness** (skip resolved findings) | Deferred — the GH bot can filter output in v1; a harness input is a later option | `github-integration` feature / harness §7 |
| **CI-native run** (GH Action / GH App + webhooks) | **Out of the harness** — the harness is already CI-ready (headless CLI, JSON, exit codes, stories 15–17). Packaging is a follow-up feature. | `github-integration` feature |
| **PR-comment-triggered behavior** (`break glass`, re-check, scoped review) | **Out of the harness** — a caller that composes existing flags (`--only`, scope, spec context) | `github-integration` feature |

**The boundary lesson.** Cloudflare's bot and reviewer are fused. stet keeps them separate: the
harness stays a pure CLI, so the same engine serves humans, agents, autonomous loops, *and* a
future GitHub integration. CI-run and PR-comment triggers are **consumers of the `RunReport`
contract**, not harness machinery — pulling them inward would break exactly the reusability the
boundary rule (#24) protects.

## 5. Operating metrics (their 30-day window — context, not targets)

- **131,246 review runs** across **48,095 merge requests**.
- **Median duration 3 m 39 s**; **average cost $1.19 / review** ($0.98 median).
- **Prompt-cache hit rate 85.7%**, ~120 B tokens processed.
- **`break glass` rate 0.6%** of MRs — the AI verdict is rarely overridden.
- ~**1.2 findings / review** (159,103 total); security reviewer ~4% critical-rate; code-quality
  reviewer ~50% of all findings by volume.

Read-out for stet: the median runtime vindicates our budget ceilings as generous-not-stingy; the
cache rate vindicates the constant-rubric design; the low break-glass rate suggests a
conservative, approval-biased system earns trust.

## 6. Acknowledged limitations (theirs)

They report the system cannot reliably handle architectural awareness, cross-system impact, or
subtle concurrency bugs; large refactors (500+ files) trigger expensive multi-model orchestration;
the coordinator warns when its prompt exceeds 50% of context. Human review remains a first-class
part of the loop — the system is a guardrail and first-pass filter, not a replacement. This is
consistent with stet's framing: stet judges, the caller (human or agent) remains accountable.

## 7. What we deliberately did **not** take

- Their concrete thresholds (≤10 / ≤100 lines, etc.) — stet adopts the *classifier mechanism*, and
  the **code-review feature PRD** owns the actual numbers, tuned to stet's specialist set.
- The fused bot/reviewer architecture — see §4's boundary lesson.
- The control-plane Worker and the GH-App webhook service — `github-integration` feature territory,
  not the harness.
