/**
 * Shared test-support helper: CliIo capture factory.
 *
 * This is a plain `.ts` module (NOT `*.test.ts`) so it is safe to import from
 * any test file without triggering test registration side-effects.
 *
 * Same pattern as `src/test-support/stub-repo.ts`.
 */

import type { CliIo } from "../cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CapturedIo {
  io: CliIo;
  stdoutLines: string[];
  stderrLines: string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a CliIo that captures stdout and stderr writes into arrays.
 * No network, no disk — pure in-memory capture for test assertions.
 */
export function makeIo(cwd: string, homeDir: string = cwd): CapturedIo {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io: CliIo = {
    cwd,
    // Default homeDir to cwd (a temp dir) so e2e tests never read the real
    // ~/.config/stet/config.yml off the host machine. Override per test as needed.
    homeDir,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
  return { io, stdoutLines, stderrLines };
}
