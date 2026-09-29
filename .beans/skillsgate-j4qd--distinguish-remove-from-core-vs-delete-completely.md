---
# skillsgate-j4qd
title: Distinguish remove from core vs delete completely in core view
status: completed
type: feature
priority: high
created_at: 2026-09-28T13:23:20Z
updated_at: 2026-09-28T13:33:50Z
---

Differentiate between 'Remove from Core' (deactivate/unlink, preserve in library/store) and 'Delete completely' (purge from all locations) in the Core UI and backend.



## Todo
- [ ] Step 1: Model domain types CoreRemoveMode (detach | purge) in core-skills
- [ ] Step 2: Implement detach and purge logic in removeCoreSkill
- [ ] Step 3: Update IPC handler and preload signature
- [ ] Step 4: Add RemoveCoreSkillModal in core view
- [ ] Step 5: Add i18n strings for English and Simplified Chinese
- [x] Step 6: Verify via unit tests and build



## Summary of Changes
- Defined domain type `CoreRemoveMode` (`detach` | `purge`).
- Implemented `removeCoreSkill` in desktop and CLI engines:
  - `detach`: Unlinks from Core and all connected agent tools. If the entry is a real directory without a backup in canonical storage, it safely preserves a copy in `~/.agents/.store/` before unlinking.
  - `purge`: Completely deletes the skill from Core (`~/.agents/skills`), canonical store (`~/.agents/.store`), skills library (`~/.agents/skills-library`), all agent tools, and `.skill-lock.json`.
- Updated IPC handler `core:remove` and preload API to pass the removal mode.
- Replaced ambiguous row confirmation button in Core view with `RemoveCoreSkillDialog` offering clear choices: 'Remove from Core only (Preserve in library / store)' vs 'Delete completely from disk'.
- Added complete translations in `zh-CN.ts` and verified `i18n:check`.
- Added unit tests for detach and purge in `core-skills.test.ts` (19/19 passing) and verified production build.
