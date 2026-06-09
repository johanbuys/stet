#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { matchError, type Result } from "better-result";
import type { StetError } from "./errors.js";

/** Shape returned by the CLI's exit-resolution function. */
export interface ExitResolution {
  exitCode: number;
  /** Human message for stderr; absent on Ok paths. */
  stderr?: string;
}

/**
 * Pure function: maps a Result from the run pipeline to an exit code + optional stderr message.
 *
 * This is the single exhaustive match over the StetError union. Adding a new variant
 * to StetError is a compile error here until a handler is added.
 *
 * Exit-code contract (PRD §4.8):
 *   0  — clean at threshold
 *   1  — ≥1 gating finding
 *   2  — stet malfunctioned (all taxonomy errors in M1)
 */
export function resolveExit(result: Result<{ exitCode: 0 | 1 }, StetError>): ExitResolution {
  if (result.isOk()) {
    return { exitCode: result.value.exitCode };
  }

  const stderr: string = matchError(result.error, {
    ScopeError: (e) => `stet: scope error — ${e.message}`,
    ConfigError: (e) => `stet: config error in ${e.path} — ${e.message}`,
    RoutingError: (e) =>
      e.tier !== undefined
        ? `stet: routing error (tier: ${e.tier}) — ${e.message}`
        : `stet: routing error — ${e.message}`,
    BudgetError: (e) => `stet: budget exceeded (limit: ${e.limit}) — ${e.message}`,
  });

  return { exitCode: 2, stderr };
}

// ── process boundary ──────────────────────────────────────────────────────────
// Only executed when this module is the entry point. The pure resolveExit above
// is imported by tests; this thin wrapper owns the actual side effects.

// Only run when this file is the direct entry point, not when imported by tests.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
  // T6 placeholder: real run pipeline not yet implemented.
  process.stderr.write("stet: not implemented yet. https://github.com/johanbuys/stet\n");
  process.exit(2);
}
