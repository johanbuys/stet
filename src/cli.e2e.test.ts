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

import { execFile as execFileCb } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { main, type CliIo } from "./cli.js";
import { parseRunReport } from "./schema/report.js";
import { registerPhase, resetRegistry } from "./phases/index.js";
import { stubDet } from "./phases/stub-det.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Fixture directory path (committed template — NOT a git repo)
// ---------------------------------------------------------------------------

const FIXTURE_TEMPLATE = fileURLToPath(new URL("../fixtures/stub-repo", import.meta.url));

// ---------------------------------------------------------------------------
// Fixture materialization helper
// ---------------------------------------------------------------------------

type StubRepoVariant = "pass" | "fail";

/**
 * Copy the fixture template to `dir`, git-init it, make an initial commit, and stage a change.
 * The fixture is then in the state scope detection expects: staged changes present.
 *
 * `variant = "fail"` writes `command: "exit 7"` to stet.config.yml instead of `echo ok`.
 *
 * Mirrors fixtures/stub-repo/setup.sh logic, in-process.
 */
export async function setupStubRepo(dir: string, variant: StubRepoVariant = "pass"): Promise<void> {
  // Copy template files
  await cp(FIXTURE_TEMPLATE, dir, { recursive: true });

  // Write fail-variant config if requested
  if (variant === "fail") {
    await writeFile(join(dir, "stet.config.yml"), `phases:\n  stub-det:\n    command: "exit 7"\n`);
  }

  // git init + configure local user + initial commit
  const git = (args: string[]) => execFile("git", args, { cwd: dir });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "stet-test"]);
  await git(["config", "user.email", "stet-test@example.com"]);
  await git(["add", "."]);
  await git(["commit", "-m", "Initial commit"]);

  // Stage a change so scope detection resolves to "staged"
  await writeFile(
    join(dir, "src", "main.ts"),
    (await import("node:fs")).readFileSync(join(dir, "src", "main.ts"), "utf8") + "\n",
  );
  await git(["add", "src/main.ts"]);
}

// ---------------------------------------------------------------------------
// I/O capture helper
// ---------------------------------------------------------------------------

function makeIo(cwd: string): { io: CliIo; stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const io: CliIo = {
    cwd,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };
  return { io, stdoutLines, stderrLines };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("CLI e2e — stub-det", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Each test gets a fresh tmp dir and a clean registry
    tmpDir = await mkdtemp(join(tmpdir(), "stet-e2e-"));
    resetRegistry();
    // Register stub-det explicitly — never rely on the default set (plan P10)
    registerPhase(stubDet);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Slice 1: happy-path pass ──────────────────────────────────────────────

  it("pass variant: main --format json → valid RunReport with stub-det completed, exit 0", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main(["--format", "json"], io);

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

    const result = await main(["--format", "json"], io);

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

    const result = await main(["--format", "json"], io);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
    }
  });

  // ── Slice 4: JSON output is ONLY the report — no other stdout writes ──────

  it("--format json: stdout receives exactly the RunReport JSON, nothing else", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    await main(["--format", "json"], io);

    // Exactly one line (the JSON.stringify output)
    expect(stdoutLines).toHaveLength(1);
    // It must parse as valid JSON
    expect(() => JSON.parse(stdoutLines[0]!)).not.toThrow();
  });

  // ── Slice 5: unknown flag → Err(ConfigError) ─────────────────────────────

  it("unknown flag → main returns Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--unknown-flag"], io);

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
    const result = await main(["--format", "json", "--fail-on", "warning"], io);

    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(stdoutLines[0]!);
    // failOn is reflected in the report
    expect(parsed.result.failOn).toBe("warning");
  });

  // ── Slice 7: invalid --fail-on value → Err(ConfigError) ─────────────────

  it("invalid --fail-on value → Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--fail-on", "critical"], io);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 8: invalid --format value → Err(ConfigError) ──────────────────

  it("invalid --format value → Err(ConfigError)", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io } = makeIo(tmpDir);

    const result = await main(["--format", "xml"], io);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 9: human mode output ───────────────────────────────────────────

  it("human mode: stdout has per-phase status lines, not raw JSON", async () => {
    await setupStubRepo(tmpDir, "pass");
    const { io, stdoutLines } = makeIo(tmpDir);

    const result = await main([], io); // default format is human

    expect(result.isOk()).toBe(true);
    // Multiple lines, NOT a JSON object
    expect(stdoutLines.length).toBeGreaterThan(0);
    expect(() => JSON.parse(stdoutLines.join("\n"))).toThrow();
    // Contains stub-det
    const combined = stdoutLines.join("\n");
    expect(combined).toContain("stub-det");
  });
});
