/**
 * Tests for filterDiff (T24, M8).
 *
 * Verifies semantic pre-filtering: lockfiles, minified, sourcemaps,
 * vendored directories, and @generated-except-migrations are stripped.
 *
 * All tests use synthetic diff strings — no real filesystem access.
 * Run: vp test diff-filter
 */

import { describe, expect, it } from "vite-plus/test";
import { filterDiff } from "./diff-filter.js";

// ---------------------------------------------------------------------------
// Helpers — synthetic diff builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal unified diff section for a file.
 * Optionally includes `@generated` annotation in the content.
 */
function diffSection(path: string, opts: { generated?: boolean; content?: string } = {}): string {
  const body = opts.content ?? "+line one\n-line two\n";
  const generatedLine = opts.generated ? "+// @generated\n" : "";
  return [
    `diff --git a/${path} b/${path}`,
    `index abc..def 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,2 +1,3 @@`,
    generatedLine + body,
  ].join("\n");
}

function makeDiff(...sections: string[]): string {
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Tests — T24: Semantic pre-filtering
// ---------------------------------------------------------------------------

describe("filterDiff (T24)", () => {
  // ── No-op: normal files pass through ─────────────────────────────────────

  it("regular source files are not stripped", () => {
    const files = ["src/index.ts", "src/lib.ts"];
    const diff = makeDiff(diffSection("src/index.ts"), diffSection("src/lib.ts"));
    const { filteredFiles, strippedFiles, filteredDiff } = filterDiff(files, diff);

    expect(filteredFiles).toEqual(["src/index.ts", "src/lib.ts"]);
    expect(strippedFiles).toEqual([]);
    expect(filteredDiff).toBe(diff);
  });

  it("empty input → empty output", () => {
    const { filteredFiles, strippedFiles, filteredDiff } = filterDiff([], "");
    expect(filteredFiles).toEqual([]);
    expect(strippedFiles).toEqual([]);
    expect(filteredDiff).toBe("");
  });

  // ── Lockfiles ─────────────────────────────────────────────────────────────

  it("package-lock.json → stripped", () => {
    const files = ["src/index.ts", "package-lock.json"];
    const diff = makeDiff(diffSection("src/index.ts"), diffSection("package-lock.json"));
    const { filteredFiles, strippedFiles } = filterDiff(files, diff);

    expect(filteredFiles).toEqual(["src/index.ts"]);
    expect(strippedFiles).toContain("package-lock.json");
  });

  it("yarn.lock → stripped", () => {
    const files = ["yarn.lock"];
    const { filteredFiles, strippedFiles } = filterDiff(files, makeDiff(diffSection("yarn.lock")));
    expect(filteredFiles).toEqual([]);
    expect(strippedFiles).toContain("yarn.lock");
  });

  it("pnpm-lock.yaml → stripped", () => {
    const files = ["pnpm-lock.yaml"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("pnpm-lock.yaml")));
    expect(strippedFiles).toContain("pnpm-lock.yaml");
  });

  it("bun.lockb → stripped", () => {
    const files = ["bun.lockb"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("bun.lockb")));
    expect(strippedFiles).toContain("bun.lockb");
  });

  it("Cargo.lock → stripped", () => {
    const files = ["Cargo.lock"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("Cargo.lock")));
    expect(strippedFiles).toContain("Cargo.lock");
  });

  it("go.sum → stripped", () => {
    const files = ["go.sum"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("go.sum")));
    expect(strippedFiles).toContain("go.sum");
  });

  it("nested lockfile (e.g. subpackage/package-lock.json) → stripped", () => {
    const files = ["packages/foo/package-lock.json"];
    const { strippedFiles } = filterDiff(
      files,
      makeDiff(diffSection("packages/foo/package-lock.json")),
    );
    expect(strippedFiles).toContain("packages/foo/package-lock.json");
  });

  // ── Minified files ────────────────────────────────────────────────────────

  it("*.min.js → stripped", () => {
    const files = ["dist/app.min.js"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("dist/app.min.js")));
    expect(strippedFiles).toContain("dist/app.min.js");
  });

  it("*.min.css → stripped", () => {
    const files = ["dist/style.min.css"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("dist/style.min.css")));
    expect(strippedFiles).toContain("dist/style.min.css");
  });

  it("regular .js (not minified) → not stripped", () => {
    const files = ["src/app.js"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("src/app.js")));
    expect(strippedFiles).toEqual([]);
  });

  // ── Source maps ───────────────────────────────────────────────────────────

  it("*.js.map → stripped", () => {
    const files = ["dist/app.js.map"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("dist/app.js.map")));
    expect(strippedFiles).toContain("dist/app.js.map");
  });

  it("*.css.map → stripped", () => {
    const files = ["dist/style.css.map"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("dist/style.css.map")));
    expect(strippedFiles).toContain("dist/style.css.map");
  });

  it("*.map at root level → stripped", () => {
    const files = ["output.map"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("output.map")));
    expect(strippedFiles).toContain("output.map");
  });

  // ── Vendored directories ──────────────────────────────────────────────────

  it("vendor/ prefix → stripped", () => {
    const files = ["vendor/lodash/index.js"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("vendor/lodash/index.js")));
    expect(strippedFiles).toContain("vendor/lodash/index.js");
  });

  it("nested /vendor/ in path → stripped", () => {
    const files = ["src/vendor/polyfill.js"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("src/vendor/polyfill.js")));
    expect(strippedFiles).toContain("src/vendor/polyfill.js");
  });

  it("third_party/ → stripped", () => {
    const files = ["third_party/lib.c"];
    const { strippedFiles } = filterDiff(files, makeDiff(diffSection("third_party/lib.c")));
    expect(strippedFiles).toContain("third_party/lib.c");
  });

  it("node_modules/ prefix → stripped", () => {
    const files = ["node_modules/react/index.js"];
    const { strippedFiles } = filterDiff(
      files,
      makeDiff(diffSection("node_modules/react/index.js")),
    );
    expect(strippedFiles).toContain("node_modules/react/index.js");
  });

  // ── @generated annotation ─────────────────────────────────────────────────

  it("diff containing @generated annotation → stripped", () => {
    const files = ["src/generated/types.ts"];
    const diff = makeDiff(diffSection("src/generated/types.ts", { generated: true }));
    const { strippedFiles } = filterDiff(files, diff);
    expect(strippedFiles).toContain("src/generated/types.ts");
  });

  it("@generated file that is a migration → NOT stripped", () => {
    const files = ["db/migrations/20240101_create_users.sql"];
    const diff = makeDiff(
      diffSection("db/migrations/20240101_create_users.sql", { generated: true }),
    );
    const { filteredFiles, strippedFiles } = filterDiff(files, diff);
    expect(strippedFiles).not.toContain("db/migrations/20240101_create_users.sql");
    expect(filteredFiles).toContain("db/migrations/20240101_create_users.sql");
  });

  it("file named *.generated.ts (path-only, no annotation) → not stripped by path alone", () => {
    // @generated stripping requires the annotation IN the diff content, not just path patterns
    const files = ["src/types.generated.ts"];
    const diff = makeDiff(diffSection("src/types.generated.ts", { generated: false }));
    const { strippedFiles } = filterDiff(files, diff);
    // No @generated annotation in content → not stripped
    expect(strippedFiles).not.toContain("src/types.generated.ts");
  });

  // ── Filtered diff content ─────────────────────────────────────────────────

  it("stripped file's diff section is removed from filteredDiff", () => {
    const files = ["src/index.ts", "package-lock.json"];
    const keepSection = diffSection("src/index.ts");
    const lockSection = diffSection("package-lock.json");
    const diff = makeDiff(keepSection, lockSection);

    const { filteredDiff } = filterDiff(files, diff);
    expect(filteredDiff).toContain("src/index.ts");
    expect(filteredDiff).not.toContain("package-lock.json");
  });

  it("non-stripped file's diff section is kept in filteredDiff", () => {
    const files = ["src/feature.ts"];
    const diff = makeDiff(diffSection("src/feature.ts"));
    const { filteredDiff } = filterDiff(files, diff);
    expect(filteredDiff).toContain("src/feature.ts");
  });

  it("filteredDiff is empty when all files are stripped", () => {
    const files = ["package-lock.json", "yarn.lock"];
    const diff = makeDiff(diffSection("package-lock.json"), diffSection("yarn.lock"));
    const { filteredDiff } = filterDiff(files, diff);
    expect(filteredDiff).toBe("");
  });

  // ── strippedFiles ordering and deduplication ──────────────────────────────

  it("strippedFiles is sorted and deduplicated", () => {
    const files = ["yarn.lock", "package-lock.json", "src/index.ts"];
    const diff = makeDiff(
      diffSection("yarn.lock"),
      diffSection("package-lock.json"),
      diffSection("src/index.ts"),
    );
    const { strippedFiles } = filterDiff(files, diff);
    expect(strippedFiles).toEqual(["package-lock.json", "yarn.lock"]);
  });

  // ── Files in scope but absent from diff (no corresponding diff section) ───

  it("lockfile in files but not in diff → still stripped", () => {
    const files = ["package-lock.json", "src/index.ts"];
    // Diff only has src/index.ts — lockfile has no diff section (e.g. binary file)
    const diff = makeDiff(diffSection("src/index.ts"));
    const { filteredFiles, strippedFiles } = filterDiff(files, diff);
    expect(strippedFiles).toContain("package-lock.json");
    expect(filteredFiles).not.toContain("package-lock.json");
    expect(filteredFiles).toContain("src/index.ts");
  });
});
