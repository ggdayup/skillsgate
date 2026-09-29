---
# skillsgate-0m19
title: 'test(core): cover the whole-directory-symlink false-conflict guard'
status: completed
type: task
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-29T11:41:45Z
---

ADR-0001 records the false-conflict guard at packages/cli/src/core/core-skills.ts as the invariant that stops all core entries being reported as conflicts when an agent symlinks its entire skills dir at the core dir. The guard has no unit test — it rests on documentation and one observed run. Add regression coverage.

## Checklist
- [x] Add a planCoreSync test that builds an agent whose globalSkillsDir is a symlink to the core dir
- [x] Assert every entry comes back action=skip-present with the tool-dir-is-core reason
- [x] Assert a second sync performs zero links (idempotence)
- [x] cd packages/cli && bun run test passes
