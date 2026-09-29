import { useCallback } from "react"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { exec as execCb } from "node:child_process"
import { promisify } from "node:util"
import { useStore, useDispatch } from "../store/context.js"
import { useDb } from "../db/context.js"
import type { EnrichedSkill, Action } from "../store/types.js"

// CLI core imports -- these share the same Bun runtime
import { parseSource } from "../../../cli/src/core/source-parser.js"
import { cleanupTempDir, fetchTreeSha } from "../../../cli/src/core/git.js"
import { discoverSkills } from "../../../cli/src/core/skill-discovery.js"
import {
  installDirToCore,
  syncCore,
} from "../../../cli/src/core/core-skills.js"
import {
  installSkillForAgent,
  removeSkillFromAgent,
  removeCanonicalSkill,
  sanitizeName,
} from "../../../cli/src/core/installer.js"
import {
  addSkillToLock,
  removeSkillFromLock,
} from "../../../cli/src/core/skill-lock.js"
import { agents, detectInstalledAgents } from "../../../cli/src/core/agents.js"
import type { Skill, AgentConfig } from "../../../cli/src/types.js"

export interface InstallLocalPathOptions {
  targetType?: "core" | "agents"
  selectedAgents?: string[]
  mode?: "symlink" | "copy"
}

export interface InstallLocalPathResult {
  success: boolean
  error?: string
  skillNames?: string[]
}

export interface PathValidationResult {
  valid: boolean
  resolvedPath: string
  skills: Skill[]
  error?: string
}

