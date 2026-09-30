---
# skillsgate-o7ni
title: 'test(desktop): give the mirrored core-sync engine a test suite'
status: in-progress
type: task
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-30T00:03:23Z
---

apps/desktop/src/main/core-skills.ts is an 888-line mirror of packages/cli/src/core/core-skills.ts with no test file, while the CLI original has 403 lines of tests. Drift between the two is undetected. Give the mirror coverage.

## Checklist
- [ ] Port the CLI core-skills tests that apply to the mirror (fake HOME, fan-out links, remove semantics, installDirToCore)
- [ ] Pin the deliberate divergence: desktop installDirToCore defaults to copy, CLI to link
- [ ] Test command green in apps/desktop context
