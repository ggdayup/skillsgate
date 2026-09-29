# ADR-0001: Two-tier skill store with core-set fan-out

## Status

Accepted · 2026-09-14

Backfilled 2026-09-29. Introduced by `967d176` ("central core skills directory
fanned out to every tool"); physical-path link correction in `ff56a7b`.

## Context

SkillsGate installs skills into 33 different agent harnesses, each with its own
global skills directory. Two populations of skills exist and they want different
lifecycles:

- A hand-curated set that should be *everywhere* — the skills the user wants
  available to every harness.
- Skills installed for one or two particular harnesses.

Before this decision there was one store and no distinction, so "make this
available everywhere" meant repeating the install 33 times, and a per-tool skill
was indistinguishable from a shared one.

There was also a naming collision to absorb: upstream `vercel-labs/skills` uses
`~/.agents/skills` as its canonical global store (see
[ADR-0006](0006-coexist-with-upstream-skills-on-disk.md)).

## Decision Drivers

- **Must not** silently overwrite a directory a tool or a user owns.
- **Must be idempotent** — repeated syncs must converge, not accumulate work.
- **Must survive partial failure** — one conflicted skill cannot abort the sync.
- The shared set should be reviewable and version-controlled, not an artifact
  of install order.

## Considered Options

### Option 1: Two tiers — git-tracked core dir fanned out by symlinks

- **Pros**: one edit propagates everywhere; core set is a real directory tree
  that `git` can diff; per-tool skills remain physically separate; conflicts are
  *visible* rather than resolved by force.
- **Cons**: symlink semantics differ per platform and per tool; a tool that
  symlinks its whole skills dir needs special handling; the fan-out engine is
  the most complex code in the repo.

### Option 2: Copy the core set into every tool directory

- **Pros**: no symlink edge cases; every tool sees plain directories.
- **Cons**: 152 entries × N tools of duplication; a stale copy silently drifts;
  updating the core set means deleting and rewriting user-visible files.

### Option 3: Keep a manifest file listing core skills

- **Pros**: explicit, could carry metadata and versions.
- **Cons**: manifest and directory drift apart — the failure mode upstream has
  (`cleanAndCreateDirectory` deleting a directory the manifest no longer
  describes). A second source of truth to reconcile.

## Decision

Split the store into two tiers and make the directory the source of truth.

| Path | Role |
| --- | --- |
| `~/.agents/skills/` | **Core set.** Real directories, git-tracked, hand-curated. *The contents are the truth — there is no manifest.* |
| `~/.agents/.store/` | Canonical backend for non-core, per-tool installs. Agent-side entries are symlinks into it. |
| `~/.agents/core.json` | Per-agent opt-outs **only**. Never other state. |
| `~/.agents/.backup/` | Where a replaced real directory is parked, never deleted. |

`planCoreSync()` computes one item per (core skill × detected tool); the plan is
pure read, `applyCoreSync()` executes it, and the status view is *the same plan
grouped differently* — so the UI panels cannot disagree
(`packages/cli/src/core/core-skills.ts:269`, `:445`, `:517`).

Four invariants:

1. **Incremental.** Each entry is inspected first and only linked if `missing`
   or `dangling`. Already-linked is `skip-present`.
2. **Never implicit overwrite.** A real directory of the same name is reported
   as `skip-conflict`. Replacing it is a separate, explicit action
   (`replaceConflictWithCoreLink`, `core-skills.ts:940`) that moves it to
   `.backup/` first and rolls back if linking fails.
3. **Only remove our own links.** An unlink is performed only when the target
   resolves *inside* the core dir (`unlinkCoreLinkFromAgent`,
   `core-skills.ts:754`). A real directory is never deleted; in `detach` mode it
   is reported as a residual copy instead.
4. **`core.json` is opt-outs only** because `readSkillLock()` returns an empty
   lock on a version mismatch — storing exclusions in `.skill-lock.json` would
   silently wipe them on any `LOCK_FILE_VERSION` bump.

## Consequences

### Positive

- One edit to the core set reaches every detected tool.
- Conflicts are surfaced as data, never resolved by destroying user files.
- The core set is a normal git tree — reviewable, diffable, revertable.

### Negative

- The fan-out engine (~980 lines) is substantial and its correctness depends on
  subtle symlink behaviour (see [ADR-0002](0002-path-identity-via-realpath.md)).
- **Two implementations must be kept in step**: `packages/cli/src/core/core-skills.ts`
  and `apps/desktop/src/main/core-skills.ts`. The desktop mirror has no test
  suite — drift there is undetected (see
  [ADR-0004](0004-share-logic-mirror-stable-config.md)).
- The two default modes intentionally differ: CLI `installDirToCore` defaults to
  `link`, desktop to `copy`, because the core dir is git-tracked and needs real
  files. Easy to mistake for a bug.

### Risks

- **A tool symlinking its entire skills directory at the core dir would report
  all 152 entries as conflicts.** Mitigated by the false-conflict guard at
  `core-skills.ts:284`, which short-circuits when
  `realpathOrResolve(agentDir) === realpathOrResolve(CORE_SKILLS_DIR)`.
  ⚠️ This guard has no dedicated unit test — it rests on documentation and one
  observed run. Worth a regression test.
- **Windows / cross-device copies fall back to materialised directories.** The
  fallback is reported, but a copy is not a link and will not track later core
  edits.

## Implementation Notes

- Engine: `packages/cli/src/core/core-skills.ts`
- Link primitives: `packages/cli/src/core/installer.ts`
- Paths: `packages/cli/src/constants.ts`
- CLI surface: `skillsgate core list | status | sync [--dry-run] | add | remove | exclude | include`
- Desktop mirror: `apps/desktop/src/main/core-skills.ts`, route
  `apps/desktop/src/renderer/routes/core.tsx`
- Tests: `packages/cli/src/core/core-skills.test.ts`

## Related Decisions

- [ADR-0002](0002-path-identity-via-realpath.md) — the path-identity primitive
  this design depends on.
- [ADR-0006](0006-coexist-with-upstream-skills-on-disk.md) — upstream claims the
  same `~/.agents/skills` path.

## References

- `AGENTS.md` §3 "Symlink Canonical Store Defense" and "Core Skill Set"
- `967d176`, `ff56a7b` (physical containing dir + dead-link sweep)
- Bean `skillsgate-tdbt` — relative symlinks breaking under a symlinked tool dir
