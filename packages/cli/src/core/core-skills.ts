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
import os from "node:os";
import type { Dirent } from "node:fs";
import {
  AgentConfig,
  AgentType,
  CoreConfig,
  CoreInstallOptions,
  CoreInstallOutcome,
  CorePruneAction,
  CorePruneItem,
  CorePrunePlan,
  CorePruneResult,
  CoreStatusEntry,
  CoreSyncItem,
  CoreSyncPlan,
  CoreSyncResult,
  Skill,
} from "../types.js";
import {
  BACKUP_DIR,
  CANONICAL_SKILLS_DIR,
  CORE_CONFIG_PATH,
  CORE_CONFIG_VERSION,
  CORE_SKILLS_DIR,
  SKILL_MD,
  SKILLS_LIBRARY_DIR,
  STORE_REPOS_DIR,
  STORE_SUBDIR,
} from "../constants.js";

export type CoreRemoveMode = "detach" | "purge";

export interface CoreSkillSource {
  type: "git" | "store" | "local-path" | "core-native";
  repoName?: string;
  repoDisplayName?: string;
  subGroup?: string;
  originUrl?: string;
  sourcePath?: string;
  label: string;
}

export interface CoreBatchRemoveResult {
  ok: boolean;
  removed: string[];
  failed: { name: string; error: string }[];
  unlinked: number;
}
import { agents, detectInstalledAgents } from "./agents.js";
import {
  isPathSafe,
  realpathOrResolve,
  sanitizeName,
  writeSkillFiles,
} from "./installer.js";
import { parseSkillMd } from "./skill-discovery.js";

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

/**
 * Link `target` at `srcReal`, preferring a relative link.
 *
 * Relative link math has to use the *physical* containing directory: the kernel
 * resolves `..` after following every symlink in the path, so a tool whose
 * skills dir sits behind a symlinked ancestor (e.g. ~/.config/zed ->
 * …/SyncedConfig/config/zed) gets a link that lands nowhere if the relative
 * path is derived from the logical path. `symlink()` succeeds regardless, so
 * the only way to catch it is to resolve the link back and compare.
 *
 * Returns false when neither the relative nor the absolute form resolves.
 */
async function writeCoreLink(
  physicalDir: string,
  target: string,
  srcReal: string,
): Promise<boolean> {
  const type = process.platform === "win32" ? "junction" : undefined;
  for (const linkValue of [path.relative(physicalDir, srcReal), srcReal]) {
    try {
      await fs.symlink(linkValue, target, type);
    } catch {
      await fs.unlink(target).catch(() => {});
      continue;
    }
    const resolved = await fs.realpath(target).catch(() => null);
    if (resolved === srcReal) return true;
    await fs.unlink(target).catch(() => {});
  }
  return false;
}

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

    if (
      !(await writeCoreLink(await realpathOrResolve(dir), target, entry.realPath))
    ) {
      throw new Error("软链无法解析到 core 条目");
    }
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

// ---------- pruning non-core skills ----------

export interface CorePruneOptions {
  /** Restrict to these agents. Default: every detected agent. */
  agentNames?: AgentType[];
  /** Agent instances passed directly (e.g. from desktop mirror). */
  agents?: AgentConfig[];
  /** Whitelist of skills to protect per agent. Default protects agy-status in antigravity-cli. */
  protectedSkills?: Record<string, string[]>;
}

export const DEFAULT_PROTECTED_SKILLS: Record<string, string[]> = {
  antigravity: ["agy-status"],
  "antigravity-cli": ["agy-status"],
};

