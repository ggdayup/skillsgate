# ADR-0011: Skills library cold storage tier (`~/.agents/skills-library`)

## Status

Accepted · 2026-09-29

Introduced by `skillsgate-f7d4`, `skillsgate-vp1e`, and `skillsgate-wcuj` ("Skills migration to library based on audit").

## Context

As power users accumulate dozens or hundreds of AI skills, keeping every skill active in the Core directory creates severe friction:

1. **Agent context bloat**: Several modern coding agents (such as Claude Code, Cursor, and Windsurf) inspect and index all skills present in their global skills directory on startup. A large skill set consumes valuable LLM context window tokens and degrades agent attention.
2. **Filesystem discovery overhead**: 100+ skills fanned out across 33 agent harnesses generate over 3,300 active filesystem symlinks.
3. **UI and workflow clutter**: Infrequently used skills (such as specialized governance, audit, or session-management skills) bury daily tools.

Users wanted to archive non-essential skills to cold storage without deleting them permanently.

## Decision Drivers

- Inactive skills must be completely hidden from all coding agents.
- Migrating between Core and cold storage must be lossless and reversible.
- Cold storage must support domain-based categorization (such as `governance`, `sessions`, `tools`).
- Hard purges must cascade to cold storage to prevent resurrected ghost skills.

## Considered Options

### Option 1: Dedicated cold storage directory at `~/.agents/skills-library/`

- **Pros**: Clear architectural separation. Coding agent harnesses only look in their own directory (which mirrors `~/.agents/skills/`); they never read `skills-library/`. Skills can be categorized into subfolders. Moving files between Core and Library is an instantaneous filesystem rename on the same mount.
- **Cons**: Adds a third directory concept alongside Core and Store.

### Option 2: Add an `enabled: false` boolean flag in `core.json`

- **Pros**: Keeps files in place in `~/.agents/skills`.
- **Cons**: Violates the foundational rule that directory contents represent truth (ADR-0001). Files left in `~/.agents/skills` are visible to tools that read the directory directly.

### Option 3: Zip compression archive

- **Pros**: Saves disk space.
- **Cons**: Inspecting SKILL.md contents requires decompression. Unnecessary complexity for small text-heavy directories.

## Decision

Establish a cold storage tier at `~/.agents/skills-library/`.

### 1. Complete Isolation from Agents

Skills in `~/.agents/skills-library/` are not symlinked into any agent harness directory. They do not appear in active agent prompt context or active Core listings.

### 2. Category Hierarchy

The library supports arbitrary category subdirectories (such as `governance`, `sessions`, `tools`). Skills can be placed at the library root or within a category folder.

### 3. Cascade Purge

When a user explicitly deletes a skill using `mode: "purge"`, the removal pipeline sweeps `~/.agents/skills-library/` via `purgeFromSkillsLibrary`, deleting any root or sub-folder copies to prevent orphaned duplicates.

## Consequences

### Positive

- Keeps active Core sets lean and focused, preserving coding agent prompt token budgets.
- Preserves specialized and historical skills for future use without risk of accidental deletion.
- Clean separation between active runtime configuration and persistent reference archives.

### Negative

- Users must deliberately promote a library skill back to Core or Store when they wish to use it again.

## Implementation Notes

- Constant: `SKILLS_LIBRARY_DIR` in `packages/cli/src/constants.ts:44` and `apps/desktop/src/main/skill-paths.ts:29`.
- Purge integration: `purgeFromSkillsLibrary` in `apps/desktop/src/main/core-skills.ts:743` and `packages/cli/src/core/core-skills.ts:803`.
- Migration tools and scripts: `.beans/skillsgate-vp1e`, `skillsgate-wcuj`, `skillsgate-f7d4`.

## Related Decisions

- ADR-0001: Two-tier skill store with core-set fan-out (defines the hot active tier).
- ADR-0010: Core skill source resolution and detach mode (defines the purge cascade).

## References

- Issues / Beans: `skillsgate-f7d4`, `skillsgate-vp1e`, `skillsgate-wcuj`.
