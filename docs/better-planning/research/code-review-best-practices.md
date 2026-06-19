# Code-Review Agents — Best-Practices Findings (2024–2026)

**Status:** done 2026-06-18 — web-sourced research sweep (3 parallel agents, live search). Evidence base
for the `code-review` feature PRD; companion to `cloudflare-ai-review-reference.md`.
**Purpose:** capture the current field consensus on review-agent architecture, prompting/rubrics, and
evaluation so the `code-review` PRD builds on proven patterns rather than inventing them.
**Citations caveat:** URLs/benchmark numbers below are *as gathered* by the research agents. Spot-check any
specific figure or arXiv id before quoting it externally or treating it as authoritative — several were not
independently re-verified. The *patterns* are corroborated across multiple independent sources; trust those
over any single number.

---

## 1. The architecture consensus — it's what stet already has

Every serious 2024–26 system has converged on the same shape:

> **high-recall finder(s) → independent verify/filter → judge that dedups, ranks, drops**

This is stet's **composite specialists → coordinator**. Convergent sources:

- **Anthropic Code Review** — parallel agents (one per issue class) → verification step checks candidates
  against actual code behavior → dedup + severity rank. Reports `<1%` of findings marked incorrect.
  (code.claude.com/docs/en/code-review)
- **BitsAI-CR (ByteDance, production)** — RuleChecker → ReviewFilter → 75% precision, 12k+ WAU.
  (arXiv 2501.15134)
- **Cursor BugBot** — 8 parallel passes → majority vote → dedicated validator model → category filter → dedup.
- **Qodo** — judge agent removes duplicates, filters low-signal; only high confidence+relevance survive.
- **QASecClaw** — finder + verify: **−88.6% false positives at only −3.1% recall** (560→64 FPs). (arXiv 2605.01885)
- **Counter-example:** Greptile (single agentic loop, no verify stage) is independently measured as the noisiest.

**The governing principle:** *tune recall in the finder, precision in the filter.* Let specialists be
aggressive; the verify/judge pass is the precision knob. This is the single most-cited reason for low
false-positive rates — and it matches what our own pressure test showed (coordinator cut ~64% noise).

Other architecture notes:
- **One subagent per check** (Amp) — a stronger guarantee each criterion is actually evaluated. Maps to stet's per-specialist model.
- **Gated judge, not always-on** (Amp "Oracle") — invoke the high-reasoning judge only for hard cases, for cost/latency. Aligns with stet's risk-classifier-gated coordinator.
- **Agentic file-reading has beaten RAG/embeddings** — Sourcegraph/Cody dropped embeddings for BM25+agent; Greptile dropped pure-embedding RAG. BUT you still need *structural* call-graph context (the "80% problem": an agent edits one file, misses 5 interconnected ones). Pure grep is not enough for cross-file impact.

## 2. Noise reduction (the #1 user complaint) — strongest copyable material

Alert fatigue is measured: a tool posting ~18 comments/PR "teaches reviewers to ignore it," and devs then
ignore the valid ~60% too. The proven levers, in priority order:

1. **A distinct verify phase that tries to DISPROVE each candidate against the real code** (read-only for stet, since mutation-free). Biggest FP reducer across the board.
2. **Explicit "what NOT to flag" exclusion lists in the prompt** — Anthropic's "Hard Exclusions" + "Key Precedents"; PR-Agent's "DO NOT suggest" blocklist. (Pulled into the draft rubric.)
3. **Require a concrete failure scenario before flagging** — "if you can't explain why with a specific scenario, don't flag it; prefer not reporting over guessing." The single strongest in-prompt rule.
4. **Anti-hallucination clause for partial diffs** — "symbols may be defined elsewhere"; "don't treat truncation as incomplete"; "don't claim a change breaks other code without identifying the specific path." Mandatory for stet (budget-trimmed diffs).
5. **Abstention is a feature** — "an empty list is acceptable"; hard finding caps. Copilot stays silent on ~29% of reviews by design.
6. **Severity gate as a downstream filter, NOT a "stay silent" prompt instruction** — see the Opus 4.8 delta in §4.
7. **Learning from dismissals** — prefer *explicit* org-scoped learnings (CodeRabbit) over *implicit* silent suppression (Greptile suppresses a comment type after N ignores); explicit fits stet's "nothing passes silently."

## 3. Prompting / rubric engineering

