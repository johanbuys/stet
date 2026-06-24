# Driver brief — template

A Driver brief is the contract between the Lead and a Driver subagent. The Driver is stateless
hands: one bounded task, test-first, a small diff back. A good brief is the difference between a
three-minute fix and a Driver that "drives unattended for miles."

## Template

- **Goal** — one line, the *behavior* outcome, not the mechanism. ("Make X work." "Stop dropping Y.")
- **Read first** — the files / functions the Driver must read before editing.
- **Test first (red → green)** — the failing test to write and confirm red *before* the change.
  Name what it asserts.
- **The change** — precise: name the file and lines, state the edit, give the value of any default.
- **Mechanism constraints** — what must NOT break (other callers, contracts, the public shape).
- **Do NOT touch** — an explicit scope fence (files / areas out of bounds).
- **Stop-and-report clause** — "if the fix needs more than this, or a test fails for a real reason,
  STOP and report instead of forcing it green."
- **Report back** — what the Driver returns: files changed, the red proof, final test / check
  results, any deviation it made.

## Hard rules

- One bounded task. Test-first. Small diff.
- The Driver never widens scope silently — it stops and reports.
- The brief is not trust. The Lead verifies the returned diff itself (reads it, runs the suite).

## Example (condensed, from stet PR #88)

> **Goal:** the review phase drops a real model's findings — fix that.
> **Read first:** `composite.ts` roll-up (~L335); `finding.ts` (`SpecialistSubmission`,
> `parseFindings`).
> **Test first:** add a test where a fake submits a finding with NO confidence; assert it survives
> stamped. Confirm it fails on today's code first.
> **The change:** parse against `SpecialistSubmission`; stamp `confidence: "low"` + specialist +
> phase.
> **Constraint:** `parseFindings` is also used by the coordinator + eval — keep their default on
> `Finding`.
> **Do NOT touch:** `eval/runner.ts`, the coordinator parse.
> **Stop-and-report:** if a test fails for a real reason, don't force it green.

The Driver came back having stopped on three tests it couldn't honestly make pass — which became
the Architect's next decision. That stop is the brief working, not failing.
