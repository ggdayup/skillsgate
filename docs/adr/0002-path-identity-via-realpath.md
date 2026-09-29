# ADR-0002: Path identity via `realpath`, never literal path equality

## Status

Accepted · 2026-09-14

Backfilled 2026-09-29. Hardened by `ff56a7b`.

## Context

SkillsGate creates and removes symlinks across directories that are themselves
often symlinks — `~/.config/zed` may point at a synced config tree, an agent may
point its entire skills dir at `~/.agents/.store`, and core entries may be
symlinks into a skills library.

String comparison of paths cannot answer *"are these the same directory?"* once
any link in the chain is involved. Every one of the following had occurred or
was reachable:

- Installing to an agent whose skills dir already *is* the store produced
  `store/x → store/x`, a self-referential link (`ELOOP`).
- Two entries that were the same directory were reported as a same-name conflict
  — in one run, **all 152 core entries** were misreported across five agents.
- A relative link computed from a *logical* containing directory resolved its
  `..` after the kernel walked through a symlinked ancestor, landing somewhere
  else entirely. `symlink()` still returned success, so the result was a
  permanently dangling link and a sync that never converged (40/40 broken on
  Zed; fixed in `ff56a7b`).

## Decision Drivers

- **Must** detect "same directory" reliably regardless of how many links are in
  the path.
- **Must** verify a link *after* creating it — success from `fs.symlink` proves
  nothing about where it resolves.
- **Must** still be able to plan before directories exist.

## Considered Options

### Option 1: `realpath` with a `path.resolve` fallback

- **Pros**: resolves the whole chain; the fallback keeps planning possible for
  not-yet-created paths; one helper usable everywhere.
- **Cons**: `realpath` is a syscall per call; on macOS with many entries this is
  measurable (mitigated by resolving each directory once per plan, not per
  entry).

### Option 2: Compare canonicalised strings only, don't re-verify links

- **Pros**: cheaper.
- **Cons**: cannot catch the relative-`..` mis-resolution, which *succeeds* at
  creation time and only fails on access. This was the exact bug.

### Option 3: Always create absolute links

- **Pros**: immune to `..` arithmetic.
- **Cons**: breaks when the home directory moves or is shared across machines,
  and produces machine-specific links in a git-tracked tree. Rejected.

## Decision

Use a single identity primitive everywhere and treat path equality as
unreadable without it:

```ts
// packages/cli/src/core/installer.ts:34
export async function realpathOrResolve(dir: string): Promise<string> {
  try { return await fs.realpath(dir); } catch { return path.resolve(dir); }
}
```

Applied in six places:

1. **Canonical-agent detection** (`installer.ts:74`) — if the agent dir and
   `~/.agents/.store` resolve identically, write the skill to the store *once*
   and skip link creation entirely. This is the Symlink Canonical Store Defense.
2. **Relative link math** for `.store` entries uses both ends' real paths
   (`installer.ts:211`).
3. **False-conflict guard** — agent dir resolving to the core dir short-circuits
   the whole plan for that tool (`core-skills.ts:291`).
4. **Entry identity** during planning — `realpath(target) === coreRealPath`
   means *linked* (`core-skills.ts:193`).
5. **Physical containing directory** for link creation (`core-skills.ts:374`).
6. **Idempotence checks** in `installDirToCore`.

And every link is **written then re-resolved and compared**; on mismatch the
link is removed and the next form is tried:

```ts
// packages/cli/src/core/core-skills.ts:374 — writeCoreLink
for (const linkValue of [path.relative(physicalDir, srcReal), srcReal]) {
  await fs.symlink(linkValue, target, type);
  const resolved = await fs.realpath(target).catch(() => null);
  if (resolved === srcReal) return true;
  await fs.unlink(target).catch(() => {});
}
return false;
```

Fallback chain: **relative → absolute → copy** (`junction` on win32).

## Consequences

### Positive

- Self-referential links are structurally impossible: identity is checked before
  any link is created.
- The relative-`..` class of bug is caught at creation, not on a later read.
- Convergence is now testable — `core-skills.test.ts:191` asserts a second sync
  performs zero links.

### Negative

- `realpath` failures are swallowed into `path.resolve`, so a *transient* I/O
  error can look like "these are different directories" and produce a spurious
  conflict. The failure mode is safe (report, don't destroy) but noisy.
- The helper is duplicated three times (`packages/cli/src/core/installer.ts`,
  `apps/desktop/src/main/core-skills.ts:119`,
  `apps/desktop/src/main/git-repo.ts:12`) rather than shared.

### Risks

- **A newly added code path compares raw strings instead.** Mitigation: the
  invariant is written down in `AGENTS.md` §3 and exercised by
  `core-skills.test.ts`, which builds a fake symlinked `~/.config/zed` and reads
  through it with `stat()`.

## Implementation Notes

- `packages/cli/src/core/installer.ts:34`
- `packages/cli/src/core/core-skills.ts:291`, `:374`
- Regression test: `packages/cli/src/core/core-skills.test.ts:170-195`

## Related Decisions

- [ADR-0001](0001-two-tier-skill-store-and-core-fan-out.md) — the design this
  primitive exists to make safe.

## References

- Bean `skillsgate-tdbt` — fan-out relative symlinks break when the tool dir is
  behind a symlinked ancestor (root cause; fixed `ff56a7b`)
- `AGENTS.md` §3
