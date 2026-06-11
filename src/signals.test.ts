/**
 * Tests for src/signals.ts — POSIX signal handling (T16, M4 step 5).
 *
 * Two layers:
 *   1. Unit tests: signalExitCode + installSignalHandlers behavior exercised by
 *      directly invoking the registered handlers (not via process.emit, which would
 *      also fire Vitest's own SIGINT handler and risk killing the test process).
 *   2. Integration tests: spawn fixtures/signal-test/run.ts via node, send a real
 *      OS signal, assert exit code + partial report content.
 *
 * PRD refs: §3.4.4 (teardown + signal codes); acceptance #9.
 * Plan refs: M4 step 5.
 */

import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installSignalHandlers, signalExitCode, runWithSignals } from "./signals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Invoke the most recently registered listener for the given signal without
 * going through the OS or process.emit (which fires ALL registered listeners).
 *
 * We use process.rawListeners because our handler is always appended last via
 * process.on — rawListeners returns wrappers for `once` listeners and the
 * function itself for `on` listeners, so calling it is safe.
 */
function callLastListener(sig: "SIGINT" | "SIGTERM"): void {
  const listeners = process.rawListeners(sig);
  const last = listeners[listeners.length - 1];
  if (typeof last === "function") (last as () => void)();
}

// ---------------------------------------------------------------------------
// signalExitCode — pure POSIX mapping
// ---------------------------------------------------------------------------

describe("signalExitCode", () => {
  it("SIGINT → 130 (128 + signal 2)", () => {
    expect(signalExitCode("SIGINT")).toBe(130);
  });

  it("SIGTERM → 143 (128 + signal 15)", () => {
    expect(signalExitCode("SIGTERM")).toBe(143);
  });
});

// ---------------------------------------------------------------------------
// installSignalHandlers — unit tests
// ---------------------------------------------------------------------------

