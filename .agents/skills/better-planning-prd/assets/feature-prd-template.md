# <feature> — PRD

**Status:** draft — <date>
**Depends on:** <product PRD §…> · <feature>-brief.md (if one exists)
**Draws on:** <research/findings docs>
**Companion:** <feature>-prd-overview.html

<!-- If other features consume this one's contracts, flag it here, at the top. -->

## Overview

<One paragraph: what this feature is, why it exists, and the single most important thing to
understand about it.>

## User stories

A LONG, numbered list. Each user story in the format:

> As a <user>, I want <capability>, so that <benefit>

1. As a <user>, I want <capability>, so that <benefit>.
2. …

<This list should be extremely extensive and cover ALL aspects of the feature — the happy
paths, the recovery paths, and the non-obvious actors: admins, API consumers, agents,
operators. If a requirement below has no story, either add the story or question the
requirement.>

## Requirements / behavior

<The what and why, in depth. Organize by capability, not by implementation.>

## Contracts & schemas

<Everything other features (or external callers) consume: data shapes, CLI flags, exit codes,
events, file formats. Versioned and explicit — this section is the dependency surface.>

## Acceptance criteria

<Testable, numbered. Each one is something a reviewer can check, not a vibe.>

1. …

## Edge cases

<A dedicated section, not semantics scattered through prose. Edge cases are where ambiguity
hides; a PRD without them reads agreed-upon and ships surprises. Cover: empty/missing inputs,
concurrency/ordering, failure mid-operation, scale extremes, conflicting configuration.>

## Deliberately deferred

<What this feature will NOT do in this iteration, each with the reason. A cut without a reason
gets re-litigated.>

## Decisions

| # | Decision | Made by | Rationale | Status |
|---|---|---|---|---|
| 1 | <decision> | user / draft | <why> | settled / open |

<User-made calls distinguished from draft-level proposals awaiting review. Every open question
raised anywhere about this feature must land here as settled or deliberately deferred.>
