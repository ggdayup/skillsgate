---
# skillsgate-g2y2
title: 'docs: correct the agent-count badge (28 -> 33)'
status: completed
type: task
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-29T15:19:52Z
---

README.md badge and body say 28 agents; the registry holds 33 (pinned by packages/cli/src/core/agents.test.ts). Find and fix every stale count in README.md prose.

## Checklist
- [ ] Badge says 33
- [ ] Prose counts say 33
- [ ] Agent list in README matches the registry (spot-check the four seam cases: Gemini CLI, the three Antigravity interfaces, Qoder/Qoder CN, CodeArts Doer)


## Summary of Changes (Landed)
- **Bean ID**: `skillsgate-g2y2`
- **Landed Commit**: `5f7b67dc442fd6c458967b8200097701995e801c`
- **Reviewer Report**: `.herdr/reports/skillsgate-g2y2-review.md`
- **Test Gate**: `bun install --ignore-scripts && cd packages/cli && bun run test`
