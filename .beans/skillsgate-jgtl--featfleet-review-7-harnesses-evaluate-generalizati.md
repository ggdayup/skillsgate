---
# skillsgate-jgtl
title: 'feat(fleet): review 7 harnesses, evaluate generalization, and prepare PR'
status: completed
type: task
priority: high
created_at: 2026-09-11T11:02:26Z
updated_at: 2026-09-11T11:06:49Z
---

Use herdr-run protocol to review recent changes in skillsgate (7 new harnesses: antigravity, codebuddy, workbuddy, workbuddy-ai, trae-cn, pi, mercury), evaluate architectural generalization across desktop/cli/tui, and prepare upstream PR branch.



## Summary of Changes
- Completed gated review of 7 coding agent harnesses (antigravity, codebuddy, workbuddy, workbuddy-ai, trae-cn, pi, mercury).
- Ported realpathOrResolve symlink defense into desktop installSkillToAgent (apps/desktop/src/main/ipc-handlers.ts), eliminating destructive deletion bugs on symlinked global stores.
- Deduplicated DISPLAY_NAME_TO_KEY between agent-logo.tsx and home.tsx in apps/desktop.
- Updated root README.md with 27-agent badge and comprehensive supported agents list.
- Added automated test suite (packages/cli/src/core/agents.test.ts, packages/cli/src/core/installer.test.ts).
- Verified 100% clean passes on tests, typecheck, i18n check, and builds.
- Created isolated upstream PR branch feat/support-more-coding-agents rebased on origin/main, completely excluding internal orchestration files.
