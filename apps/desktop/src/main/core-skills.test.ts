import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

// Fake HOME setup BEFORE loading modules.
const HOME_BEFORE = process.env.HOME;
const USERPROFILE_BEFORE = process.env.USERPROFILE;
const CLAUDE_CONFIG_BEFORE = process.env.CLAUDE_CONFIG_DIR;
const XDG_CONFIG_BEFORE = process.env.XDG_CONFIG_HOME;

const home = fsSync.mkdtempSync(path.join(os.tmpdir(), "desktop-core-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.XDG_CONFIG_HOME;

const {
  CORE_SKILLS_DIR,
  CANONICAL_SKILLS_DIR,
  SKILLS_LIBRARY_DIR,
  BACKUP_DIR,
} = require("./skill-paths") as typeof import("./skill-paths");

const {
  planCoreSync,
  applyCoreSync,
  removeCoreSkill,
  installDirToCore,
  findDanglingCoreEntries,
} = require("./core-skills") as typeof import("./core-skills");

import type { CoreAgent } from "./core-skills";

const coreDir = CORE_SKILLS_DIR;
const claudeDir = path.join(home, ".claude", "skills");
const zedRealDir = path.join(home, "synced", "zed", "skills");
const zedLogicalDir = path.join(home, ".config", "zed", "skills");

const claudeAgent: CoreAgent = {
  name: "claude",
  displayName: "Claude Code",
  globalSkillsDir: claudeDir,
};

const zedAgent: CoreAgent = {
  name: "zed",
  displayName: "Zed",
  globalSkillsDir: zedLogicalDir,
};

async function mkCoreEntry(name: string): Promise<string> {
  const dir = path.join(coreDir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `# ${name}\n`);
  return dir;
}

async function linkFromClaude(name: string, target: string): Promise<string> {
  const link = path.join(claudeDir, name);
  await fs.symlink(path.relative(claudeDir, target), link);
  return link;
}

const exists = (p: string) =>
  fs
    .lstat(p)
    .then(() => true)
    .catch(() => false);

fsSync.mkdirSync(coreDir, { recursive: true });
fsSync.mkdirSync(claudeDir, { recursive: true });
fsSync.mkdirSync(zedRealDir, { recursive: true });
fsSync.mkdirSync(path.join(home, ".config"), { recursive: true });
fsSync.symlinkSync(path.join(home, "synced", "zed"), path.join(home, ".config", "zed"));

after(async () => {
  process.env.HOME = HOME_BEFORE;
  if (USERPROFILE_BEFORE === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = USERPROFILE_BEFORE;
  if (CLAUDE_CONFIG_BEFORE === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_BEFORE;
  if (XDG_CONFIG_BEFORE === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = XDG_CONFIG_BEFORE;
  await fs.rm(home, { recursive: true, force: true });
});

describe("removeCoreSkill", () => {
  it("drops the core entry and unlinks it from each tool", async () => {
    const entry = await mkCoreEntry("plain-skill");
    const link = await linkFromClaude("plain-skill", entry);

    const res = await removeCoreSkill("plain-skill", [claudeAgent]);

    assert.equal(res.ok, true);
    assert.equal(res.coreEntryMissing, false);
    assert.equal(res.unlinked, 1);
    assert.deepEqual(res.residualCopies, []);
    assert.equal(await exists(entry), false);
    assert.equal(await exists(link), false);
  });

  it("preserves a real directory in canonical store when detaching from core", async () => {
    const entry = await mkCoreEntry("preserved-skill");
    const link = await linkFromClaude("preserved-skill", entry);

    const res = await removeCoreSkill("preserved-skill", [claudeAgent], { mode: "detach" });

    assert.equal(res.ok, true);
    assert.equal(await exists(entry), false);
    assert.equal(await exists(link), false);
    const storePath = path.join(CANONICAL_SKILLS_DIR, "preserved-skill");
    assert.equal(await exists(storePath), true);
  });

  it("purges a skill completely from core, store, and library", async () => {
    const entry = await mkCoreEntry("purged-skill");
    const link = await linkFromClaude("purged-skill", entry);
    const libraryPath = path.join(SKILLS_LIBRARY_DIR, "purged-skill");
    await fs.mkdir(libraryPath, { recursive: true });
    const storePath = path.join(CANONICAL_SKILLS_DIR, "purged-skill");
    await fs.mkdir(storePath, { recursive: true });

    const res = await removeCoreSkill("purged-skill", [claudeAgent], { mode: "purge" });

    assert.equal(res.ok, true);
    assert.equal(await exists(entry), false);
    assert.equal(await exists(link), false);
    assert.equal(await exists(storePath), false);
    assert.equal(await exists(libraryPath), false);
  });

  it("sweeps a dangling tool link when the core entry is already gone", async () => {
    const link = await linkFromClaude(
      "ghost-skill",
      path.join(coreDir, "ghost-skill"),
    );
    assert.equal(await exists(link), true);

    const res = await removeCoreSkill("ghost-skill", [claudeAgent]);

    assert.equal(res.ok, true);
    assert.equal(res.coreEntryMissing, true);
    assert.equal(res.unlinked, 1);
    assert.equal(await exists(link), false);
  });

  it("leaves a tool's own copy alone and reports it as residual", async () => {
    const own = path.join(claudeDir, "owned-skill");
    await fs.mkdir(own, { recursive: true });

    const res = await removeCoreSkill("owned-skill", [claudeAgent]);

    assert.equal(res.ok, true);
    assert.equal(res.unlinked, 0);
    assert.equal(res.residualCopies.length, 1);
    assert.ok(await exists(own));
  });

  it("never touches a link that points outside the core set", async () => {
    const library = path.join(SKILLS_LIBRARY_DIR, "ai", "kept");
    await fs.mkdir(library, { recursive: true });
    const link = await linkFromClaude("kept", library);

    const res = await removeCoreSkill("kept", [claudeAgent]);

    assert.equal(res.ok, true);
    assert.equal(res.unlinked, 0);
    assert.equal(await exists(link), true);
    assert.ok(await exists(library));
  });

  it("neutralises a traversal-shaped name instead of deleting outside core", async () => {
    const outside = path.join(home, ".agents", "escape");
    await fs.mkdir(outside, { recursive: true });

    const res = await removeCoreSkill("../../escape", [claudeAgent]);

    assert.equal(res.ok, true);
    assert.ok(await exists(outside));
  });
});
