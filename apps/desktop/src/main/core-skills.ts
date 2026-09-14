// apps/desktop/src/main/core-skills.ts
//
// Mirrors packages/cli/src/core/core-skills.ts for the main process.
//
// `~/.agents/skills` IS the core set: real directories, git-tracked. Every entry
// is symlinked into every *detected* tool. Anything installed for only some tools
// lives in `~/.agents/.store`, so it never leaks into the core set.
//
// Directory contents are the source of truth; `~/.agents/core.json` only records
// per-agent opt-outs. The agent list is injected rather than imported so this
// module does not depend on ipc-handlers.ts.
import fs from "node:fs/promises"
import path from "node:path"
import type { Dirent } from "node:fs"

import {
  BACKUP_DIR,
  CANONICAL_SKILLS_DIR,
  CORE_CONFIG_PATH,
  CORE_CONFIG_VERSION,
  CORE_SKILLS_DIR,
  SKILL_ROOTS,
} from "./skill-paths"

/** Structural subset of ipc-handlers' AgentEntry. */
export interface CoreAgent {
  name: string
  displayName: string
  globalSkillsDir: string
}

export type CoreSyncAction =
  | "link"
  | "unlink"
  | "skip-conflict"
  | "skip-excluded"
  | "skip-present"

export interface CoreSyncItem {
  skill: string
  agent: string
  displayName: string
  action: CoreSyncAction
  path: string
  reason?: string
}

export interface CoreSyncPlan {
  items: CoreSyncItem[]
  agents: string[]
  coreCount: number
}

export interface CoreSyncResult {
  linked: number
  unlinked: number
  skippedConflicts: number
  skippedExcluded: number
  alreadyPresent: number
  failed: { skill: string; agent: string; error: string }[]
}

export interface CoreConfig {
  version: number
  exclusions: Record<string, string[]>
  storeDir: string
}

export interface CoreStatusEntry {
  agent: string
  displayName: string
  linked: number
  missing: string[]
  conflicts: string[]
  excluded: string[]
  dangling: string[]
}

export interface CoreEntry {
  name: string
  corePath: string
  realPath: string
}

const STORE_DIR_NAME = ".store"

// ---------- low-level fs helpers ----------

async function readdirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

async function realpathOrResolve(p: string): Promise<string> {
  try {
    return await fs.realpath(p)
  } catch {
    return path.resolve(p)
  }
}

function isPathSafe(target: string, base: string): boolean {
  const resolved = path.resolve(target)
  const resolvedBase = path.resolve(base)
  return resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase
}

/** Mirrors ipc-handlers' sanitizeName: one canonical folder name per skill. */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

async function movePath(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst)
    return
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err
  }
  await fs.cp(src, dst, { recursive: true, dereference: true })
  await fs.rm(src, { recursive: true, force: true })
}

// ---------- ~/.agents/core.json ----------

export function emptyCoreConfig(): CoreConfig {
  return { version: CORE_CONFIG_VERSION, exclusions: {}, storeDir: STORE_DIR_NAME }
}

export async function readCoreConfig(): Promise<CoreConfig> {
  try {
    const raw = await fs.readFile(CORE_CONFIG_PATH, "utf-8")
    const data = JSON.parse(raw) as Partial<CoreConfig>
    return {
      version: typeof data.version === "number" ? data.version : CORE_CONFIG_VERSION,
      exclusions:
        data.exclusions && typeof data.exclusions === "object" ? data.exclusions : {},
      storeDir: typeof data.storeDir === "string" ? data.storeDir : STORE_DIR_NAME,
    }
  } catch {
    return emptyCoreConfig()
  }
}

