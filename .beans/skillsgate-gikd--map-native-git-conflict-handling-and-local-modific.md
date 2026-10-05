---
# skillsgate-gikd
title: 'Map: Native Git conflict handling and local modification sync'
status: completed
type: epic
priority: high
tags:
    - wayfinder:map
created_at: 2026-10-05T11:50:44Z
updated_at: 2026-10-05T12:04:18Z
---

## Destination

A production-ready native Git synchronization and conflict resolution architecture for tracked GitHub skill sources in SkillsGate (desktop and CLI), allowing users to preserve local personalized modifications via stash-merge, discard changes via hard reset, or resolve conflict markers directly.

## Notes

- Domain: Git version control, Electron IPC, React desktop UI, Agent skills store.
- Standing preferences: Strictly prioritize data safety (zero data loss); leverage native Git commands without re-inventing VCS primitives; maintain consistency across all 33 supported agent harnesses.
- Skills to consult: wayfinder, research, prototype, grilling.

## Decisions so far

## Not yet specified

- Remote non-fast-forward / rebased upstream handling.
- Integrated visual diff and 3-way merge editor within SkillsGate desktop.
- Batch multi-repo conflict handling during global 'Update All'.

## Out of scope

- Full Git GUI client features (commit graph, interactive rebasing, staging individual hunks).
- Automatic LLM-driven semantic conflict resolution without human confirmation.
- System-level Git credential management and SSH/GPG key configuration.
