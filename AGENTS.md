# SkillsGate — Agent Guidelines & System Knowledge

## 1. Project Overview & Architecture
SkillsGate is a visual AI skill manager for coding agents across Desktop (Electron + React), Terminal UI (Bun + OpenTUI), and CLI (Node.js).

### Monorepo Structure
- `packages/cli`: Core logic, agent registry (`src/core/agents.ts`), installer (`src/core/installer.ts`), types (`src/types.ts`), skill discovery (`src/core/skill-discovery.ts`).
- `packages/tui`: Interactive terminal UI, badge colors (`src/utils/colors.ts`), views (`src/views/skill-detail.tsx`).
- `apps/desktop`: Electron app, main process IPC (`src/main/ipc-handlers.ts`), renderer logo mapping (`src/renderer/components/agent-logo.tsx`), SVG assets (`src/renderer/assets/agent-logos/`).
- `packages/local-db`: SQLite persistence and SSH remote sync client.

---

## 2. Supported Coding Agent Harnesses (30 Agents)
SkillsGate provides unified skill discovery and synchronization across 30 agent targets.

> **Core is not an agent.** `~/.agents/skills` is the shared core skill set that fans out into these tools — see §3. It appears in listings so core skills stay visible, but it is a *source*, never an install target.

1. **Claude Code** (`claude-code`)
2. **Cursor** (`cursor`)
3. **GitHub Copilot** (`github-copilot`)
4. **Windsurf** (`windsurf`)
5. **Cline** (`cline`)
6. **Continue** (`continue`)
7. **Codex CLI** (`codex-cli`)
8. **Droid CLI** (`droid-cli`)
9. **OB-1** (`ob-1`)
10. **Amp** (`amp`)
11. **Goose** (`goose`)
12. **Junie** (`junie`)
13. **Kilo Code** (`kilo-code`)
14. **OpenCode** (`opencode`)
15. **OpenClaw** (`openclaw`)
16. **Pear AI** (`pear-ai`)
17. **Roo Code** (`roo-code`)
18. **Trae** (`trae`)
19. **Zed** (`zed`)
20. **Antigravity** (`antigravity`, `AG`, `.gemini/skills`, `~/.gemini/config/skills`)
21. **Antigravity IDE** (`antigravity-ide`, `AGI`, `.gemini/skills`, `~/.gemini/antigravity-ide/skills`)
22. **Antigravity CLI** (`antigravity-cli`, `AGC`, `.gemini/skills`, `~/.gemini/antigravity-cli/skills`)
23. **Gemini CLI** (`gemini-cli`, `GEM`, `.gemini/skills`, `~/.gemini/skills`)
24. **CodeBuddy** (`codebuddy`, `CB`, `.codebuddy/skills`, `~/.codebuddy/skills`)
25. **CodeBuddy CN** (`codebuddy-cn`, `CBN`, `.codebuddy-cn/skills`, `~/.codebuddycn/skills` or `~/.codebuddy-cn/skills`)
26. **WorkBuddy** (`workbuddy`, `WB`, `.workbuddy/skills`, `~/.workbuddy/skills`)
27. **WorkBuddy AI** (`workbuddy-ai`, `WBA`, `.workbuddy-ai/skills`, `~/.workbuddy-ai/skills`)
28. **Trae CN** (`trae-cn`, `TCN`, `.trae-cn/skills`, `~/.trae-cn/skills`)
29. **Pi Coding Agent** (`pi`, `PI`, `.pi/skills`, `~/.pi/agent/skills`)
30. **Mercury Agent** (`mercury`, `MC`, `.mercury/skills`, `~/.mercury/skills`)

#### The three Antigravity interfaces are three separate tools
Google ships three Antigravity products, all of which can be installed at once, and the
language_server binary shipped inside each one documents the mapping itself:

> Depending on the interface you are using, the directory name will differ:
> **CLI**: `antigravity-cli/` · **Antigravity 2.0**: `antigravity/` · **IDE**: `antigravity-ide/`

| Interface | Detect | State dir | `globalSkillsDir` |
| --- | --- | --- | --- |
| Antigravity 2.0 (app) | `/Applications/Antigravity.app` | `~/.gemini/antigravity/` | `~/.gemini/config/skills` |
| Antigravity IDE | `/Applications/Antigravity IDE.app` | `~/.gemini/antigravity-ide/` | `~/.gemini/antigravity-ide/skills` |
| Antigravity CLI (`agy`) | `agy` on PATH | `~/.gemini/antigravity-cli/` | `~/.gemini/antigravity-cli/skills` |

