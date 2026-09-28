import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractGitErrorMessage, buildCliEnv, COMMON_BIN_DIRS } from "./git-repo";

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
