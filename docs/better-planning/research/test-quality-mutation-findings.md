# Test-Quality via Mutation Testing — Research Findings

**Status:** done — 2026-06-22 (deep-research harness: 6 angles, 26 sources, 25 claims
adversarially verified 3-vote, 0 killed)
**Feeds:** the future `test-quality` (Phase 4) feature brainstorm/PRD — and informs Phase 5 (the
sandboxed execution surface). Not a spec.
**Scope of confidence:** the academic metric/correlation findings are HIGH (peer-reviewed,
multiply-corroborated). The exciting LLM results (Meta ACH, GEM-LLM) are weaker — vendor/author
self-reports, **all on Java/Defects4J**, so transfer to stet's TypeScript/Vitest context is
**open inference, not established**. Marked inline.
**Prompted by:** Johan, from the Salesforce "7 Patterns for Agentic Engineering" (mutation testing
= their Pattern 5, "grade your tests, not just your code").

---

## Headline

Mutation testing is the **strongest available proxy for test quality** — it measures
oracle/fault-detection power, not just execution — and is empirically **superior to code
coverage**. But the raw metric is **treacherous**: most of its apparent correlation with real
fault-finding is a confound of test-suite *size*, only ~1% of blind operator-mutants resemble real
faults, and the equivalent-mutant problem (provably undecidable) skews the score. The field's
answer, and the design stet should copy: **(a)** replace blind operator mutation with **LLM-guided,
concern-targeted** mutants; **(b)** **LLM(+SMT) equivalence filtering** before anything counts as a
"weak test"; **(c)** surface the **localized oracle gap**, not a single score; and **(d)** for CI,
**reason to prioritize, then execute a small targeted subset to confirm** — pure static
kill-prediction is demonstrably weak exactly on the mutants that matter.

This maps cleanly onto stet: **Phase 4 reasons/judges + generates targeted mutants + computes the
oracle-gap signal; Phase 5's sandbox actually runs the mutants ephemerally** (never persisting),
keeping "mutation-free" intact.

---

## Findings (sub-questions 1–4: the metric)

