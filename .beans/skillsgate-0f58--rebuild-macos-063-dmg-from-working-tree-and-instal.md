---
# skillsgate-0f58
title: Rebuild macOS 0.6.3 dmg from working tree and install to /Applications
status: completed
type: task
priority: high
created_at: 2026-09-24T07:31:56Z
updated_at: 2026-09-24T07:35:14Z
---

- Rebuild the desktop dmg carrying the uncommitted in-progress work (skillsgate-tdbt, skillsgate-gkjs, skillsgate-trar).
- No version bump: these beans are still in progress, so this is not a release build; 0.6.3 artifacts are overwritten.
- Verify the bundle is not the sandbox-corrupt one (Info.plist/PkgInfo present, no .BC.T_* leftovers) per AGENTS.md.
- Install into /Applications, replacing the existing 0.6.3 app, and clear quarantine xattrs.

- [x] Typecheck and CLI tests pass
- [x] electron-vite build + electron-builder --mac
- [x] dmg bundle integrity verified
- [x] Installed to /Applications and launched

## Summary of Changes

Rebuilt 0.6.3 from the dirty working tree and installed it. CLI typecheck clean, `packages/cli` tests 14/14 pass.

- `env -u NODE_OPTIONS npm run package:mac -- --config.mac.notarize=false` produced `release/SkillsGate-0.6.3-arm64.dmg` (108,344,928 bytes) plus the zip. `latest-mac.yml` sha512 matches the dmg on disk (electron-builder wrote it, so no manual re-patch was needed this time).
- **The dmg came out intact** — mounted it and found `Info.plist` + `PkgInfo` present with 0 `.BC.T_*` leftovers, so the AGENTS.md `hdiutil create` rescue was not needed. `hdiutil verify` was deliberately not used as the gate.
- Shipped-code check rather than file presence: counted `findDanglingCoreEntries` and `LOCAL_PATH_HINT` twice each in the packaged `app.asar`, confirming the in-progress work from skillsgate-tdbt / -gkjs / -trar is actually in the binary.
- Installed from the mounted dmg via `ditto` after clearing the old 0.6.3 app, then `xattr -cr`. Only `com.apple.provenance` remains (macOS-local, not quarantine), so it opens without the right-click → Open step. `codesign --verify --deep`: valid on disk, satisfies its Designated Requirement.
- Launched and confirmed alive at 14s with 3 SkillsGate Helper processes, i.e. the renderer actually came up.

No version bump: tdbg/gkjs/trar are still in progress, so this is a non-release build and the existing 0.6.3 artifacts were overwritten. Consequence: 0.6.3 users will not receive these fixes via auto-update — bump to 0.6.4 when those beans land.

## Notes

The 12 modified source files are still uncommitted; this bean only covered build and install. Those changes belong to skillsgate-tdbt, -gkjs and -trar, which remain open and track them.
