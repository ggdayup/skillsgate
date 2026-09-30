---
# skillsgate-qpyz
title: Rebuild macOS release as 0.6.3 (ship gemini-cli + paste-install)
status: completed
type: task
priority: normal
created_at: 2026-09-19T03:41:48Z
updated_at: 2026-09-19T03:46:17Z
---


The 0.6.2 dmg (app.asar built 2026-09-15 08:22) predates the gemini-cli registration and the npx skills-add paste feature (both confirmed absent from the shipped asar). Bump 0.6.2 -> 0.6.3, commit the desktop/CLI changes, rebuild DMG+zip via the documented packaging flow, and verify the new symbols are present in app.asar.

## Summary of Changes

Rebuilt the macOS release as **0.6.3**. The prior 0.6.2 dmg predated two desktop features.

- Bumped `@skillsgate/desktop` 0.6.2 -> 0.6.3 (`package.json` + `bun.lock`).
- Added the 10 missing zh-CN keys for `install-from-command.tsx`; i18n drift now 0 missing / 0 orphaned.
- Committed the working tree (gemini-cli registration + paste-install + shared `@skillsgate/skill-sources` parser) as `49c9ea8`.
- Ran `env -u NODE_OPTIONS npm run package:mac -- --config.mac.notarize=false`; exit 0.

Verification (all green):
- skill-sources 36/36, CLI 8/8, desktop node+web tsc clean.
- Shipped `app.asar` (inside the mounted dmg) contains `gemini-cli` x6, `skills:resolve-source` x2, `antigravity-ide` x7.
- DMG was NOT corrupted this run: Info.plist present (0.6.3), 0 `.BC.T_*` files, `codesign --verify --deep --strict` passes.
- `latest-mac.yml` dmg sha512+size match the actual file; `path` still points at the zip.

Note vs 2026-09-15 memory: the sandbox DMG corruption did not reproduce here — the electron-builder dmg step produced a clean image directly, no `hdiutil create` workaround needed.

Artifacts live in `apps/desktop/release/` (gitignored). Auto-update will pick up 0.6.3 once these are published.