export async function validateLocalSkillPath(
  inputPath: string,
): Promise<PathValidationResult> {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    return { valid: false, resolvedPath: "", skills: [], error: "Path cannot be empty" }
  }

  let expanded = trimmed
  if (expanded === "~" || expanded.startsWith("~/")) {
    expanded = path.join(os.homedir(), expanded.slice(1))
  }
  const resolved = path.resolve(expanded)

  try {
    const stat = await fs.stat(resolved)
    let dir = resolved
    if (!stat.isDirectory()) {
      if (path.basename(resolved).toLowerCase() === "skill.md") {
        dir = path.dirname(resolved)
      } else {
        return { valid: false, resolvedPath: resolved, skills: [], error: "Path is not a directory" }
      }
    }

    const skills = await discoverSkills(dir)
    if (skills.length === 0) {
      let directExists = false
      try {
        await fs.access(path.join(dir, "SKILL.md"))
        directExists = true
      } catch {
        directExists = false
      }
      if (!directExists) {
        return { valid: false, resolvedPath: dir, skills: [], error: "No SKILL.md found in directory" }
      }
    }

    return { valid: true, resolvedPath: dir, skills }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return { valid: false, resolvedPath: resolved, skills: [], error: "Directory does not exist" }
    }
    return {
      valid: false,
      resolvedPath: resolved,
      skills: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

interface UseSkillActionsResult {
  installSkill: (skill: EnrichedSkill) => Promise<void>
  removeSkill: (skill: EnrichedSkill) => Promise<void>
  removeSkillFromOneAgent: (skill: EnrichedSkill, agentName: string) => Promise<void>
  updateSkill: (skill: EnrichedSkill) => Promise<void>
  installFromLocalPath: (
    localPath: string,
    options?: InstallLocalPathOptions,
  ) => Promise<InstallLocalPathResult>
}

/**
 * Provides install, remove, and update actions for skills.
 * Uses CLI core modules directly since they share the same Bun runtime.
 */
export function useSkillActions(): UseSkillActionsResult {
  const state = useStore()
  const dispatch = useDispatch()
  const { settings } = useDb()

  /**
   * Install a skill from its source.
   * For public skills (with a source in owner/repo format), runs `npx skills add`.
   */
  const installSkill = useCallback(async (skill: EnrichedSkill) => {
    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: { type: "info", message: `Installing "${skill.name}"...` },
    })

    try {
      // Determine the source from metadata or lock entry
      const sourceStr = resolveSource(skill)
      if (!sourceStr) {
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: { type: "error", message: `Cannot determine source for "${skill.name}"` },
        })
        return
      }

      const source = parseSource(sourceStr)

      // Public skills (owner/repo format): use `npx skills add`
      if (source.type === "github" || isOwnerRepoFormat(sourceStr)) {
        const repo = source.type === "github"
          ? `${source.owner}/${source.repo}`
          : sourceStr
        await runSkillsAdd(repo, dispatch)
        return
      }

      const installedAgents = await detectInstalledAgents()
      if (installedAgents.length === 0) {
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: { type: "error", message: "No AI agents detected on this system" },
        })
        return
      }

      const defaultAgents = settings.get<string[]>("install.defaultAgents", [])
      const mirrorAgents = settings.get<string[]>("sync.mirrorAgents", [])
      const preferredNames =
        defaultAgents.length > 0
          ? Array.from(new Set([...defaultAgents, ...mirrorAgents]))
          : Array.from(
              new Set([
                ...installedAgents.map((agent) => agent.name),
                ...mirrorAgents,
              ]),
            )
      const targetAgents = installedAgents.filter((agent) =>
        preferredNames.includes(agent.name),
      )

      // Local path source uses resolved path directly
      const tmpDir = source.localPath!

      try {
        // Discover skills in the downloaded directory
        const skills = await discoverSkills(tmpDir, source.subpath)

        if (skills.length === 0) {
          dispatch({
            type: "SHOW_NOTIFICATION",
            notification: { type: "error", message: `No skills found in "${sourceStr}"` },
          })
          return
        }

        // Filter if a specific skill was requested
        let targetSkills = skills
        if (source.skillFilter) {
          const filter = source.skillFilter.toLowerCase()
          targetSkills = skills.filter((s) => s.name.toLowerCase() === filter)
          if (targetSkills.length === 0) {
            dispatch({
              type: "SHOW_NOTIFICATION",
              notification: { type: "error", message: `Skill "${source.skillFilter}" not found in "${sourceStr}"` },
            })
            return
          }
        }

        let installedCount = 0

        for (const skillToInstall of targetSkills) {
          // Install to all detected agents
          for (const agent of targetAgents) {
            const result = await installSkillForAgent(
              skillToInstall,
              agent,
              "global",
              "symlink",
            )
            if (result.success) {
              installedCount++
            }
          }

          // Update lock file
          await addSkillToLock(sanitizeName(skillToInstall.name), {
            source: sourceStr,
            sourceType: source.type,
            originalUrl: source.url,
            skillFolderHash: "",
          })
        }

        // Trigger refresh
        dispatch({ type: "REFRESH_SKILLS" })

        const skillNames = targetSkills.map((s) => s.name).join(", ")
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: {
            type: "success",
            message: `Installed ${targetSkills.length} skill(s): ${skillNames} to ${targetAgents.length} agent(s)`,
          },
        })
      } finally {
        // Clean up temp directory (only if it was a temp clone/download)
        if (source.type !== "local") {
          await cleanupTempDir(tmpDir)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `Install failed: ${msg}` },
      })
    }
  }, [dispatch])

  /**
   * Remove a skill from all agents and the lock file.
   */
  const removeSkill = useCallback(async (skill: EnrichedSkill) => {
    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: { type: "info", message: `Removing "${skill.name}"...` },
    })

    try {
      const safeName = sanitizeName(skill.name)

      // Remove from all agent directories
      const installedAgents = await detectInstalledAgents()
      for (const agent of installedAgents) {
        await removeSkillFromAgent(safeName, agent, "global")
      }

      // Remove canonical copy
      await removeCanonicalSkill(skill.name)

      // Remove from lock file
      await removeSkillFromLock(safeName)

      // Trigger refresh
      dispatch({ type: "REFRESH_SKILLS" })

      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "success", message: `Removed "${skill.name}"` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `Remove failed: ${msg}` },
      })
    }
  }, [dispatch])

  /**
   * Remove a skill from a single agent only (delete its symlink).
   * If this was the last agent, also removes the canonical copy and lock entry.
   */
  const removeSkillFromOneAgent = useCallback(async (skill: EnrichedSkill, agentName: string) => {
    const agent = agents[agentName]
    if (!agent) {
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `Unknown agent: ${agentName}` },
      })
      return
    }

    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: { type: "info", message: `Removing "${skill.name}" from ${agent.displayName}...` },
    })

    try {
      const safeName = sanitizeName(skill.name)
      await removeSkillFromAgent(safeName, agent, "global")

      // If this was the last agent, also remove canonical + lock
      const remainingAgents = skill.agents.filter(a => a !== agentName)
      if (remainingAgents.length === 0) {
        await removeCanonicalSkill(skill.name)
        await removeSkillFromLock(safeName)
      }

      dispatch({ type: "REFRESH_SKILLS" })
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: {
          type: "success",
          message: remainingAgents.length > 0
            ? `Removed "${skill.name}" from ${agent.displayName}`
            : `Removed "${skill.name}" completely`,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `Remove failed: ${msg}` },
      })
    }
  }, [dispatch])

  /**
   * Update a skill by re-fetching from its source.
   * For GitHub skills: checks tree SHA for changes before re-installing.
   */
  const updateSkill = useCallback(async (skill: EnrichedSkill) => {
    if (!skill.lock) {
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `No source information for "${skill.name}"` },
      })
      return
    }

    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: { type: "info", message: `Checking for updates to "${skill.name}"...` },
    })

    try {
      const source = parseSource(skill.lock.source)

      if (source.type === "github") {
        // Check if the tree SHA has changed
        const newSha = await fetchTreeSha(source.owner, source.repo, "")
        if (newSha && newSha === skill.lock.skillFolderHash) {
          dispatch({
            type: "SHOW_NOTIFICATION",
            notification: { type: "info", message: `"${skill.name}" is already up to date` },
          })
          return
        }
      }

      // Re-install (reuses the install flow)
      await installSkill(skill)

      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "success", message: `Updated "${skill.name}"` },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({
        type: "SHOW_NOTIFICATION",
        notification: { type: "error", message: `Update failed: ${msg}` },
      })
    }
  }, [dispatch, installSkill])

  const installFromLocalPath = useCallback(
    async (
      localPath: string,
      options: InstallLocalPathOptions = {},
    ): Promise<InstallLocalPathResult> => {
      const validation = await validateLocalSkillPath(localPath)
      if (!validation.valid || validation.skills.length === 0) {
        const error = validation.error ?? "Invalid skill path"
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: { type: "error", message: `Install failed: ${error}` },
        })
        return { success: false, error }
      }

      const targetType = options.targetType ?? "core"
      const mode = options.mode ?? "symlink"
      const skills = validation.skills
      const resolvedDir = validation.resolvedPath

      try {
        if (targetType === "core") {
          for (const skill of skills) {
            const skillDir = skill.filePath ? path.dirname(skill.filePath) : resolvedDir
            const res = await installDirToCore(skillDir, skill.name, {
              mode: mode === "copy" ? "copy" : "link",
              replace: true,
            })
            if (!res.ok) {
              const err = res.error ?? `Failed to install "${skill.name}" to core`
              dispatch({
                type: "SHOW_NOTIFICATION",
                notification: { type: "error", message: `Core install failed: ${err}` },
              })
              return { success: false, error: err }
            }
            await addSkillToLock(sanitizeName(skill.name), {
              source: resolvedDir,
              sourceType: "local",
              originalUrl: resolvedDir,
              skillFolderHash: "",
            })
          }
          await syncCore()
        } else {
          const installedAgents = await detectInstalledAgents()
          const preferredAgents = options.selectedAgents && options.selectedAgents.length > 0
            ? installedAgents.filter((a) => options.selectedAgents!.includes(a.name))
            : installedAgents

          if (preferredAgents.length === 0) {
            const err = "No target agents selected or detected"
            dispatch({
              type: "SHOW_NOTIFICATION",
              notification: { type: "error", message: err },
            })
            return { success: false, error: err }
          }

          for (const skill of skills) {
            for (const agent of preferredAgents) {
              await installSkillForAgent(skill, agent, "global", mode)
            }
            await addSkillToLock(sanitizeName(skill.name), {
              source: resolvedDir,
              sourceType: "local",
              originalUrl: resolvedDir,
              skillFolderHash: "",
            })
          }
        }

        dispatch({ type: "REFRESH_SKILLS" })
        const names = skills.map((s) => s.name)
        const summary = names.join(", ")
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: {
            type: "success",
            message: `Installed ${names.length} skill(s): ${summary} (${targetType})`,
          },
        })
        return { success: true, skillNames: names }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({
          type: "SHOW_NOTIFICATION",
          notification: { type: "error", message: `Install failed: ${msg}` },
        })
        return { success: false, error: msg }
      }
    },
    [dispatch],
  )

  return {
    installSkill,
    removeSkill,
    removeSkillFromOneAgent,
    updateSkill,
    installFromLocalPath,
  }
}

