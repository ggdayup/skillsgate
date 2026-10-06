---
# skillsgate-5lxm
title: Package desktop 0.7.4 and replace /Applications install
status: in-progress
type: task
priority: high
created_at: 2026-10-06T02:08:49Z
updated_at: 2026-10-06T02:09:45Z
---

Commit+push current changes (Clear selection button + release fixes), bump desktop to 0.7.4, package the macOS build, and replace /Applications/SkillsGate.app.

## Todo

- [ ] Commit and push all pending changes
- [ ] Run package:mac (notarize off) for 0.7.4
- [ ] Verify DMG integrity (Info.plist, PkgInfo, no .BC.T_ leftovers, ABI 146, asar contains Clear button)
- [ ] Replace /Applications/SkillsGate.app and relaunch
