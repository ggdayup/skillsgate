import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractGitErrorMessage,
  buildCliEnv,
  COMMON_BIN_DIRS,
  parseLsRemoteHead,
  shouldRunScheduledCheck,
  checkRemoteUpdate,
  gitStashPush,
  gitStashPop,
  gitResetHard,
  getGitConflicts,
  gitAbortStashMerge,
  gitResolveConflicts,
  syncGitRepo,
  isGitDirty,
} from "./git-repo";

describe("git-repo error extraction and environment", () => {
  it("diagnoses killed / timeout errors cleanly", () => {
    const err = new Error("Command failed: git clone ...") as Error & { killed: boolean; signal: string };
    err.killed = true;
    err.signal = "SIGTERM";

    const msg = extractGitErrorMessage(err, "Cloning into '/some/repo'...\n");
    assert.match(msg, /超时/);
    assert.doesNotMatch(msg, /^Cloning into/);
  });

  it("filters out benign progress messages from stderr and returns the real fatal error", () => {
    const err = new Error("Command failed");
    const stderr = `Cloning into '/path/to/repo'...
remote: Repository not found.
fatal: repository 'https://github.com/citrolabs/ego-lite.git/' not found
`;
    const msg = extractGitErrorMessage(err, stderr);
    assert.doesNotMatch(msg, /^Cloning into/);
    assert.match(msg, /fatal: repository/);
    assert.match(msg, /remote: Repository not found/);
  });

  it("filters out receiving and compressing progress lines", () => {
    const err = new Error("Command failed");
    const stderr = `Cloning into '/path/to/repo'...
remote: Enumerating objects: 10, done.
remote: Counting objects: 100% (10/10), done.
Receiving objects: 50% (5/10)
fatal: early EOF
`;
    const msg = extractGitErrorMessage(err, stderr);
    assert.equal(msg, "fatal: early EOF");
  });

  it("prioritizes COMMON_BIN_DIRS and sets non-interactive git environment", () => {
    const env = buildCliEnv();
    assert.equal(env.GIT_TERMINAL_PROMPT, "0");

    const pathParts = env.PATH?.split(":") ?? [];
    if (process.platform !== "win32") {
      const homebrewIdx = pathParts.indexOf("/opt/homebrew/bin");
      const usrBinIdx = pathParts.indexOf("/usr/bin");
      if (homebrewIdx !== -1 && usrBinIdx !== -1) {
        assert.ok(homebrewIdx < usrBinIdx, "/opt/homebrew/bin should precede /usr/bin");
      }
    }
  });
});

describe("parseLsRemoteHead", () => {
  it("extracts the SHA from ls-remote output", () => {
    assert.equal(
      parseLsRemoteHead("abc1234567890123456789012345678901234567\tHEAD\n"),
      "abc1234567890123456789012345678901234567",
    );
  });

  it("returns null for empty or garbage output, never a false up-to-date", () => {
    assert.equal(parseLsRemoteHead(""), null);
    assert.equal(parseLsRemoteHead("fatal: repository not found\n"), null);
    assert.equal(parseLsRemoteHead("short\tHEAD\n"), null);
  });
});

describe("shouldRunScheduledCheck", () => {
  // Window hours are local time, so build fixtures in local time too — this
  // stays deterministic in any timezone.
  const at = (hour: number, min = 0) => new Date(2026, 9, 5, hour, min, 0).getTime();
  const window = { startHour: 3, endHour: 5 };
  const DAY = 24 * 60 * 60 * 1000;

  it("runs inside the window when the last check is older than 24h", () => {
    assert.equal(shouldRunScheduledCheck(at(4), at(4) - 3 * DAY, window), true);
  });

  it("does not run inside the window when checked recently", () => {
    assert.equal(shouldRunScheduledCheck(at(4), at(4) - 60 * 60 * 1000, window), false);
  });

  it("waits for the window even when stale before it", () => {
    assert.equal(shouldRunScheduledCheck(at(2), at(2) - 3 * DAY, window), false);
  });

  it("catches up once past the window when nothing ran since it started", () => {
    assert.equal(shouldRunScheduledCheck(at(12), at(12) - 3 * DAY, window), true);
  });

  it("does not catch up twice past the window", () => {
    assert.equal(shouldRunScheduledCheck(at(12), at(4, 30), window), false);
  });
});

