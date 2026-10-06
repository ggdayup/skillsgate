---
# skillsgate-60rg
title: 'Sources: richer skill selection controls'
status: completed
type: feature
priority: high
created_at: 2026-10-05T22:54:51Z
updated_at: 2026-10-06T00:07:54Z
---

Sources 页面（scan-sources.tsx）的 skill 选择不够灵活。丰富为：Select All（作用于当前过滤结果）、Invert、按状态快选、按 subPath 目录分组三级全选、Shift+click 范围选；并修复切换仓库时选择状态不清空的 bug。

## Todo
- [x] 工具栏：Select All / Invert / Not installed / In Core（均作用于过滤后列表）
- [x] 按 subPath 目录分组，组级全选（含半选态 indeterminate）
- [x] Shift+click 范围选（锚点按 name 重解析，过滤变化仍可用）
- [x] 切换仓库时清空已选并重置锚点
- [x] zh-CN 文案补齐 + typecheck + i18n:check + electron-vite build 全绿（顺带修复历史重复键 Select all）

## Note

沙箱 shell 中 electron-vite dev 渲染黑屏（AGENTS.md 已知限制），实时 UI 验证需在普通终端跑 `npm run dev -w apps/desktop` 人工确认。


## Summary of Changes

- Toolbar quick-selects on the filtered list: Select all (n) / Invert / Not installed (n) / In Core (n), with tooltips; zero-count buttons disabled.
- Skills grid grouped by subPath parent directory; each group header has a tri-state checkbox (checked / indeterminate) that toggles the whole group; root group labeled 'Repository root'.
- Shift+click range selection anchored to the last clicked skill; the anchor re-resolves by name so filtering cannot stale the range.
- Switching repositories now clears the pending selection (previous leak fixed).
- i18n: added zh-CN entries; removed a pre-existing duplicate 'Select all' key.
- Live verification (0.7.3 packaged app, via CDP): Select all 26/26, Invert 0, Not installed 23 + 1 indeterminate group header, shift-click range 1..5 exact, repo switch clears (42 boxes, 0 checked).
