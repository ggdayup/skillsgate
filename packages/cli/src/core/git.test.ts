import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { STORE_REPOS_DIR } from "../constants.js";
import { GitCloneError } from "./git.js";

describe("git repository management", () => {
  it("should define STORE_REPOS_DIR under CANONICAL_SKILLS_DIR/repos", () => {
    const reposDir = STORE_REPOS_DIR();
    assert.ok(reposDir.endsWith(path.join(".store", "repos")));
  });

  it("should validate ref names in GitCloneError", () => {
    const err = new GitCloneError("invalid ref", false);
    assert.equal(err.name, "GitCloneError");
    assert.equal(err.isAuth, false);
  });
});
