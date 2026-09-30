---
# skillsgate-f7d4
title: Audit 91 core skills via ollaya mcp for library migration
status: completed
type: task
priority: normal
created_at: 2026-09-29T09:02:31Z
updated_at: 2026-09-29T09:08:54Z
---

Use ollaya mcp to evaluate 91 core skills and determine which can be moved from core to skill library for on-demand loading

## Summary of Findings

- Evaluated all 91 active skills using ollaya MCP (laya model /v1/systemone via JSON-RPC stream).
- Ollaya identified 70 skills that are task-specific, domain workflows, or dev tools that can be offloaded to on-demand skills-library.
- Reconciled with the standing policy minimal-active layer (23 core skills):
  - Retain 23 core skills (~4.8k chars / ~1.4k tokens per turn).
  - Move 68 skills to skills-library (~18.8k chars / ~5.4k tokens saved per turn, -79.5% prompt footprint).
- Mapped all 68 candidate skills into on-demand categories: devtools (8), devops (23), monitoring (1), security (4), productivity (13), content (11), ai (6).
- Audit artifact generated at scratch/skills_audit_result.json.
