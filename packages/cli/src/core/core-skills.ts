// Core skills model.
//
// `~/.agents/skills` IS the core set: real directories, git-tracked, hand-curated.
// Every entry there is symlinked into every *detected* agent. Anything else a user
// installs for one or two specific tools lives in `~/.agents/.store` instead, so it
// never leaks into the core set.
//
// Directory contents are the source of truth — there is no manifest listing core
// skills. `~/.agents/core.json` only records per-agent opt-outs (and is deliberately
// kept out of `.skill-lock.json`, whose reader wipes itself on a version mismatch).
import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import {
  AgentConfig,
  AgentType,
  CoreConfig,
  CoreStatusEntry,
  CoreSyncItem,
  CoreSyncPlan,
  CoreSyncResult,
  Skill,
} from "../types.js";
import {
  BACKUP_DIR,
  CORE_CONFIG_PATH,
  CORE_CONFIG_VERSION,
  CORE_SKILLS_DIR,
  SKILL_MD,
  STORE_SUBDIR,
} from "../constants.js";
import { agents, detectInstalledAgents } from "./agents.js";
import {
  isPathSafe,
  realpathOrResolve,
  sanitizeName,
  writeSkillFiles,
} from "./installer.js";

// ---------- low-level fs helpers ----------

async function readdirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** rename(), falling back to copy+remove when src and dst are on different devices. */
async function movePath(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
  }
  await fs.cp(src, dst, { recursive: true, dereference: true });
  await fs.rm(src, { recursive: true, force: true });
}

// ---------- ~/.agents/core.json ----------

export function emptyCoreConfig(): CoreConfig {
  return {
    version: CORE_CONFIG_VERSION,
    exclusions: {},
    storeDir: STORE_SUBDIR,
  };
}

export async function readCoreConfig(): Promise<CoreConfig> {
  try {
    const raw = await fs.readFile(CORE_CONFIG_PATH(), "utf-8");
    const data = JSON.parse(raw) as Partial<CoreConfig>;
    return {
      version:
        typeof data.version === "number" ? data.version : CORE_CONFIG_VERSION,
      exclusions:
        data.exclusions && typeof data.exclusions === "object"
          ? data.exclusions
          : {},
      storeDir:
        typeof data.storeDir === "string" ? data.storeDir : STORE_SUBDIR,
    };
  } catch {
    return emptyCoreConfig();
  }
}

export async function writeCoreConfig(cfg: CoreConfig): Promise<void> {
  const target = CORE_CONFIG_PATH();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
}

export function isExcluded(
  cfg: CoreConfig,
  agent: AgentType,
  skill: string,
): boolean {
  return (cfg.exclusions[agent] || []).includes(skill);
}

/**
 * Opt an agent in/out of a single core skill. Exclusions are explicit and
 * persisted, so a reconcile will not silently re-link what the user removed.
 */
export async function setExclusion(
  agent: AgentType,
  skill: string,
  excluded: boolean,
): Promise<CoreConfig> {
  const cfg = await readCoreConfig();
  const list = new Set(cfg.exclusions[agent] || []);
  if (excluded) list.add(skill);
  else list.delete(skill);
  if (list.size > 0) cfg.exclusions[agent] = [...list].sort();
  else delete cfg.exclusions[agent];
  await writeCoreConfig(cfg);
  return cfg;
}

// ---------- the core set (directory is the truth) ----------

export interface CoreEntry {
  name: string;
  /** Path inside the core dir — may itself be a symlink. */
  corePath: string;
  /** Fully resolved path; symlink targets use this to avoid double indirection. */
  realPath: string;
}

