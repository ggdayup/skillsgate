---
# skillsgate-orud
title: 'chore: optimize herdr-run protocol with mechanical review gates, sandbox resilience, and skill evolution'
status: completed
type: task
priority: high
created_at: 2026-09-11T10:53:56Z
updated_at: 2026-09-11T10:55:27Z
---

Optimize herdr-run protocol and tooling based on learnings:
1. Add mechanical landing gate (fleet-land script) that enforces review artifact presence (.herdr/reports/<bean-id>-review.md) with VERDICT: APPROVE before allowing git merge.
2. Fix fleet-done sandbox permission error: add fallback to write notice inside worktree when repo root inbox is not writable.
3. Add worktree cold-start dependency optimization: document bun install --ignore-scripts to avoid 10-minute install/typecheck stalls.
4. Add cross-platform binary check (which vs where) to review rubric and coder briefs.
5. Create project AGENTS.md documenting project conventions, herdr-run workflow, and learned practices.
6. Synchronize skill files and scripts back to the herdr-run skill repository.

## Summary of Changes

1. Created mechanical landing script `.herdr/scripts/fleet-land.sh` (and synchronized to `herdr-run` repository) that mechanically blocks merging unless `.herdr/reports/<bean-id>-review.md` exists with `VERDICT: APPROVE` and `LANDABLE: YES`.
2. Enhanced `fleet-done` with sandbox fallback writing to `$PWD/.herdr/inbox` if root inbox is unwritable due to container/agent sandbox restrictions.
3. Added worktree cold-start dependency pre-provisioning guidelines (`bun install --ignore-scripts`) to prevent compile/typecheck stall loops.
4. Added cross-platform binary check rule (`process.platform === 'win32' ? 'where' : 'which'`) to review rubric.
5. Created `AGENTS.md` in `skillsgate` root documenting project architecture, 27 harnesses, symlink safety, and fleet rules.
6. Synchronized and committed skill evolution entries to `herdr-run` repository.
