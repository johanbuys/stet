/**
 * Deterministic pre-existing detection (TDD B·2).
 *
 * Two pure functions:
 *   - `buildAddedLineIndex` — parses a unified diff into a per-file set of
 *     new-file line numbers that are introduced by the diff (lines starting
 *     with `+` in a hunk body). It builds on `diff-sections.ts`, which splits
 *     the diff into robust per-file sections (the NEW work here is parsing the
 *     `@@` hunk headers and new-file line numbers within each section).
 *   - `markPreexisting` — stamps `meta.preexisting: true` on findings whose
 *     `location.line` is NOT in the added set for their file.
 *
 * Scope: two-way unified diffs. Combined/merge diffs (`diff --cc`) use
 * `@@@ … @@@` hunk headers and two-column `++`/`+ ` prefixes that `HUNK_HEADER`
 * does not match; net review diffs are two-way, so they are out of scope here.
 */

import { cleanPathFromMarkerLine, parseDiffSections } from "./diff-sections.js";
import type { Finding } from "./schema/finding.js";

/** Per-(b-side) file: the set of new-file line numbers that are added in the diff. */
export type AddedLineIndex = Map<string, Set<number>>;

/** Hunk header: `@@ -a[,b] +c[,d] @@ ...` — captures the `+` start line. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Build a map from b-side file path to the set of new-file line numbers that
 * are introduced (i.e. `+` lines) in the unified diff.
 *
 * The diff is first split into per-file sections by `parseDiffSections`, so the
 * `+++ ` file marker is scoped to the first marker of each section. A later body
 * line that merely *begins* with `+++ ` (an added source line whose content is
 * `++ …`) is then correctly classified as added content, not a phantom file.
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

  for (const section of parseDiffSections(diff)) {
    let file: string | null = null;
    let markerSeen = false;
    let currentLine: number | null = null;

    for (const line of section.content.split("\n")) {
      // Only the FIRST `+++ ` line in a section is the new-file marker; later
      // `+++ …` lines are added content (source text beginning with `++ `).
      if (!markerSeen && line.startsWith("+++ ")) {
        markerSeen = true;
        const path = cleanPathFromMarkerLine(line, "+++ "); // "" for /dev/null
        if (path) {
          file = path;
          if (!index.has(file)) index.set(file, new Set());
        }
        currentLine = null;
        continue;
      }

      const hunkMatch = HUNK_HEADER.exec(line);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1]!, 10);
        continue;
      }

      if (file === null || currentLine === null) continue;

      if (line.startsWith("+")) {
        index.get(file)!.add(currentLine);
        currentLine++;
      } else if (line.startsWith(" ")) {
        currentLine++;
      }
      // `-` lines: old-file only — don't advance new-file counter
    }
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
