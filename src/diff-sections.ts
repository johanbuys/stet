/**
 * Shared unified-diff section parser.
 *
 * A single, robust implementation used by both the semantic pre-filter
 * (`diff-filter.ts`) and the context-budget enforcer (`phases/coverage.ts`),
 * so the two never drift apart.
 *
 * Robustness: the destination path is derived from the `+++` line (falling back
 * to `---` for pure deletions, then to the header) rather than assuming literal
 * `a/`…`b/` prefixes. This keeps the parser working under `diff.noprefix=true`,
 * `diff.mnemonicPrefix=true`, merge/combined diffs (`diff --cc` / `--combined`),
 * quoted paths (`core.quotePath`), and timestamped unified-diff headers. The
 * previous prefix-bound regex matched NOTHING in those cases, silently dropping
 * the entire diff from every phase.
 *
 * This is a pure, total function: it never fails, so it returns a plain array
 * rather than a Result.
 */

export interface DiffSection {
  /** Destination (b-side) path; for pure deletions, the a-side path. */
  path: string;
  /** Full section text, from its header up to (not including) the next header. */
  content: string;
}

/** Matches a header that starts a new per-file section. */
const HEADER_LINE = /^diff (?:--git|--cc|--combined) /;

/** Splits the diff into sections, preserving each header at the start. */
const SECTION_SPLIT = /(?=^diff (?:--git|--cc|--combined) )/m;

/**
 * Strip one optional single-letter+slash diff prefix and any quoting/timestamp.
 *
 * Handles `a/ b/` (default), `i/ w/ c/ o/` (mnemonicPrefix), no prefix
 * (noprefix), `core.quotePath` double-quoting, and a trailing `\t<timestamp>`.
 * Returns an empty string if the marker resolves to `/dev/null`.
 */
function cleanPathFromMarkerLine(line: string, marker: string): string {
  // Drop the `--- ` / `+++ ` marker.
  let path = line.slice(marker.length);
  // Trim a trailing `\t<timestamp>` (cut at the first tab).
  const tab = path.indexOf("\t");
  if (tab !== -1) path = path.slice(0, tab);
  path = path.trimEnd();
  // Unquote a git-quoted path (core.quotePath).
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = path.slice(1, -1);
  }
  if (path === "/dev/null") return "";
  // Strip one optional single-letter prefix: a/ b/ i/ w/ c/ o/.
  path = path.replace(/^[abciow]\//, "");
  return path;
}

/** Best-effort path extraction from the header line itself (`b/<path>`). */
function pathFromHeaderLine(headerLine: string): string {
  const match = headerLine.match(/ b\/(.+)$/);
  return match?.[1]?.trimEnd() ?? "";
}

/**
 * Split a unified diff into per-file sections.
 *
 * `sections.map(s => s.content).join("")` reconstructs the original diff from
 * the first header onward (any leading preamble before the first header is
 * dropped). Sections with no derivable path are skipped.
 */
export function parseDiffSections(diff: string): DiffSection[] {
  if (!diff) return [];

  const sections: DiffSection[] = [];
  const parts = diff.split(SECTION_SPLIT);

  for (const part of parts) {
    if (!HEADER_LINE.test(part)) continue;

    const lines = part.split("\n");
    const headerLine = lines[0] ?? "";

    let plusLine: string | undefined;
    let minusLine: string | undefined;
    for (const line of lines) {
      if (plusLine === undefined && line.startsWith("+++ ")) plusLine = line;
      else if (minusLine === undefined && line.startsWith("--- ")) minusLine = line;
      if (plusLine !== undefined && minusLine !== undefined) break;
    }

    let path = plusLine !== undefined ? cleanPathFromMarkerLine(plusLine, "+++ ") : "";
    // Pure deletion: +++ is /dev/null — fall back to the a-side path.
    if (!path && minusLine !== undefined) {
      path = cleanPathFromMarkerLine(minusLine, "--- ");
    }
    // Last resort: parse the header line for a b/<path> group.
    if (!path) {
      path = pathFromHeaderLine(headerLine);
    }

    if (path) {
      sections.push({ path, content: part });
    }
  }

  return sections;
}
