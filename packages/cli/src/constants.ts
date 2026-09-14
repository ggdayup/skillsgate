// Portions adapted from vercel-labs/skills (https://github.com/vercel-labs/skills)
import path from "node:path";
import os from "node:os";

export const VERSION = "1.1.1";
export const AGENTS_DIR = ".agents";
export const SKILLS_SUBDIR = "skills";
export const UNIVERSAL_SKILLS_DIR = ".agents/skills";
export const LOCK_FILE_NAME = ".skill-lock.json";
export const SKILL_MD = "SKILL.md";
export const PLUGIN_JSON = "plugin.json";
export const MARKETPLACE_JSON = "marketplace.json";
export const CLAUDE_PLUGIN_DIR = ".claude-plugin";

// ---------- Core skills model ----------
//
// ~/.agents/skills   -> the CORE set. Real directories, git-tracked, hand-curated.
//                       Every entry is symlinked into every detected agent.
// ~/.agents/.store   -> source of truth for NON-core (per-agent) installs.
// ~/.agents/core.json-> core fan-out config (per-agent exclusions).
// ~/.agents/.backup  -> originals displaced by an explicit "replace" on conflict.

export const STORE_SUBDIR = ".store";
export const BACKUP_SUBDIR = ".backup";
export const CORE_CONFIG_NAME = "core.json";
export const CORE_CONFIG_VERSION = 1;

export const GLOBAL_LOCK_PATH = () =>
  path.join(os.homedir(), AGENTS_DIR, LOCK_FILE_NAME);

/**
 * Source of truth for non-core, per-agent installs.
 * NOTE: this used to point at `~/.agents/skills`, which now holds the core set.
 */
export const CANONICAL_SKILLS_DIR = () =>
  path.join(os.homedir(), AGENTS_DIR, STORE_SUBDIR);

/** The core skill set. Everything here fans out to every detected agent. */
export const CORE_SKILLS_DIR = () =>
  path.join(os.homedir(), AGENTS_DIR, SKILLS_SUBDIR);

/** Persisted core config (per-agent exclusion lists). */
export const CORE_CONFIG_PATH = () =>
  path.join(os.homedir(), AGENTS_DIR, CORE_CONFIG_NAME);

/** Where a displaced real directory is parked before an explicit replace. */
export const BACKUP_DIR = () =>
  path.join(os.homedir(), AGENTS_DIR, BACKUP_SUBDIR);

export const LOCK_FILE_VERSION = 1;

// Matches upstream vercel-labs/skills SKIP_DIRS
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
]);

export const MAX_SKILL_DEPTH = 5;
