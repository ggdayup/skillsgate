import path from "node:path"
import fs from "node:fs/promises"
import { execFile } from "node:child_process"
import {
  CANONICAL_SKILLS_DIR,
  STORE_REPOS_DIR,
  BACKUP_DIR,
} from "./skill-paths"
import { movePath } from "./core-skills"
import type { ParsedSource } from "@skillsgate/skill-sources"

export async function realpathOrResolve(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir)
  } catch {
    return path.resolve(dir)
  }
}

export interface GitExecResult {
  success: boolean
  stdout: string
  stderr: string
  error?: string
}

export interface RepoSyncResult {
  status: "updated" | "up-to-date" | "dirty" | "error"
  commit?: string
  error?: string
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p)
    return stat.isDirectory()
  } catch {
    return false
  }
}

const COMMON_BIN_DIRS =
  process.platform === "win32"
    ? [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Git", "cmd"),
        process.env["ProgramFiles(x86)"] &&
          path.join(process.env["ProgramFiles(x86)"], "Git", "cmd"),
      ].filter(Boolean) as string[]
    : [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
      ]

function dedupePathEntries(entries: string[]): string {
  return [...new Set(entries.filter(Boolean))].join(path.delimiter)
}

export function buildCliEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH?.split(path.delimiter) ?? []
  return {
    ...process.env,
    PATH: dedupePathEntries([...currentPath, ...COMMON_BIN_DIRS]),
  }
}

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function gitExec(args: string[], cwd?: string): Promise<GitExecResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 90_000, env: buildCliEnv() }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          success: false,
          stdout: stdout?.toString() || "",
          stderr: stderr?.toString() || "",
          error: stderr?.toString().trim() || err.message,
        })
      } else {
        resolve({
          success: true,
          stdout: stdout?.toString() || "",
          stderr: stderr?.toString() || "",
        })
      }
    })
  })
}

export async function gitClone(
  cloneUrl: string,
  targetDir: string,
  ref?: string,
): Promise<{ success: boolean; error?: string }> {
  const args = ["clone", "--depth", "1"]
  if (ref) {
    if (!/^[a-zA-Z0-9._\/-]+$/.test(ref)) {
      return { success: false, error: `Invalid ref format: "${ref}"` }
    }
    args.push("--branch", ref)
  }
  args.push(cloneUrl, targetDir)
  const res = await gitExec(args)
  return { success: res.success, error: res.error }
}

export async function isGitDirty(repoDir: string): Promise<boolean> {
  const res = await gitExec(["status", "--porcelain"], repoDir)
  if (!res.success) return false
  return res.stdout.trim().length > 0
}

export async function gitPull(
  repoDir: string,
): Promise<{ success: boolean; alreadyUpToDate: boolean; error?: string }> {
  const res = await gitExec(["pull", "--ff-only"], repoDir)
  if (!res.success) {
    return { success: false, alreadyUpToDate: false, error: res.error }
  }
  const isUpToDate = res.stdout.includes("Already up to date") || res.stdout.includes("已经是最新")
  return { success: true, alreadyUpToDate: isUpToDate }
}

export async function getGitCommit(repoDir: string): Promise<string> {
  const res = await gitExec(["rev-parse", "--short", "HEAD"], repoDir)
  return res.success ? res.stdout.trim() : ""
}

export async function ensurePersistentRepo(
  parsed: ParsedSource,
): Promise<{ success: boolean; repoDir: string; error?: string }> {
  if (parsed.type !== "github" || !parsed.owner || !parsed.repo) {
    return { success: false, repoDir: "", error: "Missing owner or repo in GitHub source." }
  }
  const repoName = `${sanitizeName(parsed.owner)}-${sanitizeName(parsed.repo)}`
  const repoDir = path.join(STORE_REPOS_DIR, repoName)
  await fs.mkdir(STORE_REPOS_DIR, { recursive: true })

  const gitDir = path.join(repoDir, ".git")
  if (await dirExists(gitDir)) {
    // Already cloned. If clean, pull to refresh; if dirty, keep as is
    const dirty = await isGitDirty(repoDir)
    if (!dirty) {
      await gitPull(repoDir).catch(() => {})
    }
    return { success: true, repoDir }
  }

  // If directory exists without .git (broken or partial), remove it
  if (await pathExists(repoDir)) {
    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {})
  }

  const cloneUrl = `${parsed.url}.git`
  const cloneRes = await gitClone(cloneUrl, repoDir, parsed.ref)
  if (!cloneRes.success) {
    await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {})
    return { success: false, repoDir, error: cloneRes.error }
  }

  return { success: true, repoDir }
}

export async function createStoreSymlink(repoSkillDir: string, canonicalDir: string): Promise<void> {
  const srcReal = await realpathOrResolve(repoSkillDir)
  const canonicalParent = await realpathOrResolve(path.dirname(canonicalDir))
  const relPath = path.relative(canonicalParent, srcReal)
  const type = process.platform === "win32" ? "junction" : undefined
  try {
    await fs.symlink(relPath, canonicalDir, type)
  } catch {
    await fs.symlink(srcReal, canonicalDir, type)
  }
}

export async function takeoverStaticStoreSkill(skillName: string, repoSkillDir: string): Promise<void> {
  const safeName = sanitizeName(skillName)
  const canonicalDir = path.join(CANONICAL_SKILLS_DIR, safeName)
  try {
    if (await pathExists(canonicalDir)) {
      const lst = await fs.lstat(canonicalDir)
      if (lst.isSymbolicLink()) {
        const realTarget = await realpathOrResolve(canonicalDir)
        const realRepoSkill = await realpathOrResolve(repoSkillDir)
        if (realTarget !== realRepoSkill) {
          await fs.unlink(canonicalDir)
          await createStoreSymlink(repoSkillDir, canonicalDir)
        }
      } else {
        // It's a real directory (old static copy) -> backup and replace with symlink
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const backupPath = path.join(BACKUP_DIR, `store--${safeName}--${stamp}`)
        await fs.mkdir(BACKUP_DIR, { recursive: true })
        await movePath(canonicalDir, backupPath)
        await createStoreSymlink(repoSkillDir, canonicalDir)
      }
    } else {
      await fs.mkdir(CANONICAL_SKILLS_DIR, { recursive: true })
      await createStoreSymlink(repoSkillDir, canonicalDir)
    }
  } catch (err) {
    console.warn(`[store] Failed to takeover static skill ${safeName}:`, err)
  }
}

export async function syncGitRepo(repoDir: string): Promise<RepoSyncResult> {
  const dirty = await isGitDirty(repoDir)
  if (dirty) {
    return {
      status: "dirty",
      error: "本地仓库存在未提交修改（Dirty），已跳过更新以防止覆盖本地改动",
    }
  }

  const pullRes = await gitPull(repoDir)
  if (!pullRes.success) {
    return {
      status: "error",
      error: pullRes.error,
    }
  }

  const commit = await getGitCommit(repoDir)
  return {
    status: pullRes.alreadyUpToDate ? "up-to-date" : "updated",
    commit,
  }
}