export async function planCorePrune(
  opts: CorePruneOptions = {},
): Promise<CorePrunePlan> {
  const core = await listCoreEntries();
  const coreNames = new Set(core.map((c) => c.name));
  const coreRealDir = await realpathOrResolve(CORE_SKILLS_DIR());

  const detected = opts.agents
    ? opts.agents
    : opts.agentNames
      ? opts.agentNames
          .map((n) => agents[n])
          .filter((a): a is AgentConfig => Boolean(a))
      : await detectInstalledAgents();

  const protectedMap: Record<string, string[]> = {
    ...DEFAULT_PROTECTED_SKILLS,
    ...(opts.protectedSkills ?? {}),
  };

  const items: CorePruneItem[] = [];
  let totalSymlinks = 0;
  let totalDirectories = 0;
  const seenRealDirs = new Set<string>();
  seenRealDirs.add(coreRealDir);

  for (const agent of detected) {
    const dir = agent.globalSkillsDir;
    const realDir = await realpathOrResolve(dir);

    // Skip agents pointing directly to core or sharing a directory with an already processed agent.
    if (seenRealDirs.has(realDir)) {
      continue;
    }
    seenRealDirs.add(realDir);

    const entries = await readdirSafe(dir);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (coreNames.has(entry.name)) continue;

      const target = path.join(dir, entry.name);
      if (!isPathSafe(target, dir)) continue;

      const isProtected = (protectedMap[agent.name] || []).includes(entry.name);
      let lst;
      try {
        lst = await fs.lstat(target);
      } catch {
        continue;
      }

      const kind = lst.isSymbolicLink() ? "symlink" : "directory";

      if (isProtected) {
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          kind,
          path: target,
          action: "keep-protected",
          reason: "受保护的工具专属技能",
        });
        continue;
      }

      if (kind === "symlink") {
        totalSymlinks += 1;
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          kind: "symlink",
          path: target,
          action: "unlink",
        });
      } else if (kind === "directory") {
        totalDirectories += 1;
        items.push({
          skill: entry.name,
          agent: agent.name,
          displayName: agent.displayName,
          kind: "directory",
          path: target,
          action: "backup-and-remove",
        });
      }
    }
  }

  return {
    items,
    agents: detected.map((a) => a.name),
    coreCount: core.length,
    totalSymlinks,
    totalDirectories,
  };
}

