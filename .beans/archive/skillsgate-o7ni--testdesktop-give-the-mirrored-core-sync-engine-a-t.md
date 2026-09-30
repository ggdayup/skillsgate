---
# skillsgate-o7ni
title: 'test(desktop): give the mirrored core-sync engine a test suite'
status: completed
type: task
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-30T02:21:21Z
---

apps/desktop/src/main/core-skills.ts is an 888-line mirror of packages/cli/src/core/core-skills.ts with no test file, while the CLI original has 403 lines of tests. Drift between the two is undetected. Give the mirror coverage.

## Checklist
- [ ] Port the CLI core-skills tests that apply to the mirror (fake HOME, fan-out links, remove semantics, installDirToCore)
- [ ] Pin the deliberate divergence: desktop installDirToCore defaults to copy, CLI to link
- [ ] Test command green in apps/desktop context


## Summary of Changes (Landed)
- **Bean ID**: `skillsgate-o7ni`
- **Landed Commit**: `72105753204cc67ec54679f5b4945241c903be43`
- **Reviewer Report**: `.herdr/reports/skillsgate-o7ni-review.md`
- **Test Gate**: `bun install --ignore-scripts && cd packages/cli && bun run test`