export async function listCoreEntries(): Promise<CoreEntry[]> {
  const dir = CORE_SKILLS_DIR();
  const entries = await readdirSafe(dir);

  const out: CoreEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const corePath = path.join(dir, entry.name);
    if (!(await isDirectory(corePath))) continue;

    out.push({
      name: entry.name,
      corePath,
      realPath: await realpathOrResolve(corePath),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function listCoreSkillNames(): Promise<string[]> {
  return (await listCoreEntries()).map((e) => e.name);
}

// ---------- agent-side inspection ----------

type AgentEntryState =
  | { kind: "missing" }
  | { kind: "linked" }
  | { kind: "dangling" }
  | { kind: "conflict"; reason: string };

async function inspectAgentEntry(
  target: string,
  coreRealPath: string,
): Promise<AgentEntryState> {
  let lst;
  try {
    lst = await fs.lstat(target);
  } catch {
    return { kind: "missing" };
  }

  if (!lst.isSymbolicLink()) {
    return {
      kind: "conflict",
      reason: lst.isDirectory() ? "同名真实目录" : "同名文件",
    };
  }

  let targetAlive = true;
  try {
    await fs.stat(target);
  } catch {
    targetAlive = false;
  }
  if (!targetAlive) return { kind: "dangling" };

  const resolved = await realpathOrResolve(target);
  if (resolved === coreRealPath) return { kind: "linked" };

  return { kind: "conflict", reason: `软链指向别处：${resolved}` };
}

/**
 * Symlinks inside an agent dir whose target is gone AND which used to point into
 * the core dir. Only these are auto-cleaned — a broken link the user made to
 * somewhere else is left alone.
 */
async function findDanglingCoreLinks(
  dir: string,
): Promise<{ name: string; path: string }[]> {
  const entries = await readdirSafe(dir);

  const coreDir = path.resolve(CORE_SKILLS_DIR());
  const out: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);

    let alive = true;
    try {
      await fs.stat(p);
    } catch {
      alive = false;
    }
    if (alive) continue;

    let raw = "";
    try {
      raw = await fs.readlink(p);
    } catch {
      continue;
    }
    const abs = path.resolve(path.dirname(p), raw);
    if (abs.startsWith(coreDir + path.sep)) out.push({ name: entry.name, path: p });
  }
  return out;
}

// ---------- planning ----------

export interface CoreSyncOptions {
  /** Restrict to these agents. Default: every detected agent. */
  agentNames?: AgentType[];
}

export async function planCoreSync(
  opts: CoreSyncOptions = {},
): Promise<CoreSyncPlan> {
  const core = await listCoreEntries();
  const cfg = await readCoreConfig();

  const detected = opts.agentNames
    ? opts.agentNames
        .map((n) => agents[n])
        .filter((a): a is AgentConfig => Boolean(a))
    : await detectInstalledAgents();

  const items: CoreSyncItem[] = [];
  const coreRealDir = await realpathOrResolve(CORE_SKILLS_DIR());

  for (const agent of detected) {
    const dir = agent.globalSkillsDir;

    // Several agents (Antigravity, CodeBuddy, Pi, …) point their whole skills
    // directory at the core dir. Everything is already visible through that
    // symlink, so there is nothing to link and nothing to clean up. Without this
    // check every core entry would be misreported as a same-name conflict.
    if ((await realpathOrResolve(dir)) === coreRealDir) {
      for (const entry of core) {
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          action: "skip-present",
          path: path.join(dir, entry.name),
          reason: "工具目录即 core 目录",
        });
      }
      continue;
    }

    for (const entry of core) {
      const target = path.join(dir, entry.name);
      if (!isPathSafe(target, dir)) continue;

      const push = (
        action: CoreSyncItem["action"],
        reason?: string,
      ): void => {
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          action,
          path: target,
          reason,
        });
      };

      if (isExcluded(cfg, agent.name, entry.name)) {
        push("skip-excluded", "已在 core.json 中排除");
        continue;
      }

      const state = await inspectAgentEntry(target, entry.realPath);
      switch (state.kind) {
        case "missing":
          push("link");
          break;
        case "linked":
          push("skip-present");
          break;
        case "dangling":
          push("link", "悬空软链：先清理再重建");
          break;
        case "conflict":
          push("skip-conflict", state.reason);
          break;
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
      });
    }
  }

  return { items, agents: detected.map((a) => a.name), coreCount: core.length };
}

// ---------- applying ----------

async function linkCoreEntry(
  entry: CoreEntry,
  agent: AgentConfig,
): Promise<{ ok: boolean; error?: string }> {
  const dir = agent.globalSkillsDir;
  const target = path.join(dir, entry.name);
  if (!isPathSafe(target, dir)) return { ok: false, error: "路径越界" };

  try {
    await fs.mkdir(dir, { recursive: true });

    if (await pathExists(target)) {
      const lst = await fs.lstat(target);
      if (lst.isSymbolicLink()) await fs.unlink(target);
      else return { ok: false, error: "同名真实条目已存在" };
    }

    const relative = path.relative(dir, entry.realPath);
    const type = process.platform === "win32" ? "junction" : undefined;
    await fs.symlink(relative, target, type);
    return { ok: true };
  } catch (err) {
    // Windows / cross-device fallback: materialise a copy instead of a link.
    try {
      const skillMd = path.join(entry.realPath, SKILL_MD);
      const raw = await fs.readFile(skillMd, "utf-8");
      await writeSkillFiles(
        {
          name: entry.name,
          description: "",
          filePath: skillMd,
          content: raw,
        },
        target,
        false,
      );
      return { ok: true };
    } catch (fallbackErr) {
      return {
        ok: false,
        error:
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr),
      };
    }
  }
}

