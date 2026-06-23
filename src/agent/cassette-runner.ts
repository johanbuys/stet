/**
 * CassetteRunner — record/replay at the AgentRunner seam (TDD C·1).
 *
 * Records or replays `{key → submission, cost}` at the AgentRunner boundary so
 * that `vp test` runs deterministically without network access (plan §M3a / PL·2).
 *
 * Key = SHA-256 of JSON-serialized `{ model, rubric, userPrompt }`.
 * Non-serializable fields (submitSchema, signal, onTool, toolset, budgets, cwd,
 * submitToolName) are excluded — they describe execution context, not the model's
 * input contract, and cannot appear in a portable cassette key.
 * `model` defaults to `null` when absent (runner resolves later at M6).
 *
 * Three factory constructors:
 *   `CassetteRunner.fromStore(store)`        — replay from in-memory object (tests)
 *   `CassetteRunner.fromFile(cassettePath)`  — replay from a JSON file
 *   `CassetteRunner.record(path, runner)`    — run live; save Ok result to JSON file
 *
 * Miss behavior: `Err(NoSubmitError)` with the first 16 hex chars of the key in the
 * message (enough to identify the entry without dumping the full 64-char hash).
 * Record mode writes only on `Ok` — errors are not persisted.
 *
 * On-disk format: a JSON object keyed by 64-char hex SHA-256 strings, each value
 * being `{ submission: unknown, cost: Cost }`. The file is pretty-printed (2-space
 * indent) so cassette diffs are human-readable in code review.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Result } from "better-result";
import type { AgentError } from "../errors.js";
import { ConfigError, NoSubmitError } from "../errors.js";
import type { AgentRunInputs, AgentRunSuccess, AgentRunner } from "./runner.js";

// ---------------------------------------------------------------------------
// Cassette format
// ---------------------------------------------------------------------------

export interface CassetteEntry {
  submission: unknown;
  cost: AgentRunSuccess["cost"];
}

/**
 * The in-memory and on-disk format for a cassette: a plain object keyed by
 * hex SHA-256 key strings, each value being a `CassetteEntry`.
 */
export type CassetteStore = Record<string, CassetteEntry>;

// ---------------------------------------------------------------------------
// Key computation — the documented hash (plan §M3a, PL·2)
// ---------------------------------------------------------------------------

/**
 * Compute the cassette lookup key for a given set of agent run inputs.
 *
 * Key domain: `{ model: string | null, rubric: string, userPrompt: string }`
 *
 * **Included:** the three fields that determine what the model responds to.
 * **Excluded:**
 *   - `submitSchema`    — TSchema object; not JSON-serializable
 *   - `toolset`         — execution configuration, not model input
 *   - `budgets`         — execution limits, not model input
 *   - `cwd`             — filesystem path; not model input
 *   - `signal`          — AbortSignal; not serializable
 *   - `onTool`          — progress callback; not serializable
 *   - `submitToolName`  — tool plumbing, not model input
 *
 * Algorithm: `SHA-256( JSON.stringify({ model: model ?? null, rubric, userPrompt }) )`
 *
 * Stability: `JSON.stringify` preserves key order when the keys are string literals
 * and none of the values contain non-UTF-8 bytes — both conditions hold here.
 * `model ?? null` normalises `undefined` to `null` so missing-model and explicit-null
 * produce the same key (both mean "runner resolves the model later").
 */
export function computeCassetteKey(
  inputs: Pick<AgentRunInputs, "model" | "rubric" | "userPrompt">,
): string {
  const { model = null, rubric, userPrompt } = inputs;
  return createHash("sha256").update(JSON.stringify({ model, rubric, userPrompt })).digest("hex");
}

// ---------------------------------------------------------------------------
// File helpers (not exported — internal I/O)
// ---------------------------------------------------------------------------

function loadCassetteFile(cassettePath: string): Result<CassetteStore, ConfigError> {
  if (!existsSync(cassettePath)) return Result.ok({});
  try {
    return Result.ok(JSON.parse(readFileSync(cassettePath, "utf8")) as CassetteStore);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Result.err(
      new ConfigError({ path: cassettePath, message: `cassette file is not valid JSON: ${msg}` }),
    );
  }
}

function saveCassetteFile(cassettePath: string, store: CassetteStore): void {
  writeFileSync(cassettePath, JSON.stringify(store, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// CassetteRunner
// ---------------------------------------------------------------------------

export class CassetteRunner implements AgentRunner {
  private constructor(
    private readonly store: CassetteStore,
    private readonly savePath: string | null,
    private readonly wrapped: AgentRunner | null,
  ) {}

  /**
   * Replay mode — reads from an in-memory `CassetteStore`.
   * No file I/O; ideal for unit tests that hand-write synthetic cassettes.
   */
  static fromStore(store: CassetteStore): CassetteRunner {
    return new CassetteRunner(store, null, null);
  }

  /**
   * Replay mode — loads the cassette from a JSON file at construction time.
   * If the file does not exist the store is empty; every `run()` call returns a miss.
   * Returns `Err(ConfigError)` if the file exists but is not valid JSON.
   */
  static fromFile(cassettePath: string): Result<CassetteRunner, ConfigError> {
    const storeRes = loadCassetteFile(cassettePath);
    if (storeRes.isErr()) return Result.err(storeRes.error);
    return Result.ok(new CassetteRunner(storeRes.value, null, null));
  }

  /**
   * Record mode — delegates to `runner` and persists each `Ok` result to
   * `cassettePath`. Existing entries at the same key are overwritten (idempotent
   * re-record). Existing entries at different keys are preserved (file is read
   * at construction, then appended/updated in memory before each save).
   *
   * Does NOT persist `Err` results — failures are not cassette-able.
   * Returns `Err(ConfigError)` if an existing cassette file is not valid JSON.
   *
   * // M5: batching multiple writes into a single flush is a future optimization.
   */
  static record(cassettePath: string, runner: AgentRunner): Result<CassetteRunner, ConfigError> {
    const storeRes = loadCassetteFile(cassettePath);
    if (storeRes.isErr()) return Result.err(storeRes.error);
    return Result.ok(new CassetteRunner(storeRes.value, cassettePath, runner));
  }

  async run(inputs: AgentRunInputs): Promise<Result<AgentRunSuccess, AgentError>> {
    const key = computeCassetteKey(inputs);

    if (this.wrapped === null) {
      // ── Replay ────────────────────────────────────────────────────────────
      const entry = this.store[key];
      if (entry === undefined) {
        return Result.err(
          new NoSubmitError({
            message: `cassette miss: no recorded entry for key ${key.slice(0, 16)}…`,
            cost: { durationMs: 0 },
          }),
        );
      }
      return Result.ok({ submission: entry.submission, cost: entry.cost });
    }

    // ── Record ──────────────────────────────────────────────────────────────
    const result = await this.wrapped.run(inputs);
    if (result.isOk()) {
      this.store[key] = { submission: result.value.submission, cost: result.value.cost };
      if (this.savePath !== null) {
        saveCassetteFile(this.savePath, this.store);
      }
    }
    return result;
  }
}