describe("checkRemoteUpdate against local file:// remotes", () => {
  // file:// remotes make this hermetic: real git, real ls-remote, no network.
  let gitOk = false;
  let originDir = "";
  let workDir = "";
  let trackedDir = "";

  const git = (args: string[], cwd: string) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      },
    });

  before(() => {
    try {
      execFileSync("git", ["--version"]);
      gitOk = true;
    } catch {
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "skillsgate-update-check-"));
    originDir = join(root, "origin.git");
    workDir = join(root, "work");
    trackedDir = join(root, "tracked");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", originDir]);
    execFileSync("git", ["clone", originDir, workDir]);
    writeFileSync(join(workDir, "SKILL.md"), "# skill\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "initial"], workDir);
    git(["push", "origin", "main"], workDir);
    execFileSync("git", ["clone", originDir, trackedDir]);
  });

  it("reports up-to-date on a fresh clone", async () => {
    if (!gitOk) return;
    const check = await checkRemoteUpdate(trackedDir);
    assert.equal(check.status, "up-to-date");
    assert.ok(check.local);
    assert.equal(check.local, check.remote);
  });

  it("reports update-available with both SHAs after upstream moves", async () => {
    if (!gitOk) return;
    writeFileSync(join(workDir, "SKILL.md"), "# skill v2\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "v2"], workDir);
    git(["push", "origin", "main"], workDir);

    const check = await checkRemoteUpdate(trackedDir);
    assert.equal(check.status, "update-available");
    assert.ok(check.local);
    assert.ok(check.remote);
    assert.notEqual(check.local, check.remote);
  });

  it("still reports availability on a dirty tree that is also behind", async () => {
    if (!gitOk) return;
    writeFileSync(join(trackedDir, "SKILL.md"), "# local edit\n");
    const check = await checkRemoteUpdate(trackedDir);
    assert.equal(check.status, "update-available");
  });

  it("reports unknown, never up-to-date, when the remote is unreachable", async () => {
    if (!gitOk) return;
    const check = await checkRemoteUpdate(join(trackedDir, "does-not-exist"));
    assert.equal(check.status, "unknown");
    assert.ok(check.error);
  });
});

describe("native Git primitives (stash, pop, reset-hard, conflicts)", () => {
  function setupRepo() {
    const root = mkdtempSync(join(tmpdir(), "skillsgate-primitives-"));
    const originDir = join(root, "origin.git");
    const trackedDir = join(root, "tracked");
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "test",
          GIT_AUTHOR_EMAIL: "test@test",
          GIT_COMMITTER_NAME: "test",
          GIT_COMMITTER_EMAIL: "test@test",
        },
      });

    execFileSync("git", ["init", "--bare", "--initial-branch=main", originDir]);
    execFileSync("git", ["clone", originDir, trackedDir]);
    writeFileSync(join(trackedDir, "SKILL.md"), "line1\nline2\nline3\n");
    git(["add", "."], trackedDir);
    git(["commit", "-m", "init"], trackedDir);
    git(["push", "origin", "main"], trackedDir);

    return { root, originDir, trackedDir, git };
  }

  it("handles stash push on clean working tree without errors", async () => {
    const { trackedDir } = setupRepo();
    const res = await gitStashPush(trackedDir, "clean-test");
    assert.equal(res.success, true);
    assert.equal(res.stashed, false);
  });

  it("stashes uncommitted modifications and untracked files", async () => {
    const { trackedDir } = setupRepo();
    writeFileSync(join(trackedDir, "SKILL.md"), "line1-modified\nline2\nline3\n");
    writeFileSync(join(trackedDir, "untracked.txt"), "untracked content\n");

    const dirtyBefore = await isGitDirty(trackedDir);
    assert.equal(dirtyBefore, true);

    const stashRes = await gitStashPush(trackedDir, "my-stash");
    assert.equal(stashRes.success, true);
    assert.equal(stashRes.stashed, true);

    const dirtyAfter = await isGitDirty(trackedDir);
    assert.equal(dirtyAfter, false);
    assert.equal(existsSync(join(trackedDir, "untracked.txt")), false);

    const popRes = await gitStashPop(trackedDir);
    assert.equal(popRes.success, true);
    assert.equal(popRes.conflict, false);
    assert.equal(existsSync(join(trackedDir, "untracked.txt")), true);
    assert.equal(readFileSync(join(trackedDir, "SKILL.md"), "utf8"), "line1-modified\nline2\nline3\n");
  });

  it("resets working tree hard including untracked files", async () => {
    const { trackedDir } = setupRepo();
    writeFileSync(join(trackedDir, "SKILL.md"), "dirty content\n");
    writeFileSync(join(trackedDir, "junk.tmp"), "junk file\n");

    const resetRes = await gitResetHard(trackedDir);
    assert.equal(resetRes.success, true);
    assert.equal(await isGitDirty(trackedDir), false);
    assert.equal(existsSync(join(trackedDir, "junk.tmp")), false);
    assert.equal(readFileSync(join(trackedDir, "SKILL.md"), "utf8"), "line1\nline2\nline3\n");
  });
});

