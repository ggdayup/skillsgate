import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// The agent registry resolves every globalSkillsDir from os.homedir() at module
// load, so the fake HOME has to be in place before anything imports the engine.
const HOME_BEFORE = process.env.HOME;
const CLAUDE_CONFIG_BEFORE = process.env.CLAUDE_CONFIG_DIR;
const XDG_CONFIG_BEFORE = process.env.XDG_CONFIG_HOME;
const home = await fs.mkdtemp(path.join(os.tmpdir(), "core-remove-"));
process.env.HOME = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.XDG_CONFIG_HOME;

const coreDir = path.join(home, ".agents", "skills");
const claudeDir = path.join(home, ".claude", "skills");
// Zed's global skills dir, reached through a symlinked ancestor: the layout
// that made every fan-out link dangle.
const zedRealDir = path.join(home, "synced", "zed", "skills");
const zedLogicalDir = path.join(home, ".config", "zed", "skills");

const {
  planCoreSync,
  applyCoreSync,
  removeCoreSkill,
  removeCoreSkills,
  resolveCoreSources,
  formatRepoDisplayName,
  parseGitOriginUrl,
  installDirToCore,
  resolveLocalSkill,
  findDanglingCoreEntries,
  planCorePrune,
  applyCorePrune,
} = await import("./core-skills.js");
const { addPathToCore } = await import("../commands/core.js");
const { agents } = await import("./agents.js");
const { CORE_SKILLS_DIR } = await import("../constants.js");

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

// Setup at module scope: a per-suite hook would leave HOME restored for the
// suites that run after it, and they would then read the real ~/.agents.
await fs.mkdir(coreDir, { recursive: true });
// Detection gate for claude-code is ~/.claude existing.
await fs.mkdir(claudeDir, { recursive: true });
await fs.mkdir(zedRealDir, { recursive: true });
await fs.mkdir(path.join(home, ".config"), { recursive: true });
await fs.symlink(path.join(home, "synced", "zed"), path.join(home, ".config", "zed"));

after(async () => {
  process.env.HOME = HOME_BEFORE;
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

    const res = await removeCoreSkill("plain-skill");

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

    const res = await removeCoreSkill("preserved-skill", { mode: "detach" });

    assert.equal(res.ok, true);
    assert.equal(await exists(entry), false);
    assert.equal(await exists(link), false);
    const storePath = path.join(home, ".agents", ".store", "preserved-skill");
    assert.equal(await exists(storePath), true);
  });

  it("purges a skill completely from core, store, and library", async () => {
    const entry = await mkCoreEntry("purged-skill");
    const link = await linkFromClaude("purged-skill", entry);
    const libraryPath = path.join(home, ".agents", "skills-library", "purged-skill");
    await fs.mkdir(libraryPath, { recursive: true });
    const storePath = path.join(home, ".agents", ".store", "purged-skill");
    await fs.mkdir(storePath, { recursive: true });

    const res = await removeCoreSkill("purged-skill", { mode: "purge" });

    assert.equal(res.ok, true);
    assert.equal(await exists(entry), false);
    assert.equal(await exists(link), false);
    assert.equal(await exists(storePath), false);
    assert.equal(await exists(libraryPath), false);
  });

  it("sweeps a dangling tool link when the core entry is already gone", async () => {
    // Regression: /core lists a skill that survives only as a stale link into
    // the core dir. Remove used to fail with "core 中不存在该技能", so the row
    // stayed and the failure was invisible from the bottom of the list.
    const link = await linkFromClaude(
      "ghost-skill",
      path.join(coreDir, "ghost-skill"),
    );
    assert.equal(await exists(link), true); // dangling on purpose

    const res = await removeCoreSkill("ghost-skill");

    assert.equal(res.ok, true);
    assert.equal(res.coreEntryMissing, true);
    assert.equal(res.unlinked, 1);
    assert.equal(await exists(link), false);
  });

  it("leaves a tool's own copy alone and reports it as residual", async () => {
    const own = path.join(claudeDir, "owned-skill");
    await fs.mkdir(own, { recursive: true });

    const res = await removeCoreSkill("owned-skill");

    assert.equal(res.ok, true);
    assert.equal(res.unlinked, 0);
    assert.equal(res.residualCopies.length, 1);
    assert.ok(await exists(own));
  });

  it("never touches a link that points outside the core set", async () => {
    const library = path.join(home, ".agents", "skills-library", "ai", "kept");
    await fs.mkdir(library, { recursive: true });
    const link = await linkFromClaude("kept", library);

    const res = await removeCoreSkill("kept");

    assert.equal(res.ok, true);
    assert.equal(res.unlinked, 0);
    assert.equal(await exists(link), true);
    assert.ok(await exists(library));
  });

  it("neutralises a traversal-shaped name instead of deleting outside core", async () => {
    const outside = path.join(home, ".agents", "escape");
    await fs.mkdir(outside, { recursive: true });

    const res = await removeCoreSkill("../../escape");

    assert.equal(res.ok, true);
    assert.ok(await exists(outside));
  });
});

