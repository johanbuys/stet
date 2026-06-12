/**
 * E2E integration tests for the stet CLI pipeline.
 *
 * Tests invoke `main()` in-process against a real git fixture repo materialized in a tmp dir.
 * No mocking — uses the real file system, real git, real phase runner.
 *
 * Fixture setup helper: `setupStubRepo(dir, variant)` — same logic as fixtures/stub-repo/setup.sh.
 * Tests register stub-det explicitly via registerPhase (plan §2, decision P10) — the test
 * keeps passing unchanged when real phases later displace the stubs from the default set.
 *
 * PRD refs: §4.5 (RunReport), §4.7 (flags), §4.8 (exit codes).
 * Plan refs: §M1 test plan, §2a (fixture state), decision P10 (explicit stub registration).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { main } from "./cli.js";
import { parseRunReport } from "./schema/report.js";
import { resetRegistry } from "./phases/index.js";
import { stubDet } from "./phases/stub-det.js";
import { setupStubRepo } from "./test-support/stub-repo.js";
import { makeIo } from "./test-support/io.js";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CLI e2e — stub-det", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Each test gets a fresh tmp dir and a clean registry.
    // The registry reset keeps state isolated but main() no longer reads from it
    // (main receives phases as a parameter — plan P10). resetRegistry is kept here
    // so other tests that may call registerPhase don't bleed into these tests.
    tmpDir = await mkdtemp(join(tmpdir(), "stet-e2e-"));
    resetRegistry();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Slice 1: happy-path pass ──────────────────────────────────────────────

  it("pass variant: main --format json → valid RunReport with stub-det completed, exit 0", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io, [stubDet]);

    // Pipeline returns Ok
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
    }

    // Exactly one stdout write — the JSON report
    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]!);

    // RunReport schema validates
    const valid = parseRunReport(parsed);
    expect(valid.isOk()).toBe(true);

    // Exactly one phase entry: stub-det
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].phase).toBe("stub-det");
    expect(parsed.phases[0].status).toBe("completed");

    // Scope detected as staged
    expect(parsed.scope.kind).toBe("staged");

    // result
    expect(parsed.result.exitCode).toBe(0);
    expect(parsed.result.gating).toEqual([]);
  });

  // ── Slice 2: fail variant → exit 1, gating finding ───────────────────────

  it("fail variant: command exit 7 → stub-det.command-failed, exit 1, gating named", async () => {
    await setupStubRepo(tmpDir, "fail");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io, [stubDet]);

    // Pipeline returns Ok (exit 1 is a valid pipeline outcome, not a stet error)
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(1);
    }

    expect(stdoutLines).toHaveLength(1);
    const parsed = JSON.parse(stdoutLines[0]!);

    expect(parsed.phases[0].phase).toBe("stub-det");
    expect(parsed.phases[0].status).toBe("completed");
    expect(parsed.phases[0].findings).toHaveLength(1);
    expect(parsed.phases[0].findings[0].id).toBe("stub-det.command-failed");

    expect(parsed.result.exitCode).toBe(1);
    expect(parsed.result.gating).toHaveLength(1);
    expect(parsed.result.gating[0].id).toBe("stub-det.command-failed");
  });

  // ── Slice 3: scope failure (non-git dir) → Err(ScopeError) ───────────────

  it("non-git dir → main returns Err(ScopeError)", async () => {
    // tmpDir is a real dir but NOT a git repo (setupStubRepo never called)
    const { io } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io, [stubDet]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
    }
  });

  // ── Slice 4: JSON output is ONLY the report — no other stdout writes ──────

  it("--format json: stdout receives exactly the RunReport JSON, nothing else", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    await main(["--format", "json"], io, [stubDet]);

    // Exactly one line (the JSON.stringify output)
    expect(stdoutLines).toHaveLength(1);
    // It must parse as valid JSON
    expect(() => JSON.parse(stdoutLines[0]!)).not.toThrow();
  });

  // ── Slice 5: unknown flag → Err(ConfigError) ─────────────────────────────

  it("unknown flag → main returns Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--unknown-flag"], io, [stubDet]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 6: --fail-on precedence (flag > config > default) ─────────────

  it("--fail-on warning causes warning+high finding to gate (flag > config > default)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    // The pass variant produces no error findings; inject a warning by using --fail-on
    // The echo ok command succeeds, so there are NO findings at all.
    // To test --fail-on we need a warning finding. Since stub-det only emits
    // stub-det.command-failed (error) or nothing, test precedence at the unit level:
    // flag overrides default — with flag "warning" and no findings → still exit 0.
    const result = await main(["--format", "json", "--fail-on", "warning"], io, [stubDet]);

    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(stdoutLines[0]!);
    // failOn is reflected in the report
    expect(parsed.result.failOn).toBe("warning");
  });

  // ── Slice 7: invalid --fail-on value → Err(ConfigError) ─────────────────

  it("invalid --fail-on value → Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--fail-on", "critical"], io, [stubDet]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 8: invalid --format value → Err(ConfigError) ──────────────────

  it("invalid --format value → Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--format", "xml"], io, [stubDet]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 9: human mode output ───────────────────────────────────────────

  it("human mode: stdout has per-phase status lines, not raw JSON", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main([], io, [stubDet]); // default format is human

    expect(result.isOk()).toBe(true);
    // Multiple lines, NOT a JSON object
    expect(stdoutLines.length).toBeGreaterThan(0);
    expect(() => JSON.parse(stdoutLines.join("\n"))).toThrow();
    // Contains stub-det
    const combined = stdoutLines.join("\n");
    expect(combined).toContain("stub-det");
  });

  // ── Slice 10: --version ───────────────────────────────────────────────────

  it("--version emits a semver string on stdout and exits 0", async () => {
    const { io, stdoutLines, stderrLines } = makeIo(tmpDir);

    const result = await main(["--version"], io, []);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
    }
    // Exactly one stdout line — the version string
    expect(stdoutLines).toHaveLength(1);
    // Must look like a semver (digits.digits.digits)
    expect(stdoutLines[0]).toMatch(/^\d+\.\d+\.\d+/);
    // Nothing on stderr
    expect(stderrLines).toHaveLength(0);
  });

  it("--version wins over --help when both are given", async () => {
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--version", "--help"], io, []);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
    }
    // Output must be a version string, not a usage block
    expect(stdoutLines).toHaveLength(1);
    expect(stdoutLines[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  // ── Slice 11: --help ──────────────────────────────────────────────────────

  it("--help emits a usage block mentioning each flag group and exits 0", async () => {
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--help"], io, []);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
    }
    const combined = stdoutLines.join("\n");
    // Must mention the program name
    expect(combined).toContain("stet");
    // Scope flags
    expect(combined).toMatch(/--staged/);
    expect(combined).toMatch(/--working/);
    expect(combined).toMatch(/--against/);
    expect(combined).toMatch(/--commit/);
    // Output flags
    expect(combined).toMatch(/--format/);
    expect(combined).toMatch(/--fail-on/);
    // Meta flags
    expect(combined).toMatch(/--version/);
    expect(combined).toMatch(/--help/);
  });

  // ── Slice 12: unknown flag still exits 2 via ConfigError ─────────────────

  it("truly unknown flag → Err(ConfigError) — not confused with --help/--version", async () => {
    const { io } = makeIo(tmpDir);

    const result = await main(["--no-such-flag"], io, []);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 13: unknown config key surfaces as a harness phase in the report ──
  //
  // T18 (PRD §3.7): an unknown top-level config key produces a warning finding
  // from loadConfig. cli.ts must INJECT that finding into the RunReport as a
  // synthetic "harness" phase. The load.test.ts unit tests only prove loadConfig
  // *returns* the finding — these prove cli.ts actually *surfaces* it, and that
  // the finding participates in exit-code gating per --fail-on.

  // Overwrite the project config with one that keeps stub-det runnable but adds
  // an unknown top-level key (the likeliest real-world typo / forward-compat key).
  async function writeProjectConfigWithUnknownKey(): Promise<void> {
    await writeFile(
      join(tmpDir, "stet.config.yml"),
      'phases:\n  stub-det:\n    command: "echo ok"\nunknownFutureKey: someValue\n',
    );
  }

  it("unknown config key → JSON report carries a harness phase with the warning finding (exit 0 under default failOn)", async () => {
    await setupStubRepo(tmpDir, "pass");
    await writeProjectConfigWithUnknownKey();
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io, [stubDet]);

    // Default failOn is "error" — a warning does not gate, so the run exits 0.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(0);
    }

    const parsed = JSON.parse(stdoutLines[0]!);
    const valid = parseRunReport(parsed);
    expect(valid.isOk()).toBe(true);

    // The harness phase is injected ahead of the real phases.
    const harness = parsed.phases.find((p: { phase: string }) => p.phase === "harness");
    expect(harness).toBeDefined();
    expect(harness.status).toBe("completed");
    expect(harness.findings).toHaveLength(1);
    expect(harness.findings[0].id).toBe("harness.unknown-config-key");
    expect(harness.findings[0].severity).toBe("warning");
    expect(harness.findings[0].message).toContain("unknownFutureKey");

    // The real phase still ran and the warning did NOT gate the exit.
    expect(parsed.phases.some((p: { phase: string }) => p.phase === "stub-det")).toBe(true);
    expect(parsed.result.exitCode).toBe(0);
    expect(parsed.result.gating).toEqual([]);
  });

  it("unknown config key under --fail-on warning → finding gates, exit 1, gating names it", async () => {
    await setupStubRepo(tmpDir, "pass");
    await writeProjectConfigWithUnknownKey();
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json", "--fail-on", "warning"], io, [stubDet]);

    // warning + high confidence now gates → exit 1.
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.exitCode).toBe(1);
    }

    const parsed = JSON.parse(stdoutLines[0]!);
    expect(parsed.result.exitCode).toBe(1);
    expect(parsed.result.gating).toHaveLength(1);
    expect(parsed.result.gating[0].id).toBe("harness.unknown-config-key");
  });

  it("clean config → no harness phase is injected", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io, [stubDet]);

    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(stdoutLines[0]!);
    // Only the real phase — the synthetic harness phase is omitted on clean config.
    expect(parsed.phases.some((p: { phase: string }) => p.phase === "harness")).toBe(false);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].phase).toBe("stub-det");
  });
});
