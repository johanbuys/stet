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
 * Scope: two-way unified diffs only. Combined/merge diffs (`diff --cc` /
 * `--combined`) use `@@@ … @@@` hunk headers and two-column `++`/`+ ` prefixes
 * that `HUNK_HEADER` does not match; they are detected and skipped entirely so
 * callers get a conservative empty added-set (no false "introduced" misclassification).
 * Full conservative handling (treating their findings as gating) is deferred to
 * M4 wiring, which has the scope file list to distinguish unchanged from unparseable.
 */

import { cleanPathFromMarkerLine, parseDiffSections } from "./diff-sections.js";
import { PREEXISTING_META_KEY } from "./schema/finding.js";
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
 * The map is keyed by `section.path` — the canonical cleaned path produced by
 * `parseDiffSections` (which applies `---`/header fallbacks), NOT a re-derived
 * path from re-running `cleanPathFromMarkerLine` on the `+++ ` line. We still
 * scan for the first `+++ ` line solely to detect pure deletions (`+++ /dev/null`);
 * those sections are skipped (no entry created).
 *
 * Combined-diff sections (`diff --cc` / `--combined`) are detected and skipped
 * entirely — their `@@@ … @@@` hunk headers would produce an empty added-set,
 * which would misleadingly treat all their findings as pre-existing.
 *
 * Line numbering follows the new-file side of each `@@` hunk:
 *   - `+line` → added; recorded and counter advanced
 *   - ` line` → context; counter advanced (not recorded)
 *   - `-line` → deleted; counter NOT advanced (old-file only)
 *
 * Pure deletions (`+++ /dev/null`) and combined-diff sections produce no entries.
 */
export function buildAddedLineIndex(diff: string): AddedLineIndex {
  const index: AddedLineIndex = new Map();

  for (const section of parseDiffSections(diff)) {
    // Combined diffs (`diff --cc` / `--combined`) are unsupported — skip the whole
    // section so callers get a conservatively empty added-set rather than silently
    // processing @@@ headers as if they were @@ (which would produce no added lines
    // and misclassify all findings in the section as pre-existing).
    if (
      section.content.startsWith("diff --cc ") ||
      section.content.startsWith("diff --combined ")
    ) {
      continue;
    }

    let markerSeen = false;
    let isPureDeletion = false;
    let currentLine: number | null = null;

    for (const line of section.content.split("\n")) {
      // Detect a combined hunk header inside the section body (belt-and-suspenders
      // for any section that wasn't caught by the header check above).
      if (line.startsWith("@@@")) {
        // Combined diff — skip the entire section's body parse.
        isPureDeletion = true; // reuse flag to suppress index entry
        break;
      }

      // Only the FIRST `+++ ` line in a section is the new-file marker; later
      // `+++ …` lines are added content (source text beginning with `++ `).
      // We check this line solely to detect `+++ /dev/null` (pure deletion).
      // The map key comes from section.path, not from re-deriving the path here.
      if (!markerSeen && line.startsWith("+++ ")) {
        markerSeen = true;
        const rawPath = cleanPathFromMarkerLine(line, "+++ "); // "" for /dev/null
        if (!rawPath) {
          // Pure deletion — no entry should be created.
          isPureDeletion = true;
          break;
        }
        // Entry keyed by section.path (canonical), not the re-derived rawPath.
        if (!index.has(section.path)) index.set(section.path, new Set());
        currentLine = null;
        continue;
      }

      const hunkMatch = HUNK_HEADER.exec(line);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1]!, 10);
        continue;
      }

      if (currentLine === null) continue;
      // Process body lines only once a (non-/dev/null) `+++ ` marker has created
      // the section.path entry — restores the original `file === null` guard so a
      // malformed section with a hunk but no marker can never deref undefined.
      const addedSet = index.get(section.path);
      if (addedSet === undefined) continue;

      if (line.startsWith("+")) {
        addedSet.add(currentLine);
        currentLine++;
      } else if (line.startsWith(" ")) {
        currentLine++;
      }
      // `-` lines: old-file only — don't advance new-file counter
    }

    // If we broke early for pure deletion / combined diff, we may have already
    // created an entry for section.path. Remove it.
    if (isPureDeletion) {
      index.delete(section.path);
    }
  }

  return index;
}

/**
 * Strip a leading `./` and then one optional single-letter diff prefix
 * (`a/`, `b/`, `i/`, `w/`, `c/`, `o/`) from a model-supplied file path so it
 * matches index keys produced by `cleanPathFromMarkerLine`.
 *
 * Examples:
 *   `"b/src/a.ts"`  → `"src/a.ts"`
 *   `"./src/a.ts"`  → `"src/a.ts"`
 *   `"src/a.ts"`    → `"src/a.ts"` (unchanged)
 */
export function normalizeFindingPath(file: string): string {
  // Strip leading ./
  let path = file.startsWith("./") ? file.slice(2) : file;
  // Strip one optional single-letter diff prefix (same set as cleanPathFromMarkerLine).
  path = path.replace(/^[abciow]\//, "");
  return path;
}

/**
 * Stamp `meta.preexisting: true` on findings that point at pre-existing lines.
 *
 * Rules (TDD B·2):
 *   - `location.line` ∈ `index[file]`         → introduced (no stamp); any forged
 *                                                 `meta.preexisting` is stripped so
 *                                                 the harness fully owns the key.
 *   - `location.line` NOT ∈ `index[file]`      → `meta[PREEXISTING_META_KEY] = true`
 *   - no `location.line` (cross-cutting)        → unchanged; still gates normally
 *
 * `finding.location.file` is normalized before lookup: `./` and single-letter diff
 * prefixes (`b/`, `a/`, …) are stripped so model-supplied paths match index keys.
 *
 * Mutates findings in place. Returns the same array for chaining.
 */
export function markPreexisting(findings: Finding[], index: AddedLineIndex): Finding[] {
  for (const finding of findings) {
    const line = finding.location?.line;
    if (line === undefined) continue;

    const rawFile = finding.location!.file;
    // Normalize: try the cleaned path first, fall back to the raw key.
    const normalizedFile = normalizeFindingPath(rawFile);
    const addedLines = index.get(normalizedFile) ?? index.get(rawFile);

    if (addedLines?.has(line)) {
      // Introduced: harness owns the preexisting key — strip any forged value.
      const meta = finding.meta as Record<string, unknown> | undefined;
      if (meta !== undefined && PREEXISTING_META_KEY in meta) {
        delete meta[PREEXISTING_META_KEY];
      }
      continue;
    }

    // Pre-existing: line is not in the added set (or file not in the diff at all)
    finding.meta = { ...(finding.meta as Record<string, unknown>), [PREEXISTING_META_KEY]: true };
  }
  return findings;
}
