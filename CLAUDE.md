# CLAUDE.md

## What This Is
`stet` is a standalone CLI that validates code changes across five dimensions: deterministic checks (tests, types, lint), spec compliance (does the diff satisfy the PRD/task?), general code review (quality, bugs, security), test quality analysis (are the tests meaningful?), and behavioral verification (what should be tested end-to-end, and in v2, actually executing it). It is designed to be invoked by humans, by AI agents, by autonomous loops like ideoshi-code, or by CI systems — anywhere code needs verification before it's trusted.

## Development Discipline: TDD (Required)
Use the tdd skill. 

