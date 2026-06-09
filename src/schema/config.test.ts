/**
 * Tests for loadConfig and StetConfig schema.
 *
 * TDD vertical slices — one behavior per test, in implementation order.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "stet-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Slice 1: missing file → Ok({}) ──────────────────────────────────────────

  it("missing stet.config.yml → Ok with empty defaults", async () => {
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({});
    }
  });

  // ── Slice 2: valid minimal file → Ok ────────────────────────────────────────

  it("valid yaml with phases slice → Ok with parsed config", async () => {
    const yaml = `phases:\n  stub-det:\n    command: "echo ok"\n`;
    await writeFile(join(tmpDir, "stet.config.yml"), yaml);
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.phases?.["stub-det"]).toEqual({ command: "echo ok" });
    }
  });

  it("valid yaml with output.failOn → Ok", async () => {
    const yaml = `output:\n  failOn: warning\n`;
    await writeFile(join(tmpDir, "stet.config.yml"), yaml);
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.output?.failOn).toBe("warning");
    }
  });

  it("empty yaml file → Ok with empty defaults", async () => {
    await writeFile(join(tmpDir, "stet.config.yml"), "");
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
  });

  // ── Slice 3: malformed YAML → Err(ConfigError) ──────────────────────────────

  it("malformed yaml → Err(ConfigError) carrying path", async () => {
    await writeFile(join(tmpDir, "stet.config.yml"), "phases: [\nbad yaml");
    const result = await loadConfig(tmpDir);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
      expect(result.error.path).toContain("stet.config.yml");
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  // ── Slice 4: schema-invalid top-level key value → Err(ConfigError) ──────────

  it("output.failOn invalid value → Err(ConfigError)", async () => {
    const yaml = `output:\n  failOn: critical\n`;
    await writeFile(join(tmpDir, "stet.config.yml"), yaml);
    const result = await loadConfig(tmpDir);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  // ── Slice 5: unknown top-level keys pass silently (forward compat) ──────────

  it("unknown top-level key → Ok (forward compat, M5 will warn)", async () => {
    const yaml = `phases: {}\nunknownFutureKey: someValue\n`;
    await writeFile(join(tmpDir, "stet.config.yml"), yaml);
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
  });

  // ── Slice 6: phases.<id> unknown keys pass through (phase's business) ────────

  it("unknown keys inside phases.<id> → Ok (phase validates its own slice)", async () => {
    const yaml = `phases:\n  stub-det:\n    command: echo ok\n    someFutureKey: 42\n`;
    await writeFile(join(tmpDir, "stet.config.yml"), yaml);
    const result = await loadConfig(tmpDir);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const slice = result.value.phases?.["stub-det"] as Record<string, unknown>;
      expect(slice?.["command"]).toBe("echo ok");
      expect(slice?.["someFutureKey"]).toBe(42);
    }
  });
});
