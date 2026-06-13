/**
 * Tests for qualification check + manifest reader (T20 · M6 · PRD §3.2, acceptance #15).
 *
 * Covers:
 *   qualify.ts — checkQualification: no-match → warning, match → null, version bump → warning
 *   manifest.ts — readManifest: valid file, missing file, malformed JSON, bad schema
 *
 * PRD refs: §3.2, acceptance #15; plan M6 (b).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { useTempDir } from "../test-support/temp-dir.js";
import { TIER_PREFERENCES, type ModelTier } from "./resolve.js";
import { readManifest, type ManifestEntry } from "./manifest.js";
import {
  checkQualification,
  CURRENT_FIXTURE_SET_VERSION,
  CURRENT_RUBRIC_VERSION,
} from "./qualify.js";

const MANIFEST_PATH = fileURLToPath(new URL("../../fixtures/manifest.json", import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchingEntry(
  model: string,
  tier: "robust" | "fast",
  overrides?: Partial<ManifestEntry>,
): ManifestEntry {
  return {
    model,
    tier,
    rubricVersion: CURRENT_RUBRIC_VERSION,
    fixtureSetVersion: CURRENT_FIXTURE_SET_VERSION,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkQualification
// ---------------------------------------------------------------------------

describe("checkQualification", () => {
  it("no entries → unqualified-model warning finding", () => {
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", []);
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("harness.unqualified-model");
    expect(finding!.phase).toBe("harness");
    expect(finding!.severity).toBe("warning");
    expect(finding!.confidence).toBe("high");
  });

  it("warning message names the model and tier (actionable)", () => {
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", []);
    expect(finding!.message).toContain("anthropic/claude-opus-4-8");
    expect(finding!.message).toContain("robust");
  });

  it("exact match (model + tier + rubricVersion + fixtureSetVersion) → null (no warning)", () => {
    const entries = [matchingEntry("anthropic/claude-opus-4-8", "robust")];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).toBeNull();
  });

  it("wrong rubricVersion → unqualified warning (version bump invalidates)", () => {
    const entries = [
      matchingEntry("anthropic/claude-opus-4-8", "robust", { rubricVersion: "0.9.0" }),
    ];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("harness.unqualified-model");
  });

  it("wrong fixtureSetVersion → unqualified warning (version bump invalidates)", () => {
    const entries = [
      matchingEntry("anthropic/claude-opus-4-8", "robust", { fixtureSetVersion: "0.9.0" }),
    ];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).not.toBeNull();
    expect(finding!.id).toBe("harness.unqualified-model");
  });

  it("wrong tier → unqualified warning", () => {
    const entries = [matchingEntry("anthropic/claude-opus-4-8", "fast")];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).not.toBeNull();
  });

  it("wrong model → unqualified warning", () => {
    const entries = [matchingEntry("openai/gpt-4o", "robust")];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).not.toBeNull();
  });

  it("multiple entries: one match suppresses the warning", () => {
    const entries = [
      matchingEntry("openai/gpt-4o", "robust"),
      matchingEntry("anthropic/claude-opus-4-8", "robust"),
    ];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).toBeNull();
  });

  it("stale rubricVersion alongside a fresh match → null (the fresh match wins)", () => {
    const entries = [
      matchingEntry("anthropic/claude-opus-4-8", "robust", { rubricVersion: "0.9.0" }),
      matchingEntry("anthropic/claude-opus-4-8", "robust"),
    ];
    const finding = checkQualification("anthropic/claude-opus-4-8", "robust", entries);
    expect(finding).toBeNull();
  });

  it("fast tier match on fast tier → null", () => {
    const entries = [matchingEntry("anthropic/claude-haiku-4-5", "fast")];
    const finding = checkQualification("anthropic/claude-haiku-4-5", "fast", entries);
    expect(finding).toBeNull();
  });

  it("fast entry does not qualify a robust-tier check", () => {
    const entries = [matchingEntry("anthropic/claude-haiku-4-5", "fast")];
    const finding = checkQualification("anthropic/claude-haiku-4-5", "robust", entries);
    expect(finding).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readManifest
// ---------------------------------------------------------------------------

describe("readManifest", () => {
  const tmpDir = useTempDir("stet-manifest-");

  it("valid manifest file → Ok with parsed entries", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(
      path,
      JSON.stringify({
        entries: [
          {
            model: "anthropic/claude-opus-4-8",
            tier: "robust",
            rubricVersion: "1.0.0",
            fixtureSetVersion: "1.0.0",
          },
        ],
      }),
    );
    const result = await readManifest(path);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toEqual({
        model: "anthropic/claude-opus-4-8",
        tier: "robust",
        rubricVersion: "1.0.0",
        fixtureSetVersion: "1.0.0",
      });
    }
  });

  it("empty entries array → Ok with empty list", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(path, JSON.stringify({ entries: [] }));
    const result = await readManifest(path);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("missing file → Ok with empty list (no qualifications)", async () => {
    const path = join(tmpDir(), "nonexistent.json");
    const result = await readManifest(path);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(0);
    }
  });

  it("malformed JSON → Err(ConfigError)", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(path, "not valid json {{{");
    const result = await readManifest(path);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
      expect(result.error.path).toBe(path);
    }
  });

  it("missing 'entries' field → Err(ConfigError)", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(path, JSON.stringify({ models: [] }));
    const result = await readManifest(path);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  it("entry missing required field → Err(ConfigError)", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(
      path,
      JSON.stringify({
        entries: [{ model: "anthropic/claude-opus-4-8", tier: "robust" }], // missing rubricVersion, fixtureSetVersion
      }),
    );
    const result = await readManifest(path);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  it("entry with a tier outside the union → Err(ConfigError)", async () => {
    const path = join(tmpDir(), "manifest.json");
    await writeFile(
      path,
      JSON.stringify({
        entries: [
          {
            model: "anthropic/claude-opus-4-8",
            tier: "Robust", // case slip — not in the ModelTier union
            rubricVersion: "1.0.0",
            fixtureSetVersion: "1.0.0",
          },
        ],
      }),
    );
    const result = await readManifest(path);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ConfigError");
    }
  });

  it("multiple valid entries → Ok with all entries", async () => {
    const path = join(tmpDir(), "manifest.json");
    const entries = [
      {
        model: "anthropic/claude-opus-4-8",
        tier: "robust",
        rubricVersion: "1.0.0",
        fixtureSetVersion: "1.0.0",
      },
      {
        model: "openai/gpt-4o",
        tier: "robust",
        rubricVersion: "1.0.0",
        fixtureSetVersion: "1.0.0",
      },
    ];
    await writeFile(path, JSON.stringify({ entries }));
    const result = await readManifest(path);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
    }
  });

  it("shipped fixtures/manifest.json is readable and has entries", async () => {
    const result = await readManifest(MANIFEST_PATH);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBeGreaterThan(0);
      for (const entry of result.value) {
        expect(typeof entry.model).toBe("string");
        expect(["robust", "fast"]).toContain(entry.tier);
        expect(typeof entry.rubricVersion).toBe("string");
        expect(typeof entry.fixtureSetVersion).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Drift guard: shipped defaults must be qualified in the shipped manifest
// ---------------------------------------------------------------------------

describe("shipped manifest covers the default preference table", () => {
  it("every TIER_PREFERENCES model has a current-version manifest entry for its tier", async () => {
    const result = await readManifest(MANIFEST_PATH);
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    const entries = result.value;
    for (const tier of ["robust", "fast"] satisfies ModelTier[]) {
      for (const model of TIER_PREFERENCES[tier]) {
        // If this fails, TIER_PREFERENCES and fixtures/manifest.json have drifted:
        // a zero-config run would emit harness.unqualified-model for stet's own default.
        expect(
          checkQualification(model, tier, entries),
          `${model} (${tier}) must be qualified in the shipped manifest`,
        ).toBeNull();
      }
    }
  });
});
