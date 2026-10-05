---
# skillsgate-tfmv
title: Batch add selected skills to core in desktop UI
status: completed
type: feature
priority: normal
created_at: 2026-10-05T13:47:37Z
updated_at: 2026-10-05T14:07:27Z
---

Provide a batch action in the desktop library multi-select floating action bar to add/promote multiple selected skills into ~/.agents/skills (core).

### Todo
- [x] Inspect existing single-skill core promotion and installation IPC handlers
- [x] Implement backend batch promote / add to core IPC handler in desktop main process
- [x] Expose batch add to core in preload and desktop API
- [x] Add batch Add to Core button and progress/feedback in home.tsx floating action bar
- [x] Verify TypeScript types and desktop build
- [x] Test batch adding skills to core and verify fan-out state updates
