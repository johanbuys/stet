/**
 * Tests for parseDiffSections — the shared, robust unified-diff section parser.
 *
 * Covers default a/ b/ prefixes (single + multiple, reconstruction via join),
 * noprefix headers, mnemonicPrefix, pure deletions, renames, quoted paths,
 * empty input, and leading non-section text.
 *
 * Run: vp test diff-sections
 */

import { describe, expect, it } from "vite-plus/test";
import { parseDiffSections } from "./diff-sections.js";

describe("parseDiffSections", () => {
  // ── Empty / degenerate input ──────────────────────────────────────────────

  it("empty string → []", () => {
    expect(parseDiffSections("")).toEqual([]);
  });

  it("input with no diff header → []", () => {
    expect(parseDiffSections("just some text\nno headers here\n")).toEqual([]);
  });

  // ── Standard a/ b/ prefixes ───────────────────────────────────────────────

  it("single standard a/ b/ section → path is the b/ side", () => {
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc..def 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,2 +1,3 @@",
      "+added\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("src/index.ts");
    expect(sections[0]?.content).toBe(diff);
  });

  it("multiple sections — paths extracted and join reconstructs the input", () => {
    const a = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index abc..def 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,1 @@",
      "+a\n",
    ].join("\n");
    const b = [
      "diff --git a/src/b.ts b/src/b.ts",
      "index abc..def 100644",
      "--- a/src/b.ts",
      "+++ b/src/b.ts",
      "@@ -1,1 +1,1 @@",
      "+b\n",
    ].join("\n");
    const diff = a + b;

    const sections = parseDiffSections(diff);
    expect(sections.map((s) => s.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(sections.map((s) => s.content).join("")).toBe(diff);
  });

  // ── noprefix (diff.noprefix=true) ─────────────────────────────────────────

  it("noprefix header → path from +++ with no prefix", () => {
    const diff = [
      "diff --git foo.ts foo.ts",
      "index abc..def 100644",
      "--- foo.ts",
      "+++ foo.ts",
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("foo.ts");
  });

  // ── mnemonicPrefix (diff.mnemonicPrefix=true) ─────────────────────────────

  it("mnemonicPrefix header → strips w/ prefix from +++", () => {
    const diff = [
      "diff --git i/foo.ts w/foo.ts",
      "index abc..def 100644",
      "--- i/foo.ts",
      "+++ w/foo.ts",
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("foo.ts");
  });

  // ── Pure deletion ─────────────────────────────────────────────────────────

  it("pure deletion (+++ /dev/null) → path from --- a/ side", () => {
    const diff = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "index abc..000 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,1 +0,0 @@",
      "-gone\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("old.ts");
  });

  // ── Rename ────────────────────────────────────────────────────────────────

  it("rename — path is the b/ (destination) side", () => {
    const diff = [
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts",
      "--- a/old-name.ts",
      "+++ b/new-name.ts",
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("new-name.ts");
  });

  // ── Quoted path (core.quotePath) ──────────────────────────────────────────

  it('quoted path (+++ "b/has space.ts") → unquoted path', () => {
    const diff = [
      "diff --git a/has space.ts b/has space.ts",
      "index abc..def 100644",
      '--- "a/has space.ts"',
      '+++ "b/has space.ts"',
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("has space.ts");
  });

  // ── Timestamp suffix on +++ line ──────────────────────────────────────────

  it("trailing tab+timestamp on +++ line is trimmed", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index abc..def 100644",
      "--- a/src/x.ts\t2026-01-01 00:00:00",
      "+++ b/src/x.ts\t2026-01-01 00:00:01",
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections[0]?.path).toBe("src/x.ts");
  });

  // ── Leading non-section text is skipped ───────────────────────────────────

  it("leading text before first header is skipped", () => {
    const lead = "some preamble\nmore preamble\n";
    const section = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index abc..def 100644",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1,1 +1,1 @@",
      "+x\n",
    ].join("\n");

    const sections = parseDiffSections(lead + section);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("src/x.ts");
    expect(sections[0]?.content).toBe(section);
  });

  // ── Combined / merge diffs ────────────────────────────────────────────────

  it("diff --cc header → recognized as a section, path from header b/", () => {
    const diff = [
      "diff --cc src/merged.ts",
      "index abc,def..111 100644",
      "--- a/src/merged.ts",
      "+++ b/src/merged.ts",
      "@@@ -1,1 -1,1 +1,1 @@@",
      "++merged\n",
    ].join("\n");

    const sections = parseDiffSections(diff);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe("src/merged.ts");
  });
});
