# <feature> — Drift Ledger

**Status:** active — last sync <checkpoint> <date>
**Anchor:** <feature>-tdd.md (the design of record this ledger reconciles against)
**Tracks:** <feature>-plan.md milestones as they land

<!-- Build-time record maintained by better-planning-comprehend. NOT a planning artifact: it tracks
     the reconciliation between the TDD and the code that actually landed. The TDD stays canonical;
     this is the running diff of every architectural divergence and its fate. -->

## Sync checkpoints

<One row per sync session, so a fresh session knows where the last reconciliation left off.>

| Checkpoint | Window (diff range) | Date | Deltas reviewed | Open fixes |
|---|---|---|---|---|
| M1 synced | <baseline>..<sha> | <date> | 4 | 0 |
| M2 synced | <sha>..<sha> | <date> | 6 | 1 |

## Deltas

<One entry per consequential delta surfaced and reconciled. Within-spec implementation churn is not
logged — only changes that moved the architecture.>

### D<n> · <short title>
- **Checkpoint:** <M2 / on-demand <date>>
- **What changed:** <the architectural delta, inferred from the code>
- **Where:** `<path(s)>` · <component / boundary>
- **TDD section:** <which decision / interface / data-model entry it touches, or "none — undecided">
- **Disposition:**
  - `intentional` → TDD updated in place (decision #<n>), rationale appended — **OR**
  - `drift` → flagged for fix: <what the fix is, who/what picks it up> — **OR**
  - `undecided` → new TDD decision #<n> made now: <the call + rationale>
- **Decided by:** human <date>

## Open fixes

<Drift items flagged for correction but not yet fixed — the live to-do the builder works under the
plan's reality-disagrees protocol. Clear each as its fix lands.>

- [ ] D<n> — <fix> — flagged <date>
