export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Resilient fallback frontmatter parser for SKILL.md.
 *
 * Extracts YAML frontmatter without throwing on unquoted colons
 * in string values (e.g. `description: ... Ollaya: classify ...`).
 * Preserves nested mappings (e.g. `metadata:`) as structured objects
 * and multiline strings under `description:` as folded strings.
 */
export function parseFrontmatterFallback(raw: string): SkillFrontmatter | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const block = match[1];

  const data: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const commitCurrent = () => {
    if (!currentKey) return;

    // Check if child lines represent a nested mapping (e.g. metadata:)
    const isNestedMapping =
      currentKey !== "description" &&
      currentLines.some((l) => /^\s+[a-zA-Z0-9_-]+:\s*/.test(l));

    if (isNestedMapping) {
      const nested: Record<string, unknown> = {};
      for (const line of currentLines) {
        const m = line.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
        if (m) {
          let subVal = m[2].trim();
          if (
            (subVal.startsWith('"') && subVal.endsWith('"') && subVal.length >= 2) ||
            (subVal.startsWith("'") && subVal.endsWith("'") && subVal.length >= 2)
          ) {
            subVal = subVal.slice(1, -1);
          }
          nested[m[1]] = subVal;
        }
      }
      data[currentKey] = nested;
    } else {
      let val = currentLines.join("\n").trim();
      if (
        (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
      ) {
        val = val.slice(1, -1);
      } else if (val.startsWith(">-") || val.startsWith(">") || val.startsWith("|")) {
        val = val
          .replace(/^[>|]-?\s*/, "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ");
      } else {
        val = val
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .join(" ");
      }
      data[currentKey] = val;
    }
  };

  for (const line of lines) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      commitCurrent();
      currentKey = keyMatch[1];
      currentLines = keyMatch[2] ? [keyMatch[2]] : [];
    } else if (currentKey && /^\s+/.test(line)) {
      currentLines.push(line);
    }
  }
  commitCurrent();

  if (
    typeof data.name !== "string" ||
    data.name.trim().length === 0 ||
    typeof data.description !== "string" ||
    data.description.trim().length === 0
  ) {
    return null;
  }

  return data as SkillFrontmatter;
}

/**
 * Unified frontmatter parser for SKILL.md.
 *
 * Tries standard YAML parsing first (via parseYaml, e.g. gray-matter).
 * If that throws or yields incomplete name/description fields, falls back to
 * parseFrontmatterFallback.
 */
export function parseSkillFrontmatter(
  raw: string,
  parseYaml?: (content: string) => { data: Record<string, unknown> },
): SkillFrontmatter | null {
  let data: Record<string, unknown> | null = null;
  if (parseYaml) {
    try {
      const parsed = parseYaml(raw);
      if (parsed?.data && typeof parsed.data === "object") {
        data = parsed.data;
      }
    } catch {
      // Fall through to fallback parser on YAML syntax errors
    }
  }

  if (
    !data ||
    typeof data.name !== "string" ||
    data.name.trim().length === 0 ||
    typeof data.description !== "string" ||
    data.description.trim().length === 0
  ) {
    const fallback = parseFrontmatterFallback(raw);
    if (!fallback) return null;
    data = data ? { ...data, ...fallback } : fallback;
  }

  if (
    typeof data.name !== "string" ||
    data.name.trim().length === 0 ||
    typeof data.description !== "string" ||
    data.description.trim().length === 0
  ) {
    return null;
  }

  return data as SkillFrontmatter;
}