- The tell is `~/.gemini/<dir>/bin/agentapi`, a script each product writes pointing at its
  own executable. Do **not** guess from directory mtimes.
- All three also read the shared global customization root `~/.gemini/config/skills`
  (confirmed for the CLI by its own log: `skills.go:199 … ~/.gemini/config/skills/…`).
- ⚠️ **Never use the bare `~/.gemini` directory as a detection signal.** Gemini CLI, Graft
  and others create it, so it reported "Antigravity installed" on machines that never had
  Antigravity. Same trap as `~/.gemini/skills` — that is Gemini CLI's dir, not Antigravity's.
- `/Applications/Antigravity Tools.app` is a third-party app (`com.lbjlaq.antigravity-tools`),
  **not** Google's. Never map it to an Antigravity entry.
- `~/.gemini/<dir>/builtin/skills` ships with the product — leave it alone.

#### `~/.gemini` is shared by four products, and only one path is Gemini CLI's

Google ships **Gemini CLI** (`google-gemini/gemini-cli`) as a *separate* product from the
Antigravity family, and both live under `~/.gemini`. The two must never be conflated:

| Product | Global skills dir | Evidence |
| --- | --- | --- |
| Gemini CLI | `~/.gemini/skills` | its bundle documents `Global → ~/.gemini/skills` ("available in all projects") and `Project → .gemini/skills` |
| Antigravity (2.0 / IDE / CLI) | `~/.gemini/config/skills` + `~/.gemini/<product>/skills` | `language_server` references `.gemini/config/` 13/5/17 times respectively and `.gemini/skills` **zero** times |

- `~/.gemini/skills` belongs to **Gemini CLI** (`gemini-cli`, short code `GEM`). It is *not* an
  Antigravity directory, and `gemini-cli` must not share a `globalSkillsDir` with any Antigravity
  entry — pinned by `packages/cli/src/core/agents.test.ts`.
- Detection: `gemini` on PATH, or `~/.gemini/skills` existing. Never the bare `~/.gemini` dir.
- Gemini CLI also reads `<workspace>/.gemini/skills` per project; SkillsGate only manages the
  global path, consistent with every other harness.

---

## 3. Engineering Learnings & Invariants

### Symlink Canonical Store Defense
Many agents (such as Antigravity, CodeBuddy CN, Pi and WorkBuddy AI) link their global skills directory directly to the canonical store (**`~/.agents/.store`**).
- **Invariant**: `packages/cli/src/core/installer.ts` must use `realpathOrResolve()` on both the agent target directory and `CANONICAL_SKILLS_DIR()`.
- **Behavior**: When real paths match, the installer writes once to the canonical directory and skips creating self-referential symlinks, preventing filesystem recursion or `EEXIST` failures.
- ⚠️ **`CANONICAL_SKILLS_DIR()` is `~/.agents/.store`, not `~/.agents/skills`.** The latter is the core set (below). Conflating the two is what made every core entry look like a same-name conflict.

### Core Skill Set (`~/.agents/skills`)
A central, git-tracked directory whose contents are symlinked into **every** detected tool. A tool may still own non-core skills on top.

```
~/.agents/skills/     ← THE core set. Directory contents are the truth. git-tracked.
~/.agents/.store/     ← canonical backend for non-core installs (symlink targets)
~/.agents/.backup/    ← where a conflicting real directory is moved before linking
~/.agents/core.json   ← per-agent exclusions ONLY (nothing else)
```

- **Dir-is-truth**: there is no manifest. The contents of `~/.agents/skills` *are* the core set. `core.json` holds only per-agent opt-outs — deliberately, because `readSkillLock()` returns `emptyLock()` on a version mismatch, so storing exclusions in the lock would silently wipe them on any `LOCK_FILE_VERSION` bump.
- **Fan-out is idempotent and incremental**: it fills in missing links only. It never silently overwrites a **real directory** of the same name — that is reported as a conflict and skipped; replacing is an explicit action that backs up to `.backup/` first.
- **It only unlinks its own symlinks**: a link is removed only if its target resolves inside the core dir. Real directories are never deleted. Windows copy-fallback leftovers are reported as residual copies.
- **Invariant — the false-conflict guard**: before planning, compare `realpathOrResolve(agent.globalSkillsDir)` with `realpathOrResolve(CORE_SKILLS_DIR)`. Agents that symlink their *entire* skills dir at the core dir (Antigravity, CodeBuddy, CodeBuddy CN, Pi, WorkBuddy AI) must short-circuit to "already linked". Without this, all 152 core entries are misreported as conflicts.
- **Symlinks are relative and dereferenced on fan-out**, to avoid `tool/x → core/x → skills-library/…/x` double indirection. Fallback chain: relative → absolute → copy (`junction` on win32).
- **CLI**: `skillsgate core list | status | sync [--dry-run] | add | remove | exclude | include`.
- **Desktop**: `/core` route. One read-only plan (`corePlan()`) yields one item per (core skill × tool); per-tool status and per-skill fan-out are two groupings of it, so the panels cannot disagree. Sync requires two clicks: preview, then apply.

