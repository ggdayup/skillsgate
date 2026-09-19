// Portions adapted from vercel-labs/skills (https://github.com/vercel-labs/skills)
import fs from "node:fs/promises";
import path from "node:path";
import {
  SkillLockFile,
  SkillLockEntry,
  AgentType,
} from "../types.js";
import { GLOBAL_LOCK_PATH, LOCK_FILE_VERSION } from "../constants.js";

export async function readSkillLock(): Promise<SkillLockFile> {
  const lockPath = GLOBAL_LOCK_PATH();
  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    const data = JSON.parse(raw) as SkillLockFile;

    if (data.version !== LOCK_FILE_VERSION) {
      // A different tool owns this file. Upstream `npx skills` writes
      // `~/.agents/.skill-lock.json` at version 3, and *both* implementations
      // discard the file on a version mismatch — so reading is safe, but
      // writing would destroy the other tool's install provenance.
      // writeSkillLock() below refuses to clobber it.
      return emptyLock();
    }

    return data;
  } catch {
    return emptyLock();
  }
}

/** Version of the lock file currently on disk, or null when there is none. */
export async function readLockFileVersion(): Promise<number | null> {
  try {
    const raw = await fs.readFile(GLOBAL_LOCK_PATH(), "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "number" ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function writeSkillLock(lock: SkillLockFile): Promise<void> {
  const lockPath = GLOBAL_LOCK_PATH();

  // Guard against clobbering another tool's lock file. SkillsGate and upstream
  // `npx skills` share this path but use incompatible versions (1 vs 3), and
  // both wipe on mismatch — an unguarded write here would silently delete the
  // other tool's provenance. Park the foreign file, then write ours.
  //
  // Residual limitation: the two schemas still cannot coexist, so the other
  // tool will keep discarding ours. Reconciling them is a separate issue; this
  // guard only guarantees we never *destroy* data.
  const onDiskVersion = await readLockFileVersion();
  if (onDiskVersion !== null && onDiskVersion !== LOCK_FILE_VERSION) {
    const parked = `${lockPath}.v${onDiskVersion}.bak`;
    try {
      await fs.copyFile(lockPath, parked);
      console.warn(
        `[skillsgate] ${lockPath} is version ${onDiskVersion}, not ${LOCK_FILE_VERSION} ` +
          `(written by another skills CLI). Backed it up to ${parked} before writing.`,
      );
    } catch {
      // Could not preserve it — leave the other tool's file untouched.
      console.warn(
        `[skillsgate] ${lockPath} is version ${onDiskVersion} and could not be backed up. ` +
          `Leaving it alone; install provenance will not be recorded.`,
      );
      return;
    }
  }

  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), "utf-8");
}

export async function addSkillToLock(
  name: string,
  entry: Omit<SkillLockEntry, "installedAt" | "updatedAt">,
): Promise<void> {
  const lock = await readSkillLock();
  const now = new Date().toISOString();

  const existing = lock.skills[name];
  lock.skills[name] = {
    ...entry,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
  };

  await writeSkillLock(lock);
}

export async function removeSkillFromLock(name: string): Promise<void> {
  const lock = await readSkillLock();
  delete lock.skills[name];
  await writeSkillLock(lock);
}

export function getSkillsBySource(
  lock: SkillLockFile,
): Map<string, Array<[string, SkillLockEntry]>> {
  const groups = new Map<string, Array<[string, SkillLockEntry]>>();
  for (const [name, entry] of Object.entries(lock.skills)) {
    const existing = groups.get(entry.source) || [];
    existing.push([name, entry]);
    groups.set(entry.source, existing);
  }
  return groups;
}

export async function saveSelectedAgents(
  agentNames: AgentType[],
): Promise<void> {
  const lock = await readSkillLock();
  lock.lastSelectedAgents = agentNames;
  await writeSkillLock(lock);
}

export async function getLastSelectedAgents(): Promise<
  AgentType[] | undefined
> {
  const lock = await readSkillLock();
  return lock.lastSelectedAgents;
}

function emptyLock(): SkillLockFile {
  return { version: LOCK_FILE_VERSION, skills: {} };
}
