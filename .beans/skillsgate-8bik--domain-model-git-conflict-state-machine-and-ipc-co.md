---
# skillsgate-8bik
title: 'Domain model: Git conflict state machine and IPC contracts'
status: completed
type: task
priority: high
tags:
    - wayfinder:prototype
created_at: 2026-10-05T11:50:58Z
updated_at: 2026-10-05T12:04:18Z
parent: skillsgate-gikd
blocked_by:
    - skillsgate-vtm4
---

## Question

What is the formal domain state machine (clean -> dirty -> stashing -> pulling -> popping -> merged / conflicted) and TypeScript IPC contract required to represent sync progress, conflict file lists, and resolution states between the Electron main process and the React renderer?
