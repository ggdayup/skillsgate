---
# skillsgate-nzq8
title: Fix GitHub blob URL skill discovery parsing
status: completed
type: bug
priority: high
created_at: 2026-09-29T09:30:01Z
updated_at: 2026-09-29T09:45:30Z
---

## Problem
When a user adds skills in the Discover page using a specific file URL like https://github.com/ollaya-dev/ollaya/blob/main/skills/ollaya-decisions/SKILL.md, it discovered skills under .claude/skills but missed the target SKILL.md.

## Root Causes
1. **GitHub blob URL parsing**: `parseGitHubUrl` only handled `/tree/` paths and ignored `/blob/` URLs, dropping `ref` and `subpath`.
2. **Subpath handling**: `resolveSourceSkills` and `skills:resolve-source` discarded `subpath`, falling back to full-repository traversal instead of scoping to the target skill.
3. **YAML frontmatter parsing**: SKILL.md in `ollaya-decisions` contained unquoted colons in `description: ... Ollaya: classify ...`. Standard `gray-matter` threw a YAML syntax error, causing `parseSkillMd` to silently drop the skill.

## Todos
- [x] Reproduce defect with test or script
- [x] Trace repository and skill URL parsing logic in discover / skill importer
- [x] Fix root cause so blob URLs and specific target paths are properly resolved as skills
- [x] Verify fix with automated tests
