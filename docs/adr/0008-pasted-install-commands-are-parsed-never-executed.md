# ADR-0008: Pasted install commands are parsed, never executed

## Status

Accepted · 2026-09-19

Backfilled 2026-09-29. Landed in `49c9ea8`, which also **deleted** the previous
spawn-based implementation.

## Context

Users copy an install line straight out of a README:

```
npx skills add humanlayer/skills --skill show-me
```

and expect to paste it into SkillsGate. The obvious implementation is to run it
— `spawn("npx", ["skills", "add", …])` — which is exactly what an earlier
version did via a `skills:install-via-cli` IPC handler and a
`buildNpxInstallCommand()` helper.

That approach executes arbitrary text from an untrusted document as a child
process, pulls the package from the npm registry at run time, and performs the
install *outside* SkillsGate — so no provenance is recorded and no agent fan-out
happens. It was removed rather than hardened.

## Decision Drivers

- **Must never execute** a string that originated outside the app.
- **Must** route installs through SkillsGate's own installer, so the result is
  identical to a GUI-driven install.
- The parse must behave the same in the renderer (for a live hint) and in main
  (authoritatively).

## Considered Options

### Option 1 (chosen): a pure parser shared as a workspace package

- **Pros**: no child process, no registry access, deterministic and unit
  testable; one implementation serves CLI, TUI, desktop main and renderer.
- **Cons**: must reimplement upstream's grammar and keep it in step.

### Option 2: shell out to `npx skills add …`

- **Pros**: always matches upstream exactly.
- **Cons**: executes untrusted text; installs outside our model; network
  dependent; the reason the old code was deleted. Rejected.

### Option 3: resolve the npm package and import it

- **Pros**: reuses upstream's parser.
- **Cons**: still registry access at run time, still a dynamic import of
  untrusted code. Rejected.

## Decision

`parseInstallCommand()` is a pure function with a stated invariant at the top of
its file:

```ts
// packages/skill-sources/src/parse-install-command.ts:10
// INVARIANT — the pasted string is NEVER executed.
// It is a source descriptor, nothing more. We never spawn `npx`, never resolve
// a package from the npm registry, and never shell out. … the command text is
// only ever *read*.
```

Implementation discipline that makes this true:

- No `child_process`, no dynamic `import()`, no `fs` anywhere in the parse path.
- Tokenisation is hand-rolled (`tokenize`, `parse-install-command.ts:153`) — it
  never passes the string to a shell.
- Runner tokens (`npx`, `bunx`, `pnpm`, `yarn`, `npm`, `deno`, `dlx`, `exec`,
  `-y`, `--yes`, `--`) are used **only for recognition**; `locateCommand()`
  requires the bin prefix to be all runner tokens or it returns `null` and the
  input is treated as a plain source.
- Other upstream subcommands (`skills use`, `skills remove`, …) yield a specific
  error — *"That is the `skills X` command, not `skills add`"* — not a generic
  parse failure.
- Unknown flags are ignored rather than fatal, matching upstream.
- `tryParseInstallCommand()` is the non-throwing variant used across IPC.

### Where the parse happens

**In the main process, not the renderer.** `source-parser.ts` imports
`node:path` and `node:os`, so importing the barrel into the renderer would break
the browser bundle. The renderer's `INSTALL_COMMAND_HINT` regex
(`apps/desktop/src/renderer/routes/discover.tsx:23`) is an affordance only:

> *it is never trusted as the real parse. The main process re-parses the string
> authoritatively.*

Flow:

```
renderer  InstallFromCommand (components/install-from-command.tsx)
   ↓ IPC  skills:resolve-source
main      parse + clone + discover → ResolvedSourcePreview
   ↓ IPC  skills:install  /  core:install
main      resolveSourceSkills(source, skillFilter) → installer
```

`formatInstallCommand()` is the inverse of the parser, so the copyable hint in
the UI always round-trips back through it.

## Consequences

### Positive

- Pasting is inert: the worst a malformed line can do is produce a parse error.
- Installs through paste are indistinguishable from installs through the GUI —
  same provenance, same fan-out, same canonical store.

### Negative

- **We own a copy of upstream's grammar** and must track changes to it.
- The renderer regex and the real parser can disagree; only the real one counts,
  so a hint may appear for input that later fails to parse.
- Compatibility is partial by design: only two of upstream's six source types
  are installable, turned into specific messages by `unsupportedSourceReason()`
  rather than silent failure.

### Risks

- **A code path reintroduces a spawn.** ⚠️ There is one: the TUI still runs
  `npx skills add ${source} --all -y` through `execAsync` for GitHub sources
  (`packages/tui/src/data/use-skill-actions.ts:515`, call site `:143`). It
  bypasses our installer and is the opposite of this invariant. The invariant in
  this ADR governs the *paste* path; the TUI path is an open inconsistency and
  should either be migrated to our installer or documented as a deliberate
  exception.

## Implementation Notes

- `packages/skill-sources/src/parse-install-command.ts` (370 lines) — the parser
- `packages/skill-sources/src/format-install-command.ts` — the inverse
- `apps/desktop/src/renderer/components/install-from-command.tsx` — paste UI
- `apps/desktop/src/main/ipc-handlers.ts:1880` — `skills:resolve-source`
- `apps/desktop/src/preload/api.d.ts:184` — `ResolvedSourcePreview`
- `docs/install-command-paste.md` — full feature record

## Related Decisions

- [ADR-0004](0004-share-logic-mirror-stable-config.md) — the shared package this
  parser lives in.
- [ADR-0006](0006-coexist-with-upstream-skills-on-disk.md) — the grammar and
  aliases being mirrored.
- [ADR-0005](0005-cli-entry-is-a-platform-binary-forwarder.md) — why the CLI is
  not the paste entry point.

## References

- `49c9ea8` — shipped paste-install; deleted `skills:install-via-cli`
- `docs/install-command-paste.md` §4, §9
- `AGENTS.md` "Install command paste"
