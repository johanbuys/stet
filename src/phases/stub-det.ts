/**
 * stub-det — the deterministic stub phase (PRD §3.9).
 *
 * Permanent product surface: lives in src/, never in a released binary's default phase set,
 * but always available for registration (the steel-thread test registers it explicitly).
 *
 * Responsibilities:
 *   - Validate its config slice: { command: string } — missing/invalid ⇒ PhaseReport error.
 *   - Run the configured command via `node:child_process` spawn with `shell: true`
 *     (the user provides their own command line, e.g. "echo ok" or "vp test"; stet-imposed
 *     bash execution limits arrive in M3 — for now the only cap is a generous output ceiling).
 *   - Capture stdout + stderr (capped at ~4 KB per stream to keep evidence readable).
 *   - Map exit code → one Check in audit.checks:
 *       - exit 0 → status "passed", no findings, phase status "completed"
 *       - non-zero → status "failed", one Finding (stub-det.command-failed, error, high),
 *         phase status "completed" (the phase succeeded; the command did not)
 *   - Spawn failure → phase status "error" (the phase could not run).
 *   - cost.durationMs measured around the spawn.
 *
 * Why shell: true?
 *   The user configures a full shell command line (may contain pipes, redirects, compound
 *   commands). shell: true routes through /bin/sh, which is acceptable because:
 *   (a) the command is the user's own, running in their own repo;
 *   (b) stet is read-only by design (mutation-free — PRD §3.2); the shell is the user's
 *   existing toolchain, not stet-imposed attack surface.
 *   Stet-controlled bash limits (timeouts, output caps) arrive in M3.
 *
 * PRD references: §3.9 (stub phases), §4.1 (PhaseConfiguration), §4.2 (Finding),
 * §4.3 (Check / Audit), §4.4 (PhaseReport), §4.6 (confidence rules — deterministic = high).
 */

import { spawn } from "node:child_process";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Audit, Check, PhaseReport } from "../schema/report.js";
import type { PhaseConfiguration } from "./types.js";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** TypeBox schema for the config slice stub-det expects. */
const StubDetConfigSchema = Type.Object({
  command: Type.String({ minLength: 1 }),
});

/** The config slice stub-det expects from user/project config. */
type StubDetConfig = Static<typeof StubDetConfigSchema>;

/**
 * Validate the phase's config slice via TypeBox Value.Check (narrows without assertions).
 * Returns the typed config or a reason string for the error PhaseReport.
 */
function validateConfig(
  config: unknown,
): { ok: true; value: StubDetConfig } | { ok: false; reason: string } {
  if (!Value.Check(StubDetConfigSchema, config)) {
    return {
      ok: false,
      reason: "stub-det: no command configured — config must be { command: string }",
    };
  }
  return { ok: true, value: config };
}

// ---------------------------------------------------------------------------
// Output cap
// ---------------------------------------------------------------------------

/** Max bytes captured per stream before truncation. ~4 KB each. */
const OUTPUT_CAP = 4096;

/** Truncation marker appended when a stream's output was clipped at OUTPUT_CAP. */
const TRUNCATION_MARKER = "\n…[stet: output truncated at 4KB]";

function capOutput(buf: Buffer, truncated: boolean): string {
  return buf.toString("utf8") + (truncated ? TRUNCATION_MARKER : "");
}

// ---------------------------------------------------------------------------
// Spawn helper — returns the exit code and combined captured output
// ---------------------------------------------------------------------------

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Set when the OS-level spawn itself failed (e.g. ENOENT on cwd); means the phase errored. */
  spawnError?: string;
  /** Set when the run was aborted via the caller's AbortSignal. */
  aborted?: boolean;
}

/**
 * Run `command` via /bin/sh in `cwd`. Resolves with the exit code and captured output.
 * Never rejects — spawn errors (e.g. bad cwd) set spawnError on the result instead.
 *
 * When `signal` is supplied and fires, the child process group is killed with SIGKILL
 * (same semantics as runBash in budgets.ts: detached + process.kill(-pid, "SIGKILL") so
 * the shell AND any subprocesses it spawned are terminated together), and the result
 * carries aborted: true so run() can map it to a cancelled PhaseReport.
 *
 * Engineering note: shell: true without detached: true means killing the shell PID leaves
 * its grandchildren alive, which hold the inherited stdout/stderr pipe open and prevent the
 * 'close' event from ever firing — the Promise never resolves. Use detached: true and kill
 * the whole process group. (See engineering-notes.md §Bash limits.)
 */