describe("installSignalHandlers", () => {
  it("getReceived() returns null before any signal fires", () => {
    const controller = new AbortController();
    const { cleanup, getReceived } = installSignalHandlers(controller);
    try {
      expect(getReceived()).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("SIGINT fires the controller and records received='SIGINT'", () => {
    const controller = new AbortController();
    const { cleanup, getReceived } = installSignalHandlers(controller);
    try {
      expect(controller.signal.aborted).toBe(false);
      callLastListener("SIGINT");
      expect(controller.signal.aborted).toBe(true);
      expect(getReceived()).toBe("SIGINT");
    } finally {
      cleanup();
    }
  });

  it("SIGTERM fires the controller and records received='SIGTERM'", () => {
    const controller = new AbortController();
    const { cleanup, getReceived } = installSignalHandlers(controller);
    try {
      callLastListener("SIGTERM");
      expect(controller.signal.aborted).toBe(true);
      expect(getReceived()).toBe("SIGTERM");
    } finally {
      cleanup();
    }
  });

  it("cleanup removes both SIGINT and SIGTERM listeners", () => {
    const controller = new AbortController();
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    const { cleanup } = installSignalHandlers(controller);
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
    cleanup();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("second SIGINT calls process.exit(130) — teardown refused, no report", () => {
    // Spy on process.exit to prevent the test process from actually exiting.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const controller = new AbortController();
    const { cleanup } = installSignalHandlers(controller);
    try {
      callLastListener("SIGINT"); // first: starts teardown
      expect(exitSpy).not.toHaveBeenCalled();
      callLastListener("SIGINT"); // second: force-kill
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }
  });

  it("SIGTERM after SIGINT is idempotent — received stays 'SIGINT'", () => {
    const controller = new AbortController();
    const { cleanup, getReceived } = installSignalHandlers(controller);
    try {
      callLastListener("SIGINT");
      expect(getReceived()).toBe("SIGINT");
      callLastListener("SIGTERM"); // second signal — first wins
      expect(getReceived()).toBe("SIGINT");
    } finally {
      cleanup();
    }
  });

  it("SIGINT after SIGTERM does NOT force-kill — first SIGINT after SIGTERM is still the first SIGINT", () => {
    // Finding 3: teardownStarted was shared, so SIGTERM→SIGINT incorrectly escalated.
    // Fixed: force-kill only on repeat SIGINT (sigintCount > 1), not on first SIGINT
    // regardless of prior SIGTERM.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const controller = new AbortController();
    const { cleanup, getReceived } = installSignalHandlers(controller);
    try {
      callLastListener("SIGTERM"); // start teardown via SIGTERM
      expect(getReceived()).toBe("SIGTERM");
      callLastListener("SIGINT"); // first-ever SIGINT — must NOT force-kill
      expect(exitSpy).not.toHaveBeenCalled();
      // received stays SIGTERM (first signal wins)
      expect(getReceived()).toBe("SIGTERM");
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }
  });

  it("SIGINT → SIGINT force-kills even if SIGTERM arrived between them", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    const controller = new AbortController();
    const { cleanup } = installSignalHandlers(controller);
    try {
      callLastListener("SIGINT"); // first SIGINT
      callLastListener("SIGTERM"); // SIGTERM in between — idempotent
      callLastListener("SIGINT"); // second SIGINT — must force-kill
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }
  });

  it("controller.signal.reason reflects the SIGINT string", () => {
    const controller = new AbortController();
    const { cleanup } = installSignalHandlers(controller);
    try {
      callLastListener("SIGINT");
      expect(controller.signal.reason).toBe("SIGINT");
    } finally {
      cleanup();
    }
  });

  it("controller.signal.reason reflects the SIGTERM string", () => {
    const controller = new AbortController();
    const { cleanup } = installSignalHandlers(controller);
    try {
      callLastListener("SIGTERM");
      expect(controller.signal.reason).toBe("SIGTERM");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// runWithSignals — unit tests
// ---------------------------------------------------------------------------

describe("runWithSignals", () => {
  it("returns result and received=null when run completes normally", async () => {
    const { result, received } = await runWithSignals(async (_signal) => 42);
    expect(result).toBe(42);
    expect(received).toBeNull();
  });

  it("passes an AbortSignal to the inner function", async () => {
    let capturedSignal: AbortSignal | null = null;
    await runWithSignals(async (signal) => {
      capturedSignal = signal;
    });
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
  });

  it("cleans up signal handlers in finally after normal completion", async () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    await runWithSignals(async (_signal) => "done");
    // After completion, listener counts must be back to baseline
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("cleans up signal handlers in finally even when inner function throws", async () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    try {
      await runWithSignals(async (_signal) => {
        throw new Error("inner error");
      });
    } catch {
      // expected
    }
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("received reflects the signal that fired during the run", async () => {
    let fireSignal!: () => void;
    const { received } = await runWithSignals(async (_signal) => {
      // Capture the handler so we can fire it from inside the run
      const listeners = process.rawListeners("SIGINT");
      const last = listeners[listeners.length - 1];
      if (typeof last === "function") fireSignal = last as () => void;
      fireSignal();
    });
    expect(received).toBe("SIGINT");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — child-process harness
//
// Spawn fixtures/signal-test/run.ts via node --experimental-strip-types,
// send a real OS signal, assert exit code + partial report with cancelled statuses.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE = resolve(REPO_ROOT, "fixtures/signal-test/run.ts");

interface FixtureHandle {
  proc: ReturnType<typeof spawn>;
  waitForReady: () => Promise<void>;
  waitForClose: () => Promise<number | null>;
  getStdout: () => string;
}

// Track live fixture processes so they can be killed in afterEach if a test fails
// before it cleans up its own child.
const liveFixtures: FixtureHandle[] = [];

afterEach(() => {
  // Kill any fixtures that survived (e.g. due to a failed assertion before kill).
  for (const f of liveFixtures.splice(0)) {
    try {
      f.proc.kill("SIGKILL");
    } catch {
      // already exited — ignore
    }
  }
});

function spawnFixture(): FixtureHandle {
  let stdoutData = "";

  // jiti (available in node_modules/.bin) runs TypeScript files directly and handles
  // the .js → .ts extension remapping that ESM imports require. bun is not available
  // in this environment; node --experimental-strip-types does not remap .js to .ts.
  const proc = spawn(resolve(REPO_ROOT, "node_modules/.bin/jiti"), [FIXTURE], {
    cwd: REPO_ROOT,
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    stdoutData += chunk.toString();
  });

  const waitForReady = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      // Fail fast if the spawn itself fails (e.g. ENOENT for the node binary).
      proc.on("error", (err) => reject(new Error(`fixture spawn error: ${err.message}`)));

      if (stdoutData.includes("READY")) {
        resolve();
        return;
      }
      const onData = () => {
        if (stdoutData.includes("READY")) {
          proc.stdout?.off("data", onData);
          resolve();
        }
      };
      proc.stdout?.on("data", onData);
      proc.on("close", () => reject(new Error("process exited before READY")));
    });

  const waitForClose = (): Promise<number | null> =>
    new Promise<number | null>((resolve) => {
      proc.on("close", (code) => resolve(code));
    });

  const handle: FixtureHandle = {
    proc,
    waitForReady,
    waitForClose,
    getStdout: () => stdoutData,
  };

  liveFixtures.push(handle);
  return handle;
}

describe("T16: signal handling — child-process harness (PRD §3.4.4, acceptance #9)", () => {
  it("SIGINT causes exit 130 with partial report showing cancelled phases", async () => {
    const { proc, waitForReady, waitForClose, getStdout } = spawnFixture();
    await waitForReady();
    proc.kill("SIGINT");
    const exitCode = await waitForClose();

    expect(exitCode).toBe(130);

    const jsonLine = getStdout()
      .split("\n")
      .find((l) => l.trim().startsWith("{"));
    expect(jsonLine).toBeDefined();
    const report = JSON.parse(jsonLine!);
    expect(report.phases).toHaveLength(2);
    expect(report.phases.every((p: { status: string }) => p.status === "cancelled")).toBe(true);
  }, 10_000);

  it("SIGTERM causes exit 143 with partial report showing cancelled phases", async () => {
    const { proc, waitForReady, waitForClose, getStdout } = spawnFixture();
    await waitForReady();
    proc.kill("SIGTERM");
    const exitCode = await waitForClose();

    expect(exitCode).toBe(143);

    const jsonLine = getStdout()
      .split("\n")
      .find((l) => l.trim().startsWith("{"));
    expect(jsonLine).toBeDefined();
    const report = JSON.parse(jsonLine!);
    expect(report.phases).toHaveLength(2);
    expect(report.phases.every((p: { status: string }) => p.status === "cancelled")).toBe(true);
  }, 10_000);
});
