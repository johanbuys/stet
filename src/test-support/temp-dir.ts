/**
 * Shared test-support helper: per-test temp directory lifecycle.
 *
 * Plain `.ts` (NOT `*.test.ts`) so importing it triggers no test registration —
 * same convention as `src/test-support/io.ts` and `stub-repo.ts`. Replaces the
 * mkdtemp/rm beforeEach/afterEach scaffold otherwise copied across suites.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vite-plus/test";

/**
 * Register beforeEach/afterEach hooks that create a fresh temp dir before each test
 * and remove it after. Returns a getter for the current test's directory.
 *
 * Call inside a `describe` block so the hooks scope to that suite:
 *   const tmpDir = useTempDir("stet-manifest-");
 *   it("…", () => { const path = join(tmpDir(), "manifest.json"); });
 */
export function useTempDir(prefix: string): () => string {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}