describe("syncGitRepo strategies and conflict lifecycle", () => {
  function setupDivergedRepos() {
    const root = mkdtempSync(join(tmpdir(), "skillsgate-sync-"));
    const originDir = join(root, "origin.git");
    const workDir = join(root, "work");
    const trackedDir = join(root, "tracked");
    const git = (args: string[], cwd: string) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf-8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "test",
          GIT_AUTHOR_EMAIL: "test@test",
          GIT_COMMITTER_NAME: "test",
          GIT_COMMITTER_EMAIL: "test@test",
        },
      });

    execFileSync("git", ["init", "--bare", "--initial-branch=main", originDir]);
    execFileSync("git", ["clone", originDir, workDir]);
    writeFileSync(join(workDir, "SKILL.md"), "line1\nline2\nline3\n");
    writeFileSync(join(workDir, "other.txt"), "other init\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "init"], workDir);
    git(["push", "origin", "main"], workDir);

    execFileSync("git", ["clone", originDir, trackedDir]);
    return { root, originDir, workDir, trackedDir, git };
  }

  it("ff-only strategy returns dirty when working tree has modifications", async () => {
    const { trackedDir } = setupDivergedRepos();
    writeFileSync(join(trackedDir, "SKILL.md"), "line1 local modification\nline2\nline3\n");

    const syncRes = await syncGitRepo(trackedDir, "ff-only");
    assert.equal(syncRes.status, "dirty");
    assert.ok(syncRes.error);
    assert.match(syncRes.error, /未提交修改/);
  });

  it("stash-merge merges local changes cleanly when there are no conflicting lines", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    // Remote changes other.txt and line3 of SKILL.md
    writeFileSync(join(workDir, "other.txt"), "remote updated other\n");
    writeFileSync(join(workDir, "new-file.txt"), "new file from remote\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "remote updates"], workDir);
    git(["push", "origin", "main"], workDir);

    // Local changes line1 of SKILL.md
    writeFileSync(join(trackedDir, "SKILL.md"), "line1 local edit\nline2\nline3\n");

    const syncRes = await syncGitRepo(trackedDir, "stash-merge");
    assert.equal(syncRes.status, "updated");
    assert.equal(syncRes.mergedLocalChanges, true);

    // Verify both remote changes and local modifications coexist
    assert.equal(existsSync(join(trackedDir, "new-file.txt")), true);
    assert.equal(readFileSync(join(trackedDir, "other.txt"), "utf8"), "remote updated other\n");
    const skillContent = readFileSync(join(trackedDir, "SKILL.md"), "utf8");
    assert.match(skillContent, /line1 local edit/);
  });

  it("stash-merge marks conflict when both remote and local edit same line", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    // Remote changes line1
    writeFileSync(join(workDir, "SKILL.md"), "line1 REMOTE EDIT\nline2\nline3\n");
    git(["commit", "-am", "remote edit line 1"], workDir);
    git(["push", "origin", "main"], workDir);

    // Local changes line1
    writeFileSync(join(trackedDir, "SKILL.md"), "line1 LOCAL EDIT\nline2\nline3\n");

    const syncRes = await syncGitRepo(trackedDir, "stash-merge");
    assert.equal(syncRes.status, "conflict");
    assert.ok(syncRes.conflictedFiles);
    assert.ok(syncRes.conflictedFiles.includes("SKILL.md"));

    // Conflicts should be detected by getGitConflicts
    const conflicts = await getGitConflicts(trackedDir);
    assert.ok(conflicts.includes("SKILL.md"));

    // Resolve conflict flow
    writeFileSync(join(trackedDir, "SKILL.md"), "line1 RESOLVED\nline2\nline3\n");
    const resolveRes = await gitResolveConflicts(trackedDir);
    assert.equal(resolveRes.ok, true);

    const remaining = await getGitConflicts(trackedDir);
    assert.equal(remaining.length, 0);
  });

  it("gitAbortStashMerge rolls back conflicted working tree and restores local modifications without prePullCommit", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    writeFileSync(join(workDir, "SKILL.md"), "line1 REMOTE\nline2\nline3\n");
    git(["commit", "-am", "remote line 1"], workDir);
    git(["push", "origin", "main"], workDir);

    writeFileSync(join(trackedDir, "SKILL.md"), "line1 LOCAL\nline2\nline3\n");
    writeFileSync(join(trackedDir, "untracked-local.txt"), "local untracked\n");
    const syncRes = await syncGitRepo(trackedDir, "stash-merge");
    assert.equal(syncRes.status, "conflict");

    const conflictsBefore = await getGitConflicts(trackedDir);
    assert.ok(conflictsBefore.length > 0);

    // Call without prePullCommit: must auto-detect base commit from stash@{0}^1
    const abortRes = await gitAbortStashMerge(trackedDir);
    assert.equal(abortRes.success, true);
    assert.equal(abortRes.restoredLocalState, true);

    const conflictsAfter = await getGitConflicts(trackedDir);
    assert.equal(conflictsAfter.length, 0);

    // Verify local edits are restored into working tree
    assert.equal(readFileSync(join(trackedDir, "SKILL.md"), "utf8"), "line1 LOCAL\nline2\nline3\n");
    assert.equal(existsSync(join(trackedDir, "untracked-local.txt")), true);
    assert.equal(readFileSync(join(trackedDir, "untracked-local.txt"), "utf8"), "local untracked\n");
  });

  it("gitAbortStashMerge rolls back conflicted working tree with explicit prePullCommit", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    writeFileSync(join(workDir, "SKILL.md"), "line1 REMOTE V2\nline2\nline3\n");
    git(["commit", "-am", "remote line 1 v2"], workDir);
    git(["push", "origin", "main"], workDir);

    writeFileSync(join(trackedDir, "SKILL.md"), "line1 LOCAL V2\nline2\nline3\n");
    const syncRes = await syncGitRepo(trackedDir, "stash-merge");
    assert.equal(syncRes.status, "conflict");
    assert.ok(syncRes.prePullCommit);

    const abortRes = await gitAbortStashMerge(trackedDir, syncRes.prePullCommit);
    assert.equal(abortRes.success, true);
    assert.equal(abortRes.restoredLocalState, true);

    assert.equal(readFileSync(join(trackedDir, "SKILL.md"), "utf8"), "line1 LOCAL V2\nline2\nline3\n");
  });

  it("getGitConflicts correctly handles filenames with spaces", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    writeFileSync(join(workDir, "my space skill.txt"), "remote v1\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "remote space file"], workDir);
    git(["push", "origin", "main"], workDir);

    git(["pull", "--ff-only"], trackedDir);

    writeFileSync(join(workDir, "my space skill.txt"), "remote v2 conflict\n");
    git(["commit", "-am", "remote v2"], workDir);
    git(["push", "origin", "main"], workDir);

    writeFileSync(join(trackedDir, "my space skill.txt"), "local v2 conflict\n");
    const syncRes = await syncGitRepo(trackedDir, "stash-merge");
    assert.equal(syncRes.status, "conflict");

    const conflicts = await getGitConflicts(trackedDir);
    assert.ok(conflicts.includes("my space skill.txt"), "Space file should be unquoted in conflicts list");
    assert.ok(!conflicts.includes('"my space skill.txt"'), "Quotes must be stripped");

    // Clean up
    await gitAbortStashMerge(trackedDir);
  });

  it("gitResolveConflicts handles conflict resolved by deleting the conflicted file", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    writeFileSync(join(workDir, "to-delete.txt"), "remote delete test\n");
    git(["add", "."], workDir);
    git(["commit", "-m", "add to-delete"], workDir);
    git(["push", "origin", "main"], workDir);

    git(["pull", "--ff-only"], trackedDir);

    writeFileSync(join(workDir, "to-delete.txt"), "remote modification\n");
    git(["commit", "-am", "remote mod"], workDir);
    git(["push", "origin", "main"], workDir);

    writeFileSync(join(trackedDir, "to-delete.txt"), "local modification\n");
    await syncGitRepo(trackedDir, "stash-merge");

    assert.ok((await getGitConflicts(trackedDir)).includes("to-delete.txt"));

    // User resolves conflict by removing the file
    rmSync(join(trackedDir, "to-delete.txt"));

    const resolveRes = await gitResolveConflicts(trackedDir);
    assert.equal(resolveRes.ok, true);
    assert.equal((await getGitConflicts(trackedDir)).length, 0);
  });

  it("discard-reset creates safety backup and aligns with remote", async () => {
    const { workDir, trackedDir, git } = setupDivergedRepos();

    writeFileSync(join(workDir, "SKILL.md"), "line1 REMOTE MASTER\nline2\nline3\n");
    git(["commit", "-am", "remote master"], workDir);
    git(["push", "origin", "main"], workDir);

    writeFileSync(join(trackedDir, "SKILL.md"), "line1 TO BE DISCARDED\nline2\nline3\n");
    writeFileSync(join(trackedDir, "local-scratch.txt"), "scratch to backup\n");

    const syncRes = await syncGitRepo(trackedDir, "discard-reset");
    assert.equal(syncRes.status, "updated");
    assert.ok(syncRes.backupPath);
    assert.equal(existsSync(syncRes.backupPath), true);
    assert.equal(existsSync(join(syncRes.backupPath, "local-scratch.txt")), true);
    assert.equal(readFileSync(join(syncRes.backupPath, "SKILL.md"), "utf8"), "line1 TO BE DISCARDED\nline2\nline3\n");

    // Working directory is aligned with remote
    assert.equal(readFileSync(join(trackedDir, "SKILL.md"), "utf8"), "line1 REMOTE MASTER\nline2\nline3\n");
    assert.equal(existsSync(join(trackedDir, "local-scratch.txt")), false);
  });
});
