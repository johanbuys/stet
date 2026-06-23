/**
 * Deterministic pre-existing detection (TDD B·2).
 *
 * Two pure functions:
 *   - `buildAddedLineIndex` — parses a unified diff into a per-file set of
 *     new-file line numbers that are introduced by the diff (lines starting
 *     with `+` in a hunk body). This is NEW code; `diff-sections.ts` parses
 *     file sections only and does NOT parse `@@` hunk headers or line numbers.
 *   - `markPreexisting` — stamps `meta.preexisting: true` on findings whose
 *     `location.line` is NOT in the added set for their file.
 */

import type { Finding } from "./schema/finding.js";

/** Per-(b-side) file: the set of new-file line numbers that are added in the diff. */
export type AddedLineIndex = Map<string, Set<number>>;

/** Hunk header: `@@ -a[,b] +c[,d] @@ ...` — captures the `+` start line. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Build a map from b-side file path to the set of new-file line numbers that
 * are introduced (i.e. `+` lines) in the unified diff.
 *
 * Line numbering follows the new-file side of each `@@` hunk:
 *   - `+line` → added; recorded and counter advanced
 *   - ` line` → context; counter advanced (not recorded)
 *   - `-line` → deleted; counter NOT advanced (old-file only)
 *
 * Pure deletions (`+++ /dev/null`) and pure-deletion hunks produce no entries.
 */
export function buildAddedLineIndex(diff: string): AddedLineIndex {
  const index: AddedLineIndex = new Map();

  let currentFile: string | null = null;
  let currentLine: number | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      let path = line.slice(4);
      const tab = path.indexOf("\t");
      if (tab !== -1) path = path.slice(0, tab);
      path = path.trimEnd();
      if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
        path = path.slice(1, -1);
      }
      if (path === "/dev/null") {
        currentFile = null;
      } else {
        path = path.replace(/^[abciow]\//, "");
        currentFile = path;
        if (!index.has(currentFile)) {
          index.set(currentFile, new Set());
        }
      }
      currentLine = null;
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1]!, 10);
      continue;
    }

    if (currentFile === null || currentLine === null) continue;

    if (line.startsWith("+")) {
      index.get(currentFile)!.add(currentLine);
      currentLine++;
    } else if (line.startsWith(" ")) {
      currentLine++;
    }
    // `-` lines: old-file only — don't advance new-file counter
  }

  return index;
}

/**
 * Stamp `meta.preexisting: true` on findings that point at pre-existing lines.
 *
 * Rules (TDD B·2):
 *   - `location.line` ∈ `index[file]`         → introduced (no stamp)
 *   - `location.line` NOT ∈ `index[file]`      → `meta.preexisting = true`
 *   - no `location.line` (cross-cutting)        → unchanged; still gates normally
 *
 * Mutates findings in place. Returns the same array for chaining.
 */
export function markPreexisting(findings: Finding[], index: AddedLineIndex): Finding[] {
  for (const finding of findings) {
    const line = finding.location?.line;
    if (line === undefined) continue;

    const file = finding.location!.file;
    const addedLines = index.get(file);
    if (addedLines?.has(line)) continue; // introduced — leave alone

    // Pre-existing: line is not in the added set (or file not in the diff at all)
    finding.meta = { ...(finding.meta as Record<string, unknown>), preexisting: true };
  }
  return findings;
}
