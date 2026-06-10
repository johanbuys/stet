/**
 * Scope detection for stet.
 *
 * Resolves what diff the current run should analyze — either from explicit CLI flags
 * or through the auto-detection priority ladder:
 *   staged → working → branch-vs-default → last-commit → error
 *
 * All git operations run via execFile (no shell interpolation) with an explicit cwd.
 * Every fallible function returns Result<T, ScopeError> and never throws across the
 * module boundary. Result.gen is used for composition to keep the Ok-type uniform.
 *
 * Default-branch determination order (documented here, PRD §3.6):
 *   1. `git symbolic-ref refs/remotes/origin/HEAD` — the remote-tracking default
 *   2. Local branch named "main"
 *   3. Local branch named "master"
 *   4. None — auto-detection falls through to the last-commit rung
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { Result } from "better-result";
import { ScopeError } from "./errors.js";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** CLI flags that select scope explicitly. At most one must be set. */
export interface ScopeFlags {
  staged?: boolean;
  working?: boolean;
  against?: string;
  commit?: string;
  commits?: string;
}

/**
 * Resolved scope — matches the RunReport `scope` shape (PRD §4.5).
 * `ref` is present for "against" (default branch or explicit ref) and "commit" kinds.
 * `stripped` is M8 — never set here.
 */
export interface Scope {
  kind: "staged" | "working" | "against" | "commit" | "commits";
  ref?: string;
  files: string[];
}

// ---------------------------------------------------------------------------
// Internal git runner
// ---------------------------------------------------------------------------

/**
 * Run a git command in `cwd` and return its trimmed stdout.
 * Maps any execution failure to Err(ScopeError) with the provided `errorMessage`.
 * Never throws.
 */
async function runGit(
  cwd: string,
  args: string[],
  errorMessage: string,
): Promise<Result<string, ScopeError>> {
  return Result.tryPromise({
    try: async () => {
      const { stdout } = await execFile("git", args, { cwd });
      return stdout.trim();
    },
    catch: (cause) => {
      // Surface git's own first stderr line — "fail fast on inputs" demands
      // actionable messages, and git usually says exactly what's wrong.
      const gitSays =
        cause instanceof Error && "stderr" in cause && typeof cause.stderr === "string"
          ? (cause.stderr.trim().split("\n")[0] ?? "")
          : "";
      return new ScopeError({
        message: gitSays === "" ? errorMessage : `${errorMessage} (git: ${gitSays})`,
      });
    },
  });
}

/**
 * Parse newline-separated git output into a sorted, deduplicated file list,
 * filtering out empty lines.
 */
function parseFileList(raw: string): string[] {
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen].sort();
}

// ---------------------------------------------------------------------------
// Repo sanity check
// ---------------------------------------------------------------------------

/**
 * Verify that `cwd` is inside a git repository.
 * Returns Err("not a git repository") if not.
 */
async function assertGitRepo(cwd: string): Promise<Result<void, ScopeError>> {
  const result = await runGit(cwd, ["rev-parse", "--git-dir"], "not a git repository");
  return result.map(() => undefined);
}

// ---------------------------------------------------------------------------
// Staged-file helpers
// ---------------------------------------------------------------------------

/** Returns the list of staged (cached) files. Empty list if nothing staged. */
async function getStagedFiles(cwd: string): Promise<Result<string[], ScopeError>> {
  const result = await runGit(
    cwd,
    ["diff", "--name-only", "--cached"],
    "failed to list staged files",
  );
  return result.map(parseFileList);
}

// ---------------------------------------------------------------------------
// Working-tree helpers
// ---------------------------------------------------------------------------

/**
 * Returns working-tree changed files: tracked modifications vs HEAD plus untracked files.
 * PRD §3.6: --working ⇒ `git diff --name-only HEAD` + `git ls-files --others --exclude-standard`.
 */
async function getWorkingFiles(cwd: string): Promise<Result<string[], ScopeError>> {
  return Result.gen(async function* () {
    const diffRaw = yield* Result.await(
      runGit(cwd, ["diff", "--name-only", "HEAD"], "failed to list working-tree changes"),
    );
    const untrackedRaw = yield* Result.await(
      runGit(cwd, ["ls-files", "--others", "--exclude-standard"], "failed to list untracked files"),
    );
    return Result.ok(parseFileList(diffRaw + "\n" + untrackedRaw));
  });
}

// ---------------------------------------------------------------------------
// Default-branch detection
// ---------------------------------------------------------------------------

/**
 * Attempt to determine the default branch.
 * Returns Ok(branchName) or Ok(undefined) if none can be determined.
 *
 * Resolution order (documented in module JSDoc):
 *   1. `git symbolic-ref refs/remotes/origin/HEAD` (strips "refs/remotes/origin/" prefix)
 *   2. local branch "main"
 *   3. local branch "master"
 *   4. undefined
 */