describe("removeCoreSkills", () => {
  it("batch removes multiple skills and unlinks them from tools", async () => {
    const entry1 = await mkCoreEntry("batch-skill-1");
    const entry2 = await mkCoreEntry("batch-skill-2");
    const link1 = await linkFromClaude("batch-skill-1", entry1);
    const link2 = await linkFromClaude("batch-skill-2", entry2);

    const res = await removeCoreSkills(["batch-skill-1", "batch-skill-2"], { mode: "detach" });

    assert.equal(res.ok, true);
    assert.deepEqual(res.removed, ["batch-skill-1", "batch-skill-2"]);
    assert.deepEqual(res.failed, []);
    assert.equal(res.unlinked, 2);
    assert.equal(await exists(entry1), false);
    assert.equal(await exists(entry2), false);
    assert.equal(await exists(link1), false);
    assert.equal(await exists(link2), false);
  });
});

describe("resolveCoreSources", () => {
  it("correctly identifies git source and subGroup from store repos", async () => {
    const reposDir = path.join(home, ".agents", ".store", "repos");
    const repoDir = path.join(reposDir, "cursor-plugins");
    const gitDir = path.join(repoDir, ".git");
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(
      path.join(gitDir, "config"),
      `[remote "origin"]\n\turl = https://github.com/cursor/plugins.git\n`,
    );

    const pstackSkillDir = path.join(repoDir, "pstack", "skills", "test-pstack-skill");
    await fs.mkdir(pstackSkillDir, { recursive: true });

    const coreSkillPath = path.join(coreDir, "test-pstack-skill");
    await fs.symlink(pstackSkillDir, coreSkillPath);

    const entries = [
      {
        name: "test-pstack-skill",
        corePath: coreSkillPath,
        realPath: await fs.realpath(coreSkillPath),
      },
    ];

    try {
      const sources = await resolveCoreSources(entries);
      assert.ok(sources["test-pstack-skill"]);
      assert.equal(sources["test-pstack-skill"].type, "git");
      assert.equal(sources["test-pstack-skill"].repoName, "cursor-plugins");
      assert.equal(sources["test-pstack-skill"].repoDisplayName, "cursor/plugins");
      assert.equal(sources["test-pstack-skill"].subGroup, "pstack");
      assert.equal(sources["test-pstack-skill"].label, "cursor/plugins / pstack");
    } finally {
      await fs.unlink(coreSkillPath).catch(() => undefined);
    }
  });
});