export async function applyCoreSync(
  plan: CoreSyncPlan,
): Promise<CoreSyncResult> {
  const result: CoreSyncResult = {
    linked: 0,
    unlinked: 0,
    skippedConflicts: 0,
    skippedExcluded: 0,
    alreadyPresent: 0,
    failed: [],
  };

  const core = new Map((await listCoreEntries()).map((e) => [e.name, e]));

  for (const item of plan.items) {
    const agent = agents[item.agent];
    if (!agent) continue;

    if (item.action === "skip-conflict") {
      result.skippedConflicts += 1;
      continue;
    }
    if (item.action === "skip-excluded") {
      result.skippedExcluded += 1;
      continue;
    }
    if (item.action === "skip-present") {
      result.alreadyPresent += 1;
      continue;
    }

    if (item.action === "unlink") {
      try {
        const lst = await fs.lstat(item.path);
        if (lst.isSymbolicLink()) {
          await fs.unlink(item.path);
          result.unlinked += 1;
        }
      } catch (err) {
        result.failed.push({
          skill: item.skill,
          agent: item.agent,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    // action === "link"
    const entry = core.get(item.skill);
    if (!entry) continue;
    const res = await linkCoreEntry(entry, agent);
    if (res.ok) result.linked += 1;
    else
      result.failed.push({
        skill: item.skill,
        agent: item.agent,
        error: res.error ?? "未知错误",
      });
  }

  return result;
}

export async function syncCore(
  opts: CoreSyncOptions = {},
): Promise<CoreSyncResult> {
  return applyCoreSync(await planCoreSync(opts));
}

// ---------- status ----------

export async function getCoreStatus(
  opts: CoreSyncOptions = {},
): Promise<CoreStatusEntry[]> {
  const plan = await planCoreSync(opts);
  const byAgent = new Map<string, CoreStatusEntry>();

  for (const name of plan.agents) {
    byAgent.set(name, {
      agent: name,
      displayName: agents[name]?.displayName ?? name,
      linked: 0,
      missing: [],
      conflicts: [],
      excluded: [],
      dangling: [],
    });
  }

  for (const item of plan.items) {
    const entry = byAgent.get(item.agent);
    if (!entry) continue;
    switch (item.action) {
      case "skip-present":
        entry.linked += 1;
        break;
      case "link":
        entry.missing.push(item.skill);
        break;
      case "skip-conflict":
        entry.conflicts.push(item.skill);
        break;
      case "skip-excluded":
        entry.excluded.push(item.skill);
        break;
      case "unlink":
        entry.dangling.push(item.skill);
        break;
    }
  }

  return [...byAgent.values()];
}

// ---------- adding / removing core skills ----------

export async function installSkillToCore(
  skill: Skill,
): Promise<{ ok: boolean; path: string; error?: string }> {
  const name = sanitizeName(skill.name);
  const dir = CORE_SKILLS_DIR();
  const target = path.join(dir, name);
  if (!isPathSafe(target, dir)) {
    return { ok: false, path: target, error: "路径越界" };
  }

  try {
    if (await pathExists(target)) {
      const lst = await fs.lstat(target);
      return {
        ok: false,
        path: target,
        error: `core 中已存在 ${name}（${lst.isSymbolicLink() ? "软链" : "目录"}）`,
      };
    }
    await fs.mkdir(dir, { recursive: true });
    await writeSkillFiles(skill, target, true);
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      path: target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Remove an agent-side link, but only when it is one of ours. Never a real dir. */
async function unlinkCoreLinkFromAgent(
  agent: AgentConfig,
  name: string,
): Promise<boolean> {
  const target = path.join(agent.globalSkillsDir, name);
  try {
    const lst = await fs.lstat(target);
    if (!lst.isSymbolicLink()) return false;

    const raw = await fs.readlink(target);
    const abs = path.resolve(path.dirname(target), raw);
    const coreDir = path.resolve(CORE_SKILLS_DIR());
    if (!abs.startsWith(coreDir + path.sep)) return false;

    await fs.unlink(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop a skill from the core set and unlink it everywhere. Only symlinks that
 * point back into the core dir are removed; a real directory left behind by a
 * copy-mode install is reported as a residual copy instead of being deleted.
 */
export async function removeCoreSkill(name: string): Promise<{
  ok: boolean;
  unlinked: number;
  residualCopies: string[];
  error?: string;
}> {
  const dir = CORE_SKILLS_DIR();
  const safeName = sanitizeName(name);
  const target = path.join(dir, safeName);
  if (!isPathSafe(target, dir)) {
    return { ok: false, unlinked: 0, residualCopies: [], error: "路径越界" };
  }

  try {
    const lst = await fs.lstat(target);
    if (lst.isSymbolicLink()) await fs.unlink(target);
    else await fs.rm(target, { recursive: true, force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      unlinked: 0,
      residualCopies: [],
      error: code === "ENOENT" ? "core 中不存在该技能" : String(err),
    };
  }

  const detected = await detectInstalledAgents();
  let unlinked = 0;
  const residualCopies: string[] = [];

  for (const agent of detected) {
    const agentPath = path.join(agent.globalSkillsDir, safeName);
    if (await unlinkCoreLinkFromAgent(agent, safeName)) {
      unlinked += 1;
      continue;
    }
    try {
      const lst = await fs.lstat(agentPath);
      if (!lst.isSymbolicLink() && lst.isDirectory()) {
        residualCopies.push(`${agent.displayName}: ${agentPath}`);
      }
    } catch {
      // nothing there
    }
  }

  return { ok: true, unlinked, residualCopies };
}

/**
 * Adopt a skill the agent owns outright (a real directory) into the core set.
 * Symlinks are rejected — those are already shared, not owned.
 */
export async function promoteToCore(
  skillName: string,
  agentName: AgentType,
): Promise<{ ok: boolean; path: string; error?: string }> {
  const agent = agents[agentName];
  if (!agent) return { ok: false, path: "", error: `未知工具：${agentName}` };

  const name = sanitizeName(skillName);
  const src = path.join(agent.globalSkillsDir, name);
  const dst = path.join(CORE_SKILLS_DIR(), name);

  try {
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) {
      return {
        ok: false,
        path: dst,
        error: `${name} 在 ${agent.displayName} 中是软链，不是自有技能`,
      };
    }
    if (!lst.isDirectory()) {
      return { ok: false, path: dst, error: `${name} 不是目录` };
    }
    if (await pathExists(dst)) {
      return { ok: false, path: dst, error: `core 中已存在 ${name}` };
    }

    await fs.mkdir(CORE_SKILLS_DIR(), { recursive: true });
    await movePath(src, dst);
    return { ok: true, path: dst };
  } catch (err) {
    return {
      ok: false,
      path: dst,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Explicit conflict resolution: park the agent's own directory in `.backup/`
 * and replace it with a link to the core skill. Never runs implicitly.
 */
export async function replaceConflictWithCoreLink(
  skillName: string,
  agentName: AgentType,
): Promise<{ ok: boolean; backupPath?: string; error?: string }> {
  const agent = agents[agentName];
  if (!agent) return { ok: false, error: `未知工具：${agentName}` };

  const name = sanitizeName(skillName);
  const target = path.join(agent.globalSkillsDir, name);
  const entry = (await listCoreEntries()).find((e) => e.name === name);
  if (!entry) return { ok: false, error: "core 中不存在该技能" };

  try {
    const lst = await fs.lstat(target);
    if (lst.isSymbolicLink()) {
      return { ok: false, error: "目标已是软链，无需替换" };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupRoot = BACKUP_DIR();
    const backupPath = path.join(backupRoot, `${agentName}--${name}--${stamp}`);
    await fs.mkdir(backupRoot, { recursive: true });
    await movePath(target, backupPath);

    const res = await linkCoreEntry(entry, agent);
    if (!res.ok) {
      await movePath(backupPath, target).catch(() => undefined);
      return { ok: false, error: res.error ?? "建立软链失败，已还原原目录" };
    }
    return { ok: true, backupPath };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
