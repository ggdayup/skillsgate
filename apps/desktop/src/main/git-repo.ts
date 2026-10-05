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

export const COMMON_BIN_DIRS =
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
    PATH: dedupePathEntries([...COMMON_BIN_DIRS, ...currentPath]),
    GIT_TERMINAL_PROMPT: "0",
  }
}

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function extractGitErrorMessage(
  err: (Error & { killed?: boolean; signal?: NodeJS.Signals | string; code?: string | number | null }) | null,
  stderr: string,
  stdout = "",
): string {
  if (err?.killed || err?.signal === "SIGTERM" || err?.code === "ETIMEDOUT") {
    return "Git 操作超时（请检查网络连接或 GitHub 访问情况，稍后重试）"
  }

  const rawStderr = stderr.trim()
  if (!rawStderr) {
    return err?.message || stdout.trim() || "未知 Git 执行错误"
  }

  const lines = rawStderr.split("\n").map((l) => l.trim()).filter(Boolean)
  const meaningfulLines = lines.filter((line) => {
    if (/^Cloning into\s+/i.test(line)) return false
    if (/^Receiving objects:\s+/i.test(line)) return false
    if (/^Resolving deltas:\s+/i.test(line)) return false
    if (/^Updating files:\s+/i.test(line)) return false
    if (/^remote:\s+(Enumerating|Counting|Compressing|Total)\b/i.test(line)) return false
    return true
  })

  if (meaningfulLines.length > 0) {
    return meaningfulLines.join("\n")
  }

  return err?.message || rawStderr
}

export function gitExec(
  args: string[],
  cwd?: string,
  timeoutMs = 90_000,
): Promise<GitExecResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: timeoutMs, env: buildCliEnv() }, (err, stdout, stderr) => {
      const outStr = stdout?.toString() || ""
      const errStr = stderr?.toString() || ""
      if (err) {
        resolve({
          success: false,
          stdout: outStr,
          stderr: errStr,
          error: extractGitErrorMessage(err, errStr, outStr),
        })
      } else {
        resolve({
          success: true,
          stdout: outStr,
          stderr: errStr,
        })
      }
    })
  })
}

export async function gitClone(
  cloneUrl: string,
  targetDir: string,
  ref?: string,
  timeoutMs = 180_000,
): Promise<{ success: boolean; error?: string }> {
  const args = ["clone", "--depth", "1"]
  if (ref) {
    if (!/^[a-zA-Z0-9._\/-]+$/.test(ref)) {
      return { success: false, error: `Invalid ref format: "${ref}"` }
    }
    args.push("--branch", ref)
  }
  args.push(cloneUrl, targetDir)
  const res = await gitExec(args, undefined, timeoutMs)
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

export interface GitCommitInfo {
  hash: string
  message: string
  date: string
  author: string
}

export async function getGitOriginUrl(repoDir: string): Promise<string> {
  const res = await gitExec(["remote", "get-url", "origin"], repoDir)
  return res.success ? res.stdout.trim() : ""
}

export async function getGitBranch(repoDir: string): Promise<string> {
  const res = await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], repoDir)
  return res.success ? res.stdout.trim() : ""
}

export async function getGitLatestLog(repoDir: string): Promise<GitCommitInfo | null> {
  const res = await gitExec(
    ["log", "-1", "--format=%h%x1f%s%x1f%cd%x1f%an", "--date=short"],
    repoDir,
  )
  if (!res.success || !res.stdout.trim()) return null
  const [hash = "", message = "", date = "", author = ""] = res.stdout.trim().split("\x1f")
  return { hash, message, date, author }
}

export function getRepoDisplayName(originUrl: string, repoName: string): string {
  if (originUrl) {
    const clean = originUrl.replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "")
    if (clean.includes("/")) return clean
  }
  if (repoName.includes("-")) {
    const parts = repoName.split("-")
    if (parts.length >= 2) {
      return `${parts[0]}/${parts.slice(1).join("-")}`
    }
  }
  return repoName
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

// ---------------------------------------------------------------------------
// Remote update discovery (read-only: never writes to the working tree)
// ---------------------------------------------------------------------------

export type GitUpdateStatus = "up-to-date" | "update-available" | "unknown"

export interface GitUpdateCheck {
  status: GitUpdateStatus
  /** Full local HEAD SHA, when it could be read. */
  local?: string
  /** Full remote HEAD SHA, when it could be read. */
  remote?: string
  /** Why the check is unknown. Never shown as up-to-date on failure. */
  error?: string
}

/** One network round trip per repo; failures degrade to unknown, never block. */
export const UPDATE_CHECK_TIMEOUT_MS = 15_000

/** Automatic re-check interval. Fixed at 24h by product decision. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface UpdateCheckWindow {
  startHour: number
  endHour: number
}

/**
 * Parse `git ls-remote origin HEAD` output into a remote SHA.
 * Pure function so the parsing (vs the network) is unit-testable.
 */
export function parseLsRemoteHead(stdout: string): string | null {
  const firstLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!firstLine) return null
  const sha = firstLine.split(/\s+/)[0] ?? ""
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : null
}

/** Read the remote HEAD SHA without touching the working tree. Null on any failure. */
export async function getRemoteHead(
  repoDir: string,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
): Promise<string | null> {
  const res = await gitExec(["ls-remote", "origin", "HEAD"], repoDir, timeoutMs)
  if (!res.success) return null
  return parseLsRemoteHead(res.stdout)
}

/**
 * Compare local HEAD against remote HEAD.
 * Works on the existing shallow clones: no fetch, no local writes.
 * A dirty tree still reports availability — pulling stays blocked elsewhere,
 * but the user deserves to know an update exists (see story 10 of the spec).
 */
export async function checkRemoteUpdate(
  repoDir: string,
  timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
): Promise<GitUpdateCheck> {
  const localRes = await gitExec(["rev-parse", "HEAD"], repoDir, timeoutMs)
  const local = localRes.success ? localRes.stdout.trim() : ""
  if (!local) {
    return { status: "unknown", error: localRes.error ?? "无法读取本地提交" }
  }

  const remote = await getRemoteHead(repoDir, timeoutMs)
  if (!remote) {
    return { status: "unknown", local, error: "无法读取远端提交（离线或无权限？）" }
  }

  return local === remote
    ? { status: "up-to-date", local, remote }
    : { status: "update-available", local, remote }
}

/**
 * Whether the once-per-24h automatic check should run now.
 * Pure function of (now, last run, quiet window) so the scheduling policy is
 * unit-testable without timers. Assumes startHour < endHour (validated upstream).
 *
 * - Inside the window: run when the last check is older than 24h.
 * - Past the window: catch up once when nothing ran since the window started
 *   (covers machine-asleep / app-closed); the next startup/view-open check
 *   covers anything older.
 * - Before the window: wait for it, even when stale — the window exists to
 *   keep daytime hours quiet.
 */
export function shouldRunScheduledCheck(
  nowMs: number,
  lastCheckedAtMs: number,
  window: UpdateCheckWindow,
): boolean {
  if (nowMs - lastCheckedAtMs < UPDATE_CHECK_INTERVAL_MS) return false

  const start = new Date(nowMs)
  start.setHours(window.startHour, 0, 0, 0)
  const end = new Date(nowMs)
  end.setHours(window.endHour, 0, 0, 0)
  const startMs = start.getTime()
  const endMs = end.getTime()

  if (nowMs >= startMs && nowMs < endMs) return true
  if (nowMs >= endMs && lastCheckedAtMs < startMs) return true
  return false
}
