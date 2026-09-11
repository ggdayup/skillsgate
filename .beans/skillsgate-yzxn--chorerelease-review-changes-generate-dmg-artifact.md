---
# skillsgate-yzxn
title: 'chore(release): review changes, generate dmg artifact, and update upstream PR'
status: completed
type: task
priority: high
created_at: 2026-09-11T14:08:37Z
updated_at: 2026-09-11T14:10:45Z
---

Review all agent harness changes (CodeBuddy app detection, WorkBuddy AI), build release DMG package, commit clean updates, and update upstream PR #26 on skillsgate/skillsgate



## Summary of Changes
- Reviewed CodeBuddy and WorkBuddy AI harness implementations and broadened app bundle detection to support both /Applications/CodeBuddy.app and /Applications/CodeBuddy CN.app.
- Added 'CodeBuddy' alias to renderer DISPLAY_NAME_TO_KEY.
- Built new production release DMG package: apps/desktop/release/SkillsGate-0.6.0-arm64.dmg (103MB).
- Committed code updates across main and cherry-picked to PR branch feat/support-more-coding-agents.
- Pushed updated commits to GitHub fork ggdayup/skillsgate, updating upstream PR #26.
