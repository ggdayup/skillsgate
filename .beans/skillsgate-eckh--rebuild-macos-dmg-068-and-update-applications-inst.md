---
# skillsgate-eckh
title: Rebuild macOS dmg 0.6.8 and update /Applications install
status: completed
type: task
priority: normal
created_at: 2026-10-05T07:47:42Z
updated_at: 2026-10-05T07:49:07Z
---

Package wzqu feature (242723f) as desktop 0.6.8: version bump, package:mac, verify dmg integrity, install to /Applications.

## Summary

- Bumped desktop 0.6.7 -> 0.6.8 (package.json + bun.lock re-synced; bun.lock had drifted at 0.6.6).
- package:mac built SkillsGate-0.6.8-arm64.dmg + zip + blockmaps; latest-mac.yml regenerated.
- dmg verified intact: Info.plist + PkgInfo present, no .BC.T_* files, asar contains git-sources:check-updates.
- Installed to /Applications (app was not running; ditto + xattr -cr); installed copy verified 0.6.8 with new code.
- release/ artifacts are gitignored, not committed.