**Convention**: `apps/desktop/src/main` mirrors CLI modules instead of importing them (`core-skills.ts`, `skill-paths.ts`), because the CLI is ESM with `.js` import extensions that complicate bundling. If you change the CLI engine, mirror it here.

### Cross-Platform Executable Detection
- **Rule**: When detecting installed agent CLI tools via shell commands, never execute `which` directly without checking platform.
- **Implementation**:
  ```ts
  const binary = process.platform === "win32" ? "where" : "which";
  ```

### Worktree Cold-Start & Build Hygiene
- In Git worktrees (`fleet/<agent>`), `node_modules` is not present by default.
- Pre-provision dependencies with `bun install --ignore-scripts` to bypass native Electron rebuild scripts (`electron-rebuild`) during headless CLI verification.
- Run `npm run typecheck --workspace=skillsgate` or `cd packages/cli && bun run typecheck` to verify TypeScript contracts.
- ⚠️ **`--ignore-scripts` also skips downloading the Electron binary.** `npm run dev -w apps/desktop` then bundles fine and dies at launch with `Error: Electron uninstall` — a misleading message, since the `electron` npm package *is* present; only its `dist/` is missing.
  - Confirm: `node -e "require('electron')"` should print a path under `node_modules/electron/dist/`.
  - Fix: `cd node_modules/electron && node install.js`. If the zip is already cached (`~/Library/Caches/electron/electron-v<ver>-<platform>-<arch>.zip`) this only extracts — no download needed.
  - If that fails on file writes, extract manually instead: `rm -rf dist && unzip -q ~/Library/Caches/electron/<zip> -d dist` then `printf 'Electron.app/Contents/MacOS/Electron' > path.txt` (no trailing newline — `index.js` does `path.join(dist, contents)`).
- **`electron-vite dev` cannot be launched from a sandboxed shell.** Chromium needs to open its own sandbox and write to `~/Library/Application Support/`; under sandboxing it dies with `GPU process isn't usable. Goodbye.` Run it from a normal terminal instead. A successful launch prints `[ipc] registerIpcHandlers initialized`.

### Packaging a macOS release (DMG + zip)
```bash
cd apps/desktop
env -u NODE_OPTIONS npm run package:mac -- --config.mac.notarize=false
```
- `env -u NODE_OPTIONS` is required: the agent shell injects a `createWriteStream` shim via `NODE_OPTIONS`, which makes asar packing die with `Brokered file token refused`.
- `notarize` is a **`mac`** property. `--config.notarize=false` is rejected by electron-builder 26; it must be `--config.mac.notarize=false`.
- Version bump: `apps/desktop/package.json` **and** `bun.lock`. `package-lock.json` deliberately lags (it still said `0.6.0` at `0.6.1`), so do not try to sync it — `npm install --package-lock-only` rewrites 1000+ unrelated lines.
- `release/` is gitignored; artifacts are never committed.

⚠️ **electron-builder's own DMG step produces a corrupt bundle under a sandboxed shell.** It mounts the image at `/Volumes/<name>` and rewrites files there; the sandbox renames each modified file to a `.BC.T_*` backup and is then denied the unlink, so the backups strand inside the image. Symptom: `Contents/Info.plist` is *gone*, replaced by a 3740-byte `.BC.T_*`, plus an 8-byte `.BC.T_*` where `PkgInfo` was. Finder says the app "is damaged"; `codesign -dv` reports `bundle format unrecognized`.
- **`hdiutil verify` still reports VALID** — it only checksums the filesystem, not the bundle. Never use it as the gate.
- Detect: `hdiutil attach -readonly -nobrowse -mountpoint /tmp/x release/SkillsGate-<ver>-arm64.dmg`, then confirm `Info.plist` + `PkgInfo` exist and `find /tmp/x -name ".BC.T_*"` returns 0.
- Fix: the pre-dmg app dir `release/mac-arm64/SkillsGate.app` is **intact** (corruption only happens inside the mounted volume), so rebuild the image from it — needs sandbox bypass:
  ```bash
  hdiutil create -srcfolder release/mac-arm64 -volname "SkillsGate <ver>-arm64" -format UDZO -o release/SkillsGate-<ver>-arm64.dmg
  ```
