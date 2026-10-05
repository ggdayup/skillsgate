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

export type GitSyncStrategy = "ff-only" | "stash-merge" | "discard-reset"

export interface RepoSyncResult {
  status: "updated" | "up-to-date" | "dirty" | "conflict" | "error"
  commit?: string
  error?: string
  mergedLocalChanges?: boolean
  conflictedFiles?: string[]
  backupPath?: string
  prePullCommit?: string
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

export async function gitStashPush(
  repoDir: string,
  message?: string,
): Promise<{ success: boolean; stashed: boolean; error?: string }> {
  const args = ["stash", "push", "-u"]
  if (message) {
    args.push("-m", message)
  }
  const res = await gitExec(args, repoDir)
  if (!res.success) {
    if (
      res.stdout.includes("No local changes to save") ||
      res.stderr.includes("No local changes to save")
    ) {
      return { success: true, stashed: false }
    }
    return { success: false, stashed: false, error: res.error }
  }
  const stashed = !res.stdout.includes("No local changes to save")
  return { success: true, stashed }
}

export async function getGitConflicts(repoDir: string): Promise<string[]> {
  const conflicted = new Set<string>()
  const diffRes = await gitExec(["diff", "--name-only", "--diff-filter=U"], repoDir)
  if (diffRes.success && diffRes.stdout.trim()) {
    for (const rawLine of diffRes.stdout.trim().split("\n")) {
      const line = rawLine.trim().replace(/^"|"$/g, "")
      if (line) conflicted.add(line)
    }
  }
  const statusRes = await gitExec(["status", "--porcelain"], repoDir)
  if (statusRes.success && statusRes.stdout.trim()) {
    for (const rawLine of statusRes.stdout.trim().split("\n")) {
      const line = rawLine.trim()
      const match = line.match(/^(?:DD|AU|UD|UA|DU|AA|UU)\s+(.+)$/)
      if (match && match[1]) {
        conflicted.add(match[1].trim().replace(/^"|"$/g, ""))
      }
    }
  }
  return [...conflicted].sort()
}

export async function gitStashPop(
  repoDir: string,
): Promise<{ success: boolean; conflict: boolean; conflictedFiles?: string[]; error?: string }> {
  const res = await gitExec(["stash", "pop"], repoDir)
  if (res.success) {
    return { success: true, conflict: false }
  }
  const conflicts = await getGitConflicts(repoDir)
  const isConflict =
    conflicts.length > 0 ||
    res.stdout.includes("CONFLICT") ||
    res.stderr.includes("CONFLICT") ||
    res.stdout.includes("Unmerged paths")
  if (isConflict) {
    return {
      success: false,
      conflict: true,
      conflictedFiles: conflicts,
      error: "代码合入发生冲突",
    }
  }
  return { success: false, conflict: false, error: res.error }
}

export async function gitStashDrop(
  repoDir: string,
): Promise<{ success: boolean; error?: string }> {
  const res = await gitExec(["stash", "drop"], repoDir)
  return { success: res.success, error: res.error }
}

export async function getStashBaseCommit(repoDir: string): Promise<string | null> {
  const res = await gitExec(["rev-parse", "--verify", "stash@{0}^1"], repoDir)
  return res.success && res.stdout.trim() ? res.stdout.trim() : null
}

export async function gitResetHard(
  repoDir: string,
): Promise<{ success: boolean; error?: string }> {
  const resetRes = await gitExec(["reset", "--hard", "HEAD"], repoDir)
  if (!resetRes.success) {
    return { success: false, error: resetRes.error }
  }
  const cleanRes = await gitExec(["clean", "-fd"], repoDir)
  if (!cleanRes.success) {
    return { success: false, error: cleanRes.error }
  }
  return { success: true }
}

export async function gitAbortStashMerge(
  repoDir: string,
  prePullCommit?: string,
): Promise<{ success: boolean; restoredLocalState: boolean; error?: string }> {
  const targetCommit = prePullCommit || (await getStashBaseCommit(repoDir))

  const resetRes = await gitResetHard(repoDir)
  if (!resetRes.success) {
    return { success: false, restoredLocalState: false, error: resetRes.error }
  }

  if (targetCommit) {
    const revertRes = await gitExec(["reset", "--hard", targetCommit], repoDir)
    if (revertRes.success) {
      const popRes = await gitStashPop(repoDir)
      if (popRes.success) {
        return { success: true, restoredLocalState: true }
      }
      return {
        success: true,
        restoredLocalState: false,
        error: "回滚已完成，但恢复本地暂存修改失败: " + popRes.error,
      }
    }
    return {
      success: false,
      restoredLocalState: false,
      error: "重置到合并前版本失败: " + revertRes.error,
    }
  }
  return { success: true, restoredLocalState: false }
}

export async function gitResolveConflicts(
  repoDir: string,
): Promise<{ ok: boolean; remainingConflicts?: string[]; error?: string }> {
  const conflictedFiles = await getGitConflicts(repoDir)
  if (conflictedFiles.length === 0) {
    const stashMsgRes = await gitExec(["log", "-1", "--format=%s", "refs/stash"], repoDir)
    if (stashMsgRes.success && stashMsgRes.stdout.includes("skillsgate-stash-merge-")) {
      await gitStashDrop(repoDir).catch(() => {})
    }
    return { ok: true }
  }

  const unhandled: string[] = []
  for (const relPath of conflictedFiles) {
    const cleanRel = relPath.replace(/^"|"$/g, "").trim()
    const fullPath = path.join(repoDir, cleanRel)
    try {
      const content = await fs.readFile(fullPath, "utf-8")
      if (
        /^<{7}\s+/m.test(content) ||
        /^={7}\s*$/m.test(content) ||
        /^>{7}\s+/m.test(content)
      ) {
        unhandled.push(cleanRel)
      }
    } catch (err: unknown) {
      const isNotFound =
        (err as { code?: string })?.code === "ENOENT" ||
        !(await pathExists(fullPath))
      if (!isNotFound) {
        unhandled.push(cleanRel)
      }
    }
  }

  if (unhandled.length > 0) {
    return {
      ok: false,
      remainingConflicts: unhandled,
      error: `仍有 ${unhandled.length} 个文件存在冲突标记未解决`,
    }
  }

  const addRes = await gitExec(["add", "-A"], repoDir)
  if (!addRes.success) {
    return { ok: false, error: addRes.error }
  }

  const remainingGitConflicts = await getGitConflicts(repoDir)
  if (remainingGitConflicts.length > 0) {
    return {
      ok: false,
      remainingConflicts: remainingGitConflicts,
      error: `Git 仍检测到 ${remainingGitConflicts.length} 个未解决冲突`,
    }
  }

  await gitExec(["reset"], repoDir).catch(() => {})

  const stashMsgRes = await gitExec(["log", "-1", "--format=%s", "refs/stash"], repoDir)
  if (stashMsgRes.success && stashMsgRes.stdout.includes("skillsgate-stash-merge-")) {
    await gitStashDrop(repoDir).catch(() => {})
  }

  return { ok: true }
}

export async function syncGitRepo(
  repoDir: string,
  strategy: GitSyncStrategy = "ff-only",
): Promise<RepoSyncResult> {
  const existingConflicts = await getGitConflicts(repoDir)
  if (existingConflicts.length > 0 && strategy !== "discard-reset") {
    return {
      status: "conflict",
      conflictedFiles: existingConflicts,
      error: "本地仓库存在未解决冲突，请先解决或放弃回滚后再执行更新",
    }
  }

  const dirty = await isGitDirty(repoDir)

  if (strategy === "discard-reset") {
    let backupPath: string | undefined
    if (dirty || existingConflicts.length > 0) {
      const repoName = path.basename(repoDir)
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      backupPath = path.join(BACKUP_DIR, `discard--${repoName}--${stamp}`)
      await fs.mkdir(BACKUP_DIR, { recursive: true })
      await fs.cp(repoDir, backupPath, {
        recursive: true,
        filter: (src) => path.basename(src) !== ".git",
      })
    }

    const resetRes = await gitResetHard(repoDir)
    if (!resetRes.success) {
      return { status: "error", error: "重置本地修改失败: " + resetRes.error, backupPath }
    }

    const stashMsgRes = await gitExec(["log", "-1", "--format=%s", "refs/stash"], repoDir)
    if (stashMsgRes.success && stashMsgRes.stdout.includes("skillsgate-stash-merge-")) {
      await gitStashDrop(repoDir).catch(() => {})
    }

    const pullRes = await gitPull(repoDir)
    if (!pullRes.success) {
      return { status: "error", error: pullRes.error, backupPath }
    }

    const commit = await getGitCommit(repoDir)
    return {
      status: pullRes.alreadyUpToDate ? "up-to-date" : "updated",
      commit,
      backupPath,
    }
  }

  if (!dirty) {
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

  if (strategy === "ff-only") {
    return {
      status: "dirty",
      error: "本地仓库存在未提交修改（Dirty），已跳过更新以防止覆盖本地改动",
    }
  }

  if (strategy === "stash-merge") {
    const prePullCommit = await getGitCommit(repoDir)
    const stamp = Date.now()
    const stashRes = await gitStashPush(repoDir, `skillsgate-stash-merge-${stamp}`)
    if (!stashRes.success) {
      return { status: "error", error: "保存本地修改（stash）失败: " + stashRes.error }
    }

    const pullRes = await gitPull(repoDir)
    if (!pullRes.success) {
      const popRestore = await gitStashPop(repoDir)
      const note = popRestore.success ? "（已自动恢复本地修改）" : "（本地修改仍暂存在 Git stash 中）"
      return { status: "error", error: `拉取远端更新失败: ${pullRes.error}${note}` }
    }

    const popRes = await gitStashPop(repoDir)
    const commit = await getGitCommit(repoDir)

    if (popRes.conflict) {
      const conflicts = popRes.conflictedFiles?.length
        ? popRes.conflictedFiles
        : await getGitConflicts(repoDir)
      return {
        status: "conflict",
        commit,
        prePullCommit,
        conflictedFiles: conflicts,
        error: `更新已拉取，但与本地修改发生冲突（共 ${conflicts.length} 个文件），暂存已保留在 Git stash 中`,
      }
    }

    if (!popRes.success) {
      return {
        status: "error",
        commit,
        prePullCommit,
        error: "恢复本地修改失败: " + popRes.error,
      }
    }

    return {
      status: pullRes.alreadyUpToDate ? "up-to-date" : "updated",
      commit,
      prePullCommit,
      mergedLocalChanges: true,
    }
  }

  return {
    status: "error",
    error: `未知的同步策略: ${strategy as string}`,
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
