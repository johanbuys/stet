# <feature> — Technical Design (TDD)

**Status:** draft — <date>
**Depends on:** <feature>-prd.md (settled) · <product PRD §…>
**Draws on:** <research/findings docs, spikes>
**Companion:** <feature>-tdd-overview.html

<!-- If other features consume this one's interfaces/contracts, flag it here, at the top. -->

## Area map

<The full set of technical areas this design covers, in one screen — nothing invisible. Mark each
with its consequence × irreversibility rank, so the walk order is visible: which areas were taken
deep, which were mentioned briefly. This map is the top layer of the layered-zoom walk.>

| Area | Consequence | Walked |
|---|---|---|
| <e.g. occurrence storage / data model> | high · hard to reverse | deep |
| <e.g. CLI surface> | low · cheap to change | brief |

## System map

<Components and how they fit the whole, at one diagram's depth. The companion renders this as a
CSS-only diagram. Prose names each component's single responsibility and what it depends on.>

## Data model

<Entities, relationships, ownership. The shapes that persist and who is allowed to mutate them.>

## Interfaces & contracts

<The boundaries between components, and the contracts other features or external callers consume —
function signatures, events, schemas, flags. Flagged at the top if anything else depends on them.>

## Major decisions

<The consequential, hard-to-reverse calls — each walked layered-zoom (system shape → boundary →
decision). For each: the recommendation, the alternatives weighed, and WHY this one. The rationale
travels downstream; the roads not taken are recorded so they aren't silently re-walked later.>

### Decision: <title>
- **Context:** <what forces a choice here>
- **Options:** <A / B / C, each with its real trade-off>
- **Chosen:** <one> — **because** <rationale>
- **Rejected:** <the rest> — <why not>

## Technical risks & unknowns

<What could break this design, and the open spikes. Each risk: its impact, and how it'll be
resolved or de-risked (a spike, a fallback, a deliberate bet).>

## Non-functional requirements

<Perf / security / scale / availability targets that shape the architecture — only the ones that
actually constrain a decision above. A target with no architectural consequence doesn't belong here.>

## Stack & library choices

<The frameworks, libraries, and services chosen, each with rationale and the alternative considered.
Brownfield: what already exists that this builds on vs. introduces.>

## Decisions

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| 1 | <decision> | human / draft | <why> | settled / open |

<Human-made calls distinguished from draft-level proposals awaiting review. Every architectural
question raised anywhere must land here as settled or deliberately deferred. This table is the
living record the comprehend loop updates when intentional evolution is accepted during the build.>
