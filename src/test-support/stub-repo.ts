/**
 * Shared test-support helper: stub git repo materialization.
 *
 * This is a plain `.ts` module (NOT `*.test.ts`) so it is safe to import from
 * any test file without triggering test registration side-effects.
 *
 * Fixture template lives at `<repo-root>/fixtures/stub-repo` (a committed
 * directory tree, NOT a git repo — it is materialized into a tmp dir at test time).
 */

import { execFile as execFileCb } from "node:child_process";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Fixture directory path (committed template — NOT a git repo)
// ---------------------------------------------------------------------------

const FIXTURE_TEMPLATE = fileURLToPath(new URL("../../fixtures/stub-repo", import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StubRepoVariant = "pass" | "fail";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Copy the fixture template to `dir`, git-init it, make an initial commit, and stage a change.
 * The fixture is then in the state scope detection expects: staged changes present.
 *
 * `variant = "fail"` writes `command: "exit 7"` to stet.config.yml instead of `echo ok`.
 *
 * Mirrors fixtures/stub-repo/setup.sh logic, in-process.
 */
export async function setupStubRepo(dir: string, variant: StubRepoVariant = "pass"): Promise<void> {
  // Copy template files
  await cp(FIXTURE_TEMPLATE, dir, { recursive: true });

  // Write fail-variant config if requested
  if (variant === "fail") {
    await writeFile(join(dir, "stet.config.yml"), `phases:\n  stub-det:\n    command: "exit 7"\n`);
  }

  // git init + configure local user + initial commit
  const git = (args: string[]) => execFile("git", args, { cwd: dir });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "stet-test"]);
  await git(["config", "user.email", "stet-test@example.com"]);
  await git(["add", "."]);
  await git(["commit", "-m", "Initial commit"]);

  // Stage a change so scope detection resolves to "staged"
  await writeFile(
    join(dir, "src", "main.ts"),
    (await import("node:fs")).readFileSync(join(dir, "src", "main.ts"), "utf8") + "\n",
  );
  await git(["add", "src/main.ts"]);
}
