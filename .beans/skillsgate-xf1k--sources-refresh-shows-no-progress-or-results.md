---
# skillsgate-xf1k
title: 'Sources: Refresh shows no progress or results'
status: completed
type: feature
priority: high
created_at: 2026-10-05T00:47:49Z
updated_at: 2026-10-05T02:09:04Z
---

In the Sources page (apps/desktop/src/renderer/routes/scan-sources.tsx) the toolbar Refresh button only spins an icon and re-reads local disk state, so the user sees no progress and no result.

Chosen design (agreed with user):
- Merge the Refresh and Update-all-Git-sources buttons into ONE Refresh that runs the full flow: pull every tracked repo (git pull --ff-only, dirty repos skipped) then re-scan, so the action is never a no-op.
- Show progress as an inline status bar inside the toolbar, not a toast.

Work:
- [ ] Main: stream per-repo progress events (git-sources:progress) while refreshing
- [ ] Main: single git-sources:refresh handler; drop the now-dead git-sources:pull-all
- [ ] Preload + api.d.ts: gitSourcesRefresh, onGitSourcesProgress, GitSourceRefreshProgress type
- [ ] Renderer: one Refresh button, inline progress bar (n/total + current repo + elapsed), then a persisted result summary (repos, skills, duration, updated/up-to-date/skipped/failed, and the skill/repo delta vs the previous scan)
- [ ] Per-repo Pull latest button keeps working and feeds the same per-repo badges
- [ ] i18n: zh-CN entries for every new string
- [ ] Delete the now-dead pullingAll state and handlePullAll from the renderer
- [x] typecheck + tests pass

## Summary of Changes

Sources 页的 Refresh 现在是一个动作、一条反馈线。

**合并后的语义**：Refresh = 拉取所有未 dirty 的仓库 + 重新扫描。原来那个只读本地磁盘的 Refresh 被移除，因为它永远不会产生可见变化，这正是"看不出进展和结果"的根因。`git-sources:pull-all` 及其 renderer 调用一并删除，没有留下无用的 API 面。

**进行中**：main 进程通过 `git-sources:progress` 推送 `GitRefreshProgress`，renderer 在工具栏下方显示进度条 + `正在拉取 <repo> (n/total)` + 每 100ms 刷新的计时器。计时器是必需的——进度条本身可能在大仓库上停留数秒而毫无动静。

**完成后**：状态条常驻，显示 updated / up to date / skipped / failed 计数、变动的仓库名、技能增删数、仓库与技能总数、耗时。

### 实现中发现并修正的问题

1. **进度分母撒谎**：`syncAllGitRepos` 原来数的是 store 下的所有目录，包含没有 `.git` 的残留（`stablyai-orca`），于是 5 个仓库的页面显示 `(3/6)`。改为先筛出真实 git 仓库再计数。
2. **卡在 "Refreshing..." 无法恢复**：刷新抛错时 invoke 会 reject，但只有 broadcast 能清掉进行中的 UI。`syncAllGitRepos` 外层加了 try/catch，在 rethrow 前广播 `phase: "error"`。
3. **"1 Updated" 旁边写着 "No change"**：这两行测量的不是一回事（提交 vs 技能清单），并排出现自相矛盾。改为列出实际移动的仓库名，仅在既无新提交也无技能变化时才说"没有变化"。
4. **"Failed" 不带原因**：失败徽章和汇总的 Failed 计数都把 git 自己的报错放进 `title`，否则用户无从判断该怎么办。

### 验证

在真实 app 里跑通（`electron-vite build` + Electron + `orca computer` 驱动），不是只过了编译：

- 进行中：`Pulling addyosmani-agent-skills (1/5)` + 进度条 + 计时器
- 真实拉到新提交：`2686b62 → 1401c8b`，日期 `09-25 → 10-03`
- 完成后：`4 Up to date · 1 Skipped · 5 repos · 166 skills · 7.0s`
- main 日志逐仓库确认：`cursor-plugins: dirty` 被正确跳过（dirty 保护没被这次合并破坏）

过程中一次 1m35s 的运行里出现 1 Failed，而同样的 `git pull` 在 shell 里只要 2s——是瞬时网络抖动。这正是第 4 点的价值：现在失败会带上 git 的原始报错。

`tsc`（node + web）、`i18n:check`（0 missing）、desktop 19 tests、cli 38 tests 全部通过。

### 未做（有意）

`skillsgate-wzqu` 提到的主动更新发现（打开 Sources 时自动检查上游、24h 静默窗口）是独立议题，本次没有碰——它需要新的后台调度与状态存储，不应该混进一个交互修复里。
