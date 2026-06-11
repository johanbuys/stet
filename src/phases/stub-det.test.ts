/**
 * Tests for stub-det — the deterministic stub phase.
 *
 * Tests real commands (no mocks): `echo ok`, `exit 7`, `false`, etc.
 * Each test validates both the PhaseReport shape and the TypeBox schema contract (Value.Check).
 *
 * PRD §3.9 (stub phases), §4.1 (PhaseConfiguration), §4.6 (confidence rules),
 * harness plan §2a M1 step 4.
 */

import { Value } from "@sinclair/typebox/value";
import { describe, expect, test } from "vite-plus/test";
import { PhaseReport } from "../schema/report.js";
import { stubDet } from "./stub-det.js";

// ---------------------------------------------------------------------------
// Helper: minimal PhaseContext (cwd is arbitrary — commands are shell-run)
// ---------------------------------------------------------------------------

function ctx(command: string, cwd = "/tmp") {
  return {
    cwd,
    scope: { kind: "staged" as const, files: ["src/foo.ts"] },
    config: { command },
  };
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe("stub-det activation", () => {
  test("activation is always true — regardless of scope content", () => {
    const emptyScope = { scope: { kind: "staged" as const, files: [] } };
    const nonEmptyScope = { scope: { kind: "working" as const, files: ["a.ts", "b.ts"] } };
    expect(stubDet.activation(emptyScope)).toBe(true);
    expect(stubDet.activation(nonEmptyScope)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase identity
// ---------------------------------------------------------------------------

describe("stub-det identity", () => {
  test('id is "stub-det"', () => {
    expect(stubDet.id).toBe("stub-det");
  });

  test('kind is "deterministic"', () => {
    expect(stubDet.kind).toBe("deterministic");
  });
});

// ---------------------------------------------------------------------------
// Passing command (exit 0)
// ---------------------------------------------------------------------------

describe("stub-det — passing command (exit 0)", () => {
  test('exit 0 ⇒ status "completed", no findings', async () => {
    const report = await stubDet.run(ctx("echo ok"));
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(0);
  });

  test("exit 0 ⇒ exactly one Check in audit.checks", async () => {
    const report = await stubDet.run(ctx("echo ok"));
    expect(report.audit.checks).toHaveLength(1);
  });

  test("passing Check has name, type, command, status=passed, evidence", async () => {
    const report = await stubDet.run(ctx("echo hello"));
    const check = report.audit.checks?.[0];
    expect(check?.name).toBe("stub-det command");
    expect(check?.type).toBe("test_command");
    expect(check?.command).toBe("echo hello");
    expect(check?.status).toBe("passed");
    expect(check?.evidence).toContain("exit 0");
    // Stdout is captured and included in evidence
    expect(check?.evidence).toContain("hello");
  });

  test("cost.durationMs is present and non-negative", async () => {
    const report = await stubDet.run(ctx("echo ok"));
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("passing report validates against the TypeBox PhaseReport schema", async () => {
    const report = await stubDet.run(ctx("echo ok"));
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Failing command (non-zero exit)
// ---------------------------------------------------------------------------

describe("stub-det — failing command (non-zero exit)", () => {
  test('non-zero exit ⇒ status "completed" (the phase ran; the command failed)', async () => {
    const report = await stubDet.run(ctx("exit 7"));
    expect(report.status).toBe("completed");
  });

  test("non-zero exit ⇒ exactly one Finding with id stub-det.command-failed", async () => {
    const report = await stubDet.run(ctx("exit 7"));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.id).toBe("stub-det.command-failed");
  });

  test("finding.phase is stub-det", async () => {
    const report = await stubDet.run(ctx("exit 7"));
    expect(report.findings[0]?.phase).toBe("stub-det");
  });

  test('finding.severity is "error"', async () => {
    const report = await stubDet.run(ctx("exit 7"));
    expect(report.findings[0]?.severity).toBe("error");
  });

  test('finding.confidence is "high" (PRD §4.6 — deterministic findings are high by construction)', async () => {
    const report = await stubDet.run(ctx("exit 7"));
    expect(report.findings[0]?.confidence).toBe("high");
  });

  test("finding.message names command and exit code", async () => {
    const report = await stubDet.run(ctx("exit 7"));
    const msg = report.findings[0]?.message ?? "";
    expect(msg).toContain("exit 7");
    expect(msg).toContain("exit");
  });

  test("finding.evidence carries command and output fields", async () => {
    const report = await stubDet.run(ctx("echo failure && exit 3"));
    const evidence = report.findings[0]?.evidence;
    expect(evidence).toBeDefined();
    expect(evidence?.command).toBe("echo failure && exit 3");
    expect(typeof evidence?.output).toBe("string");
  });

  test("failing Check has status=failed with evidence", async () => {
    const report = await stubDet.run(ctx("exit 1"));
    const check = report.audit.checks?.[0];
    expect(check?.status).toBe("failed");
    expect(check?.evidence).toContain("exit 1");
  });

  test("failing report validates against the TypeBox PhaseReport schema", async () => {
    const report = await stubDet.run(ctx("exit 3"));
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  test("cost.durationMs is present on a failing run", async () => {
    const report = await stubDet.run(ctx("exit 1"));
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Missing / invalid config ⇒ error report (never throw)
// ---------------------------------------------------------------------------

describe("stub-det — missing or invalid config", () => {
  test('missing config ⇒ status "error" with reason', async () => {
    const badCtx = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: [] },
      config: undefined,
    };
    const report = await stubDet.run(badCtx);
    expect(report.status).toBe("error");
    expect(report.reason).toContain("stub-det");
    expect(report.reason).toContain("command");
  });

  test('null config ⇒ status "error"', async () => {
    const badCtx = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: [] },
      config: null,
    };
    const report = await stubDet.run(badCtx);
    expect(report.status).toBe("error");
  });

  test('config with non-string command ⇒ status "error"', async () => {
    const badCtx = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: [] },
      config: { command: 42 },
    };
    const report = await stubDet.run(badCtx);
    expect(report.status).toBe("error");
  });

  test('config with empty-string command ⇒ status "error"', async () => {
    const badCtx = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: [] },
      config: { command: "" },
    };
    const report = await stubDet.run(badCtx);
    expect(report.status).toBe("error");
  });

  test("error report validates against the TypeBox PhaseReport schema", async () => {
    const badCtx = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: [] },
      config: undefined,
    };
    const report = await stubDet.run(badCtx);
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pathological / spawn-failure commands — phase never rejects
// ---------------------------------------------------------------------------

describe("stub-det — phase never rejects (infallible contract)", () => {
  test("command that cannot run at all ⇒ error report, no throw", async () => {
    // A command that does not exist as a binary — spawn will fail with ENOENT or similar.
    // shell: true means the shell handles it; typically exits non-zero with an error message.
    // Either way, run() must not throw — the promise must resolve.
    const report = await stubDet.run(ctx("/this-binary-does-not-exist-ever-xyz"));
    // Could be "error" (spawn failed completely) or "completed" with a failed finding.
    // Either is acceptable — what's NOT acceptable is a rejection.
    expect(["completed", "error"]).toContain(report.status);
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });

  test("the returned promise always resolves, never rejects", async () => {
    const badCtx = {
      cwd: "/nonexistent-directory-that-never-exists",
      scope: { kind: "staged" as const, files: [] },
      config: { command: "echo hi" },
    };
    // Must resolve; the test itself would throw/timeout on rejection
    const report = await stubDet.run(badCtx);
    expect(["completed", "error"]).toContain(report.status);
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawn failure → phase error (not a command-failed finding)
// ---------------------------------------------------------------------------

describe("stub-det — spawn failure maps to phase error", () => {
  test("nonexistent cwd triggers spawn error ⇒ status error with spawn reason", async () => {
    // Pointing cwd at a directory that does not exist makes spawn emit an ENOENT error event
    // (the shell cannot be started in a nonexistent working directory). This exercises the
    // spawnError branch: the phase could not run, so the report is status "error", not
    // "completed" with a command-failed finding.
    const badCtx = {
      cwd: "/nonexistent-directory-that-never-exists-spawn-test",
      scope: { kind: "staged" as const, files: [] },
      config: { command: "echo hi" },
    };
    const report = await stubDet.run(badCtx);
    expect(report.status).toBe("error");
    expect(report.reason).toContain("spawn");
    expect(Value.Check(PhaseReport, report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Output captured in evidence (stdout + stderr, capped)
// ---------------------------------------------------------------------------

describe("stub-det — output capture", () => {
  test("stdout is captured in the passing Check's evidence", async () => {
    const report = await stubDet.run(ctx("echo captured-output"));
    const check = report.audit.checks?.[0];
    expect(check?.evidence).toContain("captured-output");
  });

  test("stderr is captured in evidence when command writes to stderr", async () => {
    const report = await stubDet.run(ctx("echo err-line >&2; exit 1"));
    // Evidence should include the stderr content somewhere (check or finding)
    const check = report.audit.checks?.[0];
    expect(check?.evidence).toContain("err-line");
  });
});

// ---------------------------------------------------------------------------
// Cancellation via ctx.signal (M4 PhaseContext.signal contract)
// ---------------------------------------------------------------------------

describe("stub-det — cancellation via ctx.signal", () => {
  /**
   * Helper: build a context with an already-aborted signal.
   * The reason is a plain string so the typeof guard in run() can surface it.
   */
  function ctxWithAbortedSignal(command: string, reason = "cancelled by scheduler") {
    const controller = new AbortController();
    controller.abort(reason);
    return {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: ["src/foo.ts"] },
      config: { command },
      signal: controller.signal,
    };
  }

  /**
   * Helper: build a context whose signal fires after a short delay.
   * Returns the context and the controller so the caller can abort at will.
   */
  function ctxWithDelayedSignal(command: string, reason = "cancelled by scheduler") {
    const controller = new AbortController();
    const context = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: ["src/foo.ts"] },
      config: { command },
      signal: controller.signal,
    };
    return { context, controller, reason };
  }

  test('pre-aborted signal ⇒ status "cancelled" without running the command', async () => {
    // The signal is already aborted before run() is called — no child should be spawned.
    const context = ctxWithAbortedSignal("echo should-not-run");
    const report = await stubDet.run(context);
    expect(report.status).toBe("cancelled");
  });

  test("pre-aborted signal ⇒ reason carries the signal's string reason", async () => {
    const context = ctxWithAbortedSignal("echo x", "gates failed: stub-det");
    const report = await stubDet.run(context);
    expect(report.reason).toBe("gates failed: stub-det");
  });

  test("pre-aborted signal with non-string reason ⇒ fallback reason string", async () => {
    // controller.abort() with no argument leaves reason as a DOMException, not a string.
    const controller = new AbortController();
    controller.abort(); // no reason arg — DOMException, not string
    const context = {
      cwd: "/tmp",
      scope: { kind: "staged" as const, files: ["src/foo.ts"] },
      config: { command: "echo x" },
      signal: controller.signal,
    };
    const report = await stubDet.run(context);
    expect(report.status).toBe("cancelled");
    expect(typeof report.reason).toBe("string");
    expect(report.reason!.length).toBeGreaterThan(0);
  });

  test("pre-aborted signal ⇒ cancelled report has empty findings and empty audit", async () => {
    const context = ctxWithAbortedSignal("echo x");
    const report = await stubDet.run(context);
    expect(report.findings).toHaveLength(0);
    expect(report.audit).toEqual({});
  });

  test("pre-aborted signal ⇒ cancelled report has a non-negative durationMs", async () => {
    const context = ctxWithAbortedSignal("echo x");
    const report = await stubDet.run(context);
    expect(typeof report.cost.durationMs).toBe("number");
    expect(report.cost.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("signal aborted mid-command ⇒ child is killed and run resolves with cancelled", async () => {
    // Use a long-running sleep so the child is alive when the signal fires.
    // Without the fix this test would hang for the full sleep duration.
    const { context, controller } = ctxWithDelayedSignal("sleep 30");
    // Abort after a very short delay to let spawn happen but before sleep completes.
    setTimeout(() => controller.abort("scheduler cancel"), 50);
    const report = await stubDet.run(context);
    expect(report.status).toBe("cancelled");
  }, 5_000 /* 5 s timeout — far less than the 30 s sleep */);

  test("signal aborted mid-command ⇒ reason from string signal reason", async () => {
    const { context, controller } = ctxWithDelayedSignal("sleep 30");
    setTimeout(() => controller.abort("scheduler cancel"), 50);
    const report = await stubDet.run(context);
    expect(report.reason).toBe("scheduler cancel");
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Output truncation marker (Fix 5: marker must appear on >4KB output)
// ---------------------------------------------------------------------------

describe("stub-det — truncation marker", () => {
  test("output >4KB on stdout ends with the truncation marker", async () => {
    // Emit 6000 'x' bytes on stdout — exceeds the 4096-byte cap.
    const bigCmd = `node -e "process.stdout.write('x'.repeat(6000))"`;
    const report = await stubDet.run(ctx(bigCmd));
    const check = report.audit.checks?.[0];
    // The captured evidence must include the truncation marker.
    expect(check?.evidence).toContain("…[stet: output truncated at 4KB]");
  });

  test("output ≤4KB on stdout has NO truncation marker", async () => {
    const smallCmd = `echo small`;
    const report = await stubDet.run(ctx(smallCmd));
    const check = report.audit.checks?.[0];
    expect(check?.evidence).not.toContain("…[stet: output truncated at 4KB]");
  });

  test("output >4KB on stderr ends with the truncation marker", async () => {
    // Emit 6000 'y' bytes on stderr — exceeds the 4096-byte cap.
    const bigStderrCmd = `node -e "process.stderr.write('y'.repeat(6000))" ; exit 1`;
    const report = await stubDet.run(ctx(bigStderrCmd));
    const check = report.audit.checks?.[0];
    // stderr is included in evidence — truncation marker must appear.
    expect(check?.evidence).toContain("…[stet: output truncated at 4KB]");
  });
});
