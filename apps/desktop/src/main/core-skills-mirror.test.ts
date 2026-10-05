import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const CLI_CORE_PATH = path.resolve(
  currentDir,
  "../../../../packages/cli/src/core/core-skills.ts"
);
const DESKTOP_CORE_PATH = path.resolve(currentDir, "./core-skills.ts");

const SHARED_FUNCTIONS = [
  "applyCorePrune",
  "applyCoreSync",
  "emptyCoreConfig",
  "findDanglingCoreEntries",
  "formatRepoDisplayName",
  "getCoreStatus",
  "installDirToCore",
  "isExcluded",
  "listCoreEntries",
  "parseGitOriginUrl",
  "planCorePrune",
  "planCoreSync",
  "promoteToCore",
  "readCoreConfig",
  "removeCoreSkill",
  "removeCoreSkills",
  "replaceConflictWithCoreLink",
  "resolveCoreSources",
  "setExclusion",
  "syncCore",
  "writeCoreConfig",
] as const;

const SHARED_CONSTANTS = ["DEFAULT_PROTECTED_SKILLS"] as const;

const CLI_ONLY_EXPORTS = new Set([
  "installSkillToCore",
  "listCoreSkillNames",
  "pruneAndSyncCore",
  "resolveLocalSkill",
]);

const DESKTOP_ONLY_EXPORTS = new Set([
  "BACKUP_DIR",
  "CANONICAL_SKILLS_DIR",
  "CORE_SKILLS_DIR",
  "SKILL_ROOTS",
  "batchAddToCore",
  "getCoreSummary",
  "movePath",
  "sanitizeName",
]);

async function loadModules() {
  const cli = await import(CLI_CORE_PATH);
  const desktopMod = await import(DESKTOP_CORE_PATH);
  const desktop = (desktopMod as Record<string, any>).default ?? desktopMod;
  return { cli, desktop };
}

describe("core-skills mirror consistency", () => {
  it("exports all shared core sync engine functions and constants in both modules", async () => {
    const { cli, desktop } = await loadModules();

    for (const name of SHARED_FUNCTIONS) {
      assert.equal(
        typeof (cli as Record<string, any>)[name],
        "function",
        `CLI core-skills must export function ${name}`
      );
      assert.equal(
        typeof (desktop as Record<string, any>)[name],
        "function",
        `Desktop core-skills must export function ${name}`
      );
    }

    for (const name of SHARED_CONSTANTS) {
      assert.ok(
        (cli as Record<string, any>)[name] !== undefined,
        `CLI core-skills must export constant ${name}`
      );
      assert.ok(
        (desktop as Record<string, any>)[name] !== undefined,
        `Desktop core-skills must export constant ${name}`
      );
    }
  });

  it("permits only documented deliberate divergences between CLI and Desktop exports", async () => {
    const { cli, desktop } = await loadModules();

    const cliExports = Object.keys(cli);
    const desktopExports = Object.keys(desktop);

    const sharedSet = new Set<string>([...SHARED_FUNCTIONS, ...SHARED_CONSTANTS]);

    const unexpectedCliExports = cliExports.filter(
      (k) => !sharedSet.has(k) && !CLI_ONLY_EXPORTS.has(k)
    );
    assert.deepEqual(
      unexpectedCliExports,
      [],
      `Unexpected CLI export detected. If intentional, mirror it to Desktop or add to CLI_ONLY_EXPORTS allowlist.`
    );

    const unexpectedDesktopExports = desktopExports.filter(
      (k) => !sharedSet.has(k) && !DESKTOP_ONLY_EXPORTS.has(k)
    );
    assert.deepEqual(
      unexpectedDesktopExports,
      [],
      `Unexpected Desktop export detected. If intentional, mirror it to CLI or add to DESKTOP_ONLY_EXPORTS allowlist.`
    );
  });

  it("guarantees identical behavior for pure utility functions across implementations", async () => {
    const { cli, desktop } = await loadModules();

    const testCases: [string, string][] = [
      ["https://github.com/foo/bar.git", "bar"],
      ["git@github.com:foo/bar.git", "bar"],
      ["https://gitlab.com/group/sub/repo.git", "repo"],
      ["", "local-repo"],
    ];
    for (const [url, name] of testCases) {
      const cliResult = cli.formatRepoDisplayName(url, name);
      const desktopResult = desktop.formatRepoDisplayName(url, name);
      assert.equal(
        cliResult,
        desktopResult,
        `formatRepoDisplayName diverged for ${url}, ${name}`
      );
    }

    const gitConfigSample = [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "origin"]',
      '\turl = git@github.com:anthropics/skills.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    ].join('\n');
    assert.equal(
      cli.parseGitOriginUrl(gitConfigSample),
      desktop.parseGitOriginUrl(gitConfigSample),
      "parseGitOriginUrl diverged for valid git config"
    );
    assert.equal(
      cli.parseGitOriginUrl("no remote origin here"),
      desktop.parseGitOriginUrl("no remote origin here"),
      "parseGitOriginUrl diverged for empty config"
    );

    assert.deepEqual(
      cli.emptyCoreConfig(),
      desktop.emptyCoreConfig(),
      "emptyCoreConfig initial object structure must match"
    );

    const sampleConfig = {
      version: 1 as const,
      exclusions: {
        claude: ["excluded-skill"],
      },
    };
    assert.equal(
      cli.isExcluded(sampleConfig, "claude", "excluded-skill"),
      desktop.isExcluded(sampleConfig, "claude", "excluded-skill")
    );
    assert.equal(
      cli.isExcluded(sampleConfig, "claude", "other-skill"),
      desktop.isExcluded(sampleConfig, "claude", "other-skill")
    );
    assert.equal(
      cli.isExcluded(sampleConfig, "cursor", "excluded-skill"),
      desktop.isExcluded(sampleConfig, "cursor", "excluded-skill")
    );

    assert.deepEqual(
      cli.DEFAULT_PROTECTED_SKILLS,
      desktop.DEFAULT_PROTECTED_SKILLS,
      "DEFAULT_PROTECTED_SKILLS dictionary must match"
    );
  });
});