function runCommand(command: string, cwd: string, signal?: AbortSignal): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdoutBuf = Buffer.alloc(0);
    let stderrBuf = Buffer.alloc(0);
    // Track whether each stream was truncated so the marker can be appended.
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let hasExited = false;
    let aborted = false;

    let child: ReturnType<typeof spawn>;
    try {
      // detached: true creates a new process group (pgid = child.pid) so we can kill
      // the shell AND any subprocesses it spawned with a single process.kill(-pid, "SIGKILL").
      child = spawn(command, [], { shell: true, cwd, detached: true });
    } catch (err) {
      // Synchronous spawn failure (extremely rare)
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ exitCode: -1, stdout: "", stderr: "", spawnError: msg });
      return;
    }

    const kill = () => {
      // Guard on !hasExited to avoid SIGKILLing a pgid that may have been reused after
      // the child exited (mirrors budgets.ts kill() guard, engineering-notes.md §Bash limits).
      if (!settled && !hasExited && child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Group already gone or PID reused — ignore.
        }
      }
    };

    const onAbort = () => {
      aborted = true;
      kill();
    };

    // An already-aborted signal never fires its "abort" event (DOM semantics). Check eagerly
    // and kill synchronously before/instead of attaching a listener. (See engineering-notes.md
    // §Scheduler signal seam — same pattern as runBash and agent-phase.)
    if (signal?.aborted) {
      aborted = true;
      kill();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = OUTPUT_CAP - stdoutBuf.length;
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining);
        stdoutBuf = Buffer.concat([stdoutBuf, slice]);
        // If we hit the cap (either this chunk exactly filled it or there was more)
        if (stdoutBuf.length >= OUTPUT_CAP && chunk.length > slice.length) {
          stdoutTruncated = true;
        }
      } else {
        // Buffer is already full — any further data means truncation occurred
        stdoutTruncated = true;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const remaining = OUTPUT_CAP - stderrBuf.length;
      if (remaining > 0) {
        const slice = chunk.subarray(0, remaining);
        stderrBuf = Buffer.concat([stderrBuf, slice]);
        if (stderrBuf.length >= OUTPUT_CAP && chunk.length > slice.length) {
          stderrTruncated = true;
        }
      } else {
        stderrTruncated = true;
      }
    });

    const finalize = (code: number | null) => {
      if (settled) return;
      signal?.removeEventListener("abort", onAbort);
      settled = true;
      resolve({
        exitCode: code ?? -1,
        stdout: capOutput(stdoutBuf, stdoutTruncated),
        stderr: capOutput(stderrBuf, stderrTruncated),
        aborted,
      });
    };

    child.on("error", (err) => {
      if (settled) return;
      signal?.removeEventListener("abort", onAbort);
      settled = true;
      // The shell itself failed to launch — record spawnError so run() can surface a phase error.
      resolve({
        exitCode: -1,
        stdout: capOutput(stdoutBuf, stdoutTruncated),
        stderr: capOutput(stderrBuf, stderrTruncated),
        spawnError: err.message,
        aborted,
      });
    });

    child.on("exit", (code) => {
      hasExited = true;
      // 'close' fires after 'exit' in normal cases. We resolve in 'close' to ensure all
      // stdio data has been flushed. If 'close' doesn't follow promptly (background child
      // holding the pipe), 'exit' at least unblocks kill() guards.
      // For the abort path the kill already sent SIGKILL; 'close' will follow shortly.
      void code; // used via finalize in 'close'
    });

    child.on("close", (code) => {
      finalize(hasExited ? code : code);
    });
  });
}

// ---------------------------------------------------------------------------
// PhaseReport builders
// ---------------------------------------------------------------------------

function errorReport(reason: string, durationMs: number): PhaseReport {
  return {
    phase: "stub-det",
    status: "error",
    reason,
    findings: [],
    audit: {},
    cost: { durationMs },
  };
}

/**
 * Build a cancelled PhaseReport from an AbortSignal.
 *
 * Reason: use signal.reason when it's a string (engineering-notes.md §Scheduler signal seam:
 * "controller.abort() without a string reason leaves signal.reason as a DOMException, not a
 * string — always guard with typeof === 'string'"). Fall back to a literal.
 */
