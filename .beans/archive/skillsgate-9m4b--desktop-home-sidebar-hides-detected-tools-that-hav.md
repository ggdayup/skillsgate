---
# skillsgate-9m4b
title: Desktop home sidebar hides detected tools that have 0 skills
status: completed
type: bug
priority: normal
created_at: 2026-09-27T04:20:54Z
updated_at: 2026-09-27T04:30:49Z
---

Found while adding the codeartsdoer harness: ~/.codeartsdoer/skills is empty until fan-out, so CodeArts Doer never appears in the Tools list even though it is detected.

home.tsx:1832 filters the list to (agentSkillCounts[a.displayName] || 0) > 0.

That is wrong because the same list is not only a filter — each row is also a drag-and-drop install target (onDropOnAgent at home.tsx:274) and the place a user looks to confirm a harness was registered at all. A tool with 0 skills therefore cannot be given its first skill from the UI: the affordance is hidden behind having already used the affordance. The row already renders the count as \`agentSkillCounts[name] || 0\` (line 286), so nothing about the row needs a nonzero count to be meaningful.

Fix: list every detected tool; keep showing the per-tool count, which may be 0. Rename agentsWithSkills, which would then lie.

TODO:
- [x] home.tsx: drop the > 0 filter from the Tools memo
- [x] Rename agentsWithSkills -> toolAgents (prop type, destructure, 2 render sites, memo deleted, call site passes agents)
- [x] Re-check the section guard still only hides when nothing is detected
- [x] desktop tsconfig.node + tsconfig.web clean, i18n drift clean, electron-vite build
- [x] Rebuild + reinstall the 0.6.3 dmg; confirmed via the accessibility tree that every detected tool is listed


## Summary of Changes

`home.tsx` no longer filters the sidebar Tools list by skill count. Final diff is five
lines of behavior plus a comment:

- deleted the `agentsWithSkills` memo (`agents.filter((a) => (agentSkillCounts[a.displayName] || 0) > 0)`)
- `LeftSidebar` prop `agentsWithSkills` -> `toolAgents` (interface, destructure, section
  guard, row map)
- call site passes `agents` directly
- JSX comment above `<MemoizedLeftSidebar>` recording why empty tools must stay visible,
  so the filter does not come back as an "optimization"

The row already rendered its count as `agentSkillCounts[agent.displayName] || 0`, so a
zero-count row was always displayable — the filter was hiding a valid drop target, not
avoiding a broken render.

### Verification
- `tsc --noEmit -p tsconfig.web.json` and `tsconfig.node.json`: clean. i18n drift:
  199/199, 0 missing, 0 orphaned.
- Rebuilt the 0.6.3 dmg+zip (`env -u NODE_OPTIONS npm run package:mac --
  --config.mac.notarize=false`), DMG passed the bundle gate (`Info.plist` + `PkgInfo`
  present, 0 `.BC.T_*`, `codesign --verify --deep` valid, manifest sha512 + size match),
  reinstalled to `/Applications`, `xattr -cr`.
- Packaged asar: `toolAgents` -> 4, `agentsWithSkills` -> 0, `codeartsdoer` -> 11.
- Read the live window over the accessibility tree (cua-driver, no focus steal): the
  Installed-page sidebar now lists all 25 detected tools including
  `AXButton "CodeArts Doer CodeArts Doer 61"`.

### Caveat on evidence strength
The empty-tool case was not demonstrated end-to-end: the core fan-out ran before this
check, so every detected tool has 61+ skills and no row has a zero count. The zero-count
path is established by reading the code and by the row's pre-existing `|| 0` fallback, not
by observation.
