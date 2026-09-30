# ADR-0010: Dynamic Core source resolution via symlink targets and non-destructive Detach mode

## Status

Accepted · 2026-09-30

Introduced by `skillsgate-eqyy` ("Batch remove from Core by source and add source filtering to Core management").

## Context

The Core skills directory (`~/.agents/skills`) is the shared set that fans out into 33 coding agent harnesses. Entries in Core originate from multiple distinct sources:

- Persistent GitHub repositories (`~/.agents/.store/repos/{repo}`)
- Monorepos with nested plugin subdirectories (`cursor/plugins / pstack`)
- Non-core canonical store (`~/.agents/.store/{skill}`)
- Core-native hand-curated directories
- External local paths developed on the user machine

Users needed to filter Core skills by originating source and batch-remove skills by repository.

Furthermore, removing a skill from Core must not cause unintended data loss. Users who remove a skill installed from GitHub want to detach it from Core and all agents, but expect the downloaded repository and skill files to remain intact on disk.

## Decision Drivers

- Directory contents must remain the single source of truth. No secondary manifest file or metadata database.
- Safe default removal. Removing from Core must not delete the underlying Git repository or user files.
- Monorepo hierarchy must be preserved and accurately classified in UI filtering.
- Atomic batch operations. Removing multiple skills must execute in one sweep and reconcile caches once.

## Considered Options

### Option 1: Dynamic source resolution via symlink target inspection with Detach mode

- **Pros**: Zero metadata drift because source identity is computed directly from `realPath`. Safe by default because Detach only unlinks from Core and agents. Preserves cloned repositories and local directories.
- **Cons**: Requires reading `.git/config` to discover remote origin URLs. Requires canonicalizing both symlink targets and base store directories across operating systems.

### Option 2: Record source metadata in `core.json` manifest

- **Pros**: Avoids filesystem path inspection at list time.
- **Cons**: Violates ADR-0001 ("the directory is the truth"). If a user renames, moves, or symlinks files manually, the manifest drifts and produces stale or missing entries.

### Option 3: Hard delete on removal

- **Pros**: Simpler implementation.
- **Cons**: Destructive. Removing a skill from Core wipes out the entire cloned Git repository or local source directory, destroying user work.

## Decision

Derive source classification dynamically at inspection time, and support two distinct removal modes.

### 1. Dynamic Source Resolution (`resolveCoreSources`)

Inspect each Core entry target using `realpathOrResolve`. Match against base directories:

- If target resides in `STORE_REPOS_DIR`, classify as `git`. Read `.git/config` for origin URL. Extract nested subdirectories (such as `pstack/skills/*`) to identify the plugin `subGroup`.
- If target resides in `CANONICAL_SKILLS_DIR`, classify as `store`.
- If target resides in `CORE_SKILLS_DIR`, classify as `core-native`.
- Otherwise, classify as `local-path`.

Both unresolved and resolved base paths are compared to guarantee correct matches on platforms with ancestor symlinks (such as macOS `/var` linking to `/private/var`).

### 2. Non-Destructive Detach vs Explicit Purge (`removeCoreSkill`, `removeCoreSkills`)

- **`detach` (default)**: Removes the entry from `~/.agents/skills` and sweeps links across all 33 agents. If the core entry was a real directory, moves it to `CANONICAL_SKILLS_DIR` to prevent data loss. Never deletes files inside `STORE_REPOS_DIR`.
- **`purge`**: Unlinks from Core and agents, deletes from `CANONICAL_SKILLS_DIR`, and sweeps cold storage in `SKILLS_LIBRARY_DIR`.

## Consequences

### Positive

- Core management UI can group and filter skills by repository and plugin sub-group.
- Users can safely remove skills from Core without re-cloning repositories later.
- Batch operations unlink dozens of skills in one operation and run a single cache invalidation.

### Negative

- First list of Core skills performs fast `.git/config` reads for unique repository roots.
- Mitigation: Repository metadata is cached in an in-memory map during the sweep.

## Implementation Notes

- Resolution engine: `resolveCoreSources` in `apps/desktop/src/main/core-skills.ts:880` and `packages/cli/src/core/core-skills.ts:960`.
- Removal functions: `removeCoreSkill` in `apps/desktop/src/main/core-skills.ts:758` and `packages/cli/src/core/core-skills.ts:824`.
- Batch removal: `removeCoreSkills` in `apps/desktop/src/main/core-skills.ts:850` and `packages/cli/src/core/core-skills.ts:918`.
- IPC registration: `core:batch-remove` in `apps/desktop/src/main/ipc-handlers.ts:311`.
- UI: Source filter dropdown and batch toolbar in `apps/desktop/src/renderer/routes/core.tsx`.

## Related Decisions

- ADR-0001: Two-tier skill store with core-set fan-out (defines the Core directory lifecycle).
- ADR-0002: Path identity via `realpath` (provides link target resolution).
- ADR-0009: Persistent GitHub repository store (creates the repo targets classified here).

## References

- Issue / Bean: `skillsgate-eqyy` ("Batch remove from Core by source and add source filtering to Core management").
