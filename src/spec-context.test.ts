/**
 * Tests for buildSpecContext (T23, M8).
 *
 * All tests use injectable deps — no real filesystem or stdin access.
 * Run: vp test spec
 */

import { describe, expect, it } from "vite-plus/test";
import { buildSpecContext } from "./spec-context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** readFile mock: returns content for known paths; throws ENOENT for anything else. */
function mockReadFile(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const content = files[path];
    if (content !== undefined) return content;
    const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
    (err as NodeJS.ErrnoException).code = "ENOENT";
    throw err;
  };
}

/** readFile mock that throws the given fs error code for a specific path. */
function mockReadFileError(targetPath: string, code: string) {
  return async (path: string): Promise<string> => {
    if (path === targetPath) {
      const err = new Error(`${code}: permission denied, open '${path}'`);
      (err as NodeJS.ErrnoException).code = code;
      throw err;
    }
    const err = new Error("ENOENT");
    (err as NodeJS.ErrnoException).code = "ENOENT";
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Tests — T23: Spec-context combining
// ---------------------------------------------------------------------------

describe("buildSpecContext (T23)", () => {
  // ── No flags → empty spec context ─────────────────────────────────────────

  it("no prd, no task → empty text and empty sources", async () => {
    const result = await buildSpecContext({});
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("");
    expect(result.value.sources).toEqual([]);
  });

  // ── --prd as literal (file not found) ─────────────────────────────────────

  it("--prd with a non-existent path treats value as literal", async () => {
    const result = await buildSpecContext(
      { prd: "implement user authentication" },
      { readFile: mockReadFile({}) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("implement user authentication");
    expect(result.value.sources).toEqual(["--prd <inline>"]);
  });

  it("--prd literal: source is --prd <inline>, not the literal text", async () => {
    const result = await buildSpecContext(
      { prd: "As a user I want CSV export" },
      { readFile: mockReadFile({}) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    // The source label is always "--prd <inline>", not the text content
    expect(result.value.sources[0]).toBe("--prd <inline>");
  });

  // ── --prd as file ──────────────────────────────────────────────────────────

  it("--prd with existing file reads its content", async () => {
    const result = await buildSpecContext(
      { prd: "docs/spec.md" },
      { readFile: mockReadFile({ "docs/spec.md": "# Spec\nDo the thing." }) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("# Spec\nDo the thing.");
    expect(result.value.sources).toEqual(["--prd docs/spec.md"]);
  });

  it("--prd file: source preserves the file path", async () => {
    const result = await buildSpecContext(
      { prd: "docs/prd/csv-export.md" },
      { readFile: mockReadFile({ "docs/prd/csv-export.md": "PRD content" }) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.sources).toEqual(["--prd docs/prd/csv-export.md"]);
  });

  // ── --prd as stdin ─────────────────────────────────────────────────────────

  it("--prd - reads from stdin", async () => {
    const result = await buildSpecContext(
      { prd: "-" },
      { readStdin: async () => "stdin spec content" },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("stdin spec content");
    expect(result.value.sources).toEqual(["--prd -"]);
  });

  // ── --task only ────────────────────────────────────────────────────────────

  it("--task alone adds task text with --task source", async () => {
    const result = await buildSpecContext({ task: "implement CSV export" });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("implement CSV export");
    expect(result.value.sources).toEqual(["--task"]);
  });

  // ── --prd file + --task concatenated ──────────────────────────────────────

  it("--prd file + --task concatenates with double newline", async () => {
    const result = await buildSpecContext(
      { prd: "docs/prd.md", task: "do X" },
      { readFile: mockReadFile({ "docs/prd.md": "PRD content" }) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("PRD content\n\ndo X");
    expect(result.value.sources).toEqual(["--prd docs/prd.md", "--task"]);
  });

  it("--prd literal + --task both appear in sources", async () => {
    const result = await buildSpecContext(
      { prd: "Some inline spec", task: "do Y" },
      { readFile: mockReadFile({}) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("Some inline spec\n\ndo Y");
    expect(result.value.sources).toEqual(["--prd <inline>", "--task"]);
  });

  it("--prd stdin + --task concatenates with double newline", async () => {
    const result = await buildSpecContext(
      { prd: "-", task: "additional task" },
      { readStdin: async () => "stdin prd text" },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("stdin prd text\n\nadditional task");
    expect(result.value.sources).toEqual(["--prd -", "--task"]);
  });

  // ── Error cases ────────────────────────────────────────────────────────────

  it("--prd file with EACCES (non-ENOENT) → Err(ConfigError)", async () => {
    const result = await buildSpecContext(
      { prd: "secret.md" },
      { readFile: mockReadFileError("secret.md", "EACCES") },
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("ConfigError");
    expect(result.error.path).toBe("secret.md");
    expect(result.error.message).toContain("--prd");
  });

  it("--prd - stdin read error → Err(ConfigError)", async () => {
    const result = await buildSpecContext(
      { prd: "-" },
      {
        readStdin: async () => {
          throw new Error("stdin pipe broken");
        },
      },
    );
    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error._tag).toBe("ConfigError");
    expect(result.error.path).toBe("<stdin>");
    expect(result.error.message).toContain("stdin pipe broken");
  });

  // ── Empty / whitespace-only flag values treated as absent (finding 10) ──────

  it('--prd "" → empty text and empty sources (not an inline literal)', async () => {
    const result = await buildSpecContext({ prd: "" }, { readFile: mockReadFile({}) });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("");
    expect(result.value.sources).toEqual([]);
  });

  it('--prd "   " (whitespace) → empty text and empty sources', async () => {
    const result = await buildSpecContext({ prd: "   " }, { readFile: mockReadFile({}) });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("");
    expect(result.value.sources).toEqual([]);
  });

  it('--task "" → empty sources', async () => {
    const result = await buildSpecContext({ task: "" });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("");
    expect(result.value.sources).toEqual([]);
  });

  it('--prd "" combined with valid --task → only --task in sources', async () => {
    const result = await buildSpecContext(
      { prd: "", task: "do X" },
      { readFile: mockReadFile({}) },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("do X");
    expect(result.value.sources).toEqual(["--task"]);
  });

  it('--prd "-" (stdin) still reads stdin (whitespace guard does not apply)', async () => {
    const result = await buildSpecContext(
      { prd: "-" },
      { readStdin: async () => "stdin spec content" },
    );
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.text).toBe("stdin spec content");
    expect(result.value.sources).toEqual(["--prd -"]);
  });

  // ── Report field contract: provided + sources ──────────────────────────────

  it("sources length > 0 ↔ provided:true (derivation)", async () => {
    const withPrd = await buildSpecContext({ prd: "spec text" }, { readFile: mockReadFile({}) });
    expect(withPrd.isOk()).toBe(true);
    if (!withPrd.isOk()) return;
    // Caller derives provided from sources.length > 0
    expect(withPrd.value.sources.length).toBeGreaterThan(0);

    const empty = await buildSpecContext({});
    expect(empty.isOk()).toBe(true);
    if (!empty.isOk()) return;
    expect(empty.value.sources).toHaveLength(0);
  });
});
