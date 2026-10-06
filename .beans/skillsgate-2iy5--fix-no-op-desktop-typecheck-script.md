---
# skillsgate-2iy5
title: Fix no-op desktop typecheck script
status: todo
type: task
created_at: 2026-10-05T23:32:29Z
updated_at: 2026-10-05T23:32:29Z
---

apps/desktop package.json 'typecheck' runs bare `tsc --noEmit` against the solution-style tsconfig.json (files: [] + references), which checks nothing — it let the 'agents is not defined' and 'tmpDir' renderer/main bugs ship in 0.7.3. Change the script to `tsc -b` (or run tsconfig.web.json and tsconfig.node.json explicitly), and fix any errors it then surfaces.
