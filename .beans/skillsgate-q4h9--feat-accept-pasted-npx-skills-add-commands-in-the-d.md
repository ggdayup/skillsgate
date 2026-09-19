---
# skillsgate-q4h9
title: 'feat: accept pasted `npx skills add` commands in the desktop'
status: in_progress
type: task
priority: high
created_at: 2026-09-15T01:15:00Z
updated_at: 2026-09-15T14:12:00Z
---

Let users paste the ecosystem-conventional install command into the desktop UI:

    npx skills add humanlayer/skills --skill show-me

**The pasted string is never executed.** It is parsed as a source descriptor and
handed to SkillsGate's own install pipeline (`cloneRepo` → `discoverSkills` →
`filterSkills` → `installSkillForAgent`). No `npx`, no npm registry, no bin-name
hijacking. The whole point is that the *entry point* is familiar while the
*engine* stays ours.

## Decisions (settled with the user)

1. Grammar is upstream-shaped; the engine stays native.
2. Do **not** occupy the `skills` bin name. A global bin collision is a hard
   `EEXIST` (it would break installs for users who already have upstream), and a
   local collision silently favours the lexicographically-first package name —
   `skills` sorts before `skillsgate`, so the shim would lose without a word.
3. Parser lives in `packages/cli/src/core/`, mirrored into `apps/desktop/src/main/`
   per the existing convention.
4. Flags are honoured as pre-fill defaults, and the resolved intent is always
   shown before install. `-y` never bypasses the confirm.
5. Unknown flags are ignored and listed, not fatal. Unparseable input falls back
   to plain `parseSource()`.
6. Upstream-only sources (GitLab, Azure Repos, generic git/SSH, archives) get a
   specific "not supported yet" message rather than a vague parse failure.
7. GUI scope is global only; project scope is a non-goal.
8. Multi-skill repos pasted without `--skill` get a GUI multi-select, defaulting
   to nothing selected.
9. The Discover search box detects command-shaped input and offers to switch,
   rather than switching silently.
10. `discover.tsx`'s displayed command is fixed and shares its serializer with
    the parser, so display and paste cannot drift apart.

## Non-goals

- Never execute the pasted command.
- Never invoke `npx` / touch the npm registry.
- No bin-name hijacking.
- No project-scope install in the desktop.

## Known gaps (detailed in AGENTS.md §3 "Install command paste")

- `skills:install` has no skill-filter parameter, and its `_scope` argument is
  never used — the desktop has no scope concept at all.
- Agent slugs differ from upstream for `codex`/`droid`/`kilo`/`roo`.
- The desktop's local `parseSource` is weaker than the CLI's (no `@skill`, no
  `tree/<ref>/<path>`).
- Upstream-only source types are not installable — there is no archive/tarball
  extraction anywhere in the repo.

## Progress

- [x] `parseInstallCommand()` + 36 tests — `packages/skill-sources/src/parse-install-command.ts`
- [x] Removed the dead `skills:install-via-cli` bridge (it spawned real `npx skills`)
- [x] `writeSkillLock()` no longer clobbers a foreign-version lock file
- [x] Parser shared with the desktop via the `@skillsgate/skill-sources` workspace
      package — resolved by extraction, not mirroring (see `docs/install-command-paste.md` §9).
      This also closed G9: the desktop no longer has its own weaker `parseSource`.
- [x] Thread `skillFilter` through `skills:install` / `core:install` +
      `resolveSourceSkills`; new `skills:resolve-source` channel returns a
      `ResolvedSourcePreview` (parse + clone + discover, nothing written)
- [x] Desktop paste panel — `components/install-from-command.tsx`; the Discover
      search box swaps the grid for it when `INSTALL_COMMAND_HINT` matches
- [x] `discover.tsx` command hint is now a `CommandChip` with a copy button

### Verified

`tsc -p tsconfig.node.json` and `tsconfig.web.json` clean · `electron-vite build`
clean · 36/36 shared tests · 8/8 CLI tests · CLI typecheck + `tsup` clean.
Built bundles: `out/main/index.js` has **0** references to
`@skillsgate/skill-sources` (inlined, so no `ERR_REQUIRE_ESM`), and
`skills:resolve-source` is present in both main and preload.

### Deviations from the decisions above

- **#3 superseded.** The parser is *not* mirrored. It lives in the
  `@skillsgate/skill-sources` workspace package, consumed by both sides — the two
  hand-copies had already drifted. See `docs/install-command-paste.md` §9.
- **#8 refined.** Skills the command named explicitly are pre-selected; "nothing
  selected" now applies only when the command named none, where the user really
  does have to choose from the whole repo.
- **#10 half-done.** The chip is fixed and copyable, but it does **not** share a
  serializer with the parser: the renderer cannot import the shared barrel
  because `source-parser.ts` pulls in `node:path`/`node:os`. Needs a browser-safe
  grammar subpath.
- **CLI exposure dropped.** `packages/cli/src/cli.ts` and `commands/` are
  unreachable — `bin/cli.mjs` launches the TUI platform binary and the TUI entry
  ignores argv entirely. Adding the feature there would have been dead code.