- Then re-sync the manifest: patch the dmg `sha512` + `size` in `release/latest-mac.yml` (`openssl dgst -sha512 -binary <dmg> | openssl base64 -A`) and regenerate the blockmap with `node_modules/app-builder-bin/mac/app-builder_arm64 blockmap --input <dmg> --output <dmg>.blockmap`. Note the binary is `app-builder_arm64`, not `app-builder`.
- The `.zip` target is built from the app dir and is **unaffected**, and `path:` in `latest-mac.yml` points at the zip — so auto-update keeps working even when the dmg is broken.
- Signing is ad-hoc and unnotarized: first launch needs right-click → Open, or `xattr -cr /Applications/SkillsGate.app`.
- Verify the shipped code actually contains your change — the packaged `app.asar` is the source of truth:
  `python3 -c "d=open('release/mac-arm64/SkillsGate.app/Contents/Resources/app.asar','rb').read(); print(d.count(b'<new symbol>'))"`

### Running the CLI test suite
- **Use the package script**: `cd packages/cli && bun run test` (which is `tsx --test 'src/core/*.test.ts'`).
- **Do not run bare `bun test`.** With bun 1.2.7 it fails *every* file with `Failed to get caller source origin` (a bun × `node:test` interop bug), even when all assertions would pass. It looks like a real failure and is not one.

### `fs.readdir` Dirent generics (Node types)
- **Rule**: never annotate a variable as `Awaited<ReturnType<typeof fs.readdir>>`.
- **Why**: it resolves to `Dirent<NonSharedBuffer>[]`, but `fs.readdir(dir, { withFileTypes: true })` returns `Dirent<string>[]`. Assigning one to the other is a type error.
- **Fix**: `import type { Dirent } from "node:fs"` and annotate as `Dirent[]`.

### react-window row components
- `rowComponent` is typed `(props) => ReactElement | null`, but `memo()` widens the return type to `ReactNode` — passing a memoized row straight to `rowComponent` is a type error. Narrow it once at the definition: `}) as (props: RowComponentProps<RowData>) => ReactElement | null`.
- Row props declared on the component must **exclude** `index` / `style`: react-window injects those and types `rowProps` as everything *but* them. Declare the shared data separately and take `RowComponentProps<RowData>`.

### Install command paste (`npx skills add …`)

The desktop accepts the ecosystem-conventional install command as a **paste
format**, so a user can copy a line straight out of a README:

```
npx skills add humanlayer/skills --skill show-me
```

- **The pasted string is never executed.** `parseInstallCommand()` lives in
  `packages/skill-sources/src/parse-install-command.ts` — the
  `@skillsgate/skill-sources` workspace package, consumed by the CLI's core layer
  (which the TUI imports directly) **and** by the desktop main process. It reads
  the string into a `ParsedSource` + skill filter and hands that to the existing
  pipeline. Never `spawn` `npx`, never resolve a package from the registry, never
  shell out.
  - This layer is deliberately **shared, not mirrored**, unlike the agent registry
    in §2. The two hand-copies had already drifted (the desktop's rejected the
    `@skill` suffixes and `tree/<ref>/<path>` URLs the CLI accepted), so the fix
    was to extract a source-only package rather than keep syncing them by hand.
    It is bundled, never required at runtime: `noExternal` in `packages/cli/tsup.config.ts`
    and the `externalizeDepsPlugin` exclusion in `apps/desktop/electron-vite.config.ts`.
    A runtime `require` would fail, because the package is ESM and the desktop main
    process is CJS.
- **Never occupy the `skills` bin name.** `npx` ignores `$PATH` entirely and
  prefers the local `node_modules/.bin`. A global bin collision is a hard
  `EEXIST` — it would break installs for anyone who already has upstream — and a
  local collision silently resolves to the lexicographically-first package name,
  where `skills` beats `skillsgate`. Silent failure is the worst outcome, so we
  do not compete for the name.
- **Grammar is upstream-shaped; reachability is not.** Upstream's `parseSource()`
  understands six source types (`local`, `github`, `gitlab`, `git`, `download`,
  `well-known`); we install two. `unsupportedSourceReason()` turns the other four
  into a specific message instead of a vague parse failure.