export async function applyCorePrune(
  plan: CorePrunePlan,
): Promise<CorePruneResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBase = path.join(BACKUP_DIR(), `prune--${stamp}`);
  const result: CorePruneResult = {
    unlinked: 0,
    backedUp: 0,
    protected: 0,
    failed: [],
  };

  for (const item of plan.items) {
    if (item.action === "keep-protected") {
      result.protected += 1;
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

    if (item.action === "backup-and-remove") {
      try {
        const targetBackup = path.join(backupBase, item.agent, item.skill);
        await fs.mkdir(path.dirname(targetBackup), { recursive: true });
        await movePath(item.path, targetBackup);
        result.backedUp += 1;
        result.backupDir = backupBase;
      } catch (err) {
        result.failed.push({
          skill: item.skill,
          agent: item.agent,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }
  }

  return result;
}

export async function pruneAndSyncCore(
  opts: CorePruneOptions = {},
): Promise<{ pruneResult: CorePruneResult; syncResult: CoreSyncResult }> {
  const prunePlan = await planCorePrune(opts);
  const pruneResult = await applyCorePrune(prunePlan);
  const syncPlan = await planCoreSync({ agentNames: prunePlan.agents });
  const syncResult = await applyCoreSync(syncPlan);
  return { pruneResult, syncResult };
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

export type { CoreInstallOptions, CoreInstallOutcome };

export async function installDirToCore(
  skillDir: string,
  name: string,
  opts: CoreInstallOptions = {},
): Promise<CoreInstallOutcome> {
  const mode = opts.mode ?? "link";
  const safeName = sanitizeName(name);
  const dir = CORE_SKILLS_DIR();
  const target = path.join(dir, safeName);
  if (!isPathSafe(target, dir)) {
    return { ok: false, path: target, error: "路径越界" };
  }

  try {
    if (await pathExists(target)) {
      const lst = await fs.lstat(target);
      if (mode === "link" && lst.isSymbolicLink()) {
        const [srcReal, entryReal] = await Promise.all([
          realpathOrResolve(skillDir),
          realpathOrResolve(target),
        ]);
        if (srcReal === entryReal) {
          return { ok: true, path: target, already: true };
        }
      }
      if (!opts.replace) {
        return {
          ok: false,
          path: target,
          conflict: true,
          error: `core 中已存在 ${safeName}（${lst.isSymbolicLink() ? "软链" : "目录"}）`,
        };
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(BACKUP_DIR(), `core--${safeName}--${stamp}`);
      await fs.mkdir(BACKUP_DIR(), { recursive: true });
      await movePath(target, backupPath);
    }
    await fs.mkdir(dir, { recursive: true });

    if (mode === "link") {
      const srcReal = await realpathOrResolve(skillDir);
      const type = process.platform === "win32" ? "junction" : undefined;
      const coreReal = await realpathOrResolve(dir);
      try {
        await fs.symlink(path.relative(coreReal, srcReal), target, type);
      } catch {
        try {
          await fs.symlink(srcReal, target, type);
        } catch {
          await fs.cp(skillDir, target, { recursive: true, dereference: true });
        }
      }
    } else {
      await fs.cp(skillDir, target, { recursive: true, dereference: true });
    }
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      path: target,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ResolvedLocalSkill {
  ok: true;
  skillDir: string;
  name: string;
  parsed?: Skill;
}

export interface LocalSkillError {
  ok: false;
  error: string;
}

export async function resolveLocalSkill(
  rawPath: string,
  explicitName?: string,
): Promise<ResolvedLocalSkill | LocalSkillError> {
  const expanded =
    rawPath === "~"
      ? os.homedir()
      : rawPath.startsWith("~/") || rawPath.startsWith("~\\")
        ? path.join(os.homedir(), rawPath.slice(2))
        : rawPath;
  const resolved = path.resolve(expanded);

  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return { ok: false, error: `Directory not found: ${rawPath}` };
  }

  let skillDir = resolved;
  if (stat.isFile()) {
    if (path.basename(resolved).toLowerCase() === "skill.md") {
      skillDir = path.dirname(resolved);
    } else {
      return { ok: false, error: `${rawPath} is not a directory or SKILL.md file` };
    }
  } else if (!stat.isDirectory()) {
    return { ok: false, error: `${rawPath} is not a directory` };
  }

  const skillMdPath = path.join(skillDir, SKILL_MD);
  let mdStat;
  try {
    mdStat = await fs.stat(skillMdPath);
  } catch {
    return { ok: false, error: `${rawPath} does not contain a SKILL.md file` };
  }
  if (!mdStat.isFile()) {
    return { ok: false, error: `${skillMdPath} is not a file` };
  }

  const parsed = await parseSkillMd(skillMdPath);
  const candidateName = explicitName || parsed?.name || path.basename(skillDir);
  const safeName = sanitizeName(candidateName);
  if (!safeName) {
    return { ok: false, error: `Could not determine a valid skill name from ${rawPath}` };
  }

  return {
    ok: true,
    skillDir,
    name: safeName,
    parsed: parsed ?? undefined,
  };
}

export async function findDanglingCoreEntries(): Promise<
  { name: string; pointsTo: string }[]
> {
  const out: { name: string; pointsTo: string }[] = [];
  const dir = CORE_SKILLS_DIR();
  for (const entry of await readdirSafe(dir)) {
    if (entry.name.startsWith(".") || !entry.isSymbolicLink()) continue;
    const p = path.join(dir, entry.name);
    try {
      await fs.stat(p);
      continue;
    } catch {
      // Symlink points to nonexistent target.
    }
    let raw = "";
    try {
      raw = await fs.readlink(p);
    } catch {
      continue;
    }
    out.push({ name: entry.name, pointsTo: path.resolve(path.dirname(p), raw) });
  }
  return out;
}

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
 *
 * A core entry that is already gone is not an error: the caller may be looking
 * at a skill that survives only as a dangling link in a tool dir, and the sweep
 * below is what clears it.
 */
async function purgeFromSkillsLibrary(safeName: string): Promise<void> {
  try {
    const libDir = SKILLS_LIBRARY_DIR();
    const top = path.join(libDir, safeName);
    if (await pathExists(top)) {
      await fs.rm(top, { recursive: true, force: true });
    }
    const entries = await readdirSafe(libDir);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".")) {
        const sub = path.join(libDir, e.name, safeName);
        if (await pathExists(sub)) {
          await fs.rm(sub, { recursive: true, force: true });
        }
      }
    }
  } catch {
    // Best effort
  }
}

export async function removeCoreSkill(
  name: string,
  options?: { mode?: CoreRemoveMode },
): Promise<{
  ok: boolean;
  unlinked: number;
  residualCopies: string[];
  /** True when there was no core entry left, so only links could be swept. */
  coreEntryMissing: boolean;
  error?: string;
}> {
  const mode = options?.mode ?? "detach";
  const dir = CORE_SKILLS_DIR();
  const safeName = sanitizeName(name);
  const target = path.join(dir, safeName);
  if (!isPathSafe(target, dir)) {
    return {
      ok: false,
      unlinked: 0,
      residualCopies: [],
      coreEntryMissing: false,
      error: "路径越界",
    };
  }

  let coreEntryMissing = false;
  try {
    const lst = await fs.lstat(target);
    if (lst.isSymbolicLink()) {
      await fs.unlink(target);
    } else {
      if (mode === "detach") {
        const canonicalTarget = path.join(CANONICAL_SKILLS_DIR(), safeName);
        if (!(await pathExists(canonicalTarget))) {
          await fs.mkdir(CANONICAL_SKILLS_DIR(), { recursive: true });
          await fs.cp(target, canonicalTarget, { recursive: true, dereference: true });
        }
      }
      await fs.rm(target, { recursive: true, force: true });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return {
        ok: false,
        unlinked: 0,
        residualCopies: [],
        coreEntryMissing: false,
        error: String(err),
      };
    }
    coreEntryMissing = true;
  }

  if (mode === "purge") {
    const canonicalTarget = path.join(CANONICAL_SKILLS_DIR(), safeName);
    try {
      await fs.rm(canonicalTarget, { recursive: true, force: true });
    } catch {
      // Best effort
    }
    await purgeFromSkillsLibrary(safeName);
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
        if (mode === "purge") {
          await fs.rm(agentPath, { recursive: true, force: true });
        } else {
          residualCopies.push(`${agent.displayName}: ${agentPath}`);
        }
      }
    } catch {
      // nothing there
    }
  }

  return { ok: true, unlinked, residualCopies, coreEntryMissing };
}

export async function removeCoreSkills(
  names: string[],
  options?: { mode?: CoreRemoveMode },
): Promise<CoreBatchRemoveResult> {
  const removed: string[] = [];
  const failed: { name: string; error: string }[] = [];
  let totalUnlinked = 0;

  for (const name of names) {
    const res = await removeCoreSkill(name, options);
    if (res.ok) {
      removed.push(name);
      totalUnlinked += res.unlinked;
    } else {
      failed.push({ name, error: res.error || "Remove failed" });
    }
  }

  return {
    ok: failed.length === 0,
    removed,
    failed,
    unlinked: totalUnlinked,
  };
}

export function parseGitOriginUrl(content: string): string {
  const match = content.match(/\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\r\n]+)/);
  return match ? match[1].trim() : "";
}

