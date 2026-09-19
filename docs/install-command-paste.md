# Install command paste — design & implementation plan

Bean: `skillsgate-q4h9` · Status: parser landed, UI not started · 2026-09-15

## 1. Requirement

Users should be able to paste the ecosystem-conventional install command into the
desktop UI:

```
npx skills add humanlayer/skills --skill show-me
```

SkillsGate parses it into a source descriptor and runs **its own** install
pipeline. The command string is a **notification, not an instruction** — it is
never executed. `npx` is never spawned, the npm registry is never contacted, and
no package is ever resolved by name.

The value is familiarity: the entry point looks like what people already copy out
of READMEs, while the engine — provenance tracking, agent fan-out, symlink
canonicalisation, the 29-agent registry — stays ours.

## 2. Decisions

| # | Decision |
| --- | --- |
| 1 | Grammar is upstream-shaped; the engine stays native. No delegation. |
| 2 | Do **not** occupy the `skills` bin name — see §4 for why. |
| 3 | Parser lives in `packages/cli/src/core/`, mirrored into `apps/desktop/src/main/`. |
| 4 | Flags are honoured as **pre-fill defaults**, and the resolved intent is always shown before install. `-y` never bypasses the confirm. |
| 5 | Unknown flags are ignored and listed, not fatal. Unparseable input falls back to plain `parseSource()`. |
| 6 | Upstream-only sources get a specific "not supported yet" message, not a vague parse failure. |
| 7 | GUI scope is **global only**. Project scope is a non-goal. |
| 8 | Multi-skill repos pasted without `--skill` get a GUI multi-select, **defaulting to nothing selected**. |
| 9 | The Discover search box detects command-shaped input and **offers** to switch — it never switches silently. |
| 10 | The displayed command hint is produced by the parser's own serializer, so display and paste cannot drift. |

## 3. Non-goals

These are deliberate, and should stay written down so nobody adds them back:

- Never execute the pasted command.
- Never invoke `npx` / never touch the npm registry.
- No bin-name hijacking.
- No project-scope install in the desktop.

## 4. Why we do not take the `skills` bin name

Making the literal `npx skills add …` run SkillsGate is *technically* possible —
ship `bin: { skills: … }` from the `skillsgate` package, and `npx` prefers the
local `node_modules/.bin` without touching the registry. Three measured costs kill
it:

1. **Global install breaks.** `npx` ignores `$PATH` entirely (shell fallback was
   removed). A global bin collision is a hard `EEXIST`, so `npm i -g skillsgate`
   would fail for anyone who already has upstream — exactly the audience this
   feature is for.
2. **Local collisions are lost silently.** Bin collisions resolve to the
   lexicographically-first package name, and `skills` sorts before `skillsgate`.
   Upstream wins and the shim does nothing, without a word.
3. **It only works inside a project that already depends on us.** Anywhere else
   `npx skills` fetches upstream from the registry.

So the entry point is `skillsgate add <source> --skill <name>`, with the grammar
made a strict superset of upstream's.

## 5. Where it sits

The parser normalises the pasted string into the **existing** types, so nothing
downstream changes:

```
pasted command
  → parseInstallCommand()            NEW — pure, testable
  → ParsedSource + skillFilter[]     existing type
  → cloneRepo → discoverSkills → filterSkills → installSkillForAgent
```

## 6. Gaps found during the audit

These are real and some are load-bearing; the plan in §7 is ordered around them.

| # | Gap | Status |
| --- | --- | --- |
| G1 | `skills:install` has **no skill-filter parameter** — it installs *every* discovered skill. `preload.installSkill(source, agents, scope)` needs a new argument. | open |
| G2 | `skills:install`'s `_scope` argument is **never used** — the desktop has no scope concept. | open, resolved by non-goal 7 |
| G3 | Four agent slugs differ upstream (`codex`/`droid`/`kilo`/`roo`). | done — `UPSTREAM_AGENT_ALIASES` |
| G4 | No GUI multi-select for multi-skill repos. | open |
| G5 | Pasting into the existing Discover search box fails silently (searches skills.sh for the whole string). | open |
| G6 | `parseSource` accepts `./path`, but a GUI app has no cwd. | open — accept absolute and `~` only |
| G7 | No acceptance criteria were ever pinned. | done — §8 |
| G8 | Flow shape (resolve → preview → confirm) never defined. | done — decision 4 + §7 stage 3 |
| G9 | The desktop's local `parseSource` is weaker than the CLI's: no `@skill`, no `tree/<ref>/<path>`. | done — desktop now consumes `@skillsgate/skill-sources`; see §9 |
| G10 | Upstream understands six source types; we install two. No archive/tar extraction exists anywhere in the repo. | scoped out — see decision 6 |

## 7. Implementation plan

### Stage 0 — prerequisites (no behaviour change) — **done**

- [x] Delete the dead `skills:install-via-cli` bridge. It spawned a **real**
      `npx skills add <src> --all --global -y`, hardcoded `--all`, stripped `@`
      from sources (`owner/repo@skill` → `owner/reposkill`), was unreachable from
      the renderer, and did the exact thing this feature forbids.
- [x] `writeSkillLock()` no longer clobbers a foreign-version lock. It backs the
      other tool's file up and warns, instead of silently truncating it.

### Stage 1 — parse layer — **done**

- [x] `parseInstallCommand()` + `tryParseInstallCommand()` in
      `packages/skill-sources/src/parse-install-command.ts` — the
      `@skillsgate/skill-sources` workspace package, consumed by the CLI's core
      layer (which the TUI imports directly) and by the desktop main process.
