/**
 * Shared filesystem helpers for optional-file reads.
 *
 * The config layers (src/config/load.ts) and the routing manifest
 * (src/routing/manifest.ts) both treat "file does not exist" as a non-error.
 * Keeping that policy in one place stops the two read paths from drifting on
 * which error codes count as absent.
 */

/**
 * Error codes that mean "this path's file does not exist". ENOENT — no file;
 * ENOTDIR — a path component is a regular file (e.g. ~/.config itself), so the
 * path cannot exist either. Anything else (EACCES, EISDIR, …) is a real problem
 * at the expected location and must surface, not be swallowed.
 */
export const FILE_ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);

/** Narrow an unknown thrown value to a Node fs error (carries a `.code`). */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/** True when `err` is a filesystem error meaning the target file is absent. */
export function isFileAbsentError(err: unknown): boolean {
  return isNodeError(err) && err.code !== undefined && FILE_ABSENT_CODES.has(err.code);
}
