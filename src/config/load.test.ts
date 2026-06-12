/**
 * Integration tests for loadConfig — four-layer precedence and deep merge.
 *
 * Uses real temp directories, no mocks (plan M5 test plan).
 * The `homeDir` option is injected to avoid touching the real ~/.config/stet/.
 *
 * PRD §3.7: flags > project > user > built-in; nested keys merge leaf-by-leaf.
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
      expect(result.value.output?.failOn).toBe("error");
    }
  });

  // ── Slice 2: user config only → user wins over built-in ────────────────────

  it("user config only → user values override built-in defaults", async () => {
    await writeUserConfig("output:\n  failOn: warning\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.output?.failOn).toBe("warning");
    }
  });

  // ── Slice 3: project config only → project wins over built-in ──────────────

  it("project config only → project values override built-in defaults", async () => {
    await writeProjectConfig("output:\n  failOn: info\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.output?.failOn).toBe("info");
    }
  });

  // ── Slice 4: project wins over user ────────────────────────────────────────

  it("user + project — project wins over user for the same key", async () => {
    await writeUserConfig("output:\n  failOn: warning\n");
    await writeProjectConfig("output:\n  failOn: info\n");
    const result = await loadConfig({ cwd: projectDir, homeDir });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.output?.failOn).toBe("info");
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
      expect(result.value.output?.failOn).toBe("error");
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
      const review = (result.value.phases as Record<string, Record<string, unknown>>)?.review;
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
      const review = (result.value.phases as Record<string, Record<string, unknown>>)?.review;
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
      const phases = result.value.phases as Record<string, Record<string, unknown>>;
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
      expect(result.value.output?.failOn).toBe("warning");
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
      expect(result.value.output?.failOn).toBe("warning"); // flag wins
      const det = (result.value.phases as Record<string, Record<string, unknown>>)?.det;
      expect(det?.command).toBe("npm test"); // project key survives
    }
  });
});