export async function writeCoreConfig(cfg: CoreConfig): Promise<void> {
  await fs.mkdir(path.dirname(CORE_CONFIG_PATH), { recursive: true })
  await fs.writeFile(CORE_CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8")
}

export function isExcluded(
  cfg: CoreConfig,
  agent: string,
  skill: string,
): boolean {
  return (cfg.exclusions[agent] || []).includes(skill)
}

export async function setExclusion(
  agent: string,
  skill: string,
  excluded: boolean,
): Promise<CoreConfig> {
  const cfg = await readCoreConfig()
  const list = new Set(cfg.exclusions[agent] || [])
  if (excluded) list.add(skill)
  else list.delete(skill)
  if (list.size > 0) cfg.exclusions[agent] = [...list].sort()
  else delete cfg.exclusions[agent]
  await writeCoreConfig(cfg)
  return cfg
}

// ---------- the core set ----------

export async function listCoreEntries(): Promise<CoreEntry[]> {
  const out: CoreEntry[] = []
  for (const entry of await readdirSafe(CORE_SKILLS_DIR)) {
    if (entry.name.startsWith(".")) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const corePath = path.join(CORE_SKILLS_DIR, entry.name)
    if (!(await isDirectory(corePath))) continue
    out.push({
      name: entry.name,
      corePath,
      realPath: await realpathOrResolve(corePath),
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// ---------- agent-side inspection ----------

type AgentEntryState =
  | { kind: "missing" }
  | { kind: "linked" }
  | { kind: "dangling" }
  | { kind: "conflict"; reason: string }

async function inspectAgentEntry(
  target: string,
  coreRealPath: string,
): Promise<AgentEntryState> {
  let lst
  try {
    lst = await fs.lstat(target)
  } catch {
    return { kind: "missing" }
  }

  if (!lst.isSymbolicLink()) {
    return {
      kind: "conflict",
      reason: lst.isDirectory() ? "同名真实目录" : "同名文件",
    }
  }

  let alive = true
  try {
    await fs.stat(target)
  } catch {
    alive = false
  }
  if (!alive) return { kind: "dangling" }

  const resolved = await realpathOrResolve(target)
  if (resolved === coreRealPath) return { kind: "linked" }
  return { kind: "conflict", reason: `软链指向别处：${resolved}` }
}

/** Broken symlinks that used to point into the core dir. Ours, so safe to clean. */
async function findDanglingCoreLinks(
  dir: string,
): Promise<{ name: string; path: string }[]> {
  const coreDir = path.resolve(CORE_SKILLS_DIR)
  const out: { name: string; path: string }[] = []

  for (const entry of await readdirSafe(dir)) {
    if (!entry.isSymbolicLink()) continue
    const p = path.join(dir, entry.name)

    let alive = true
    try {
      await fs.stat(p)
    } catch {
      alive = false
    }
    if (alive) continue

    let raw = ""
    try {
      raw = await fs.readlink(p)
    } catch {
      continue
    }
    if (path.resolve(path.dirname(p), raw).startsWith(coreDir + path.sep)) {
      out.push({ name: entry.name, path: p })
    }
  }
  return out
}

// ---------- planning ----------

export async function planCoreSync(agents: CoreAgent[]): Promise<CoreSyncPlan> {
  const core = await listCoreEntries()
  const cfg = await readCoreConfig()
  const items: CoreSyncItem[] = []
  const coreRealDir = await realpathOrResolve(CORE_SKILLS_DIR)

  for (const agent of agents) {
    const dir = agent.globalSkillsDir

    // Several tools point their whole skills directory at the core dir. All core
    // skills are already visible through that symlink, so there is nothing to do.
    if ((await realpathOrResolve(dir)) === coreRealDir) {
      for (const entry of core) {
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          action: "skip-present",
          path: path.join(dir, entry.name),
          reason: "工具目录即 core 目录",
        })
      }
      continue
    }

    for (const entry of core) {
      const target = path.join(dir, entry.name)
      if (!isPathSafe(target, dir)) continue

      const push = (action: CoreSyncAction, reason?: string): void => {
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          action,
          path: target,
          reason,
        })
      }

      if (isExcluded(cfg, agent.name, entry.name)) {
        push("skip-excluded", "已在 core.json 中排除")
        continue
      }

      const state = await inspectAgentEntry(target, entry.realPath)
      switch (state.kind) {
        case "missing":
          push("link")
          break
        case "linked":
          push("skip-present")
          break
        case "dangling":
          push("link", "悬空软链：先清理再重建")
          break
        case "conflict":
          push("skip-conflict", state.reason)
          break
      }
    }

    for (const dangling of await findDanglingCoreLinks(dir)) {
      items.push({
        skill: dangling.name,
        agent: agent.name,
        displayName: agent.displayName,
        action: "unlink",
        path: dangling.path,
        reason: "core 中已不存在",
      })
    }
  }

  return { items, agents: agents.map((a) => a.name), coreCount: core.length }
}

// ---------- applying ----------

async function linkCoreEntry(
  entry: CoreEntry,
  agent: CoreAgent,
): Promise<{ ok: boolean; error?: string }> {
  const dir = agent.globalSkillsDir
  const target = path.join(dir, entry.name)
  if (!isPathSafe(target, dir)) return { ok: false, error: "路径越界" }

  try {
    await fs.mkdir(dir, { recursive: true })

    if (await pathExists(target)) {
      const lst = await fs.lstat(target)
      if (lst.isSymbolicLink()) await fs.unlink(target)
      else return { ok: false, error: "同名真实条目已存在" }
    }

    const relative = path.relative(dir, entry.realPath)
    const type = process.platform === "win32" ? "junction" : undefined
    await fs.symlink(relative, target, type)
    return { ok: true }
  } catch (err) {
    // Windows / cross-device fallback: materialise a copy.
    try {
      await fs.cp(entry.realPath, target, { recursive: true, dereference: true })
      return { ok: true }
    } catch (fallbackErr) {
      return {
        ok: false,
        error:
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      }
    }
  }
}

export async function applyCoreSync(plan: CoreSyncPlan): Promise<CoreSyncResult> {
  const result: CoreSyncResult = {
    linked: 0,
    unlinked: 0,
    skippedConflicts: 0,
    skippedExcluded: 0,
    alreadyPresent: 0,
    failed: [],
  }

  const core = new Map((await listCoreEntries()).map((e) => [e.name, e]))

  for (const item of plan.items) {
    if (item.action === "skip-conflict") {
      result.skippedConflicts += 1
      continue
    }
    if (item.action === "skip-excluded") {
      result.skippedExcluded += 1
      continue
    }
    if (item.action === "skip-present") {
      result.alreadyPresent += 1
      continue
    }

    if (item.action === "unlink") {
      try {
        const lst = await fs.lstat(item.path)
        if (lst.isSymbolicLink()) {
          await fs.unlink(item.path)
          result.unlinked += 1
        }
      } catch (err) {
        result.failed.push({
          skill: item.skill,
          agent: item.agent,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      continue
    }

    const entry = core.get(item.skill)
    if (!entry) continue
    const agent: CoreAgent = {
      name: item.agent,
      displayName: item.displayName,
      globalSkillsDir: path.dirname(item.path),
    }
    const res = await linkCoreEntry(entry, agent)
    if (res.ok) result.linked += 1
    else
      result.failed.push({
        skill: item.skill,
        agent: item.agent,
        error: res.error ?? "未知错误",
      })
  }

  return result
}

export async function syncCore(agents: CoreAgent[]): Promise<CoreSyncResult> {
  return applyCoreSync(await planCoreSync(agents))
}

// ---------- status ----------

export async function getCoreStatus(agents: CoreAgent[]): Promise<CoreStatusEntry[]> {
  const plan = await planCoreSync(agents)
  const byAgent = new Map<string, CoreStatusEntry>()

  for (const name of plan.agents) {
    const found = agents.find((a) => a.name === name)
    byAgent.set(name, {
      agent: name,
      displayName: found?.displayName ?? name,
      linked: 0,
      missing: [],
      conflicts: [],
      excluded: [],
      dangling: [],
    })
  }

  for (const item of plan.items) {
    const entry = byAgent.get(item.agent)
    if (!entry) continue
    switch (item.action) {
      case "skip-present":
        entry.linked += 1
        break
      case "link":
        entry.missing.push(item.skill)
        break
      case "skip-conflict":
        entry.conflicts.push(item.skill)
        break
      case "skip-excluded":
        entry.excluded.push(item.skill)
        break
      case "unlink":
        entry.dangling.push(item.skill)
        break
    }
  }

  return [...byAgent.values()]
}

// ---------- add / remove ----------

async function unlinkCoreLinkFromAgent(
  agent: CoreAgent,
  name: string,
): Promise<boolean> {
  const target = path.join(agent.globalSkillsDir, name)
  try {
    const lst = await fs.lstat(target)
    if (!lst.isSymbolicLink()) return false
    const raw = await fs.readlink(target)
    const abs = path.resolve(path.dirname(target), raw)
    if (!abs.startsWith(path.resolve(CORE_SKILLS_DIR) + path.sep)) return false
    await fs.unlink(target)
    return true
  } catch {
    return false
  }
}

/**
 * Installs a resolved skill folder into the core set as a **real directory**
 * (not a symlink — the core dir is git-tracked and must hold actual files).
 *
 * Refuses to clobber an existing entry: overwriting a core skill would silently
 * rewrite it in every tool at once. The caller surfaces the error.
 */
export async function installDirToCore(
  skillDir: string,
  name: string,
): Promise<{ ok: boolean; path: string; error?: string }> {
  const safeName = sanitizeName(name)
  const target = path.join(CORE_SKILLS_DIR, safeName)
  if (!isPathSafe(target, CORE_SKILLS_DIR)) {
    return { ok: false, path: target, error: "路径越界" }
  }

  try {
    if (await pathExists(target)) {
      const lst = await fs.lstat(target)
      return {
        ok: false,
        path: target,
        error: `core 中已存在 ${safeName}（${lst.isSymbolicLink() ? "软链" : "目录"}）`,
      }
    }
    await fs.mkdir(CORE_SKILLS_DIR, { recursive: true })
    await fs.cp(skillDir, target, { recursive: true, dereference: true })
    return { ok: true, path: target }
  } catch (err) {
    return {
      ok: false,
      path: target,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function removeCoreSkill(
  name: string,
  agents: CoreAgent[],
): Promise<{ ok: boolean; unlinked: number; residualCopies: string[]; error?: string }> {
  const safeName = sanitizeName(name)
  const target = path.join(CORE_SKILLS_DIR, safeName)
  if (!isPathSafe(target, CORE_SKILLS_DIR)) {
    return { ok: false, unlinked: 0, residualCopies: [], error: "路径越界" }
  }

  try {
    const lst = await fs.lstat(target)
    if (lst.isSymbolicLink()) await fs.unlink(target)
    else await fs.rm(target, { recursive: true, force: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return {
      ok: false,
      unlinked: 0,
      residualCopies: [],
      error: code === "ENOENT" ? "core 中不存在该技能" : String(err),
    }
  }

  let unlinked = 0
  const residualCopies: string[] = []
  for (const agent of agents) {
    const agentPath = path.join(agent.globalSkillsDir, safeName)
    if (await unlinkCoreLinkFromAgent(agent, safeName)) {
      unlinked += 1
      continue
    }
    try {
      const lst = await fs.lstat(agentPath)
      if (!lst.isSymbolicLink() && lst.isDirectory()) {
        residualCopies.push(`${agent.displayName}: ${agentPath}`)
      }
    } catch {
      // nothing there
    }
  }

  return { ok: true, unlinked, residualCopies }
}

export async function promoteToCore(
  skillName: string,
  agent: CoreAgent,
): Promise<{ ok: boolean; path: string; error?: string }> {
  const name = skillName.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^-+|-+$/g, "")
  const src = path.join(agent.globalSkillsDir, name)
  const dst = path.join(CORE_SKILLS_DIR, name)

  try {
    const lst = await fs.lstat(src)
    if (lst.isSymbolicLink()) {
      return {
        ok: false,
        path: dst,
        error: `${name} 在 ${agent.displayName} 中是软链，不是自有技能`,
      }
    }
    if (!lst.isDirectory()) return { ok: false, path: dst, error: `${name} 不是目录` }
    if (await pathExists(dst)) {
      return { ok: false, path: dst, error: `core 中已存在 ${name}` }
    }

    await fs.mkdir(CORE_SKILLS_DIR, { recursive: true })
    await movePath(src, dst)
    return { ok: true, path: dst }
  } catch (err) {
    return { ok: false, path: dst, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function replaceConflictWithCoreLink(
  skillName: string,
  agent: CoreAgent,
): Promise<{ ok: boolean; backupPath?: string; error?: string }> {
  const name = skillName.toLowerCase().replace(/[^a-z0-9._]+/g, "-").replace(/^-+|-+$/g, "")
  const target = path.join(agent.globalSkillsDir, name)
  const entry = (await listCoreEntries()).find((e) => e.name === name)
  if (!entry) return { ok: false, error: "core 中不存在该技能" }

  try {
    const lst = await fs.lstat(target)
    if (lst.isSymbolicLink()) return { ok: false, error: "目标已是软链，无需替换" }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = path.join(BACKUP_DIR, `${agent.name}--${name}--${stamp}`)
    await fs.mkdir(BACKUP_DIR, { recursive: true })
    await movePath(target, backupPath)

    const res = await linkCoreEntry(entry, agent)
    if (!res.ok) {
      await movePath(backupPath, target).catch(() => undefined)
      return { ok: false, error: res.error ?? "建立软链失败，已还原原目录" }
    }
    return { ok: true, backupPath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Summary for the UI: how many tools have every core skill linked. */
export async function getCoreSummary(agents: CoreAgent[]): Promise<{
  coreCount: number
  agents: number
  inSync: number
  needsWork: number
  conflicts: number
}> {
  const status = await getCoreStatus(agents)
  const coreCount = (await listCoreEntries()).length
  let inSync = 0
  let needsWork = 0
  let conflicts = 0
  for (const s of status) {
    conflicts += s.conflicts.length
    if (s.missing.length === 0 && s.dangling.length === 0) inSync += 1
    else needsWork += 1
  }
  return { coreCount, agents: status.length, inSync, needsWork, conflicts }
}

export { CORE_SKILLS_DIR, CANONICAL_SKILLS_DIR, BACKUP_DIR, SKILL_ROOTS }
