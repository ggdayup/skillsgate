import { test, describe, it } from "node:test"
import assert from "node:assert"
import fs from "node:fs/promises"
import path from "node:path"
import {
  determineInstallRoute,
  resolveSource,
  executeInstallSkill,
} from "./use-skill-actions.js"
import type { EnrichedSkill, Action } from "../store/types.js"
import type { AgentConfig, Skill } from "../../../cli/src/types.js"

const NPX_CMD = ["npx", "skills", "add"].join(" ")

function getNotificationMessage(
  actions: Action[],
  type: "error" | "success" | "info",
): string | undefined {
  for (const action of actions) {
    if (action.type === "SHOW_NOTIFICATION" && action.notification.type === type) {
      return action.notification.message
    }
  }
  return undefined
}

describe("resolveSource", () => {
  it("extracts source from lock originalUrl", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {},
      lock: {
        source: "github:owner/repo",
        sourceType: "github",
        originalUrl: "https://github.com/owner/repo",
        skillFolderHash: "abc",
        installedAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    }
    assert.strictEqual(resolveSource(skill), "https://github.com/owner/repo")
  })

  it("extracts source from lock source and strips github prefix", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {},
      lock: {
        source: "github:owner/repo",
        sourceType: "github",
        originalUrl: "",
        skillFolderHash: "abc",
        installedAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    }
    assert.strictEqual(resolveSource(skill), "owner/repo")
  })

  it("extracts source from metadata installCommand", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        installCommand: `${NPX_CMD} humanlayer/skills --skill show-me`,
      },
    }
    assert.strictEqual(
      resolveSource(skill),
      `${NPX_CMD} humanlayer/skills --skill show-me`,
    )
  })

  it("extracts source from metadata source", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "vercel/skills",
      },
    }
    assert.strictEqual(resolveSource(skill), "vercel/skills")
  })

  it("extracts source from metadata githubUrl", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        githubUrl: "https://github.com/owner/repo",
      },
    }
    assert.strictEqual(resolveSource(skill), "https://github.com/owner/repo")
  })

  it("returns null when no source information is present", () => {
    const skill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {},
    }
    assert.strictEqual(resolveSource(skill), null)
  })
})

describe("determineInstallRoute", () => {
  it("routes bare GitHub owner/repo to github installer", () => {
    const route = determineInstallRoute("humanlayer/skills")
    assert.strictEqual(route.type, "github")
    if (route.type === "github") {
      assert.strictEqual(route.parsed.source.owner, "humanlayer")
      assert.strictEqual(route.parsed.source.repo, "skills")
      assert.deepStrictEqual(route.parsed.skillFilter, [])
    }
  })

  it("routes GitHub owner/repo with filter to github installer", () => {
    const route = determineInstallRoute("humanlayer/skills@show-me")
    assert.strictEqual(route.type, "github")
    if (route.type === "github") {
      assert.strictEqual(route.parsed.source.owner, "humanlayer")
      assert.strictEqual(route.parsed.source.repo, "skills")
      assert.deepStrictEqual(route.parsed.skillFilter, ["show-me"])
    }
  })

  it("routes full GitHub URL to github installer", () => {
    const route = determineInstallRoute("https://github.com/vercel/skills")
    assert.strictEqual(route.type, "github")
    if (route.type === "github") {
      assert.strictEqual(route.parsed.source.owner, "vercel")
      assert.strictEqual(route.parsed.source.repo, "skills")
    }
  })

  it("routes pasted install command to github installer without executing", () => {
    const route = determineInstallRoute(
      `${NPX_CMD} humanlayer/skills --skill show-me`,
    )
    assert.strictEqual(route.type, "github")
    if (route.type === "github") {
      assert.strictEqual(route.parsed.source.owner, "humanlayer")
      assert.strictEqual(route.parsed.source.repo, "skills")
      assert.deepStrictEqual(route.parsed.skillFilter, ["show-me"])
      assert.strictEqual(route.parsed.wasCommand, true)
    }
  })

  it("routes pasted bunx skills add command to github installer", () => {
    const route = determineInstallRoute("bunx skills add anthropics/skills")
    assert.strictEqual(route.type, "github")
    if (route.type === "github") {
      assert.strictEqual(route.parsed.source.owner, "anthropics")
      assert.strictEqual(route.parsed.source.repo, "skills")
    }
  })

  it("routes local relative and home paths to local installer", () => {
    const relRoute = determineInstallRoute("./my-skills")
    assert.strictEqual(relRoute.type, "local")

    const homeRoute = determineInstallRoute("~/skills")
    assert.strictEqual(homeRoute.type, "local")
  })

  it("rejects unsupported GitLab source with readable reason", () => {
    const route = determineInstallRoute("gitlab:owner/repo")
    assert.strictEqual(route.type, "unsupported")
    if (route.type === "unsupported") {
      assert.match(route.error, /GitLab sources are not supported yet/i)
    }
  })

  it("rejects unsupported archive downloads with readable reason", () => {
    const route = determineInstallRoute("https://example.com/skill.tar.gz")
    assert.strictEqual(route.type, "unsupported")
    if (route.type === "unsupported") {
      assert.match(route.error, /Archive and direct-download/i)
    }
  })

  it("rejects empty source string", () => {
    const route = determineInstallRoute("   ")
    assert.strictEqual(route.type, "unsupported")
    if (route.type === "unsupported") {
      assert.strictEqual(route.error, "Source cannot be empty")
    }
  })
})

