# ADR-0006: Coexist with upstream `skills` on disk, never compete for its name

## Status

Accepted · 2026-09-19

Backfilled 2026-09-29. Lock-file defence at `packages/cli/src/core/skill-lock.ts:43`; bin-name rule
recorded in `docs/install-command-paste.md` §4.

## Context

SkillsGate consumes the *grammar* of upstream `vercel-labs/skills` (npm package
`skills`, invoked `npx skills add …`) so users can paste a README line straight
into the app. That compatibility brings two collisions on disk and one in the
npm bin namespace.

### The two shared paths

| Path | Upstream | SkillsGate |
| --- | --- | --- |
| `~/.agents/skills/` | canonical global store (`UNIVERSAL_SKILLS_DIR`) | `CORE_SKILLS_DIR()` — the git-tracked core set |
| `~/.agents/.skill-lock.json` | `CURRENT_VERSION = 3`; wipes when `version < 3` | `LOCK_FILE_VERSION = 1`; wipes when `version !== 1` |

Both implementations **discard the file on a version mismatch**, so each tool's
lock file is hostile territory to the other. Upstream's
`cleanAndCreateDirectory()` deletes before recreating, which can destroy a real
directory in the core set and break a relative core symlink into a skills
library.

### The bin name

The ecosystem-conventional invocation is `npx skills`. SkillsGate could have
claimed that bin name to make `npx skills` resolve to itself.

## Decision Drivers

- **Must** not destroy another tool's user data.
- **Must not** silently resolve to the wrong implementation — silent failure is
  worse than an honest error.
- Compatibility should be at the level of *syntax and flags*, not of identity.

## Considered Options

### Claim the `skills` bin name

- **Pros**: `npx skills` would route to SkillsGate inside our own projects.
- **Cons**: rejected on three measured grounds:
  1. `npx` ignores `$PATH` entirely and prefers local `node_modules/.bin`, so a
     global collision is a hard `EEXIST` — `npm i -g skillsgate` would *fail*
     for anyone who already has upstream installed. That is precisely the
     target audience.
  2. A local collision resolves to the lexicographically-first package name, and
     `skills` sorts before `skillsgate` — **upstream would win silently**, with
     no error.
  3. Outside a project that already depends on us, `npx skills` still reaches
     the registry and gets upstream regardless.

  A name that either hard-fails or silently loses is not worth having.

### Chosen: distinct name + defensive lock handling

- **Pros**: no namespace conflict; we never destroy upstream's provenance data.
- **Cons**: the two schemas still cannot coexist — upstream will still discard
  *our* lock file. Our defence is one-directional.

## Decision

1. **Never occupy the `skills` bin name.** Published bins are only `skillsgate`
   (`packages/cli/package.json:6`) and `skillsgate-tui`
   (`packages/tui/package.json:5`).

2. **Reuse upstream's *grammar*, not its identity.** The parser understands
   six source types and six flags; where SkillsGate installs only two source
   types, `unsupportedSourceReason()` returns a specific message instead of a
   vague parse failure. Four upstream `--agent` slugs are aliased in
   `UPSTREAM_AGENT_ALIASES`:

   ```
   codex → codex-cli · droid → droid-cli · kilo → kilo-code · roo → roo-code
   ```

3. **Never clobber a foreign lock file.** Writing first checks what is on disk:

   ```ts
   // packages/cli/src/core/skill-lock.ts:43
   const onDiskVersion = await readLockFileVersion();
   if (onDiskVersion !== null && onDiskVersion !== LOCK_FILE_VERSION) {
     const parked = `${lockPath}.v${onDiskVersion}.bak`;
     try { await fs.copyFile(lockPath, parked); }
     catch {
       // Could not preserve it — leave the other tool's file untouched.
       return;
     }
   }
   ```

   Reads are safe either way: `readSkillLock()` returns `emptyLock()` on a
   version mismatch rather than trusting foreign data
   (`skill-lock.ts:17`).

4. **Keep our own state out of the contested file.** Core exclusions live in
   `~/.agents/core.json` (`CORE_CONFIG_VERSION = 1`), precisely because a
   `LOCK_FILE_VERSION` bump would otherwise wipe them.

## Consequences

### Positive

- Installing SkillsGate never breaks an existing `skills` install, and vice
  versa — for files *we* write.
- Pasted upstream commands keep working as a *format*.

### Negative

- **The defence is one-directional.** Upstream will still discard our
  `.skill-lock.json` on its next run; we only guarantee we do not destroy theirs.
  Install provenance is best-effort when both tools are present.
- `~/.agents/skills` remains contested: we define it as the core set, upstream
  treats it as a store it may recreate. Whoever runs last can still delete a
  real directory there.
- Users typing `npx skills` outside our projects get upstream — by design, and
  occasionally surprising.

### Risks

- **Upstream changes the lock schema again.** Mitigation: the `.bak` parking
  keeps the data even when we cannot use it.

## Implementation Notes

- `packages/cli/src/constants.ts:29, 48, 59` — the three contested constants
- `packages/cli/src/core/skill-lock.ts:17`, `:43`
- `packages/skill-sources/src/parse-install-command.ts:120` — aliases
- `docs/install-command-paste.md` §4 and §10

## Related Decisions

- [ADR-0001](0001-two-tier-skill-store-and-core-fan-out.md) — what
  `~/.agents/skills` means to us.
- [ADR-0008](0008-pasted-install-commands-are-parsed-never-executed.md) — the
  compatibility surface itself.

## References

- `docs/install-command-paste.md` — §4 (bin name), §10 (path collisions)
- `AGENTS.md` — "Upstream `skills` collides with us on disk"