// ---------- Helpers ----------

const execAsync = promisify(execCb)

/**
 * Checks if a string matches the owner/repo format (e.g. "vercel/skills").
 */
function isOwnerRepoFormat(str: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(str)
}

/**
 * Runs `npx skills add <source> --all -y` as a child process to install
 * all skills from a public repository.
 */
async function runSkillsAdd(
  source: string,
  dispatch: (action: Action) => void
): Promise<void> {
  try {
    await execAsync(
      `npx skills add ${source} --all -y`,
      { timeout: 60_000 }
    )

    dispatch({ type: "REFRESH_SKILLS" })
    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: {
        type: "success",
        message: `Installed skills from ${source}`,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    dispatch({
      type: "SHOW_NOTIFICATION",
      notification: { type: "error", message: `Install failed: ${msg}` },
    })
  }
}

/**
 * Resolves the source string for a skill from its metadata.
 * Checks: lock.source, metadata.source, metadata.githubUrl, metadata.installCommand
 */
function resolveSource(skill: EnrichedSkill): string | null {
  // From lock file entry
  if (skill.lock?.source) {
    return skill.lock.source
  }

  // From metadata (catalog skills -- owner/repo format)
  const meta = skill.metadata
  if (meta?.source && typeof meta.source === "string") {
    return meta.source
  }

  if (meta?.githubUrl && typeof meta.githubUrl === "string") {
    return meta.githubUrl
  }

  // From install command (e.g. "skills add <source>")
  if (meta?.installCommand && typeof meta.installCommand === "string") {
    const cmd = meta.installCommand as string
    const match = cmd.match(/skills?\s+(?:add|install)\s+(.+)/)
    if (match) {
      return match[1].trim()
    }
  }

  return null
}
