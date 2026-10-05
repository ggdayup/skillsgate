---
# skillsgate-wzqu
title: 'Tracked GitHub sources: proactive update discovery and prompting'
status: in-progress
type: feature
priority: normal
tags:
    - ready-for-agent
created_at: 2026-10-05T00:50:25Z
updated_at: 2026-10-05T03:34:29Z
---

## Problem Statement

As a SkillsGate desktop user who tracks upstream GitHub skill repositories, I have no way to know when a tracked source has new commits upstream. Today the Sources view only shows the locally cloned state, and discovering updates requires manually clicking Refresh / Pull on each source (or Update All) and watching what happens. Installed skills therefore go stale silently, and I only find out by chance.

## Solution

The app proactively discovers upstream updates for tracked GitHub sources and prompts the user in the Sources view:

- Opening the Sources view triggers a lightweight remote check and marks each source as up-to-date, update-available (showing local vs remote commit), dirty (local modifications block pulling), or unknown (network/auth failure).
- Once every 24 hours, during an early-morning idle window, the app re-checks automatically while it is running, so the badge is fresh without any clicks.
- Update-available sources are surfaced with a count badge and per-source markers, reusing the existing one-click Pull / Update-All actions. Pulling is always an explicit user action; nothing is ever auto-pulled.

## User Stories

1. As a desktop user, I want to see at a glance which tracked sources have upstream updates, so that I don't have to pull each one blindly.
2. As a desktop user, I want the local vs remote commit shown on an outdated source, so that I can judge whether the update matters to me.
3. As a desktop user, I want the check to run automatically when I open the Sources view, so that the markers are fresh without extra clicks.
4. As a desktop user, I want the app to re-check once every 24 hours during early-morning idle time, so that I get fresh update signals without daytime network/CPU interference.
5. As a desktop user, I want to configure or disable the automatic check (enabled flag plus quiet-hours window), so that metered/offline machines stay quiet.
6. As a desktop user, I want a last-checked timestamp next to the update badge, so that I can trust (or distrust) what the badge claims.
7. As a desktop user, I want to update a single outdated source with one click from its marker, so that acting on the prompt is frictionless.
8. As a desktop user, I want to update all outdated sources at once, so that a backlog of updates is cheap to clear.
9. As a desktop user with local modifications in a tracked repo, I want the source clearly marked dirty with pulling blocked, so that the checker never destroys my edits.
10. As a desktop user with a dirty repo that is also behind upstream, I still want to be told an update exists, so that I can stash/reconcile on my own schedule.
11. As a desktop user with symlink-installed skills, I want a pull to take effect immediately, so that the prompt-to-fresh loop is one step.
12. As a desktop user with detached/copied skills, I want to be told that pulling alone will not refresh my installed copies, so that I am prompted to re-sync them.
13. As a desktop user on a flaky or offline network, I want failed checks to show as unknown rather than as up-to-date, so that the UI never lies to me.
14. As a desktop user with many tracked sources, I want the UI to stay responsive with progressive per-source results, so that one slow remote does not freeze the view.
15. As a desktop user, I want in-app prompting only (no OS-level notifications), so that update signals stay quiet and non-intrusive.

## Implementation Decisions

- Single seam: one new remote-check function in the desktop main-process git layer, exposed through one new IPC channel and consumed by the existing Sources-view loading flow. No changes to the persistent repo store layout, the install pipeline, or the paste-install flow. (Seam choice: this keeps the whole feature behind the one seam the Sources view already uses for list/pull; happy to adjust if reviewers prefer the check folded into the existing list channel.)
- Check mechanism is a lightweight remote-ref read (remote HEAD) compared against the local HEAD. It performs no local writes and works with the existing shallow clones.
- Pulling remains exactly the current fast-forward-only pull behind the existing Pull / Update-All actions; the feature only adds discovery and prompting, never auto-pull.
- Schedule: one delayed check shortly after startup, one check on Sources-view open, plus one automatic check per 24 hours anchored inside a configurable early-morning idle window (default 03:00–05:00 local time, only while the app is running and idle). Opening the view never triggers more than one in-flight check; results are cached with a last-checked timestamp.
- Settings additions: an enabled flag for the automatic check, the quiet-hours window, and the persisted last-checked timestamp. The interval itself is fixed at 24 hours per the product decision.
- Status model per source: up-to-date, update-available (with local and remote commits), dirty (availability still reported, pull blocked), unknown (network/auth/timeout failure, with reason).
- Resilience: per-source timeout (order of 15s), bounded concurrency across sources, offline/auth failures degrade to unknown and never to a false up-to-date.
- UI: a toolbar count badge plus per-source markers and a last-checked label, reusing existing Pull affordances. Dirty and detached-copy states get distinct copy so users understand why pulling is blocked or insufficient.
- Respects the persistent-repo-store ADR: store layout, dirty-tree protection, and link/detach semantics are unchanged; respects the paste-install ADR: source resolution and install paths are untouched.

## Testing Decisions

- Test external behavior only, not implementation details: given a fixture repo whose local and remote commits are known, the check reports update-available with both commits; a dirty fixture reports availability with pulling blocked; an unreachable remote reports unknown; the scheduler fires at most once per 24-hour window inside the quiet hours.
- Modules under test: the new remote-check function (pure behavior: local vs remote comparison plus dirty/unknown branches), the 24-hour scheduling logic (window anchoring, once-per-day, idle/running guards), and the Sources-view marker states (badge count, per-source marker, last-checked label).
- Prior art: the CLI-side git unit tests covering clone/pull/dirty behavior, and the installer tests pinning symlink-vs-copy semantics. The desktop main process currently has thin test coverage, so new focused unit tests belong at the new git-layer seam rather than behind the IPC boundary.

## Out of Scope

- OS-level, push, or email notifications; prompting stays in-app.
- Automatic pulling or any write to a dirty working tree.
- Per-skill or per-file diff contents; the feature reports repo-level availability only.
- GitHub API token flows, rate-limit handling, or ETag caching (a possible future refinement for per-skill granularity).
- CLI/TUI parity for tracked-source update prompts.
- Changing clone depth, store layout, or link/detach semantics.

## Further Notes

- The remote-ref read needs network access and must run non-interactively (no credential prompts), consistent with how the app already invokes git.
- Shallow clones are sufficient for a ref comparison; no full fetch is required for discovery (a full fetch only happens on explicit user Pull).
- If the quiet-hours window is missed (machine asleep, app closed), the next startup/view-open check covers it; there is no catch-up backlog beyond the last-checked timestamp.

## Implementation Work

- [x] git 层：checkRemoteUpdate（ls-remote 对比本地 HEAD，dirty/unknown 分支）
- [x] Main：git-sources:check-updates 通道（并发上限、超时、持久化 lastChecked）
- [x] Main：24h 凌晨静默窗口调度器 + 有更新时广播事件
- [x] Preload + api.d.ts：桥接类型与方法
- [x] Renderer：Sources 页 badge、单卡标记、last-checked 文案；i18n
- [x] typecheck 通过；按 spec 补行为测试
