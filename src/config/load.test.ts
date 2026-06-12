/**
 * Integration tests for loadConfig — four-layer precedence, deep merge, and T18 warnings.
 *
 * Uses real temp directories, no mocks (plan M5 test plan).
 * The `homeDir` option is injected to avoid touching the real ~/.config/stet/.
 *
 * PRD §3.7: flags > project > user > built-in; nested keys merge leaf-by-leaf;
 * unknown top-level keys ⇒ warning finding, not error (T18).
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./load.js";

describe("loadConfig — four-layer precedence", () => {
  let tmpDir: string;
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "stet-config-load-"));
    projectDir = join(tmpDir, "project");
    homeDir = join(tmpDir, "home");
    await mkdir(projectDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeUserConfig(yaml: string): Promise<void> {
    await mkdir(join(homeDir, ".config", "stet"), { recursive: true });
    await writeFile(join(homeDir, ".config", "stet", "config.yml"), yaml);
  }

  async function writeProjectConfig(yaml: string): Promise<void> {
    await writeFile(join(projectDir, "stet.config.yml"), yaml);
  }

  // ── Slice 1: no files → built-in defaults ──────────────────────────────────

  it("no config files → Ok with built-in defaults (failOn: error)", async () => {
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("error");
      expect(result.value.findings).toHaveLength(0);
    }
  });

  // ── Slice 2: user config only → user wins over built-in ────────────────────

  it("user config only → user values override built-in defaults", async () => {
    await writeUserConfig("output:\n  failOn: warning\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("warning");
    }
  });

  // ── Slice 3: project config only → project wins over built-in ──────────────

  it("project config only → project values override built-in defaults", async () => {
    await writeProjectConfig("output:\n  failOn: info\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("info");
    }
  });

  // ── Slice 4: project wins over user ────────────────────────────────────────

  it("user + project — project wins over user for the same key", async () => {
    await writeUserConfig("output:\n  failOn: warning\n");
    await writeProjectConfig("output:\n  failOn: info\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("info");
    }
  });

  // ── Slice 5: flag override wins over all ───────────────────────────────────

  it("flag override wins over project and user for the same key", async () => {
    await writeUserConfig("output:\n  failOn: info\n");
    await writeProjectConfig("output:\n  failOn: warning\n");
    const result = await loadConfig({
      cwd: projectDir,
      homeDir,
      flagOverride: { output: { failOn: "error" } },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("error");
    }
  });

  // ── Slice 6: all four layers simultaneously ────────────────────────────────

  it("all four layers — flags > project > user > built-in", async () => {
    // built-in: output.failOn = "error"
    // user: phases.review.tier = "standard" (distinct from project's)
    // project: phases.review.tier = "robust"
    // flag: phases.review.tier = "ultra" (wins)
    await writeUserConfig("phases:\n  review:\n    tier: standard\n");
    await writeProjectConfig("phases:\n  review:\n    tier: robust\n");

    const result = await loadConfig({
      cwd: projectDir,
      homeDir,
      flagOverride: { phases: { review: { tier: "ultra" } } },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const review = (result.value.config.phases as Record<string, Record<string, unknown>>)
        ?.review;
      expect(review?.tier).toBe("ultra");
    }
  });

  // ── Slice 7: deep merge — nested keys from different layers survive ─────────

  it("user phases.review.tier and project phases.review.enabled both survive", async () => {
    await writeUserConfig("phases:\n  review:\n    tier: fast\n");
    await writeProjectConfig("phases:\n  review:\n    enabled: true\n");

    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const review = (result.value.config.phases as Record<string, Record<string, unknown>>)
        ?.review;
      expect(review?.tier).toBe("fast");
      expect(review?.enabled).toBe(true);
    }
  });

  // ── Slice 8: sibling phase keys in user config survive project overlay ──────

  it("project overlay of one phase does not clobber unrelated user phase", async () => {
    // user has phases.review AND phases.gates
    await writeUserConfig("phases:\n  review:\n    tier: fast\n  gates:\n    skip: false\n");
    // project only overrides phases.review
    await writeProjectConfig("phases:\n  review:\n    tier: robust\n");

    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const phases = result.value.config.phases as Record<string, Record<string, unknown>>;
      expect(phases?.review?.tier).toBe("robust"); // project wins on this key
      expect(phases?.gates?.skip).toBe(false); // user's unrelated phase survives
    }
  });

  // ── Slice 9: missing user config → Ok (layer silently absent) ──────────────

  it("missing user config file → Ok (project config still applied)", async () => {
    await writeProjectConfig("output:\n  failOn: warning\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("warning");
    }
  });

  // ── Slice 10: malformed project config → Err(ConfigError) with path ─────────

  it("malformed project config YAML → Err(ConfigError) with path in error", async () => {
    await writeProjectConfig("phases: [\nbad yaml");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
      expect(result.error.path).toContain("stet.config.yml");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  // ── Slice 11: malformed user config → Err(ConfigError) with path ────────────

  it("malformed user config YAML → Err(ConfigError) with path in error", async () => {
    await writeUserConfig("output: [\nbad yaml");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
      expect(result.error.path).toContain("config.yml");
    }
  });

  // ── readYamlLayer behaviors (per-layer parse/validate; tested via project layer) ──

  it("empty project config file → Ok (parses to no-op layer, built-in defaults survive)", async () => {
    await writeProjectConfig("");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("error");
    }
  });

  it("schema-invalid value (output.failOn: critical) → Err(ConfigError) with details", async () => {
    await writeProjectConfig("output:\n  failOn: critical\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
      expect(result.error.path).toContain("stet.config.yml");
      expect(result.error.message).toContain("invalid config");
    }
  });

  it("unknown keys inside phases.<id> → Ok (phase validates its own slice)", async () => {
    await writeProjectConfig("phases:\n  stub-det:\n    command: echo ok\n    someFutureKey: 42\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const slice = (result.value.config.phases as Record<string, Record<string, unknown>>)?.[
        "stub-det"
      ];
      expect(slice?.["command"]).toBe("echo ok");
      expect(slice?.["someFutureKey"]).toBe(42);
    }
  });

  // ── Slice 12: flag override deep merges with project config ──────────────────

  it("flag override merges leaf-by-leaf with project config (both keys survive)", async () => {
    // project: output.failOn = "info" AND phases.det.command = "npm test"
    await writeProjectConfig("output:\n  failOn: info\nphases:\n  det:\n    command: npm test\n");
    // flags override only output.failOn
    const result = await loadConfig({
      cwd: projectDir,
      homeDir,
      flagOverride: { output: { failOn: "warning" } },
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("warning"); // flag wins
      const det = (result.value.config.phases as Record<string, Record<string, unknown>>)?.det;
      expect(det?.command).toBe("npm test"); // project key survives
    }
  });
});

// ── T18: unknown top-level key → warning finding ────────────────────────────────
//
// PRD §3.7: "unknown keys ⇒ warning (forward compatibility), not error."
// Unknown keys pass through in the merged config AND appear as findings so
// the caller can surface them without blocking the run.

describe("loadConfig — T18: unknown key warning findings", () => {
  let tmpDir: string;
  let projectDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "stet-config-t18-"));
    projectDir = join(tmpDir, "project");
    homeDir = join(tmpDir, "home");
    await mkdir(projectDir, { recursive: true });
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeUserConfig(yaml: string): Promise<void> {
    await mkdir(join(homeDir, ".config", "stet"), { recursive: true });
    await writeFile(join(homeDir, ".config", "stet", "config.yml"), yaml);
  }

  async function writeProjectConfig(yaml: string): Promise<void> {
    await writeFile(join(projectDir, "stet.config.yml"), yaml);
  }

  // ── T18-1: single unknown top-level key in project config ──────────────────

  it("unknown top-level key in project config → Ok + warning finding naming the key", async () => {
    await writeProjectConfig("phases: {}\nunknownFutureKey: someValue\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Unknown key passes through in the merged config (forward compat)
      expect((result.value.config as Record<string, unknown>)["unknownFutureKey"]).toBe(
        "someValue",
      );
      // And surfaces as a warning finding (not an error)
      expect(result.value.findings).toHaveLength(1);
      const f = result.value.findings[0]!;
      expect(f.id).toBe("harness.unknown-config-key");
      expect(f.phase).toBe("harness");
      expect(f.severity).toBe("warning");
      expect(f.confidence).toBe("high");
      expect(f.message).toContain("unknownFutureKey");
      expect(f.location?.file).toContain("stet.config.yml");
    }
  });

  // ── T18-2: unknown key in user config → warning naming that file ────────────

  it("unknown top-level key in user config → Ok + warning finding naming user config path", async () => {
    await writeUserConfig("typoKey: value\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings).toHaveLength(1);
      const f = result.value.findings[0]!;
      expect(f.id).toBe("harness.unknown-config-key");
      expect(f.severity).toBe("warning");
      expect(f.message).toContain("typoKey");
      expect(f.location?.file).toContain("config.yml");
    }
  });

  // ── T18-3: unknown key in both user AND project → two findings ──────────────

  it("unknown key in both user and project config → two warning findings (one per file)", async () => {
    await writeUserConfig("userUnknown: a\n");
    await writeProjectConfig("projectUnknown: b\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings).toHaveLength(2);
      const ids = result.value.findings.map((f) => f.message);
      expect(ids.some((m) => m.includes("userUnknown"))).toBe(true);
      expect(ids.some((m) => m.includes("projectUnknown"))).toBe(true);
    }
  });

  // ── T18-4: multiple unknown keys in one file → one finding per key ──────────

  it("two unknown top-level keys in one file → two warning findings", async () => {
    await writeProjectConfig("alphaKey: 1\nbetaKey: 2\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings).toHaveLength(2);
      expect(result.value.findings.every((f) => f.severity === "warning")).toBe(true);
    }
  });

  // ── T18-5: known keys produce no findings ──────────────────────────────────

  it("only known top-level keys (phases, output) → no findings", async () => {
    await writeProjectConfig("phases: {}\noutput:\n  failOn: warning\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings).toHaveLength(0);
    }
  });

  // ── T18-6: unknown keys in phases.<id> do NOT generate top-level warnings ───

  it("unknown keys inside phases.<id> do NOT trigger top-level key warnings", async () => {
    await writeProjectConfig("phases:\n  stub-det:\n    someFutureKey: 42\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.findings).toHaveLength(0);
    }
  });

  // ── T18-7: warning finding does not cause Err — it's Ok with findings ───────

  it("unknown key does not produce Err — result is Ok regardless", async () => {
    await writeProjectConfig("output:\n  failOn: error\nspellingMistake: true\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    // Must be Ok, not Err — unknown keys are warnings, not errors (PRD §3.7)
    expect(result.isErr()).toBe(false);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.config.output?.failOn).toBe("error"); // config still usable
      expect(result.value.findings[0]?.severity).toBe("warning");
    }
  });
});