- **Specialist decomposition beats a monolith** — one prompt per defect family (bugs/logic, security, perf, quality/maintainability), separate contexts, minimally-overlapping tools. (arXiv 2505.17928)
- **Few-shot of good/bad findings is the most reliable lever** — 3–5 examples mixing real bugs and known false positives to teach the decision boundary. (claude.com prompt-engineering guide; arXiv 2601.18844)
- **Forcing verbose chain-of-thought can HURT on frontier models** — they've internalized reasoning; prefer examples + structure over "think step by step." (arXiv 2601.18844)
- **Force structured output** — every production tool emits a strict schema; a Finding schema that *requires* a trigger-scenario field operationally enforces the concrete-scenario rule.
- **Diff handling** (PR-Agent, concrete + copyable): `__new hunk__`/`__old hunk__` format; inject line numbers on new-hunk only, labeled "reference only, not part of the code" (generate without line numbers, assign in a second pass — robust against line-number hallucination); drop deletion-only hunks; sort files by repo's dominant languages; overflow files → name-only list; expand context to the enclosing function. Validates stet's T24 pre-filtering.
- **Large diffs:** AST-slice to enclosing function + direct callers/callees under a token budget; inject the diff deterministically, use retrieval only for *surrounding* context.

## 4. Deltas to fold into stet's current design

1. **Don't gate on self-reported confidence.** Verbalized LLM confidence is systematically miscalibrated/overconfident (arXiv 2412.14737, 2604.01457). stet currently gates exit code on `confidence === "high"`. The proven alternative is **agreement-based**: run verify as 2-of-3 voters and derive confidence from agreement (galileo.ai LLM-judge guidance). → open design question for the PRD.
2. **Opus 4.8-specific:** conservative "only report high-severity" *prompts* suppress recall *more* on newer models (CodeRabbit: critical findings 35→29). Keep precision rules in the prompt but put the **severity gate downstream** — which is already how stet's `deriveExit` works; just don't muzzle the specialists.
3. **Add a "pre-existing / not introduced by this diff" finding tier** (Anthropic uses it). Directly addresses the stale-finding problem from our pressure test; pairs with net-vs-base scoping.
4. **Net-vs-base diff scoping is mandatory** — review the cumulative change vs the merge base, never per-commit (the pressure-test lesson; PR-Agent/Anthropic both default to this).
5. **Spec-compliance (Phase 2) is genuinely greenfield** — no production system has published a validated PRD/requirement-compliance reviewer. Consistent with stet's own R&D caveat: stet could lead here but has the least external guidance. PR-Agent's `ticket_compliance_check` (compliant / not-compliant / requires-human-verification) is the closest prior art.

## 5. Evaluation — the methodology that settles rubrics

The field has a ready-made eval design that mirrors the behavioral POC's 14-fixtures+grader:

- **Grade each emitted finding into a 3-way bucket via LLM-judge:** **HIT** (matches a seeded/ground-truth defect) / **VALID-BUT-UNSEEDED** (real, just not the seeded one) / **NOISE** (wrong/irrelevant/hallucinated). The middle bucket stops you punishing real finds you didn't seed. (CR-Bench arXiv 2603.11078; SWE-PRBench's CONFIRMED/PLAUSIBLE/FABRICATED is the same idea, validated at κ=0.75 vs humans.)
- **Match candidate↔expected via location gate (±N lines / same hunk) + embedding similarity**, enforce 1-to-1 pairing so restating one issue many ways gets no extra credit.
- **Headline metric: Signal-to-Noise Ratio** = (Hits + Valid) / Noise. Track precision + SNR + recall **per visibility tier** (in-diff / needs-surrounding-context / cross-file).
- **Include clean (bug-free) fixtures** — non-negotiable; they measure false-positive rate and prove conservative tuning held (Sphinx uses 50 bug-free per language).
- **Gate rubric/model changes** on precision/SNR not dropping vs the prior version; a recall gain that drops SNR is a regression, not a win.
- **Validate the grader itself** against a human-labeled golden subset (≥0.75 κ) before trusting it.
- **Mineable instead of hand-written:** CR-Bench transforms SWE-bench (git-blame the bug-introducing commit → fetch PR → human review/fix becomes expected findings); reusable harness `FoundryHQ-AI/swe-prbench`, dataset `foundry-ai/swe-prbench` on HuggingFace.
- **Production FPR ceilings to validate against:** <20 PRs/wk → <8% FPR; 50–150 → <5%; 150–500 → <3%; **security findings <3% regardless.**

## 6. Net implication for the build

The architecture is validated (it's ours), the base rubric is copyable (see `features/code-review/code-review-rubric-draft.md`), and the eval methodology is established. Consensus across the field: **the eval suite is the rubric-settling mechanism** — so the first build item is the review eval harness, then the phase on the copied-and-adapted rubrics, then tune against eval. Do not paper-tune prompts; do not build the rubric without the harness to measure it.
</content>
