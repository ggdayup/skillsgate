---
# skillsgate-5exy
title: 'Research: Impact of in-flight Git conflict markers on linked agent harnesses'
status: completed
type: task
priority: high
tags:
    - wayfinder:research
created_at: 2026-10-05T11:50:53Z
updated_at: 2026-10-05T12:04:18Z
parent: skillsgate-gikd
---

## Question

When a skill in ~/.agents/.store/repos contains unresolved Git conflict markers (<<<<<<< / ======= / >>>>>>>), how do downstream agent harnesses (Claude Code, Cursor, Antigravity, OpenCode, etc.) behave when parsing SKILL.md or executing helper scripts? Should SkillsGate temporarily quarantine or un-link conflicted skills from the Core / agent directories until conflicts are resolved?
