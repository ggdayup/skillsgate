---
# skillsgate-qpyz
title: Rebuild macOS release as 0.6.3 (ship gemini-cli + paste-install)
status: in-progress
type: task
created_at: 2026-09-19T03:41:48Z
updated_at: 2026-09-19T03:41:48Z
---

The 0.6.2 dmg (app.asar built 2026-09-15 08:22) predates the gemini-cli registration and the npx skills-add paste feature (both confirmed absent from the shipped asar). Bump 0.6.2 -> 0.6.3, commit the desktop/CLI changes, rebuild DMG+zip via the documented packaging flow, and verify the new symbols are present in app.asar.
