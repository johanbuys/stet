/**
 * Semantic diff pre-filtering (M8, T24, PRD §3.6, decisions #27, #32, #33).
 *
 * Strips noise files — lockfiles, minified assets, source maps, vendored
 * dependencies, and `@generated`-annotated files (except database migrations)
 * — from the diff before any phase or the risk classifier sees it.
 *
 * Stripped paths are recorded for `scope.stripped` (#33). The filtered diff
 * is handed to phases via `PhaseContext.diff` (#32).
 *
 * No silent drops: every stripped path is returned in `strippedFiles` so callers
 * can populate `scope.stripped` and the human scope echo.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterResult {
  /** Files from the input list that were NOT stripped. */
  filteredFiles: string[];
  /** Files removed by the filter, sorted. */
  strippedFiles: string[];
  /** Diff text with stripped-file sections removed. */
  filteredDiff: string;
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",
  "go.lock",
  "npm-shrinkwrap.json",
  "shrinkwrap.yaml",
]);

function isLockfile(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return LOCKFILE_NAMES.has(name);
}

function isMinified(path: string): boolean {
  return /\.min\.[jt]sx?$/.test(path) || path.endsWith(".min.css");
}

function isSourcemap(path: string): boolean {
  return path.endsWith(".map");
}

function isVendored(path: string): boolean {
  return (
    path.startsWith("vendor/") ||
    /\/vendor\//.test(path) ||
    path.startsWith("vendors/") ||
    /\/vendors\//.test(path) ||
    path.startsWith("third_party/") ||
    /\/third_party\//.test(path) ||
    path.startsWith("external/") ||
    /\/external\//.test(path) ||
    path.startsWith("extern/") ||
    /\/extern\//.test(path) ||
    path.startsWith("node_modules/") ||
    /\/node_modules\//.test(path)
  );
}

/** A migration file is exempt from @generated stripping (PRD §3.6). */
function isMigration(path: string): boolean {
  return /migrat/i.test(path);
}

function hasGeneratedAnnotation(diffSection: string): boolean {
  return /@generated/i.test(diffSection);
}

/** True when the file matches any path-based strip rule. */
function isStrippedByPath(path: string): boolean {
  return isLockfile(path) || isMinified(path) || isSourcemap(path) || isVendored(path);
}

// ---------------------------------------------------------------------------
// Diff section parsing
// ---------------------------------------------------------------------------

interface DiffSection {
  path: string;
  content: string;
}

/**
 * Split a unified diff into per-file sections.
 *
 * Each section starts with `diff --git a/PATH b/PATH`. The `b/` path is used
 * as the canonical current path (handles renames where a/ and b/ differ).
 */
function parseDiffSections(diff: string): DiffSection[] {
  if (!diff) return [];

  const sections: DiffSection[] = [];
  // Split on lines that start a new file section, preserving the delimiter.
  const parts = diff.split(/(?=^diff --git )/m);

  for (const part of parts) {
    if (!part.startsWith("diff --git ")) continue;
    // Extract the b/ path from the first line: `diff --git a/X b/Y`
    const headerMatch = part.match(/^diff --git a\/.+ b\/(.+)$/m);
    const path = headerMatch?.[1]?.trimEnd() ?? "";
    if (path) {
      sections.push({ path, content: part });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Semantically filter a diff, removing noise files.
 *
 * @param files  All files in scope (from detectScope — the full list).
 * @param diff   Full unified diff text (may be empty string when unavailable).
 */
export function filterDiff(files: string[], diff: string): FilterResult {
  // Path-based: strip files that match lockfile/minified/sourcemap/vendored patterns
  const strippedByPath = new Set(files.filter(isStrippedByPath));

  // Diff-section-based: additionally strip @generated sections (not migrations)
  const sections = parseDiffSections(diff);
  const strippedBySectionPath = new Set<string>();
  const filteredSections: string[] = [];

  for (const section of sections) {
    const strippedByPathRule = isStrippedByPath(section.path);
    const strippedByGenerated =
      !isMigration(section.path) && hasGeneratedAnnotation(section.content);

    if (strippedByPathRule || strippedByGenerated) {
      strippedBySectionPath.add(section.path);
    } else {
      filteredSections.push(section.content);
    }
  }

  // Union: stripped by path-only rule OR by diff-content @generated check
  const allStripped = new Set([...strippedByPath, ...strippedBySectionPath]);

  const filteredFiles = files.filter((f) => !allStripped.has(f));
  const strippedFiles = [...allStripped].sort();
  const filteredDiff = filteredSections.join("");

  return { filteredFiles, strippedFiles, filteredDiff };
}
