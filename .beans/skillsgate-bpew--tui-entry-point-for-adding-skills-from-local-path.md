---
# skillsgate-bpew
title: 'TUI: entry point for adding skills from local path'
status: todo
type: task
priority: low
created_at: 2026-09-22T09:46:32Z
updated_at: 2026-09-22T09:46:32Z
---

跟进 skillsgate-gkjs（Desktop 已实现）。TUI 侧管道已就绪：packages/tui/src/data/use-skill-actions.ts:98 已处理 source.localPath（symlink 安装）。缺口是没有直接的"输入路径添加"入口（目前依赖 search/discover 流程）。实现时可复用 cli/src/core/core-skills.ts 的 installSkillToCore。
