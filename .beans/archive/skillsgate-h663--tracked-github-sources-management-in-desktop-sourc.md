---
# skillsgate-h663
title: Tracked GitHub sources management in desktop Sources view
status: completed
type: feature
priority: normal
created_at: 2026-09-28T06:52:29Z
updated_at: 2026-09-28T07:11:39Z
---

Implement GitHub source tracking management in desktop UI:
- Upgrade Scan Sources to unified Sources page with dual tabs: GitHub Sources & Local Paths
- Filesystem-as-truth discovery of tracked repos in ~/.agents/.store/repos/*
- Display commit metadata, dirty status, skill lists with install statuses
- Single & global pull with dirty-tree protection
- Add new GitHub source dialog with skill preview & install
- Safe untrack/delete dialog with symlink cleanup options
