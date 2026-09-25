---
# skillsgate-e9iw
title: 'CLI: core add supports a path argument'
status: todo
type: task
priority: low
created_at: 2026-09-22T09:46:32Z
updated_at: 2026-09-22T09:46:32Z
---

跟进 skillsgate-gkjs（Desktop 已实现）。现状：packages/cli/src/commands/core.ts:296-374 的 `core add <name>` 是按名字提升/.store 移动，不接受路径。缺口：`core add --from-path <dir>`（含 symlink/copy 模式、SKILL.md 校验、重名幂等）。可镜像 Desktop 的 installDirToCore link 模式实现。