- [x] 36 tests covering runners, aliases, quoting, greedy varargs, `--all`
      expansion, slug mapping, unsupported sources, and serializer round-trips.
- [x] Desktop consumes the package directly (`apps/desktop/src/main/ipc-handlers.ts`).
      Resolved by **extraction, not mirroring** — the two hand-copies had already
      drifted, so a mirror would have kept the drift. **See §9.**
- [x] ~~Expose it from `packages/cli` so `skillsgate add "npx skills add X -s Y"`
      works from the CLI too.~~ **Dropped — unreachable.** `bin/cli.mjs`
      unconditionally launches the TUI platform binary and never imports
      `cli.ts`; nothing imports `commands/`, `mcp/` or `ui/`. Adding the feature
      there would have been dead code. See AGENTS.md §3, "Where the paste
      actually lands".

### Stage 2 — thread the filter through IPC (G1) — **done**

- [x] `skillFilter: string[]` threaded into `resolveSourceSkills()` and applied
      case-insensitively after discovery. `[]` and `["*"]` both mean "everything".
- [x] `skills:install` and `core:install` accept a trailing `skillFilter`.
- [x] `installSkill` / `coreInstall` preload signatures + `api.d.ts` updated.
- [x] New `skills:resolve-source` channel returns a `ResolvedSourcePreview`
      (parse + clone + discover, nothing written).

### Stage 3 — desktop UI — **done**

- [x] `components/install-from-command.tsx`: resolve (spinner) → preview (source
      label, skill multi-select, target agents, Core toggle) → confirm → install.
      Skills the command named are pre-selected; when it named none, nothing is,
      so the user chooses from the whole repo.
- [x] Search box (G5) swaps the grid for the panel when `INSTALL_COMMAND_HINT`
      matches. That regex is an affordance only — main re-parses authoritatively,
      so a false positive surfaces a "could not resolve" message instead of doing
      something wrong.
- [x] `discover.tsx` command hint is now a `CommandChip` with a copy button.
- [x] Resolve failures surface main's message verbatim, including
      `No skill named X in this source. Available: …`.

**Deviation:** the chip is **not** emitted via `formatInstallCommand()`. The
renderer cannot import the shared barrel — `source-parser.ts` pulls in
`node:path`/`node:os`, which the browser bundle has no shim for, and that is also
why parsing runs in main. Fixing it properly means splitting the package so the
pure grammar (tokenizer, `formatInstallCommand`, `unsupportedSourceReason`) is a
browser-safe subpath. Left as a follow-up; the format is trivial and is currently
inlined in `CommandChip`.

### Stage 4 — docs

- [x] Invariants + non-goals in `AGENTS.md` §3, including the reachability table.
- [ ] Note the upstream path/lock collision as its own issue (§10).

## 8. Acceptance criteria

1. Pasting `npx skills add humanlayer/skills --skill show-me` installs `show-me`
   and **only** `show-me`.
2. Pasting the same command without `--skill` opens a multi-select and installs
   only what is chosen.
3. Every existing source form (`owner/repo`, full GitHub URL, `owner/repo@skill`)
   behaves exactly as it does today — no regression.
4. Pasting a GitLab or archive URL produces a specific "not supported yet"
   message, not a generic parse error.

## 9. Decided — extract a shared package (neither mirror nor import)

The original question was "mirror or import?" — `AGENTS.md` says
`apps/desktop/src/main` **mirrors** CLI modules rather than importing them, because
the CLI is ESM with `.js` import extensions that complicate bundling. That is why
`core-skills.ts` and `skill-paths.ts` are copies.

Both options were rejected in favour of a third:

- **Mirroring** — the copies had *already* drifted. The desktop's `parseSource`
  understood only `github` + `local` and silently rejected the `@skill` suffixes
  and `tree/<ref>/<path>` URLs the CLI accepted (the old G9). Adding a third
  hand-copy would have guaranteed a fourth divergence.
- **Importing `skillsgate/core/parse-install-command`** — drags a build-order
  dependency and the whole CLI package into the desktop, and a deep `./dist/*.js`
  path is not a stable public surface.

**Decided:** a source-only workspace package, `packages/skill-sources`
(`@skillsgate/skill-sources`). Its `exports` point straight at the TypeScript and
each consumer's bundler compiles it — the same shape `packages/ui` already uses for
the renderer. It is bundled, never required at runtime:

- CLI: `noExternal: ["@skillsgate/skill-sources"]` in `packages/cli/tsup.config.ts`
- Desktop: listed in the `externalizeDepsPlugin` exclusion in
  `apps/desktop/electron-vite.config.ts`. A runtime `require` would fail, because
  the package is ESM while the desktop main process is CJS.

This also resolved **G9**: the desktop no longer carries its own weaker
`parseSource`. `packages/cli/src/core/source-parser.ts` is now a thin re-export
shim, so the existing `./core/source-parser.js` import surface is preserved.

## 10. Related issue — upstream collides with us on disk

`vercel-labs/skills` shares two paths with us and **both** implementations discard
the file on a version mismatch:

| Path | Upstream | SkillsGate |
| --- | --- | --- |
| `~/.agents/skills/` | canonical global store | `CORE_SKILLS_DIR()` — the git-tracked core set |
| `~/.agents/.skill-lock.json` | v3, wipes when `version < 3` | v1, wipes when `version !== 1` |

Upstream's `cleanAndCreateDirectory()` deletes before recreating, so a core entry
that is a relative symlink into a skills-library can be broken.

This is **decoupled from this feature** — it only fires when a user runs real
`npx skills` themselves. Stage 0's lock guard stops us destroying their data; the
schemas still cannot coexist. Tracked separately.
