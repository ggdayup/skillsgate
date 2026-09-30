---
# skillsgate-1w5u
title: 'fix(db): consolidate three drifted SQLite migration sets'
status: completed
type: bug
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-30T02:31:37Z
---

The schema is defined three times and the copies disagree:
- apps/desktop/src/main/db/migrations.ts (v1-v4)
- packages/tui/src/db/migrations.ts (v1-v4)
- packages/local-db/src/migrations.ts (v1 only)

desktop cached_skills has 5 columns TUI lacks; local-db remote_servers has auto_sync the others lack. Every statement is CREATE TABLE IF NOT EXISTS, so the first process to open the file defines the schema and later ones silently run against tables missing their columns. Masked, not solved.

## Checklist
- [x] Single source of truth for migrations, consumed by desktop and TUI
- [x] Existing databases created by either surface keep working (no data loss)
- [x] New installs get one canonical schema
- [x] Tests prove both old shapes upgrade


## Summary of Changes (Landed)
- **Bean ID**: `skillsgate-1w5u`
- **Landed Commit**: `c61b331d6f87b5ca48d673666842b7ebdad30a99`
- **Reviewer Report**: `.herdr/reports/skillsgate-1w5u-review.md`
- **Test Gate**: `bun install --ignore-scripts && cd packages/cli && bun run test`
