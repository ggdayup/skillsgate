---
# skillsgate-gkjs
title: 'Desktop: add skills via local path input (symlink default + toggle)'
status: in-progress
type: feature
priority: high
created_at: 2026-09-22T09:46:24Z
updated_at: 2026-09-22T09:59:05Z
---

允许用户在 discover 搜索框直接输入本地路径（~/… 或 /…）添加 skill。

设计定稿（grilling 2026-09-22）：
- 入口：扩展 INSTALL_COMMAND_HINT 匹配 `~/` 与 `/` 前缀，走现有 resolveSource → core:install 管道；不加原生目录选择器
- 路径语义：拒绝 ./ 与 ../（main cwd 无意义），报"请用绝对路径或 ~/ 开头的路径"
- 安装目标：沿用双模式，默认勾选 Core
- Copy/Symlink toggle：仅在本地源 + Core 模式显示，默认 symlink（相对→绝对→copy 回退）；远程源恒为 copy；非 Core 维持 copy 进 .store
- 重名：同路径软链幂等"已添加"；同名不同源一键替换（备份到 .backup/ 再换链）
- 错误细分：路径不存在 / 无 SKILL.md / 权限被拒 三种消息
- 断链：/core 状态页显式标注"指向核心集外且目标不存在"的断链条目

## Todo

- [x] 渲染层：LOCAL_PATH_HINT 匹配本地路径输入（discover.tsx）
- [x] 渲染层：InstallFromCommand 增加 symlink/copy toggle（本地源 + Core 时显示，默认 symlink）
- [x] Main：resolveSourceSkills 错误细分（不存在 / 非目录 / 权限 / 无 SKILL.md）+ resolve-source 拒绝 ./ 与 ../
- [x] Main/IPC：core:install 支持 { mode, replace }，同路径幂等 already，冲突 conflict 一键替换（.backup/core--<name>--<stamp>）；GitHub 源强制 copy
- [x] /core 状态页新增断链条目面板（findDanglingCoreEntries + 逐条移除按钮）
- [x] desktop tsconfig.web/node typecheck、i18n drift（0 missing/orphaned）、CLI 8/8 测试、electron-vite build 全绿；installDirToCore 8 场景假 HOME 冒烟通过

## Summary of Changes

- apps/desktop/src/main/core-skills.ts — installDirToCore 增 CoreInstallOptions{mode,replace}：link 模式（相对→绝对→copy 回退）、同源幂等、冲突标记、替换前备份；新增 findDanglingCoreEntries
- apps/desktop/src/main/ipc-handlers.ts — describeLocalPathProblem 三类错误；discoverSkillsInDir 上报 unreadable 目录；resolve-source 拒绝相对路径并回传 sourceType；core:install 透传 opts 并对 github 源强制 copy；core:list 增 danglingEntries
- preload（index.ts + api.d.ts）— coreInstall opts 参数、CoreInstallEntry/CoreInstallOptions、ResolvedSourcePreview.sourceType、CoreListResult.danglingEntries
- renderer — discover.tsx LOCAL_PATH_HINT；install-from-command.tsx 本地源默认勾选 Core + symlink toggle + 冲突替换按钮；core.tsx 断链面板；zh-CN 词典 5 条
- agents.md — paste 流程新增路径形态说明

待办：真实 GUI 手动验证（sandbox 无法启动 electron-vite dev，见 AGENTS.md）。CLI/TUI 跟进 bean：skillsgate-e9iw / skillsgate-bpew