async function detectDefaultBranch(cwd: string): Promise<Result<string | undefined, ScopeError>> {
  // 1. Remote tracking HEAD
  const remoteResult = await runGit(
    cwd,
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    "no remote HEAD",
  );
  if (remoteResult.isOk()) {
    const ref = remoteResult.value;
    const prefix = "refs/remotes/origin/";
    if (ref.startsWith(prefix)) {
      return Result.ok(ref.slice(prefix.length));
    }
  }

  // 2. Local "main"
  const mainResult = await runGit(cwd, ["rev-parse", "--verify", "main"], "no main branch");
  if (mainResult.isOk()) return Result.ok("main");

  // 3. Local "master"
  const masterResult = await runGit(cwd, ["rev-parse", "--verify", "master"], "no master branch");
  if (masterResult.isOk()) return Result.ok("master");

  // 4. None
  return Result.ok(undefined);
}

// ---------------------------------------------------------------------------
// Current-branch detection
// ---------------------------------------------------------------------------

/**
 * Returns the current branch name, or undefined if in detached-HEAD state.
 * Never fails (returns Ok).
 */
async function currentBranch(cwd: string): Promise<Result<string | undefined, ScopeError>> {
  const result = await runGit(cwd, ["symbolic-ref", "--short", "HEAD"], "detached HEAD");
  if (result.isOk()) return Result.ok(result.value);
  return Result.ok(undefined); // detached HEAD
}

// ---------------------------------------------------------------------------
// Against-ref helpers
// ---------------------------------------------------------------------------

/**
 * Returns files changed between the merge base of `ref` and HEAD.
 * `git diff --name-only <ref>...HEAD` (three-dot form = merge-base diff).
 */
async function getAgainstFiles(cwd: string, ref: string): Promise<Result<string[], ScopeError>> {
  const result = await runGit(
    cwd,
    ["diff", "--name-only", `${ref}...HEAD`],
    `failed to diff against ref "${ref}" — ref may not exist or shallow clone is missing history`,
  );
  return result.map(parseFileList);
}

// ---------------------------------------------------------------------------
// Commit-file helpers
// ---------------------------------------------------------------------------

/**
 * Returns the files touched by a single commit.
 *
 * Strategy:
 *   1. Check whether the commit has a first parent (`git rev-parse --verify --quiet <sha>^1`).
 *      If it does (normal commit OR merge commit), use `git diff --name-only <sha>^1 <sha>`.
 *      For a merge commit this yields "what the PR/branch introduced vs base" — exactly the
 *      right diff for rung 4 (CI detached-HEAD on refs/pull/N/merge) and `--commit <sha>`.
 *   2. If no first parent (root commit), fall back to
 *      `git diff-tree --no-commit-id --name-only -r --root <sha>`.
 *
 * The old `git show --name-only --format=` is silent for merge commits (prints nothing),
 * which is the silent-green bug this replaces.
 */
async function getCommitFiles(cwd: string, sha: string): Promise<Result<string[], ScopeError>> {
  // Detect whether a first parent exists (fails for root commits).
  const parentCheck = await runGit(
    cwd,
    ["rev-parse", "--verify", "--quiet", `${sha}^1`],
    "no first parent",
  );

  if (parentCheck.isOk()) {
    // Normal commit or merge commit — diff first-parent to sha.
    const result = await runGit(
      cwd,
      ["diff", "--name-only", `${sha}^1`, sha],
      `failed to diff commit "${sha}" against its first parent`,
    );
    return result.map(parseFileList);
  }

  // Root commit — no parent; use diff-tree --root.
  const result = await runGit(
    cwd,
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha],
    `failed to show root commit "${sha}" — ref may not exist or shallow clone is missing history`,
  );
  return result.map(parseFileList);
}

/**
 * Returns files changed over a commit range.
 * `git diff --name-only <range>` — the caller provides the full range string.
 */
async function getCommitsFiles(cwd: string, range: string): Promise<Result<string[], ScopeError>> {
  const result = await runGit(
    cwd,
    ["diff", "--name-only", range],
    `failed to diff range "${range}" — range may not exist or shallow clone is missing history`,
  );
  return result.map(parseFileList);
}

// ---------------------------------------------------------------------------
// HEAD sha helper
// ---------------------------------------------------------------------------

async function getHeadSha(cwd: string): Promise<Result<string, ScopeError>> {
  return runGit(cwd, ["rev-parse", "HEAD"], "failed to resolve HEAD — repository may be empty");
}

// ---------------------------------------------------------------------------
// Flag counting
// ---------------------------------------------------------------------------

