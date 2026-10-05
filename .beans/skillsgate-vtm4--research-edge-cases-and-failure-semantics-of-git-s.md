---
# skillsgate-vtm4
title: 'Research: Edge cases and failure semantics of git stash pop in non-interactive environments'
status: completed
type: task
priority: high
tags:
    - wayfinder:research
created_at: 2026-10-05T11:50:49Z
updated_at: 2026-10-05T12:04:18Z
parent: skillsgate-gikd
---

## Question

When git stash pop encounters merge conflicts or uncommitted untracked collisions in a non-interactive subprocess (GIT_TERMINAL_PROMPT=0), what exact exit codes, stdout/stderr messages, and porcelain status codes does Git produce? How can the desktop engine reliably verify whether the stash entry was retained on the stash stack or dropped, and what is the exact recovery sequence?
