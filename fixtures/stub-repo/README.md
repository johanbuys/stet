# fixtures/stub-repo

Template directory for M1 end-to-end tests and the manual acceptance run.

**Not a git repo itself** — materialize with `setup.sh <target-dir> [fail]` (manual) or the
`setupStubRepo(tmpdir)` helper exported from `src/cli.e2e.test.ts` (in-process tests).
The helper runs `git init`, commits all files, then stages a change — giving scope detection
real git state to read.