describe("fan-out links", () => {
  it("links a tool whose skills dir sits behind a symlinked ancestor", async () => {
    // Regression: zed keeps ~/.config/zed as a symlink, and the fan-out link
    // was derived from the logical path. symlink() succeeded, so nothing
    // reported it — the link just resolved to a nonexistent .agents elsewhere,
    // /core showed every skill as missing, and Sync never converged.
    await mkCoreEntry("zed-visible");

    const first = await applyCoreSync(await planCoreSync({ agentNames: ["zed"] }));

    assert.deepEqual(first.failed, []);
    assert.equal(first.linked, 1);

    const link = path.join(zedLogicalDir, "zed-visible");
    assert.ok(await exists(link));
    // stat() follows the link: the only assertion that catches wrong `..` math.
    const content = await fs
      .readFile(path.join(link, "SKILL.md"), "utf-8")
      .catch(() => null);
    assert.equal(content, "# zed-visible\n");

    const second = await applyCoreSync(await planCoreSync({ agentNames: ["zed"] }));
    assert.equal(second.linked, 0);
    assert.equal(second.alreadyPresent, 1);
  });

  it("guards against false conflicts when agent globalSkillsDir is a symlink to core", async () => {
    // Regression: agents like Antigravity, CodeBuddy, Pi symlink their entire
    // skills directory at ~/.agents/skills. Without the guard, every core entry
    // would be misreported as a same-name conflict instead of being skipped.
    await mkCoreEntry("whole-symlink-skill");

    const agent = agents["codebuddy"];
    const agentDir = path.dirname(agent.globalSkillsDir);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.symlink(CORE_SKILLS_DIR(), agent.globalSkillsDir);

    try {
      const plan = await planCoreSync({ agentNames: ["codebuddy"] });

      assert.ok(plan.items.length > 0);
      assert.equal(plan.items.length, plan.coreCount);
      assert.ok(
        plan.items.every(
          (item) =>
            item.action === "skip-present" &&
            item.reason === "工具目录即 core 目录" &&
            item.agent === "codebuddy",
        ),
      );
      assert.equal(
        plan.items.some((item) => item.action === "link"),
        false,
      );

      // Idempotence: a second planCoreSync over the same state reports zero link items
      const secondPlan = await planCoreSync({ agentNames: ["codebuddy"] });
      assert.equal(
        secondPlan.items.filter((item) => item.action === "link").length,
        0,
      );
      assert.equal(secondPlan.items.length, plan.items.length);
      assert.ok(
        secondPlan.items.every(
          (item) =>
            item.action === "skip-present" &&
            item.reason === "工具目录即 core 目录",
        ),
      );

      // Verify full plan without explicit agentNames (via detectInstalledAgents)
      const fullPlan = await planCoreSync();
      const codebuddyItems = fullPlan.items.filter(
        (item) => item.agent === "codebuddy",
      );
      assert.ok(codebuddyItems.length > 0);
      assert.ok(
        codebuddyItems.every(
          (item) =>
            item.action === "skip-present" &&
            item.reason === "工具目录即 core 目录",
        ),
      );
      assert.equal(
        codebuddyItems.some((item) => item.action === "link"),
        false,
      );
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
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

  it("defaults to link mode when mode is omitted", async () => {
    const externalDir = path.join(home, "default-mode-skill");
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(path.join(externalDir, "SKILL.md"), "# Default Mode Skill\n");

    const res = await installDirToCore(externalDir, "default-mode-skill");

    assert.equal(res.ok, true);
    const target = path.join(coreDir, "default-mode-skill");
    const lst = await fs.lstat(target);
    assert.equal(lst.isSymbolicLink(), true);
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

    const backupDir = path.join(home, ".agents", ".backup");
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

describe("resolveLocalSkill", () => {
  it("resolves skill with frontmatter name", async () => {
    const skillDir = path.join(home, "frontmatter-skill");
    await fs.mkdir(skillDir, { recursive: true });
    const content = "---\nname: Frontmatter Skill\ndescription: Test description\n---\n# Docs\n";
    await fs.writeFile(path.join(skillDir, "SKILL.md"), content);

    const res = await resolveLocalSkill(skillDir);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.name, "frontmatter-skill");
    assert.equal(res.skillDir, skillDir);
  });

  it("falls back to directory name when frontmatter name is missing", async () => {
    const skillDir = path.join(home, "plain-dir-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Plain Markdown\n");

    const res = await resolveLocalSkill(skillDir);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.name, "plain-dir-skill");
    assert.equal(res.skillDir, skillDir);
  });

  it("prefers explicit name over frontmatter name", async () => {
    const skillDir = path.join(home, "named-skill");
    await fs.mkdir(skillDir, { recursive: true });
    const content = "---\nname: original-name\ndescription: Test\n---\n";
    await fs.writeFile(path.join(skillDir, "SKILL.md"), content);

    const res = await resolveLocalSkill(skillDir, "custom-alias");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.name, "custom-alias");
  });

  it("resolves when path points directly to SKILL.md", async () => {
    const skillDir = path.join(home, "direct-file-skill");
    await fs.mkdir(skillDir, { recursive: true });
    const file = path.join(skillDir, "SKILL.md");
    await fs.writeFile(file, "# Direct File\n");

    const res = await resolveLocalSkill(file);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.name, "direct-file-skill");
    assert.equal(res.skillDir, skillDir);
  });

  it("returns error when directory does not exist", async () => {
    const res = await resolveLocalSkill(path.join(home, "does-not-exist"));
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /Directory not found/);
  });

  it("returns error when SKILL.md is missing", async () => {
    const emptyDir = path.join(home, "empty-dir");
    await fs.mkdir(emptyDir, { recursive: true });

    const res = await resolveLocalSkill(emptyDir);
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.match(res.error, /does not contain a SKILL\.md file/);
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

describe("addPathToCore", () => {
  it("adds local skill to core and syncs with detected agents", async () => {
    const localDir = path.join(home, "integration-skill");
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(
      path.join(localDir, "SKILL.md"),
      "---\nname: integration-skill\ndescription: Integration test\n---\n",
    );

    const ok = await addPathToCore(localDir);
    assert.equal(ok, true);

    const target = path.join(coreDir, "integration-skill");
    assert.equal(await exists(target), true);
  });
});

describe("core pruning", () => {
  it("plans pruning for non-core symlinks and real directories while protecting whitelist", async () => {
    // 1. Ensure core entry exists
    await mkCoreEntry("core-alpha");

    // 2. Create Claude skills dir with 1 core link, 1 non-core link, and 1 non-core real dir
    await fs.mkdir(claudeDir, { recursive: true });
    const coreAlphaReal = path.join(coreDir, "core-alpha");
    await fs.symlink(path.relative(claudeDir, coreAlphaReal), path.join(claudeDir, "core-alpha"));

    const externalStoreDir = path.join(home, ".agents", ".store", "extra-symlink");
    await fs.mkdir(externalStoreDir, { recursive: true });
    await fs.symlink(path.relative(claudeDir, externalStoreDir), path.join(claudeDir, "extra-symlink"));

    const realDir = path.join(claudeDir, "custom-real-skill");
    await fs.mkdir(realDir, { recursive: true });
    await fs.writeFile(path.join(realDir, "SKILL.md"), "# Custom\n");

    // 3. Plan pruning for claude-code
    const plan = await planCorePrune({
      agents: [agents["claude-code"]],
      protectedSkills: { "claude-code": ["protected-skill"] },
    });

    const unlinkItem = plan.items.find((i) => i.skill === "extra-symlink");
    assert.ok(unlinkItem);
    assert.equal(unlinkItem.action, "unlink");

    const backupItem = plan.items.find((i) => i.skill === "custom-real-skill");
    assert.ok(backupItem);
    assert.equal(backupItem.action, "backup-and-remove");

    // Core item should NOT be in plan
    const coreItem = plan.items.find((i) => i.skill === "core-alpha");
    assert.equal(coreItem, undefined);
  });

  it("applies prune by unlinking symlinks and moving real directories to backup", async () => {
    const plan = await planCorePrune({
      agents: [agents["claude-code"]],
    });

    const res = await applyCorePrune(plan);
    assert.equal(res.unlinked >= 1, true);
    assert.equal(res.backedUp >= 1, true);
    assert.ok(res.backupDir);

    // Verify extra-symlink is unlinked
    assert.equal(await exists(path.join(claudeDir, "extra-symlink")), false);
    // Verify custom-real-skill was moved
    assert.equal(await exists(path.join(claudeDir, "custom-real-skill")), false);
    // Verify backup exists
    assert.equal(await exists(path.join(res.backupDir!, "claude-code", "custom-real-skill")), true);
    // Verify core skill is still present
    assert.equal(await exists(path.join(claudeDir, "core-alpha")), true);
  });
});


