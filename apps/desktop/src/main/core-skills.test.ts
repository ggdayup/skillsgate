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
  batchAddToCore,
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

describe("fan-out links", () => {
  it("links a tool whose skills dir sits behind a symlinked ancestor", async () => {
    // Regression where Zed keeps ~/.config/zed as a symlink and the fan-out link
    // was derived from the logical path. The link resolved to a nonexistent directory
    // and sync never converged.
    await mkCoreEntry("zed-visible");

    const first = await applyCoreSync(await planCoreSync([zedAgent]));

    assert.deepEqual(first.failed, []);
    assert.equal(first.linked, 1);

    const link = path.join(zedLogicalDir, "zed-visible");
    assert.ok(await exists(link));
    // stat() follows the link to catch incorrect relative path resolution.
    const content = await fs
      .readFile(path.join(link, "SKILL.md"), "utf-8")
      .catch(() => null);
    assert.equal(content, "# zed-visible\n");

    const second = await applyCoreSync(await planCoreSync([zedAgent]));
    assert.equal(second.linked, 0);
    assert.equal(second.alreadyPresent, 1);
  });
});

describe("installDirToCore", () => {
  it("symlinks an external directory into core in link mode", async () => {
    const externalDir = path.join(home, "external-skill");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# External Skill\n");

    const res = await installDirToCore(externalDir, "external-skill", {
      mode: "link",
    });

    assert.equal(res.ok, true);
    const target = path.join(coreDir, "external-skill");
    const lst = await fs.lstat(target);
    assert.equal(lst.isSymbolicLink(), true);
    const content = await fs.readFile(path.join(target, "SKILL.md"), "utf-8");
    assert.equal(content, "# External Skill\n");

    const second = await installDirToCore(externalDir, "external-skill", {
      mode: "link",
    });
    assert.equal(second.ok, true);
    assert.equal(second.already, true);
  });

  it("copies an external directory into core in copy mode", async () => {
    const externalDir = path.join(home, "copy-skill");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# Copy Skill\n");

    const res = await installDirToCore(externalDir, "copy-skill", {
      mode: "copy",
    });

    assert.equal(res.ok, true);
    const target = path.join(coreDir, "copy-skill");
    const lst = await fs.lstat(target);
    assert.equal(lst.isDirectory(), true);
    assert.equal(lst.isSymbolicLink(), false);
  });

  it("defaults to copy mode when mode is omitted (pinned divergence from CLI, which defaults to link)", async () => {
    // Deliberate divergence from CLI installDirToCore in packages/cli/src/core/core-skills.ts.
    // The CLI implementation defaults to mode "link", creating a symlink in the core directory.
    // The desktop mirror defaults to mode "copy", creating a real directory.
    // This is because the core directory is git-tracked and the desktop path requires real files.
    const externalDir = path.join(home, "default-mode-skill");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# Default Mode Skill\n");

    const res = await installDirToCore(externalDir, "default-mode-skill");

    assert.equal(res.ok, true);
    const target = path.join(coreDir, "default-mode-skill");
    const lst = await fs.lstat(target);
    assert.equal(lst.isDirectory(), true);
    assert.equal(lst.isSymbolicLink(), false);
  });

  it("refuses to clobber existing entry when replace is false", async () => {
    const dirA = path.join(home, "conflict-source-a");
    const dirB = path.join(home, "conflict-source-b");
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    await fs.writeFile(path.join(dirA, "SKILL.md"), "# Skill A\n");
    await fs.writeFile(path.join(dirB, "SKILL.md"), "# Skill B\n");

    const first = await installDirToCore(dirA, "conflict-skill");
    assert.equal(first.ok, true);

    const second = await installDirToCore(dirB, "conflict-skill", {
      replace: false,
    });
    assert.equal(second.ok, false);
    assert.equal(second.conflict, true);
  });

  it("replaces existing entry and saves backup when replace is true", async () => {
    const dirA = path.join(home, "replace-source-a");
    const dirB = path.join(home, "replace-source-b");
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    await fs.writeFile(path.join(dirA, "SKILL.md"), "# Skill A\n");
    await fs.writeFile(path.join(dirB, "SKILL.md"), "# Skill B\n");

    await installDirToCore(dirA, "replace-skill");

    const res = await installDirToCore(dirB, "replace-skill", { replace: true });
    assert.equal(res.ok, true);

    const target = path.join(coreDir, "replace-skill");
    const content = await fs.readFile(path.join(target, "SKILL.md"), "utf-8");
    assert.equal(content, "# Skill B\n");

    const backupDir = BACKUP_DIR;
    const backups = await fs.readdir(backupDir);
    const found = backups.some((name) => name.startsWith("core--replace-skill--"));
    assert.equal(found, true);
  });

  it("neutralises path traversal in skill name", async () => {
    const externalDir = path.join(home, "traversal-skill");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# Traversal\n");

    const res = await installDirToCore(externalDir, "../outside");
    assert.equal(res.ok, true);
    assert.equal(res.path.startsWith(coreDir), true);
    assert.equal(path.basename(res.path), "..-outside");
  });
});

