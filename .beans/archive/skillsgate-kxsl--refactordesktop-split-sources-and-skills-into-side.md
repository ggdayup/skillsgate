---
# skillsgate-kxsl
title: 'refactor(desktop): split sources and skills into side-by-side layout'
status: completed
type: feature
priority: normal
created_at: 2026-09-29T23:12:49Z
updated_at: 2026-09-29T23:34:31Z
---

Adjust Sources page to show Git sources on the left and selected source skills on the right, not expanding all skills by default.

- [x] Refactor scan-sources.tsx layout to master-detail (sources on left, skills on right)
- [x] Update zh-CN.ts translations and check i18n drift
- [x] Run typecheck and verify desktop renderer builds

## Summary of Changes
- Refactored Sources view from single vertical accordion list to responsive master-detail layout.
- Left column displays tracked GitHub repositories with active indicator, metadata, and actions.
- Right column displays skills belonging to the selected repository with search filtering and install actions.
- Updated zh-CN.ts with all required translation keys and passed i18n drift verification.
- Verified live app on macOS via accessibility tree and window capture.
