import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractGitErrorMessage,
  buildCliEnv,
  COMMON_BIN_DIRS,
  parseLsRemoteHead,
  shouldRunScheduledCheck,
  checkRemoteUpdate,
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
