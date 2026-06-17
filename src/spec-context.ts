/**
 * Spec-context combining — M8, T23.
 *
 * Accepts --prd <file|-|literal> and --task <string>, concatenates them,
 * and tracks each input in `sources` for the run report.
 *
 * PRD §3.6: combinable; concatenated and handed to phases that declare they
 * consume spec context. Sources echoed in report.spec.sources.
 *
 * File detection: try readFile(value); on ENOENT treat as literal.
 * Other fs errors surface as Err(ConfigError).
 *
 * Injectable deps (readFile, readStdin) keep the module fully testable without
 * touching the real filesystem or process.stdin.
 */

import { readFile as nodeReadFile } from "node:fs/promises";
import { Result } from "better-result";
import { ConfigError } from "./errors.js";
import { isFileAbsentError } from "./fs-util.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecContext {
  /** Concatenated spec text (prd + task, separated by double newline when both present). */
  text: string;
  /** CLI-form source identifiers, e.g. ["--prd docs/spec.md", "--task"]. */
  sources: string[];
}

export interface SpecContextInput {
  prd?: string;
  task?: string;
}

/** Injectable I/O seam — production defaults to node:fs/promises + process.stdin. */
export interface SpecContextDeps {
  readFile?: (path: string) => Promise<string>;
  readStdin?: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Combine --prd and --task into a SpecContext.
 *
 * Returns Ok(SpecContext) — text is empty and sources is [] when neither flag
 * was provided (report.spec.provided will be false).
 *
 * Returns Err(ConfigError) only for real filesystem errors (not ENOENT —
 * that case means "not a file path; treat as literal").
 */
export async function buildSpecContext(
  input: SpecContextInput,
  deps: SpecContextDeps = {},
): Promise<Result<SpecContext, ConfigError>> {
  const { prd, task } = input;
  const readFileFn = deps.readFile ?? ((path) => nodeReadFile(path, "utf8"));
  const readStdinFn = deps.readStdin ?? readStdinDefault;

  const parts: string[] = [];
  const sources: string[] = [];

  // An empty-or-whitespace-only flag value (e.g. `--prd ""`) is treated as if
  // the flag were absent — it never represents an inline literal. Stdin ("-")
  // is non-empty and is unaffected. The guard applies to the literal flag
  // value, not to file/stdin CONTENT (a real empty file is still honored).
  if (prd !== undefined && prd.trim() !== "") {
    if (prd === "-") {
      try {
        const text = await readStdinFn();
        parts.push(text);
        sources.push("--prd -");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Result.err(new ConfigError({ path: "<stdin>", message: `--prd -: ${message}` }));
      }
    } else {
      try {
        const text = await readFileFn(prd);
        parts.push(text);
        sources.push(`--prd ${prd}`);
      } catch (err) {
        if (isFileAbsentError(err)) {
          // Not a file path — treat the value as a literal spec string.
          parts.push(prd);
          sources.push("--prd <inline>");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          return Result.err(new ConfigError({ path: prd, message: `--prd: ${message}` }));
        }
      }
    }
  }

  if (task !== undefined && task.trim() !== "") {
    parts.push(task);
    sources.push("--task");
  }

  return Result.ok({ text: parts.join("\n\n"), sources });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function readStdinDefault(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks).toString("utf8");
}
