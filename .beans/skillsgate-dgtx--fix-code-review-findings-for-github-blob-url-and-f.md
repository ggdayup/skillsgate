---
# skillsgate-dgtx
title: Fix code review findings for GitHub blob URL and frontmatter resolution
status: completed
type: bug
priority: high
created_at: 2026-09-29T10:47:46Z
updated_at: 2026-09-29T10:56:36Z
---

## Problem
Code review of the GitHub blob URL and frontmatter parser fix identified 5 issues:
1. Standards: Shared parser invariant - duplicate try-catch frontmatter parsing orchestration across skill-discovery.ts and ipc-handlers.ts.
2. Standards: Primitive obsession and middleman re-export.
3. Spec: Subpath scoping lost during install confirmation (label reverted to owner/repo without subpath).
4. Spec: Scope creep in skill-validator.ts (revert).
5. Spec: Silent fallback to repository root on missing subpath, and structured metadata flattening in frontmatter fallback.

## Todos
- [x] Centralize frontmatter parsing into parseSkillFrontmatter in @skillsgate/skill-sources with strict typing
- [x] Preserve subpath in preview.label and thread into final install to prevent full-repo scan
- [x] Explicit error on missing subpath instead of silent fallback to repo root
- [x] Preserve nested YAML mapping structures without string-flattening in fallback parser
- [x] Revert unneeded edit in skill-validator.ts and middleman export in source-parser.ts
- [x] Verify with automated tests across packages
