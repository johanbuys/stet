# Skeptic pass — reviewing existing or loop-produced code

Run this when the Architect points the Lead at code to review before driving fixes — a loop PR, a
landed milestone, an unfamiliar slice. The goal: surface the few things that matter, verified, at
the altitude of the idea — not a wall of findings.

## How

1. **Fan out independent finders.** Spawn Skeptic subagents, each on one angle, each blind to the
   others. Angles that earn their keep:
   - line-by-line correctness (every changed hunk + the enclosing function)
   - removed-behavior (what invariant did a deleted line enforce — is it re-established?)
   - cross-file (does this change break a caller, or make a callee unsafe?)
   - cleanup (reuse / duplication / dead code in the changed lines)
   - altitude (is each change at the right depth, or a bandaid bolted onto shared infra?)
   - conventions (the repo's CLAUDE.md rules — quote the exact rule + line)

   Each returns candidates: file, line, one-line summary, concrete failure scenario.

2. **Verify the load-bearing finding yourself.** Do not relay finder output wholesale. The Lead
   reads the actual code for the most consequential finding and confirms it personally. Finders
   are recall; the Lead is precision on the crux.

3. **Dedupe and rank.** Collapse near-duplicates; keep the few that matter.

4. **Report at intent altitude** in the report shape: what landed → why → the decision(s) → plain
   options. Not ten findings at diff altitude.

## Scale to the work

A small slice: a few finders, verify the crux. A thorough audit: a larger pool, a second
verification vote per finding. Say what you capped — silent truncation reads as "covered
everything" when it didn't.

## Example (stet PR #88)

Six finders → the load-bearing finding (a real model's findings silently dropped) verified by the
Lead reading the parse path and the contract comment that predicted the exact bug → **three
decisions surfaced, not ten findings.** The old loop would have merged the PR green.