describe("findDanglingCoreEntries", () => {
  it("finds broken symlinks in core directory", async () => {
    const externalDir = path.join(home, "temporary-source");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# Temp\n");

    await installDirToCore(externalDir, "dangling-candidate", { mode: "link" });
    await fs.rm(externalDir, { recursive: true, force: true });

    const dangling = await findDanglingCoreEntries();
    const match = dangling.find((d) => d.name === "dangling-candidate");
    assert.ok(match);
  });
});

describe("batchAddToCore", () => {
  it("batch adds external skills and agent skills to core with fan-out", async () => {
    const testClaudeDir = path.join(home, ".test-claude", "skills");
    const testCursorDir = path.join(home, ".test-cursor", "skills");
    await fs.mkdir(testClaudeDir, { recursive: true });
    await fs.mkdir(testCursorDir, { recursive: true });

    const testClaudeAgent: CoreAgent = {
      name: "claude-code",
      displayName: "Claude Code",
      globalSkillsDir: testClaudeDir,
    };
    const testCursorAgent: CoreAgent = {
      name: "cursor",
      displayName: "Cursor",
      globalSkillsDir: testCursorDir,
    };

    // Skill 1: An external store skill
    const storeDir = path.join(home, ".store", "ext-skill");
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, "SKILL.md"), "# Ext Skill\n");

    // Skill 2: An agent private skill
    const agentSkillDir = path.join(testClaudeDir, "agent-priv-skill");
    await fs.mkdir(agentSkillDir, { recursive: true });
    await fs.writeFile(path.join(agentSkillDir, "SKILL.md"), "# Agent Priv Skill\n");

    const result = await batchAddToCore(
      [
        { name: "ext-skill", canonicalPath: storeDir },
        { name: "agent-priv-skill", canonicalPath: agentSkillDir },
      ],
      [testClaudeAgent, testCursorAgent],
    );

    assert.equal(result.added, 2);
    assert.equal(result.already, 0);
    assert.equal(result.failed.length, 0);

    // Verify core entries exist
    const extCore = path.join(coreDir, "ext-skill");
    const privCore = path.join(coreDir, "agent-priv-skill");
    assert.equal((await fs.lstat(extCore)).isSymbolicLink(), true);
    assert.equal((await fs.lstat(privCore)).isDirectory(), true);

    // Verify fan-out happened to cursor and claude
    assert.equal((await fs.lstat(path.join(testCursorDir, "ext-skill"))).isSymbolicLink(), true);
    assert.equal((await fs.lstat(path.join(testCursorDir, "agent-priv-skill"))).isSymbolicLink(), true);
    assert.equal((await fs.lstat(path.join(testClaudeDir, "agent-priv-skill"))).isSymbolicLink(), true);

    // Second call should report already present
    const second = await batchAddToCore(
      [
        { name: "ext-skill", canonicalPath: storeDir },
        { name: "agent-priv-skill", canonicalPath: privCore },
      ],
      [testClaudeAgent, testCursorAgent],
    );
    assert.equal(second.added, 0);
    assert.equal(second.already, 2);
    assert.equal(second.failed.length, 0);
  });
});



