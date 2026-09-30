# ADR-0009: Persistent GitHub repository store under `~/.agents/.store/repos`

## Status

Accepted · 2026-09-28

Backfilled 2026-09-30. Introduced by `skillsgate-h663` ("Tracked GitHub sources management in desktop Sources view").

## Context

Upstream `skills` clones remote repositories into temporary directories and copies skill folders out. Once copied, the local files lose all connection to their remote git repository.

This created several operational problems:

1. Skills could not be updated in place. Users had to delete and re-install.
2. Monorepos containing dozens of skills (such as `cursor/plugins`) were repeatedly re-cloned for each skill, duplicating disk space and network bandwidth.
3. User edits inside cloned skills could not be tracked or protected against overwrite.
4. Offline re-scanning and discovery of tracked skill sources was impossible without persistent clones.

## Decision Drivers

- Remote skills must support on-demand `git pull` updates across all 33 coding agents.
- Monorepos must share a single repository clone rather than duplicating per skill.
- Local user modifications in cloned repositories must never be silently clobbered.
- Static store directories must be safely backed up rather than overwritten.

## Considered Options

### Option 1: Persistent Git clone under `~/.agents/.store/repos` with symlinked skills

- **Pros**: A single clone serves multiple skills. Running `git pull` in the repository immediately propagates updates across all 33 agent harnesses because Core skills and agent copies link to it. Uncommitted changes are detectable via `git status --porcelain`.
- **Cons**: Requires managing git processes in desktop main and CLI. Symlink indirection must be canonicalized carefully.

### Option 2: Ephemeral clone and copy into store (upstream approach)

- **Pros**: Simple to implement. Does not require persistent git tracking.
- **Cons**: Re-downloading on every install. No update mechanism. Monorepos explode disk consumption. User edits are lost on re-install.

### Option 3: Submodule tracking in `~/.agents`

- **Pros**: Standard git feature.
- **Cons**: Submodules are notoriously brittle for end users. They break if parent directory git status conflicts, and require manual recursive updates.

## Decision

Establish a persistent local repository store under `~/.agents/.store/repos/{owner}-{repo}`.

Skills discovered within the repository are symlinked into canonical store (`~/.agents/.store/{skill}`) and Core (`~/.agents/skills/{skill}`).

Three safety invariants govern this model:

1. **Dirty tree protection**: Before running `git pull`, check `git status --porcelain`. If uncommitted local edits exist, the pull is skipped and alerted to prevent clobbering.
2. **Static store takeover**: If a skill was previously copied as a static directory into `~/.agents/.store/{skill}`, taking over with a persistent repo backs up the static folder to `~/.agents/.backup/` before replacing it with a symlink.
3. **Instant propagation**: A single update in `~/.agents/.store/repos/{owner}-{repo}` updates all 33 agent harnesses immediately through existing symlink chains.

## Consequences

### Positive

- Updating a GitHub source updates all installed skills from that repository simultaneously.
- Monorepo repositories are downloaded once and shared across multiple skills.
- The desktop Sources view can display commit logs, branch status, and dirty state.

### Negative

- Cloned repositories occupy persistent disk space in `~/.agents/.store/repos`.
- Broken git states (such as merge conflicts or detached heads) require explicit user notification.

### Risks

- Network timeouts during `git clone` or `git pull` could hang processes.
- Mitigation: All git commands run through `gitExec` with explicit timeouts (90 seconds default) and non-interactive environment flags (`GIT_TERMINAL_PROMPT=0`).

## Implementation Notes

- Constants: `STORE_REPOS_DIR` in `packages/cli/src/constants.ts:40` and `apps/desktop/src/main/skill-paths.ts:25`.
- Git execution and repo lifecycle: `apps/desktop/src/main/git-repo.ts:121` (`gitExec`), `git-repo.ts:229` (`ensurePersistentRepo`), `git-repo.ts:264` (`createStoreSymlink`).
- Mirrored git utilities: `packages/cli/src/core/git-repo.ts`.
- Desktop UI integration: `apps/desktop/src/renderer/routes/scan-sources.tsx`.

## Related Decisions

- ADR-0001: Two-tier skill store with core-set fan-out (provides the symlink targets).
- ADR-0002: Path identity via `realpath` (resolves symlinks pointing into `STORE_REPOS_DIR`).
- ADR-0010: Core skill source resolution and detach mode (classifies skills pointing to `STORE_REPOS_DIR`).

## References

- Issue / Bean: `skillsgate-h663` ("Tracked GitHub sources management in desktop Sources view").
- Documentation: `AGENTS.md` section 3 ("Persistent GitHub Repository Store").
