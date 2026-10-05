---
# skillsgate-h59u
title: 'Task: Design backup snapshots for discarded dirty skills'
status: completed
type: task
priority: normal
tags:
    - wayfinder:task
created_at: 2026-10-05T11:51:10Z
updated_at: 2026-10-05T12:04:18Z
parent: skillsgate-gikd
blocked_by:
    - skillsgate-8bik
---

## Question

When a user selects 'Discard & Align Remote', what snapshot structure, naming convention, and retention policy should ~/.agents/.backup/ use to ensure zero-loss recovery of discarded changes before git reset --hard and git clean -fd are executed?