- **Upstream flag semantics we mirror**: `-s/--skill` and `-a/--agent` are greedy
  space-separated varargs (**no** comma splitting); `--skill '*'` / `--agent '*'`
  mean all; `--all` expands to `--skill '*' --agent '*' -y`; skill names may
  contain spaces and need quoting; unknown flags are ignored, not fatal.
- **`formatInstallCommand()` is the inverse of the parser.** The copyable hint in
  the UI must be produced by it, so the displayed command always round-trips back
  through `parseInstallCommand()`.

#### Where the paste actually lands

`packages/cli/src/cli.ts` and `src/commands/*` are **unreachable dead code**. Do
not add features there:

- `bin/cli.mjs` unconditionally `execFileSync`s the `@skillsgate/tui-*` platform
  binary, forwarding argv. It never imports `cli.ts`.
- That TUI entry (`packages/tui/src/index.tsx`) ignores argv entirely — it opens
  SQLite and renders `<App />`.
- The TUI imports only `cli/src/core/*`, `cli/src/types.js` and
  `cli/src/constants.js`. Nothing imports `cli.ts`, `commands/`, `mcp/` or `ui/`.

So the paste entry point is the **desktop GUI**:

| Layer | Channel / symbol |
| --- | --- |
| Renderer | `InstallFromCommand` in `components/install-from-command.tsx`; `discover.tsx` shows it when the search box matches `INSTALL_COMMAND_HINT` |
| Preload | `resolveSource(input)` → `skills:resolve-source`; `installSkill(…, skillFilter)` → `skills:install`; `coreInstall(source, skillFilter)` → `core:install` |
| Main | `skills:resolve-source` parses + clones + discovers and returns a `ResolvedSourcePreview`; `resolveSourceSkills(source, skillFilter)` applies the filter |

Two constraints that shape this:

- **Parsing runs in main, not the renderer.** `source-parser.ts` imports
  `node:path`/`node:os` for local paths, so importing the shared barrel from the
  renderer would break the browser bundle. The renderer's `INSTALL_COMMAND_HINT`
  regex is only an affordance; main is the authority.
- **`ResolvedSourcePreview` is declared in `src/preload/api.d.ts`**, which uses
  `export {}` + `declare global`, so main can use it too. That is why the IPC
  return type needs no mirror.

#### Upstream `skills` collides with us on disk

`vercel-labs/skills` (npm package `skills`, invoked as `npx skills`) shares two
paths with SkillsGate, and **both** implementations discard the file on a version
mismatch:

| Path | Upstream | SkillsGate |
| --- | --- | --- |
| `~/.agents/skills/` | canonical global store (`UNIVERSAL_SKILLS_DIR`) | `CORE_SKILLS_DIR()` — the git-tracked core set |
| `~/.agents/.skill-lock.json` | `CURRENT_VERSION = 3`, wipes when `version < 3` | `LOCK_FILE_VERSION = 1`, wipes when `version !== 1` |

- Upstream's `cleanAndCreateDirectory()` **deletes before recreating**, so a real
  directory in the core set can be removed, and a core entry that is a relative
  symlink into a skills-library can be broken.
- The lock file is mutually destructive in both directions. `writeSkillLock()` now
  backs a foreign-version lock up instead of clobbering it, but the two schemas
  still cannot coexist — reconciling them is a separate issue.

#### Agent slug differences

Only four upstream `--agent` slugs differ from ours; everything else already
matches (`github-copilot`, `cursor`, `cline`, `opencode`, `trae`, …). Map them in
`UPSTREAM_AGENT_ALIASES`:

`codex` → `codex-cli` · `droid` → `droid-cli` · `kilo` → `kilo-code` · `roo` → `roo-code`

---

## 4. Multi-Agent Fleet Orchestration (`herdr-run`)
This project tracks issues via Beans (`.beans/`) and orchestrates fleet agents via Herdr (`.herdr/`):
1. **Bean First**: Every unit of work begins with a committed Bean issue on `main`.
2. **Worktree Isolation**: Coder agents work exclusively in `fleet/<agent-name>` worktrees.
3. **Brief-Driven**: Assignments are dispatched via `.herdr/briefs/<bean-id>.md`.
4. **Mechanical Landing**: Code must NOT be merged without a signed review artifact (`.herdr/reports/<bean-id>-review.md`) carrying `VERDICT: APPROVE` and `LANDABLE: YES`. Use `./.herdr/scripts/fleet-land.sh <bean-id> <commit-hash> ["test-command"]` to enforce this mechanically.
