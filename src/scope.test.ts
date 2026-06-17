/**
 * Tests for src/scope.ts — real temporary git repos, no mocks.
 *
 * Each describe block builds a throwaway repo under os.tmpdir() and tears it down
 * in afterAll. Tests use real `git` commands via a local helper so that the behavior
 * under test is exactly what detectScope() will encounter in production.
 *
 * Naming convention for the repo helper:
 *   - `initRepo(dir)` — git init + identity config + initial commit
 *   - Individual tests stage/commit further as needed
 */

import { execFile as execFileCb } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { detectScope, getScopeDiff } from "./scope.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Repo helper utilities
// ---------------------------------------------------------------------------

/** Run a git command in `dir`, resolving to stdout. */
async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd: dir });
  return stdout.trim();
}

/**
 * Create a temp dir, git-init it, set a local identity + defaultBranch=main,
 * and make one initial commit so HEAD exists.
 *
 * Returns the absolute path to the repo root.
 */
async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-scope-test-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.name", "Test User");
  await git(dir, "config", "user.email", "test@example.com");
  // Create an initial commit so HEAD resolves
  const initFile = path.join(dir, "README.md");
  fs.writeFileSync(initFile, "init\n");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "-m", "initial commit");
  return dir;
}

/** Write a file to `dir`, overwriting if it exists. */
function writeFile(dir: string, name: string, content = "content\n"): void {
  fs.writeFileSync(path.join(dir, name), content);
}

/** Remove a directory tree. */
function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. Explicit --staged flag
// ---------------------------------------------------------------------------

