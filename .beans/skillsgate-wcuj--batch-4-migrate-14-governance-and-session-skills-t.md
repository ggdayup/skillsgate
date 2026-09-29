---
# skillsgate-wcuj
title: 'Batch 4: migrate 14 governance and session skills to skills-library'
status: completed
type: task
priority: normal
created_at: 2026-09-29T09:51:27Z
updated_at: 2026-09-29T09:52:31Z
---

Move 14 annotated skills from core ~/.agents/skills to skills-library, update agent symlinks and surfaces

## Summary of Changes

- Executed batch4 migration moving 14 annotated skills from core to skills-library:
  - 治理与路由入口: cold-skill-index, skill-creator, write-a-skill, skill-update-workflow, skill-standardization, skill-doctor, skill-security-auditor, using-agent-skills, skills-library-curation
  - 会话级交互协议: context-engineering
  - 长期记忆与回溯: mem-search, session-scanner
  - AI 工具集成: wizard
  - 全局偏好与驱动: gstack
- Retained exactly 22 core skills in ~/.agents/skills (total 5,473 chars, -77.0% total footprint reduction from initial 23,758 chars).
- Cleaned up 14 per-agent symlinks in claude-code, trae, trae-cn, and codex with 0 broken symlinks across all 6 core surfaces.
- Created backup at ~/.agents/.store/skills-pre-cold-batch4-2026-09-29T17-52-08.tar.gz and transaction log at ~/.agents/.store/skills-cold-migration-batch4-2026-09-29T17-52-08.json.