### 1. Mutation score > coverage — but coverage is still a useful floor *(evidence: high)*
Mutation score = killed ÷ non-equivalent mutants; the standard adequacy metric. Coverage is a
**one-way** test: *low coverage is bad, but high coverage does not imply adequate tests* — it proves
execution, not that any assertion would catch a fault.
Sources: [Weimer/UMich survey](https://web.eecs.umich.edu/~weimerw/2022-481F/readings/mutation-testing.pdf) · [Le Goues & Groce "Mind the Gap"](https://clairelegoues.com/assets/papers/jainOracleGap.pdf) · [Contextual PMT, FSE 2023](https://arxiv.org/pdf/2309.02389)

### 2. The "oracle gap" is the most *actionable* signal *(evidence: high)*
**coverage − mutation-score on covered code** localizes *"code that is executed but poorly
checked"* — weak assertions/oracles. Coverage and mutation score are only weakly correlated (~0.21
on covered code), so a large gap pinpoints specific files/functions where tests run but don't
verify. Removing assertions "creates substantially larger gaps." This beats a blanket "write more
tests" and beats a single mutation-score number.
Source: ["Mind the Gap" (arXiv:2309.02395)](https://clairelegoues.com/assets/papers/jainOracleGap.pdf)

### 3. Mutation analysis is a justified real-fault proxy *(evidence: high, one nuance)*
~**73% of real faults couple** to common mutation operators (Just et al., FSE 2014); the **coupling
effect** means tests that kill simple mutants kill ~99% of complex ones; the Competent Programmer
Hypothesis (real fixes touch ~3–4 tokens) underpins it. *Nuance (the 2-1 vote):* Gopinath's own
work warns those 3–4-token fixes "seldom equal a traditional mutation operator" — a real tension
that **reinforces** the case for LLM-targeted (not operator-blind) mutants.

### 4. Raw mutation score is confounded — this is the crux *(evidence: high)*
Most of the score↔fault-detection correlation is an **artifact of test-suite size** (collapses to
**0.05–0.20** when size is held constant), and only ~**1% of blind operator-mutants** behave like
real faults — the rest inject noise. *"Future research should focus on identifying mutants linked
with faults."* → **the entire case for targeted (LLM-guided) over blind mutation.**
Source: [Papadakis et al., ICSE 2018](https://coinse.github.io/publications/pdfs/Papadakis2018hi.pdf)

---

## Findings (sub-question 2: equivalent mutants)

### 5. Equivalent-mutant detection is undecidable; heuristics are partial *(evidence: high)*
No automated method finds all equivalents (Budd & Angluin). Trivial Compiler Equivalence catches
~30%; equivalent rates of **4–39%** bias the score. Historically a manual task.
Source: [Papadakis et al. survey](https://web.eecs.umich.edu/~weimerw/2022-481F/readings/mutation-testing.pdf)

### 6. LLM equivalence detection is current SOTA *(evidence: high for the numbers; Java-only — transfer is inference)*
- **ISSTA 2024** benchmark (3,302 Java pairs): LLMs **+35.69% F1** average over prior techniques
  (fine-tuned code-embedding best) — *but only +12.75% over the strongest prior tree-NN baseline*.
  [arXiv:2408.01760](https://arxiv.org/pdf/2408.01760)
- **Meta ACH**: equivalence detector **0.79P / 0.47R → 0.95P / 0.96R with simple preprocessing**
  (vendor self-report). [FB eng](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/) · [FSE 2025 (arXiv:2501.12862)](https://arxiv.org/abs/2501.12862)
- **GEM-LLM** (LLM invariant inference **+ SMT verification** to kill hallucinations): **98%
  precision** on Defects4J, classifying 25–30% of overlooked survivors as equivalent.
  [Elsevier ISA 2026](https://www.sciencedirect.com/science/article/pii/S2667305326000153)

---

## Findings (sub-question 3: LLM-guided mutation)

### 7. Concern-targeted LLM mutation beats blind operators, and ships actionable tests *(evidence: high for mechanism; the 73% is a vendor self-report)*
Meta ACH generates *realistic, problem-specific* mutants from **plain-text descriptions of a
concern** (vs generic syntactic flips), produces relatively **few** mutants focused on
currently-undetected faults, and over Oct–Dec 2024 trials (thousands of mutants → hundreds of
tests) engineers **accepted 73% of generated tests (36% privacy-relevant)** across
FB/IG/WhatsApp/wearables.
Sources: [FB eng](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/) · [FSE 2025](https://arxiv.org/abs/2501.12862)

> This is the direct analogue of your original framing: "alter the code in a way simulating adding a
> feature or changing an interface" → that's **concern-targeted mutation**, and the evidence says
> generating those with an LLM (vs blind operators) is what makes the signal worth acting on.

---

## Findings (sub-question 4: static vs executed — the Phase 4/5 hinge)

### 8. Pure static kill-prediction is NOT enough on the mutants that matter *(evidence: high)*
Predictive Mutation Testing's headline accuracy (AUC ~0.83) is **inflated by trivially-predictable
uncovered mutants** — 62% of the standard dataset is never executed and always survives. Remove
those and **median AUC collapses to ~0.51** (worse than random on 27% of projects); contextual PMT
still **misclassifies 33%** of outcomes. **Implication: an LLM statically predicting "would this
test catch this bug" is weak precisely on genuinely-covered code — confirmation by execution is
needed.**
Sources: [Aghamohammadi 2020](https://arxiv.org/pdf/2005.11532) · [Contextual PMT FSE 2023](https://arxiv.org/pdf/2309.02389)

### 9. The evidenced sweet spot is HYBRID *(evidence: high)*
Use prediction/reasoning to **rank** mutants, then **execute a small targeted subset to confirm**.
MutationBERT confirms a mutant predicted detected by few tests by running *just those tests*; its
higher precision **saves 33% of the compute** a prior tool spent. **This is exactly stet's Phase 4
(reason/prioritize) → Phase 5 (sandbox-execute to confirm) split.**
Source: [Contextual PMT / MutationBERT, FSE 2023](https://arxiv.org/pdf/2309.02389)

---

## Tooling landscape (sub-question 6)

**Stryker** is the mature JS/TS mutation framework and **rides Vitest natively** (stet is built on
Vite+/Vitest) — a strong **reuse** candidate for the *execute* step rather than building a mutation
engine:
- [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) — first-class Vitest integration.
- [Mutation switching (Stryker 4)](https://stryker-mutator.io/blog/announcing-stryker-4-mutation-switching/) — compiles all mutants once, toggles at runtime (cheaper than per-mutant rebuilds).
- [Incremental mode](https://stryker-mutator.io/blog/announcing-incremental-mode/) — only re-mutates changed code; suits a **diff-scoped** tool like stet.

*Inference:* stet likely **reuses Stryker for the operator/execute layer** and adds the
**LLM-guided targeting + equivalence-filter + oracle-gap framing** on top — the parts the literature
says are the differentiators. (No surviving source directly settled build-vs-reuse; this is a
design lean, not a finding.)

---

## How it maps onto stet *(inference — design choices, not literature)*

- **Phase 4 (test-quality)** owns the *reasoning/judging* layer: compute the **oracle gap** to
  localize weak oracles; generate **concern-targeted mutants** (LLM); run an **LLM(+SMT)
  equivalence filter** so nothing counts as a "weak test" until it's a *non-equivalent surviving*
  mutant; emit findings (weak-oracle locations, tautological/mock-only assertions) — graded by the
  **eval-first SNR** harness, *not* by chasing a raw mutation score.
- **Phase 5 (behavioral verification)** owns the *execution* surface: actually run the small,
  prioritized mutant subset **ephemerally in the sandbox** (temp worktree, discarded) — this is how
  mutation testing **rides existing infrastructure without violating "mutation-free"** (stet never
  writes to the user's repo; the mutant lives and dies in the sandbox).
- **The review-phase static heuristic** ("would this test fail if the code were wrong?") is the
  *cheap first pass* — finding 8 says it's weak alone, so it prioritizes rather than concludes.
- **Adjacent patterns worth adopting** (sub-question 5): separate **author from judge** (already
  stet's verify/voter independence + diff-blindness), **tautological/mock-only-assertion
  detection**, **property-based testing** as a mutant-killing oracle, and "**grade the tests, not
  just the code**" as the phase's reason for being.

---

## Open tensions / decisions for the Phase 4 PRD

Every item here must be resolved (or deliberately deferred) in the `test-quality` brainstorm/PRD:

1. **Static-only v1, or execution-required?** Finding 8 says static kill-prediction is weak on
   covered code. Does Phase 4 ship a *reasoned, non-executing* verdict first (usable before Phase
   5's sandbox exists) and gain execution later — or is any defensible mutation signal gated on
   Phase 5? *(This also sets the Phase 4 ↔ Phase 5 build dependency.)*
2. **Reuse Stryker vs build.** Stryker rides Vitest + has incremental/diff modes. Reuse it for the
   operator/execute layer and add LLM targeting on top, or build bespoke? Does the Java-only LLM
   evidence transfer to TS/Vitest?
3. **Mutant-generation strategy.** Blind operators (cheap, ~1% relevant, noisy) vs LLM
   concern-targeted (ACH-style, fewer/realistic, but vendor-only evidence + nondeterministic) — and
   how is each **tuned/graded against stet's HIT/VALID/NOISE SNR eval** rather than a raw score?
4. **Signal presentation.** Surface the **localized oracle gap + specific weak-oracle/tautological
   findings**, not a single mutation score (avoids the size-confound + equivalent-mutant traps).
   **Require an LLM(+SMT?) equivalence filter before any mutant is reported as a weak-test signal.**
5. **Boundary with code-review's `coverage-gaps`.** Code-review already does the *static*
   approximation and defers test *quality* to Phase 4 (PRD decision #11). Confirm the seam holds:
   coverage-gaps = "no test touches this behavior"; Phase 4 = "a test exists but is weak" (oracle
   gap / survives mutation).

---

## Sources (primary unless noted)

Metric & evidence: [Papadakis ICSE 2018](https://coinse.github.io/publications/pdfs/Papadakis2018hi.pdf) · [Le Goues & Groce "Mind the Gap"](https://clairelegoues.com/assets/papers/jainOracleGap.pdf) · [Weimer/UMich survey](https://web.eecs.umich.edu/~weimerw/2022-481F/readings/mutation-testing.pdf) · [PMT/Aghamohammadi 2020](https://arxiv.org/pdf/2005.11532) · [Contextual PMT/MutationBERT FSE 2023](https://arxiv.org/pdf/2309.02389)
Equivalent mutants & LLM detection: [ISSTA 2024](https://arxiv.org/pdf/2408.01760) · [Meta ACH (FB eng)](https://engineering.fb.com/2025/09/30/security/llms-are-the-key-to-mutation-testing-and-better-compliance/) · [ACH FSE 2025](https://arxiv.org/abs/2501.12862) · [GEM-LLM](https://www.sciencedirect.com/science/article/pii/S2667305326000153) · [Papadakis equivalence survey](http://web4.cs.ucl.ac.uk/staff/Y.Jia/resources/papers/PapadakisJHT2015.pdf)
Tooling: [Stryker Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) · [Stryker 4 mutation switching](https://stryker-mutator.io/blog/announcing-stryker-4-mutation-switching/) · [Stryker incremental](https://stryker-mutator.io/blog/announcing-incremental-mode/)
Patterns: [Salesforce — 7 Patterns (blog)](https://engineering.salesforce.com/maintaining-code-quality-at-agent-speed-7-patterns-for-agentic-engineering/)

*Caveat (verbatim from the harness): none of these sources address stet's specific "mutation-free"
constraint or eval-first SNR grading — those are design choices, not literature findings. The
LLM-mutation space is fast-moving (2024–26); ACH/GEM-LLM may be superseded.*
