---
# skillsgate-trar
title: 'Desktop /core: Remove on a stale-link-only skill does nothing (invisible error)'
status: completed
type: bug
priority: normal
created_at: 2026-09-22T10:26:42Z
updated_at: 2026-09-29T09:08:00Z
---

Repro: wechat-computer-use. Core entry was moved to ~/.Trash, but ~/.gemini/antigravity-cli/skills/wechat-computer-use is still a dangling symlink into ~/.agents/skills. planCoreSync() emits an 'unlink' item for that name (findDanglingCoreLinks, core-skills.ts:352), and groupBySkill in apps/desktop/src/renderer/routes/core.tsx:75-88 synthesizes a row for any skill name in the plan. Even one absent from listCoreEntries is synthesized. So the row appears in 'Core skills' with a Remove button. Clicking Remove then Confirm calls coreRemove then removeCoreSkill. That resulted in ENOENT and the IPC handler threw. The renderer caught it into setError, but the error paragraph rendered in the top summary card while the Remove buttons lived in the per-skill list far below.

Fix options: (1) make removeCoreSkill idempotent. A missing core entry should not abort. It should sweep the agent-side dangling links and return ok. (2) surface row-action errors next to the row instead of only in the header. (3) label phantom rows so the action reads 'clean up stale links' instead of 'remove from core'.

## Plan

- [x] removeCoreSkill(): ENOENT in core no longer aborts; still sweeps agent-side dangling links (CLI engine + desktop mirror). Adds coreEntryMissing to the outcome; CLI core remove wording reflects it
- [x] /core: row-action failures render next to the failing row (dangling-link panel + per-skill rows); header banner kept
- [x] Regression test: packages/cli/src/core/core-skills.test.ts (5 cases, incl. the ghost-skill dangling sweep)
- [x] bun run test 13/13 pass; CLI typecheck clean; desktop tsconfig.node + tsconfig.web clean; electron-vite build ok

## Summary of Changes

removeCoreSkill is idempotent. A core entry that is already gone falls through instead of returning a refusal. The loop unlinks every dangling core-pointing link in each tool.

/core row actions report errors inline. The error message renders under the failing row.

Phantom skill rows are distinguished visually in the desktop UI. SkillFanout tracks a phantom boolean flag populated by groupBySkill when a skill is absent from listCoreEntries. The card renders with an amber border and background. It displays a stale-link only chip. The action button reads Clean up stale links instead of Remove or Remove from Core. Clicking the button immediately invokes removeCoreSkill with detach mode. Unlinked tools for phantom rows show not linked instead of linked.

CLI core list and status command analysis confirmed no phantom row wording problem. The core list command only enumerates listCoreEntries. It never synthesizes phantom rows. The core status command accurately categorizes dangling links as stale links under each tool. The core remove command handles coreEntryMissing.

Added Chinese translations for all new labels in zh-CN.ts.

## Verification

CLI typecheck passed with zero errors.
CLI test suite passed with 20 out of 20 tests.
Desktop i18n drift check passed with 0 missing translations.
Desktop tsconfig.web and tsconfig.node checks passed with zero errors.
Electron Vite build succeeded.

## Follow-up

- [x] Phantom rows (stale links only) should read "clean up stale links" rather than "remove from the core set"; groupBySkill could flag them separately.
- [x] Check whether the CLI core list/status has the same phantom-row wording problem.
