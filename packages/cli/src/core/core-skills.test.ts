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

const { planCoreSync, applyCoreSync, removeCoreSkill } = await import(
  "./core-skills.js"
);

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
});