describe("executeInstallSkill", () => {
  const fakeAgent: AgentConfig = {
    name: "claude-code",
    displayName: "Claude Code",
    skillsDir: ".claude/skills",
    globalSkillsDir: "/mock/claude/skills",
    detectInstalled: async () => true,
  }

  const fakeSkill: Skill = {
    name: "show-me",
    description: "Show me skill",
    content: "# show-me",
    filePath: "/mock/tmp/show-me/SKILL.md",
  }

  it("installs GitHub source through shared installer and records lock provenance", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    let cloned = false
    let cleaned = false
    const installedAgents: string[] = []
    const lockedSkills: Array<{ name: string; entry: any }> = []

    const enrichedSkill: EnrichedSkill = {
      name: "show-me",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "humanlayer/skills",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async (source) => {
        cloned = true
        assert.strictEqual(source.owner, "humanlayer")
        assert.strictEqual(source.repo, "skills")
        return "/mock/tmp/humanlayer-skills"
      },
      cleanupTempDir: async (dir) => {
        cleaned = true
        assert.strictEqual(dir, "/mock/tmp/humanlayer-skills")
      },
      discoverSkills: async () => [fakeSkill],
      installSkillForAgent: async (skill, agent) => {
        installedAgents.push(agent.name)
        return { success: true }
      },
      fetchTreeSha: async () => "sha-12345",
      addSkillToLock: async (name, entry) => {
        lockedSkills.push({ name, entry })
      },
      defaultAgents: ["claude-code"],
    })

    assert.strictEqual(cloned, true)
    assert.strictEqual(cleaned, true)
    assert.deepStrictEqual(installedAgents, ["claude-code"])
    assert.strictEqual(lockedSkills.length, 1)
    assert.strictEqual(lockedSkills[0]!.name, "show-me")
    assert.strictEqual(lockedSkills[0]!.entry.source, "github:humanlayer/skills")
    assert.strictEqual(lockedSkills[0]!.entry.skillFolderHash, "sha-12345")

    const successMsg = getNotificationMessage(actions, "success")
    assert.ok(successMsg)
    assert.match(
      successMsg,
      /Installed 1 skill\(s\): show-me to 1 agent\(s\)/,
    )

    const refreshAction = actions.find((a) => a.type === "REFRESH_SKILLS")
    assert.ok(refreshAction)
  })

  it("installs pasted command with skill filter through shared installer", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const otherSkill: Skill = {
      name: "other-skill",
      description: "Other",
      content: "# other",
      filePath: "/mock/tmp/other-skill/SKILL.md",
    }

    const installedSkills: string[] = []

    const enrichedSkill: EnrichedSkill = {
      name: "show-me",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        installCommand: `${NPX_CMD} humanlayer/skills --skill show-me`,
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async () => "/mock/tmp/humanlayer-skills",
      cleanupTempDir: async () => {},
      discoverSkills: async () => [fakeSkill, otherSkill],
      installSkillForAgent: async (skill) => {
        installedSkills.push(skill.name)
        return { success: true }
      },
      fetchTreeSha: async () => "sha-1",
      addSkillToLock: async () => {},
      defaultAgents: ["claude-code"],
    })

    assert.deepStrictEqual(installedSkills, ["show-me"])
  })

  it("surfaces readable error notification when source cannot be resolved", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "mystery-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {},
    }

    await executeInstallSkill(enrichedSkill, dispatch)

    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      'Cannot determine source for "mystery-skill"',
    )
  })

  it("surfaces readable error notification for unsupported source", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "gitlab-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "gitlab:owner/repo",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch)

    const errorMsg = getNotificationMessage(actions, "error")
    assert.ok(errorMsg)
    assert.match(
      errorMsg,
      /GitLab sources are not supported yet/i,
    )
  })

  it("surfaces readable error notification when no agents detected", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "test-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "owner/repo",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [],
    })

    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      "No AI agents detected on this system",
    )
  })

  it("surfaces readable error notification when discovery finds no skills", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "empty-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "owner/repo",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async () => "/mock/tmp/empty",
      cleanupTempDir: async () => {},
      discoverSkills: async () => [],
      defaultAgents: ["claude-code"],
    })

    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      'No skills found in "owner/repo"',
    )
  })

  it("surfaces readable error notification when requested skill filter does not match", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "missing-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "owner/repo@nonexistent",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async () => "/mock/tmp/repo",
      cleanupTempDir: async () => {},
      discoverSkills: async () => [fakeSkill],
      defaultAgents: ["claude-code"],
    })

    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      'Skill "nonexistent" not found in "owner/repo@nonexistent"',
    )
  })

  it("surfaces readable error notification when agent installation fails and avoids partial lock", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)
    let lockCalled = false

    const enrichedSkill: EnrichedSkill = {
      name: "failing-skill",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "owner/repo",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async () => "/mock/tmp/repo",
      cleanupTempDir: async () => {},
      discoverSkills: async () => [fakeSkill],
      installSkillForAgent: async () => ({
        success: false,
        error: "Permission denied writing symlink",
      }),
      addSkillToLock: async () => {
        lockCalled = true
      },
      defaultAgents: ["claude-code"],
    })

    assert.strictEqual(lockCalled, false)
    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      "Install failed: Permission denied writing symlink",
    )
  })

  it("surfaces readable error notification when cloneRepo throws", async () => {
    const actions: Action[] = []
    const dispatch = (action: Action) => actions.push(action)

    const enrichedSkill: EnrichedSkill = {
      name: "network-fail",
      description: "",
      filePath: "",
      canonicalPath: "",
      agents: [],
      scope: "custom",
      projectName: null,
      hasSupportingFiles: false,
      supportingFiles: [],
      metadata: {
        source: "owner/repo",
      },
    }

    await executeInstallSkill(enrichedSkill, dispatch, {
      detectAgents: async () => [fakeAgent],
      cloneRepo: async () => {
        throw new Error("Repository not found or network offline")
      },
      defaultAgents: ["claude-code"],
    })

    const errorMsg = getNotificationMessage(actions, "error")
    assert.strictEqual(
      errorMsg,
      "Install failed: Repository not found or network offline",
    )
  })
})

describe("Invariant: no shell child processes in TUI", () => {
  it("ensures no npx child_process exec in use-skill-actions.ts", async () => {
    const filePath = path.resolve(
      import.meta.dirname,
      "use-skill-actions.ts",
    )
    const content = await fs.readFile(filePath, "utf-8")

    assert.strictEqual(content.includes(NPX_CMD), false)
    assert.strictEqual(content.includes("child_process"), false)
    assert.strictEqual(content.includes("execAsync"), false)
  })
})
