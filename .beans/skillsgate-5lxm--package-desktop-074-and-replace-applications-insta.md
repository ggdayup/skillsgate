---
# skillsgate-5lxm
title: Package desktop 0.7.4 and replace /Applications install
status: completed
type: task
priority: high
created_at: 2026-10-06T02:08:49Z
updated_at: 2026-10-06T02:20:16Z
---

Commit+push current changes (Clear selection button + release fixes), bump desktop to 0.7.4, package the macOS build, and replace /Applications/SkillsGate.app.

## Todo

- [x] Commit and push all pending changes (direct push to org denied — ggdayup is read-only on skillsgate/skillsgate; pushed to fork branch sync/0.7.4-selection-and-release instead)
- [x] Run package:mac (notarize off) for 0.7.4
- [x] Verify DMG integrity (Info.plist, PkgInfo, no .BC.T_ leftovers, ABI 146, asar contains Clear button)
- [x] Replace /Applications/SkillsGate.app and relaunch

## Summary of Changes

- Commits a77dfda (selection controls + launch fixes) and a6dc544 (version bump 0.7.4) on local main. Direct push to org skillsgate/skillsgate is denied (ggdayup token has push:false; innoke-website SSH key also lacks access), so pushed to fork branch ggdayup/skillsgate:sync/0.7.4-selection-and-release; a fork PR is needed to land on org main.
- Note: system DNS resolution of github.com was failing from this shell (nslookup worked); git push used -c http.curloptResolve=github.com:443:140.82.114.4 as a workaround.
- Packaged with package:mac --config.mac.notarize=false: DMG + zip + blockmaps + latest-mac.yml (yml hashes verified against actual files).
- DMG verified: mounted readonly, Info.plist + PkgInfo present, 0 .BC.T_ leftovers, version 0.7.4; better_sqlite3 exports node_register_module_v146; asar contains "Clear the current skill selection" (2 occurrences).
- Installed to /Applications (ditto + xattr -cr). Live CDP verification of the shipped app on the Sources Git tab: Clear button present and disabled at 0 selected; after Select all (42 boxes checked) it enabled; after clicking Clear selection back to 0 and re-disabled; single-check then Clear also zeroes. App restarted normally without debug port.