export function formatRepoDisplayName(originUrl: string, repoName: string): string {
  if (originUrl) {
    const clean = originUrl.replace(/\.git$/, "").replace(/^.*github\.com[:/]/, "");
    if (clean.includes("/")) return clean;
  }
  if (repoName.includes("-")) {
    const parts = repoName.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts.slice(1).join("-")}`;
    }
  }
  return repoName;
}

export async function resolveCoreSources(
  entries: { name: string; corePath: string; realPath: string }[],
): Promise<Record<string, CoreSkillSource>> {
  const rawReposDir = STORE_REPOS_DIR();
  const rawCanonicalDir = CANONICAL_SKILLS_DIR();
  const rawCoreDir = CORE_SKILLS_DIR();
  const reposDir = await realpathOrResolve(rawReposDir);
  const canonicalDir = await realpathOrResolve(rawCanonicalDir);
  const coreDir = await realpathOrResolve(rawCoreDir);
  const repoCache = new Map<string, { displayName: string; originUrl: string }>();

  async function getRepoMeta(repoName: string) {
    if (repoCache.has(repoName)) return repoCache.get(repoName)!;
    const repoDir = path.join(reposDir, repoName);
    const cfgPath = path.join(repoDir, ".git", "config");
    let originUrl = "";
    try {
      const content = await fs.readFile(cfgPath, "utf-8");
      originUrl = parseGitOriginUrl(content);
    } catch {}
    const displayName = formatRepoDisplayName(originUrl, repoName);
    const meta = { displayName, originUrl };
    repoCache.set(repoName, meta);
    return meta;
  }

  const out: Record<string, CoreSkillSource> = {};
  for (const entry of entries) {
    const real = entry.realPath;
    const isGit = real.startsWith(reposDir + path.sep) || real.startsWith(rawReposDir + path.sep);
    const isStore = real.startsWith(canonicalDir + path.sep) || real.startsWith(rawCanonicalDir + path.sep);
    const isCore =
      real.startsWith(coreDir + path.sep) ||
      real === coreDir ||
      real.startsWith(rawCoreDir + path.sep) ||
      real === rawCoreDir;

    if (isGit) {
      const baseDir = real.startsWith(reposDir + path.sep) ? reposDir : rawReposDir;
      const rel = path.relative(baseDir, real);
      const parts = rel.split(path.sep);
      const repoName = parts[0];
      const subParts = parts.slice(1);
      let subGroup: string | undefined = undefined;
      if (subParts.length >= 2 && subParts[1] === "skills") {
        subGroup = subParts[0];
      } else if (subParts.length >= 1 && subParts[0] !== "skills") {
        subGroup = subParts[0];
      }
      const meta = await getRepoMeta(repoName);
      const label = subGroup ? `${meta.displayName} / ${subGroup}` : meta.displayName;
      out[entry.name] = {
        type: "git",
        repoName,
        repoDisplayName: meta.displayName,
        subGroup,
        originUrl: meta.originUrl,
        label,
      };
    } else if (isStore) {
      out[entry.name] = {
        type: "store",
        label: "Store",
      };
    } else if (isCore) {
      out[entry.name] = {
        type: "core-native",
        label: "Core (Native)",
      };
    } else {
      out[entry.name] = {
        type: "local-path",
        sourcePath: real,
        label: "Local Path",
      };
    }
  }
  return out;
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
