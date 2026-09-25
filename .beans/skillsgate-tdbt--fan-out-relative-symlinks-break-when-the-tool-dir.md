---
# skillsgate-tdbt
title: Fan-out relative symlinks break when the tool dir sits behind a symlinked ancestor (zed permanently missing)
status: in-progress
type: bug
priority: high
created_at: 2026-09-22T13:28:48Z
updated_at: 2026-09-22T13:55:34Z
---

## Diagnosis

~/.config/zed is a symlink to ~/ggdayup/SyncedConfig/config/zed (the user keeps agent config under SyncedConfig). Fan-out built links with path.relative(logicalAgentDir, coreRealPath). The kernel resolves .. only AFTER following every symlink in the path, so from the physical dir the relative path is short by the symlink hop and lands at ~/ggdayup/SyncedConfig/.agents/... which does not exist. fs.symlink() succeeds regardless, so nothing reported it: /core showed all 64 zed skills as missing, and Sync re-created the same broken link forever (plan action for a dangling link is link).

Audited every detected tool: zed was the only broken one (40/40 links dangling). Relocated-but-fine: antigravity, codebuddy, codebuddy-cn, pi, workbuddy-ai, because their skills dir *is* the core dir, so the whole-dir short-circuit applies. github-copilot shares configHome and would break the same way if ~/.config/github-copilot were symlinked.

## Summary of Changes

- packages/cli/src/core/core-skills.ts: new writeCoreLink(physicalDir, target, srcReal) - relative link derived from the REAL containing dir, then verified by resolving the link back and comparing to the source realpath; falls back to an absolute link, and returns false so linkCoreEntry takes its existing copy path. linkCoreEntry now passes realpathOrResolve(dir).
- apps/desktop/src/main/core-skills.ts: same engine change mirrored, plus the local-path symlink-into-core site now uses the physical core dir.
- packages/cli/src/core/installer.ts + apps/desktop/src/main/ipc-handlers.ts: per-tool install symlinks now compute the relative path from realpath(dirname(agentTargetDir)) to realpath(canonicalDir) - same latent bug class.
- packages/cli/src/core/core-skills.test.ts: regression test links a fake zed behind a symlinked ancestor and asserts the SKILL.md is readable *through* the link (proves the .. math), plus a second sync converging to alreadyPresent. Confirmed red with the old one-line relative math, green with the fix. Suite: 14/14 pass; CLI typecheck clean; desktop tsconfig.node + tsconfig.web clean; electron-vite build ok.
- Repaired the live damage: applyCoreSync for zed with the fixed engine replaced the 40 dangling links, 64/64 now resolve, 0 dangling. Done from the repo because the installed 0.6.3 would have re-created the broken links. Note the links now point into the core dir instead of .store, so core remove can actually sweep them.

## Remaining

- [ ] Commit (interleaved with skillsgate-gkjs / skillsgate-q4h9 / skillsgate-trar work in the same files)
- [ ] Rebuild the desktop app so the GUI stops re-creating broken links on the next Sync

- 本机实测补充：5 个 ~/.config 软链（zed/iterm2/raycast/fish/git）已改为真实目录并保留 SyncedConfig 原件；zed 用修复后的引擎重新 fan-out（linked 64 / dangling 0）。logical == physical 后，已安装的 0.6.3 也不会再造坏链，重打 0.6.4 主要为带上 remove 幂等与行内报错。
