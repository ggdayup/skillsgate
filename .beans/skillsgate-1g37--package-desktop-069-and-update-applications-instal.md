---
# skillsgate-1g37
title: Package desktop 0.7.3 and update /Applications install
status: completed
type: task
priority: normal
created_at: 2026-10-05T23:09:36Z
updated_at: 2026-10-06T00:08:09Z
---

包含 Sources 页面选择增强（skillsgate-60rg）。bump 0.6.9（package.json + bun.lock），package:mac 出 DMG+zip，按 AGENTS.md 校验/重建 dmg，同步 latest-mac.yml 与 blockmap，替换 /Applications/SkillsGate.app 并启动验证。

## Note
首次 0.7.3 打包后应用黑屏：release 内 better_sqlite3.node 为 NODE_MODULE_VERSION 133（系统 Node），Electron 需要 146。根因是 bun install --ignore-scripts 跳过原生构建。修复：apps/desktop 里 npm run rebuild:native（electron-rebuild -f -w better-sqlite3）后重新 package:mac。

## Root cause 2
真正根因：commit 655e6e9 把 package.json 升到 electron 42.11.3 + better-sqlite3 12.11.1，但 bun.lock 停留在 electron 35.7.5 + bs3 12.8.0，打包出的原生模块 ABI 133 ≠ Electron 42 需要 146 → 应用黑屏。修复：仓库根 bun install 同步 lock（bun.lock 已更新），apps/desktop npm run rebuild:native 后 nm 确认 node_register_module_v146，再 package:mac。

## Root cause 3 (renderer, found after ABI fix)

Even with better-sqlite3 at NODE_MODULE_VERSION 146, the packaged window stayed
black. Direct run with `--enable-logging=stderr` showed:
`Uncaught ReferenceError: agents is not defined` (renderer bundle).

- `home.tsx:2797` passed `toolAgents={agents}` after the useActiveAgents refactor
  renamed the local to `agentRegistry` — every mount of Home crashed the renderer.
- `ipc-handlers.ts:2272` still referenced `tmpDir` after the persistent-repo-store
  change removed temp clones (dead guard, would throw on the zero-target path).
- `npm run typecheck` never caught these because the root `tsconfig.json` is
  solution-style (`files: []` + references) and bare `tsc --noEmit` checks nothing.
  Use `tsc -p tsconfig.web.json --noEmit` / `tsconfig.node.json` until fixed.
- Also declared the missing global `DetectedAgent` interface in `preload/api.d.ts`
  and typed the shift-click change handler via `e.nativeEvent`.


## Summary of Changes

- Packaged SkillsGate 0.7.3 (DMG + zip, arm64, ad-hoc signed, notarize off) and replaced /Applications/SkillsGate.app. DMG verified: Info.plist + PkgInfo present, zero .BC.T_* strays, bundled better_sqlite3.node at NODE_MODULE_VERSION 146.
- Fixed three release-blocking defects found along the way: (1) bun.lock drift (electron 35 / better-sqlite3 12.8.0) causing the sqlite ABI black screen — synced via bun install + rebuild:native; (2) renderer crash 'agents is not defined' in home.tsx (useActiveAgents rename miss) — now agentRegistry; (3) dead tmpDir reference in ipc-handlers.ts install path — removed.
- Also declared the missing global DetectedAgent type and fixed the shift-click ChangeEvent typing; tsc -p tsconfig.web.json / tsconfig.node.json and i18n:check all pass.
- Follow-up bean: skillsgate-2iy5 (typecheck script is a no-op under the solution-style tsconfig).
- Live verification of the Sources selection controls was completed under bean skillsgate-60rg (via CDP; the cua-driver AX path went unresponsive system-wide mid-session — environmental, not app).