describe("explicit --staged flag", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    writeFile(dir, "staged.ts");
    await git(dir, "add", "staged.ts");
    // Also leave an untracked file (should NOT appear under --staged)
    writeFile(dir, "untracked.ts");
  });

  afterAll(() => removeDir(dir));

  it("returns kind staged with only the staged file", async () => {
    const result = await detectScope(dir, { staged: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("staged");
      expect(result.value.files).toContain("staged.ts");
      expect(result.value.files).not.toContain("untracked.ts");
    }
  });

  it("returns Ok with files:[] when nothing is staged (empty diff is valid)", async () => {
    // Fresh repo — nothing staged in this one
    const emptyDir = await makeRepo();
    try {
      const result = await detectScope(emptyDir, { staged: true });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.kind).toBe("staged");
        expect(result.value.files).toEqual([]);
      }
    } finally {
      removeDir(emptyDir);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Explicit --working flag
// ---------------------------------------------------------------------------

describe("explicit --working flag", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
  });

  afterAll(() => removeDir(dir));

  it("detects tracked modifications", async () => {
    writeFile(dir, "README.md", "modified\n");
    const result = await detectScope(dir, { working: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("working");
      expect(result.value.files).toContain("README.md");
    }
  });

  it("detects untracked files", async () => {
    // Restore README so only the untracked file is the change
    writeFile(dir, "README.md", "init\n");
    writeFile(dir, "new-untracked.ts");
    const result = await detectScope(dir, { working: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("working");
      expect(result.value.files).toContain("new-untracked.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Explicit --against flag
// ---------------------------------------------------------------------------

describe("explicit --against flag", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Feature branch with one commit
    await git(dir, "checkout", "-b", "feature");
    writeFile(dir, "feature.ts");
    await git(dir, "add", "feature.ts");
    await git(dir, "commit", "-m", "feature work");
  });

  afterAll(() => removeDir(dir));

  it("returns kind against with the feature file", async () => {
    const result = await detectScope(dir, { against: "main" });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("against");
      expect(result.value.ref).toBe("main");
      expect(result.value.files).toContain("feature.ts");
    }
  });

  it("returns Ok with files:[] when no commits differ (empty diff is valid)", async () => {
    // On same branch, against itself — merge-base with itself is empty
    const result = await detectScope(dir, { against: "HEAD" });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("against");
      expect(result.value.files).toEqual([]);
    }
  });

  it("returns Err when the ref does not exist", async () => {
    const result = await detectScope(dir, { against: "nonexistent-branch-xyz" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toContain("nonexistent-branch-xyz");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Explicit --commit flag
// ---------------------------------------------------------------------------

describe("explicit --commit flag", () => {
  let dir: string;
  let sha: string;

  beforeAll(async () => {
    dir = await makeRepo();
    writeFile(dir, "committed.ts");
    await git(dir, "add", "committed.ts");
    await git(dir, "commit", "-m", "add committed.ts");
    sha = await git(dir, "rev-parse", "HEAD");
  });

  afterAll(() => removeDir(dir));

  it("returns kind commit with files of that commit", async () => {
    const result = await detectScope(dir, { commit: sha });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.ref).toBe(sha);
      expect(result.value.files).toContain("committed.ts");
    }
  });

  it("returns Err for a bad commit sha", async () => {
    const result = await detectScope(dir, { commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Explicit --commits flag (range)
// ---------------------------------------------------------------------------

describe("explicit --commits flag", () => {
  let dir: string;
  let firstSha: string;

  beforeAll(async () => {
    dir = await makeRepo();
    firstSha = await git(dir, "rev-parse", "HEAD");
    writeFile(dir, "range-a.ts");
    await git(dir, "add", "range-a.ts");
    await git(dir, "commit", "-m", "range-a");
    writeFile(dir, "range-b.ts");
    await git(dir, "add", "range-b.ts");
    await git(dir, "commit", "-m", "range-b");
  });

  afterAll(() => removeDir(dir));

  it("returns kind commits with files in the range", async () => {
    const result = await detectScope(dir, { commits: `${firstSha}..HEAD` });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commits");
      expect(result.value.files).toContain("range-a.ts");
      expect(result.value.files).toContain("range-b.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Conflicting flags → Err
// ---------------------------------------------------------------------------

describe("conflicting flags", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
  });

  afterAll(() => removeDir(dir));

  it("returns Err naming both flags when --staged and --working are both set", async () => {
    const result = await detectScope(dir, { staged: true, working: true });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toMatch(/conflicting/i);
      expect(result.error.message).toContain("--staged");
      expect(result.error.message).toContain("--working");
    }
  });

  it("returns Err when --staged and --against are both set", async () => {
    const result = await detectScope(dir, { staged: true, against: "main" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toMatch(/conflicting/i);
    }
  });

  it("returns Err when three flags are set", async () => {
    const result = await detectScope(dir, { staged: true, working: true, against: "main" });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toMatch(/conflicting/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Not a git repo → Err
// ---------------------------------------------------------------------------

describe("not a git repo", () => {
  it("returns Err with 'not a git repository'", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-not-a-repo-"));
    try {
      const result = await detectScope(dir, {});
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("ScopeError");
        expect(result.error.message).toContain("not a git repository");
      }
    } finally {
      removeDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Auto-detection: staged beats working (both present)
// ---------------------------------------------------------------------------

describe("auto-detection: staged beats working", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Stage one file
    writeFile(dir, "staged-auto.ts");
    await git(dir, "add", "staged-auto.ts");
    // Also leave a tracked modification (working tree change)
    writeFile(dir, "README.md", "modified for working\n");
    // And an untracked file
    writeFile(dir, "untracked-auto.ts");
  });

  afterAll(() => removeDir(dir));

  it("resolves to staged when both staged and working changes exist", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("staged");
      expect(result.value.files).toContain("staged-auto.ts");
      // Working-tree-only files should NOT appear
      expect(result.value.files).not.toContain("untracked-auto.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Auto-detection: working-tree (tracked edit)
// ---------------------------------------------------------------------------

describe("auto-detection: working-tree (tracked edit)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Modify a tracked file without staging it
    writeFile(dir, "README.md", "tracked modification\n");
  });

  afterAll(() => removeDir(dir));

  it("resolves to working when there are tracked modifications", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("working");
      expect(result.value.files).toContain("README.md");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Auto-detection: working-tree (untracked-only)
// ---------------------------------------------------------------------------

describe("auto-detection: working-tree (untracked only)", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Clean tracked files, add only an untracked file
    writeFile(dir, "only-untracked.ts");
  });

  afterAll(() => removeDir(dir));

  it("resolves to working when only untracked files exist", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("working");
      expect(result.value.files).toContain("only-untracked.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Auto-detection: feature branch → against default (merge-base files)
// ---------------------------------------------------------------------------

describe("auto-detection: feature branch vs default branch", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Create and switch to a feature branch, add a commit
    await git(dir, "checkout", "-b", "feat/auto-detect");
    writeFile(dir, "feature-auto.ts");
    await git(dir, "add", "feature-auto.ts");
    await git(dir, "commit", "-m", "feature commit");
    // Leave working tree clean so we fall through staged + working rungs
  });

  afterAll(() => removeDir(dir));

  it("resolves to against default branch with feature file", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("against");
      expect(result.value.ref).toBe("main");
      expect(result.value.files).toContain("feature-auto.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Auto-detection: detached HEAD → commit kind with HEAD files
// ---------------------------------------------------------------------------

describe("auto-detection: detached HEAD → commit kind", () => {
  let dir: string;
  let headSha: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Add a commit to detach from
    writeFile(dir, "detached.ts");
    await git(dir, "add", "detached.ts");
    await git(dir, "commit", "-m", "commit for detach");
    headSha = await git(dir, "rev-parse", "HEAD");
    // Detach HEAD
    await git(dir, "checkout", "--detach", headSha);
  });

  afterAll(() => removeDir(dir));

  it("resolves to commit kind with HEAD sha and HEAD files", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.ref).toBe(headSha);
      expect(result.value.files).toContain("detached.ts");
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Auto-detection: clean tree on default branch → Err
// ---------------------------------------------------------------------------

describe("auto-detection: clean tree on default branch → Err", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // Stay on main (default branch), leave clean working tree
  });

  afterAll(() => removeDir(dir));

  it("returns Err with 'nothing detectable' message", async () => {
    const result = await detectScope(dir, {});
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("ScopeError");
      expect(result.error.message).toContain("nothing detectable");
      expect(result.error.message).toMatch(/default branch/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 18. Auto-detection: empty repo (unborn HEAD) — staged file → Ok staged
// ---------------------------------------------------------------------------

describe("auto-detection: empty repo (unborn HEAD) with staged file → Ok staged", () => {
  it("staged file in an unborn-HEAD repo resolves to staged", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-unborn-staged-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.name", "Test User");
    await git(dir, "config", "user.email", "test@example.com");
    writeFile(dir, "first.ts");
    await git(dir, "add", "first.ts");
    try {
      const result = await detectScope(dir, {});
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.kind).toBe("staged");
        expect(result.value.files).toContain("first.ts");
      }
    } finally {
      removeDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// 19. Auto-detection: empty repo (unborn HEAD) with nothing staged → Err mentioning unborn state
// ---------------------------------------------------------------------------

describe("auto-detection: empty repo (unborn HEAD) with nothing staged → Err", () => {
  it("empty unborn-HEAD repo with nothing staged returns Err mentioning empty/unborn state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-unborn-empty-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.name", "Test User");
    await git(dir, "config", "user.email", "test@example.com");
    // No commits, no staged files
    try {
      const result = await detectScope(dir, {});
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error._tag).toBe("ScopeError");
        // Message must NOT fall through to the misleading "clean on default branch" message.
        // It must specifically mention the empty/unborn state.
        expect(result.error.message).toMatch(/empty|unborn|no commits/i);
      }
    } finally {
      removeDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. Shallow clone — explicit flags work where refs exist
// ---------------------------------------------------------------------------

// NOTE: tests 15-17 are placed before 14 conceptually but numbered sequentially here.

// ---------------------------------------------------------------------------
// 15. getCommitFiles / --commit: merge commit returns merged-in files
// ---------------------------------------------------------------------------

describe("explicit --commit flag: merge commit returns merged-in files", () => {
  let dir: string;
  let mergeSha: string;

  beforeAll(async () => {
    dir = await makeRepo();
    // main has README.md from makeRepo().
    // Create a branch that adds b.txt, then merge it back into main.
    await git(dir, "checkout", "-b", "branch-with-b");
    writeFile(dir, "b.txt");
    await git(dir, "add", "b.txt");
    await git(dir, "commit", "-m", "add b.txt on branch");
    await git(dir, "checkout", "main");
    await git(dir, "merge", "--no-ff", "branch-with-b", "-m", "merge branch-with-b");
    mergeSha = await git(dir, "rev-parse", "HEAD");
  });

  afterAll(() => removeDir(dir));

  it("--commit on a merge SHA returns non-empty file list containing b.txt", async () => {
    const result = await detectScope(dir, { commit: mergeSha });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.files.length).toBeGreaterThan(0);
      expect(result.value.files).toContain("b.txt");
    }
  });
});

// ---------------------------------------------------------------------------
// 16. Auto-detect rung 4: detached HEAD on a merge commit returns non-empty files
// ---------------------------------------------------------------------------

describe("auto-detect rung 4: detached HEAD on a merge commit returns non-empty files", () => {
  let dir: string;
  let mergeSha: string;

  beforeAll(async () => {
    dir = await makeRepo();
    await git(dir, "checkout", "-b", "feat-c");
    writeFile(dir, "c.txt");
    await git(dir, "add", "c.txt");
    await git(dir, "commit", "-m", "add c.txt");
    await git(dir, "checkout", "main");
    await git(dir, "merge", "--no-ff", "feat-c", "-m", "merge feat-c");
    mergeSha = await git(dir, "rev-parse", "HEAD");
    // Simulate CI detached-HEAD checkout of the merge commit
    await git(dir, "checkout", "--detach", mergeSha);
  });

  afterAll(() => removeDir(dir));

  it("detached HEAD on merge commit auto-resolves to commit kind with non-empty files", async () => {
    const result = await detectScope(dir, {});
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.files.length).toBeGreaterThan(0);
      expect(result.value.files).toContain("c.txt");
    }
  });
});

// ---------------------------------------------------------------------------
// 17. Root commit via --commit still returns its files
// ---------------------------------------------------------------------------

describe("explicit --commit: root commit returns its files", () => {
  let dir: string;
  let rootSha: string;

  beforeAll(async () => {
    // Make a brand-new repo; the first commit IS the root commit (no parent)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-root-commit-test-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.name", "Test User");
    await git(dir, "config", "user.email", "test@example.com");
    writeFile(dir, "root.txt", "root content\n");
    await git(dir, "add", "root.txt");
    await git(dir, "commit", "-m", "root commit");
    rootSha = await git(dir, "rev-parse", "HEAD");
  });

  afterAll(() => removeDir(dir));

  it("--commit on root (parentless) commit returns non-empty file list with root.txt", async () => {
    const result = await detectScope(dir, { commit: rootSha });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.files).toContain("root.txt");
    }
  });
});

describe("shallow clone: explicit flags work where refs exist", () => {
  let originDir: string;
  let cloneDir: string;

  beforeAll(async () => {
    // Build a source repo with a few commits
    originDir = await makeRepo();
    writeFile(originDir, "shallow-a.ts");
    await git(originDir, "add", "shallow-a.ts");
    await git(originDir, "commit", "-m", "shallow commit a");
    writeFile(originDir, "shallow-b.ts");
    await git(originDir, "add", "shallow-b.ts");
    await git(originDir, "commit", "-m", "shallow commit b");

    // Create a shallow clone (depth=1) via file:// protocol
    cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-shallow-"));
    await execFile("git", ["clone", "--depth=1", `file://${originDir}`, cloneDir]);
    // Set local identity in the clone
    await git(cloneDir, "config", "user.name", "Test User");
    await git(cloneDir, "config", "user.email", "test@example.com");
  });

  afterAll(() => {
    removeDir(originDir);
    removeDir(cloneDir);
  });

  it("--commit HEAD works on a shallow clone (shallow tip exists)", async () => {
    const sha = await git(cloneDir, "rev-parse", "HEAD");
    const result = await detectScope(cloneDir, { commit: sha });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("commit");
      expect(result.value.files).toContain("shallow-b.ts");
    }
  });

  it("--staged with nothing staged returns Ok files:[] on shallow clone", async () => {
    const result = await detectScope(cloneDir, { staged: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.kind).toBe("staged");
      expect(result.value.files).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 20. getScopeDiff — produces the unified diff text for a scope
// ---------------------------------------------------------------------------

describe("getScopeDiff", () => {
  it("returns the diff for a normal (non-root) commit", async () => {
    const dir = await makeRepo();
    try {
      writeFile(dir, "normal.ts", "export const x = 1;\n");
      await git(dir, "add", "normal.ts");
      await git(dir, "commit", "-m", "add normal.ts");
      const sha = await git(dir, "rev-parse", "HEAD");

      const scopeResult = await detectScope(dir, { commit: sha });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("normal.ts");
        expect(diffResult.value).toContain("export const x = 1;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("returns a non-empty diff for a ROOT (parentless) commit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-scopediff-root-"));
    try {
      await git(dir, "init", "-b", "main");
      await git(dir, "config", "user.name", "Test User");
      await git(dir, "config", "user.email", "test@example.com");
      writeFile(dir, "root.ts", "const root = true;\n");
      await git(dir, "add", "root.ts");
      await git(dir, "commit", "-m", "root commit");
      const rootSha = await git(dir, "rev-parse", "HEAD");

      const scopeResult = await detectScope(dir, { commit: rootSha });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value.length).toBeGreaterThan(0);
        expect(diffResult.value).toContain("root.ts");
        expect(diffResult.value).toContain("const root = true;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("includes untracked files in the working-scope diff", async () => {
    const dir = await makeRepo();
    try {
      writeFile(dir, "brand-new.ts", "const untracked = 42;\n");

      const scopeResult = await detectScope(dir, { working: true });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;
      expect(scopeResult.value.files).toContain("brand-new.ts");

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("brand-new.ts");
        expect(diffResult.value).toContain("const untracked = 42;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("includes tracked working-tree modifications in the diff", async () => {
    const dir = await makeRepo();
    try {
      writeFile(dir, "README.md", "totally different content here\n");

      const scopeResult = await detectScope(dir, { working: true });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("README.md");
        expect(diffResult.value).toContain("totally different content here");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("returns the staged diff for a staged scope", async () => {
    const dir = await makeRepo();
    try {
      writeFile(dir, "staged-diff.ts", "const staged = 7;\n");
      await git(dir, "add", "staged-diff.ts");

      const scopeResult = await detectScope(dir, { staged: true });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("staged-diff.ts");
        expect(diffResult.value).toContain("const staged = 7;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("returns the against diff (merge-base form) for an against scope", async () => {
    const dir = await makeRepo();
    try {
      await git(dir, "checkout", "-b", "feature-diff");
      writeFile(dir, "against-diff.ts", "const against = 9;\n");
      await git(dir, "add", "against-diff.ts");
      await git(dir, "commit", "-m", "feature work");

      const scopeResult = await detectScope(dir, { against: "main" });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("against-diff.ts");
        expect(diffResult.value).toContain("const against = 9;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("returns the commits-range diff for a commits scope", async () => {
    const dir = await makeRepo();
    try {
      const firstSha = await git(dir, "rev-parse", "HEAD");
      writeFile(dir, "range-x.ts", "const rangeX = 1;\n");
      await git(dir, "add", "range-x.ts");
      await git(dir, "commit", "-m", "range-x");
      writeFile(dir, "range-y.ts", "const rangeY = 2;\n");
      await git(dir, "add", "range-y.ts");
      await git(dir, "commit", "-m", "range-y");

      const scopeResult = await detectScope(dir, { commits: `${firstSha}..HEAD` });
      expect(scopeResult.isOk()).toBe(true);
      if (!scopeResult.isOk()) return;
      expect(scopeResult.value.range).toBe(`${firstSha}..HEAD`);

      const diffResult = await getScopeDiff(dir, scopeResult.value);
      expect(diffResult.isOk()).toBe(true);
      if (diffResult.isOk()) {
        expect(diffResult.value).toContain("range-x.ts");
        expect(diffResult.value).toContain("range-y.ts");
        expect(diffResult.value).toContain("const rangeX = 1;");
      }
    } finally {
      removeDir(dir);
    }
  });

  it("returns Err(ScopeError) when the against ref does not exist", async () => {
    const dir = await makeRepo();
    try {
      // Hand-build a scope with a bad ref (detectScope would reject it earlier).
      const diffResult = await getScopeDiff(dir, {
        kind: "against",
        ref: "nonexistent-ref-zzz",
        files: [],
      });
      expect(diffResult.isErr()).toBe(true);
      if (diffResult.isErr()) {
        expect(diffResult.error._tag).toBe("ScopeError");
      }
    } finally {
      removeDir(dir);
    }
  });
});
