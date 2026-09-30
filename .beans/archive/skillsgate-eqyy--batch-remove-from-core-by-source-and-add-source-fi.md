---
# skillsgate-eqyy
title: Batch remove from Core by source and add source filtering to Core management
status: completed
type: feature
priority: normal
created_at: 2026-09-29T23:21:14Z
updated_at: 2026-09-29T23:42:09Z
---

## Background
When users install skills from GitHub repositories (such as cursor/plugins or pstack) into Core, they currently have no way to filter Core skills by their origin repository, nor can they batch remove skills of a specific source from Core.

## Tasks
- [ ] Inspect how Core skills and Git repositories interact across main, preload, and renderer
- [ ] Enhance Core skill data model to associate each Core skill with its origin source (e.g., git repository or local path)
- [ ] Add batch remove from Core API in main and preload
- [ ] Add source origin filtering and batch actions in Core route (apps/desktop/src/renderer/routes/core.tsx)
- [ ] Add batch remove from Core action in Git source detail view (apps/desktop/src/renderer/routes/scan-sources.tsx)
- [ ] Verify functionality and TypeScript typecheck