function cancelledReport(signal: AbortSignal, durationMs: number): PhaseReport {
  const reason = typeof signal.reason === "string" ? signal.reason : "cancelled by scheduler";
  return {
    phase: "stub-det",
    status: "cancelled",
    reason,
    findings: [],
    audit: {},
    cost: { durationMs },
  };
}

// ---------------------------------------------------------------------------
// stub-det PhaseConfiguration
// ---------------------------------------------------------------------------

export const stubDet: PhaseConfiguration = {
  id: "stub-det",
  kind: "deterministic",

  /**
   * Activation: always true (PRD §3.9 — stub phases declare trivial predicates).
   * The harness scheduler uses the predicate; non-activated phases become "skipped" (T6).
   */
  activation: (_ctx) => true,

  /**
   * Run the configured command and map the outcome to a PhaseReport.
   * INFALLIBLE BY CONTRACT: never throws, never rejects.
   *
   * Cancellation (M4 PhaseContext.signal contract):
   *   - Pre-aborted signal: returns a cancelled report immediately, no spawn.
   *   - Signal fires mid-run: runCommand kills the child process group and resolves
   *     with aborted: true → mapped to a cancelled PhaseReport.
   *   - Reason: string-guarded (engineering-notes.md §Scheduler signal seam).
   */
  async run(ctx): Promise<PhaseReport> {
    const start = Date.now();

    // --- Pre-abort short-circuit (engineering-notes.md §Scheduler signal seam) ---
    // An already-fired signal must be handled eagerly; it will never fire its "abort"
    // event again (DOM semantics), so a listener-only approach would let the phase run
    // until the command finishes naturally — appearing hung after Ctrl-C.
    if (ctx.signal?.aborted) {
      return cancelledReport(ctx.signal, Date.now() - start);
    }

    // --- Config validation ---
    const validated = validateConfig(ctx.config);
    if (!validated.ok) {
      return errorReport(validated.reason, Date.now() - start);
    }
    const { command } = validated.value;

    // --- Run the command ---
    let spawnResult: SpawnResult;
    try {
      spawnResult = await runCommand(command, ctx.cwd, ctx.signal);
    } catch (err) {
      // runCommand should never reject, but be defensive
      const msg = err instanceof Error ? err.message : String(err);
      return errorReport(`stub-det: spawn error: ${msg}`, Date.now() - start);
    }

    // --- Cancellation mid-run: signal fired while command was running ---
    if (spawnResult.aborted && ctx.signal) {
      return cancelledReport(ctx.signal, Date.now() - start);
    }

    const durationMs = Date.now() - start;
    const { exitCode, stdout, stderr, spawnError } = spawnResult;

    // --- Spawn failure: the shell itself could not start — phase error, not a command failure ---
    if (spawnError !== undefined) {
      return errorReport(`stub-det: failed to spawn command: ${spawnError}`, durationMs);
    }

    // --- Build combined output for evidence ---
    const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    const exitLabel = `exit ${exitCode}`;
    const evidenceText = [exitLabel, combinedOutput].filter(Boolean).join("\n").trim();

    // --- Build Check ---
    const checkStatus: Check["status"] = exitCode === 0 ? "passed" : "failed";
    const check: Check = {
      name: "stub-det command",
      type: "test_command",
      command,
      status: checkStatus,
      evidence: evidenceText,
    };

    const audit: Audit = { checks: [check] };

    // --- Exit 0 → completed, no findings ---
    if (exitCode === 0) {
      return {
        phase: "stub-det",
        status: "completed",
        findings: [],
        audit,
        cost: { durationMs },
      };
    }

    // --- Non-zero → completed with one error Finding ---
    return {
      phase: "stub-det",
      status: "completed",
      findings: [
        {
          id: "stub-det.command-failed",
          phase: "stub-det",
          severity: "error",
          /**
           * confidence: "high" — deterministic findings are high by construction (PRD §4.6).
           * A failing test command is not an opinion; it is evidence.
           */
          confidence: "high",
          message: `stub-det command failed with exit ${exitCode}: ${command}`,
          evidence: {
            command,
            output: combinedOutput,
          },
        },
      ],
      audit,
      cost: { durationMs },
    };
  },
};
