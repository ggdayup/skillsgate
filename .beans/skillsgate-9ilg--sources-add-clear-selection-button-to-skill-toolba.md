---
# skillsgate-9ilg
title: 'Sources: add Clear selection button to skill toolbar'
status: completed
type: task
priority: high
created_at: 2026-10-06T00:45:08Z
updated_at: 2026-10-06T00:47:08Z
---

After using Select all / Invert / Not installed / In Core there is no toolbar way to empty the current selection. Add a 5th toolbar button "Clear" on the Git tab of scan-sources that resets selectedSkillNames and the shift-click anchor (lastAnchorRef). ## Todo

- [x] Add Clear button to toolbar in scan-sources.tsx
- [x] Add zh-CN i18n entries (checked key collisions first)
- [x] Verify tsc -p tsconfig.web.json, i18n:check, build

## Summary of Changes

- apps/desktop/src/renderer/routes/scan-sources.tsx: added a 5th toolbar button "Clear" after "In Core" on the Git tab. It calls setSelectedSkillNames(new Set()) and resets lastAnchorRef.current = null (same pattern as the repo-switch reset), so a subsequent shift-click cannot range-select from a stale anchor. Disabled when selectedSkillNames.size === 0; tooltip via t("Clear the current skill selection").
- apps/desktop/src/renderer/locales/zh-CN.ts: added "Clear" -> 清空选择 and "Clear the current skill selection" -> 清空当前已选中的技能 (no key collisions; existing "Clear filter"/"Clear selection"/"Clear all" keys untouched).
- Verification: npx tsc -p tsconfig.web.json --noEmit clean; npm run i18n:check exit 0 (0 missing, 5 pre-existing orphaned); npm run build succeeded.
- Per agreement: code change only, the installed /Applications 0.7.3 app is not repackaged.
