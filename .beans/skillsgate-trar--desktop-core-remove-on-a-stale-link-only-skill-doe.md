---
# skillsgate-trar
title: 'Desktop /core: Remove on a stale-link-only skill does nothing (invisible error)'
status: in-progress
type: bug
priority: normal
created_at: 2026-09-22T10:26:42Z
updated_at: 2026-09-22T10:56:36Z
---

Repro: wechat-computer-use. Core entry was moved to ~/.Trash, but ~/.gemini/antigravity-cli/skills/wechat-computer-use is still a dangling symlink into ~/.agents/skills. planCoreSync() emits an 'unlink' item for that name (findDanglingCoreLinks, core-skills.ts:352), and groupBySkill in apps/desktop/src/renderer/routes/core.tsx:75-88 synthesizes a row for any skill name in the plan — even one absent from listCoreEntries. So the row appears in 'Core skills' with a Remove button. Clicking Remove->Confirm calls coreRemove -> removeCoreSkill -> fs.lstat(core/<name>) -> ENOENT -> {ok:false, error:'core 中不存在该技能'}; the IPC handler (ipc-handlers.ts:2471) throws. The renderer catches it into setError, but the error <p> renders in the TOP summary card (core.tsx:412) while the Remove buttons live in the per-skill list far below (core.tsx:573+) -> user scrolled to row 'w' sees literally nothing. Verified by running the desktop main modules against the real ~/.agents.

Fix options: (1) make removeCoreSkill idempotent — missing core entry should not abort; still sweep the agent-side dangling links and return ok; (2) surface row-action errors next to the row (or as a toast) instead of only in the header; (3) label phantom rows (stale-link only) so the action reads 'clean up stale links', not 'remove from core'.

## Plan

- [x] removeCoreSkill(): ENOENT in core no longer aborts; still sweeps agent-side dangling links (CLI engine + desktop mirror). Adds coreEntryMissing to the outcome; CLI core remove wording reflects it
- [x] /core: row-action failures render next to the failing row (dangling-link panel + per-skill rows); header banner kept
- [x] Regression test: packages/cli/src/core/core-skills.test.ts (5 cases, incl. the ghost-skill dangling sweep)
- [x] bun run test 13/13 pass; CLI typecheck clean; desktop tsconfig.node + tsconfig.web clean; electron-vite build ok

## Summary of Changes

removeCoreSkill is now idempotent: a core entry that is already gone falls through instead of returning the old "core 中不存在该技能" refusal, so the loop below still unlinks every dangling core-pointing link in each tool. Verified in a temp HOME against the real-world shape (no core entry + one dangling link at .gemini/antigravity-cli/skills/wechat-computer-use): result ok:true, unlinked:1, coreEntryMissing:true, link removed. Before the change the same call returned ok:false.

/core row actions now report inline: runRow(fn, key) stores {key,msg} and the message renders under the failing row (per-skill rows and the broken-links list). The header banner was the only sink, and it sits above the fold on a 65-row page - that is why the failure read as "nothing happened".

NOT COMMITTED YET: apps/desktop/src/main/core-skills.ts, preload/api.d.ts and renderer/routes/core.tsx also carry in-progress work from skillsgate-gkjs and skillsgate-q4h9, so the commit needs to be scoped with the user.

## Follow-up

- [ ] Phantom rows (stale links only) should read "clean up stale links" rather than "remove from the core set"; groupBySkill could flag them separately.
- [ ] Check whether the CLI core list/status has the same phantom-row wording problem.