function activeFlags(flags: ScopeFlags): string[] {
  const active: string[] = [];
  if (flags.staged) active.push("--staged");
  if (flags.working) active.push("--working");
  if (flags.against !== undefined) active.push("--against");
  if (flags.commit !== undefined) active.push("--commit");
  if (flags.commits !== undefined) active.push("--commits");
  return active;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect what diff stet should analyze.
 *
 * If any explicit flag is set, it is honored directly (conflicting flags ⇒ Err).
 * With no flags, the auto-detection priority ladder runs:
 *   staged → working → branch-vs-default → last-commit(detached/no-default) → error
 *
 * See module JSDoc for the full rationale and default-branch resolution order.
 *
 * PRD references: §3.6 (scope detection & inputs), §6 (edge cases).
 */
export async function detectScope(
  cwd: string,
  flags: ScopeFlags,
): Promise<Result<Scope, ScopeError>> {
  return Result.gen(async function* () {
    // --- repo check is always first ---
    yield* Result.await(assertGitRepo(cwd));

    // --- conflicting flags ---
    const active = activeFlags(flags);
    if (active.length > 1) {
      yield* new ScopeError({
        message: `conflicting scope flags: ${active.join(", ")} — use at most one`,
      });
    }

    // -----------------------------------------------------------------------
    // Explicit flag path
    // -----------------------------------------------------------------------

    if (flags.staged) {
      const files = yield* Result.await(getStagedFiles(cwd));
      return Result.ok<Scope>({ kind: "staged", files });
    }

    if (flags.working) {
      const files = yield* Result.await(getWorkingFiles(cwd));
      return Result.ok<Scope>({ kind: "working", files });
    }

    if (flags.against !== undefined) {
      const files = yield* Result.await(getAgainstFiles(cwd, flags.against));
      return Result.ok<Scope>({ kind: "against", ref: flags.against, files });
    }

    if (flags.commit !== undefined) {
      const files = yield* Result.await(getCommitFiles(cwd, flags.commit));
      return Result.ok<Scope>({ kind: "commit", ref: flags.commit, files });
    }

    if (flags.commits !== undefined) {
      const files = yield* Result.await(getCommitsFiles(cwd, flags.commits));
      return Result.ok<Scope>({ kind: "commits", files });
    }

    // -----------------------------------------------------------------------
    // Auto-detection priority ladder
    // -----------------------------------------------------------------------

    // Rung 1: staged changes
    const stagedFiles = yield* Result.await(getStagedFiles(cwd));
    if (stagedFiles.length > 0) {
      return Result.ok<Scope>({ kind: "staged", files: stagedFiles });
    }

    // Rung 2: working-tree changes (tracked modifications OR untracked files).
    //
    // Before running getWorkingFiles, check whether HEAD resolves. An unborn HEAD
    // (git init with no commits) means there is nothing to diff against — rungs 2–4
    // are meaningless. Rather than swallowing the getWorkingFiles Err (which would also
    // silently absorb permissions failures, corrupt objects, etc.), we detect the
    // unborn case explicitly and fail fast with an actionable message.
    const headCheck = await runGit(
      cwd,
      ["rev-parse", "--verify", "--quiet", "HEAD"],
      "unborn HEAD",
    );
    if (headCheck.isErr()) {
      // Repository has no commits: rung 1 (staged) already ran and found nothing.
      return Result.err(
        new ScopeError({
          message:
            "nothing detectable: repository has no commits (unborn HEAD) and nothing is staged — make an initial commit or stage files first",
        }),
      );
    }

    const workingFiles = yield* Result.await(getWorkingFiles(cwd));
    if (workingFiles.length > 0) {
      return Result.ok<Scope>({ kind: "working", files: workingFiles });
    }

    // Rung 3: on a named branch that is NOT the default branch, with a determinable default
    const branch = yield* Result.await(currentBranch(cwd));
    const defaultBranch = yield* Result.await(detectDefaultBranch(cwd));

    if (branch !== undefined && defaultBranch !== undefined && branch !== defaultBranch) {
      // On a named feature branch — diff vs default branch (merge-base form)
      const files = yield* Result.await(getAgainstFiles(cwd, defaultBranch));
      return Result.ok<Scope>({ kind: "against", ref: defaultBranch, files });
    }

    // Rung 4: detached HEAD (CI checkouts) OR no determinable default branch
    // Use the last commit — this is the "commit" rung that serves CI detached-HEAD checkouts.
    if (branch === undefined || defaultBranch === undefined) {
      const sha = yield* Result.await(getHeadSha(cwd));
      const files = yield* Result.await(getCommitFiles(cwd, sha));
      return Result.ok<Scope>({ kind: "commit", ref: sha, files });
    }

    // Rung 5: clean tree on the default branch — nothing detectable
    return Result.err(
      new ScopeError({
        message:
          "nothing detectable: working tree clean on the default branch — use --against/--commit/--commits to specify a scope",
      }),
    );
  });
}
