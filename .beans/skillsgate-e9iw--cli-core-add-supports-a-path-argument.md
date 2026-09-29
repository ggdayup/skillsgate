---
# skillsgate-e9iw
title: 'CLI: core add supports a path argument'
status: completed
type: task
priority: low
created_at: 2026-09-22T09:46:32Z
updated_at: 2026-09-29T09:12:12Z
---

跟进 skillsgate-gkjs（Desktop 已实现）。现状：packages/cli/src/commands/core.ts:296-374 的 `core add <name>` 是按名字提升/.store 移动，不接受路径。缺口：`core add --from-path <dir>`（含 symlink/copy 模式、SKILL.md 校验、重名幂等）。可镜像 Desktop 的 installDirToCore link 模式实现。

## Summary of Changes

- Added `CoreInstallOptions` and `CoreInstallOutcome` interfaces in `packages/cli/src/types.ts`.
- Exported `installDirToCore`, `resolveLocalSkill`, and `findDanglingCoreEntries` from `packages/cli/src/core/core-skills.ts`.
- Updated `installDirToCore` to default to link mode. It handles symlink creation with relative path resolution, fallback to copy, conflict detection, and backup on replace.
- Implemented `resolveLocalSkill` to validate skill directories or SKILL.md paths. It extracts and sanitizes names from explicit arguments, frontmatter, or directory names.
- Updated `packages/cli/src/commands/core.ts` with `--from-path`, `--copy`, and `--replace` flags.
- Enhanced `runCoreAdd` to detect local paths automatically, accept `--from-path`, support dry runs, and report idempotent link statuses.
- Exported `addPathToCore` helper in `packages/cli/src/commands/core.ts` for programmatic usage.
- Added comprehensive unit tests in `packages/cli/src/core/core-skills.test.ts` covering link mode, copy mode, conflict detection, replace backups, path traversal neutralization, frontmatter parsing, direct SKILL.md file resolution, missing SKILL.md errors, and dangling symlink detection.

## Verification Evidence

- `npm test -w packages/cli` executed 34 tests across 9 suites with 0 failures.
- `npm run typecheck -w packages/cli` passed with no TypeScript errors.
- `npm run build -w packages/cli` generated the ESM distribution bundle successfully.
