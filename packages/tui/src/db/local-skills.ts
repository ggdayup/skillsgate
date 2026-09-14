// packages/tui/src/db/local-skills.ts
/**
 * Pure async scanner for local skills under the two SkillsGate roots:
 *   ~/.agents/skills   — the core set
 *   ~/.agents/.store   — non-core (per-tool) installs
 * Returns the minimal shape needed by the push orchestrator.
 * Does NOT depend on React, the store, or the DB layer.
 */
import fs from "node:fs/promises"
import path from "node:path"
import {
  CANONICAL_SKILLS_DIR,
  CORE_SKILLS_DIR,
} from "../../../cli/src/constants.js"

export interface LocalCanonicalSkill {
  folderName: string
  canonicalPath: string
  name: string
}

async function scanRoot(root: string): Promise<LocalCanonicalSkill[]> {
  const results: LocalCanonicalSkill[] = []
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return results
  }

  for (const name of names) {
    if (name.startsWith(".")) continue
    const skillDir = path.join(root, name)
    let stat: Awaited<ReturnType<typeof fs.stat>>
    try {
      stat = await fs.stat(skillDir)
    } catch {
      continue // broken symlink or unreadable
    }
    if (!stat.isDirectory()) continue

    let canonicalPath: string
    try {
      canonicalPath = await fs.realpath(skillDir)
    } catch {
      continue
    }

    const skillMdPath = path.join(canonicalPath, "SKILL.md")
    try {
      await fs.access(skillMdPath)
    } catch {
      continue // no SKILL.md
    }
    results.push({ folderName: name, canonicalPath, name })
  }
  return results
}

/**
 * List every skill directory containing a SKILL.md across the core set and the
 * non-core store. Core wins on a name collision.
 */
export async function listLocalCanonicalSkills(): Promise<LocalCanonicalSkill[]> {
  const byName = new Map<string, LocalCanonicalSkill>()
  for (const entry of await scanRoot(CORE_SKILLS_DIR())) {
    byName.set(entry.folderName, entry)
  }
  for (const entry of await scanRoot(CANONICAL_SKILLS_DIR())) {
    if (!byName.has(entry.folderName)) byName.set(entry.folderName, entry)
  }
  return [...byName.values()]
}
