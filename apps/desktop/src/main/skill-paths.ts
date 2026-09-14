// apps/desktop/src/main/skill-paths.ts
//
// Mirrors packages/cli/src/constants.ts for the main process. The desktop
// deliberately does not import from packages/cli (see the note in
// ipc-handlers.ts), so the paths are declared once here and reused everywhere.
import os from "node:os"
import path from "node:path"

const AGENTS_ROOT = path.join(os.homedir(), ".agents")

/** The core skill set. Real dirs, git-tracked; fans out to every detected tool. */
export const CORE_SKILLS_DIR = path.join(AGENTS_ROOT, "skills")

/** Source of truth for non-core (per-tool) installs. */
export const CANONICAL_SKILLS_DIR = path.join(AGENTS_ROOT, ".store")

/** Originals displaced by an explicit "replace" on a conflict. */
export const BACKUP_DIR = path.join(AGENTS_ROOT, ".backup")

/** Per-agent core exclusions. Deliberately NOT in .skill-lock.json. */
export const CORE_CONFIG_PATH = path.join(AGENTS_ROOT, "core.json")
export const CORE_CONFIG_VERSION = 1

/** Both roots count as "global" scope. */
export const SKILL_ROOTS = [CORE_SKILLS_DIR, CANONICAL_SKILLS_DIR]
