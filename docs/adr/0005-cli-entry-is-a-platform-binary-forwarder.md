# ADR-0005: The CLI entry is a forwarder to the TUI platform binary

## Status

Accepted · 2026-02-27

Backfilled 2026-09-29. `packages/cli/bin/cli.mjs` introduced in `57c134b`;
the split has since widened.

## Context

`npx skillsgate` must start an interactive terminal UI. The TUI is built with
Bun and `@opentui`, and is shipped as prebuilt per-platform binaries; the npm
package `skillsgate` is plain Node and must work on machines with no Bun.

There was also an older command-style CLI (`skillsgate add …`, `skillsgate core
sync …`) written against Node.

Three shapes were possible, and the repo now contains evidence for the choice
that was made — including evidence that surprised people reading the tree for
the first time.

## Decision Drivers

- `npx skillsgate` should open the TUI, not a command dispatcher.
- No Bun requirement for end users.
- The Node package must not need to compile or bundle the TUI.
- Platform-specific native code belongs in platform-specific packages.

## Considered Options

### Option 1 (chosen): a tiny Node forwarder that `execFileSync`s the right binary

- **Pros**: `skillsgate` stays a small dependency-free script; the heavy TUI
  lives in `@skillsgate/tui-<platform>` packages; one code path for every OS.
- **Cons**: argv handed to the TUI is not interpreted by anyone in between —
  see below.

### Option 2: ship the TUI as JS and run it under Node

- **Pros**: no binary resolution, no platform packages.
- **Cons**: `@opentui` is Bun-oriented; this would mean maintaining a Node
  renderer path that does not exist. Rejected.

### Option 3: keep the command-style CLI as the entry and make `tui` a subcommand

- **Pros**: preserves a scripted interface.
- **Cons**: the common case (`npx skillsgate`) would sit behind a subcommand;
  two surfaces to maintain and document.

## Decision

`bin` points at a forwarder and nothing else:

```jsonc
// packages/cli/package.json
"bin": { "skillsgate": "./bin/cli.mjs" },
"exports": { "./core/*": "./dist/core/*.js", "./utils/*": …, "./constants": …, "./types": … }
```

`packages/cli/bin/cli.mjs` maps `platform`/`arch` → `@skillsgate/tui-*`, resolves
the binary, auto-installs it if missing, then:

```js
// packages/cli/bin/cli.mjs:95
execFileSync(binPath, process.argv.slice(2), { stdio: "inherit" });
```

`packages/tui/bin/skillsgate-tui` is a near-identical copy of the same script
(both resolve to the platform package), so the chain is:

```
skillsgate → bin/cli.mjs → @skillsgate/tui-<platform> → bun-built TUI
```

**And the TUI ignores argv entirely** — `packages/tui/src/index.tsx` contains no
`process.argv` read; it opens `~/.skillsgate/skillsgate.db` and renders
`<App />`.

### Consequence taken knowingly: `src/cli.ts` is unreachable

`packages/cli/src/cli.ts` imports all twelve commands, and `src/commands/*`
imports `src/mcp/` and `src/ui/` — but **nothing reachable from the bin imports
`cli.ts`**. It is excluded from typecheck:

```jsonc
// packages/cli/tsconfig.json:20
"exclude": [..., "src/cli.ts", "src/commands", "src/mcp", "src/ui", "src/telemetry.ts"]
```

So `cli.ts`, `commands/`, `mcp/`, `ui/` form a dead cluster. They are retained
rather than deleted because `packages/cli/src/core/core-skills.test.ts:32` still imports
`../commands/core.js`, and because they are a record of the old surface.

**Do not add features there.** The paste-install entry point, for example, is
the desktop GUI, not the CLI (see
[ADR-0008](0008-pasted-install-commands-are-parsed-never-executed.md)).

The *library* surface that remains live is `exports`: `./core/*`, `./utils/*`,
`./constants`, `./types`, consumed by the TUI via deep relative paths.

## Consequences

### Positive

- `npx skillsgate` opens the UI in one hop with no Bun dependency.
- One forwarder script covers six platform/arch combinations.

### Negative

- **`src/cli.ts` and `src/commands/` look live and are not.** Several hours of
  confusion are the predictable cost; mitigated only by this ADR, a
  `tsconfig.json` exclusion and `AGENTS.md`.
- `cli.ts` still contains a `case "tui"` branch that `execFileSync`s
  `skillsgate-tui` — a duplicate of what the bin already does, further
  reinforcing the wrong reading.
- Two copies of the forwarder script (`packages/cli/bin/cli.mjs`,
  `packages/tui/bin/skillsgate-tui`) can drift; they already differ slightly in
  the `--no-save` flag.
- The TUI silently discards argv, so any future `skillsgate <subcommand>` must
  change the TUI first — the forwarder cannot fix it.

### Risks

- **A contributor adds a command to `src/commands/` and sees no effect.**
  Mitigation: this ADR, plus the `tsconfig` exclusion which at least means the
  dead cluster does not fail typecheck.

## Implementation Notes

- `packages/cli/bin/cli.mjs`
- `packages/tui/bin/skillsgate-tui` (duplicate)
- `packages/tui/src/index.tsx` — argv-free entry
- `packages/cli/tsconfig.json:20` — exclusion list

## Related Decisions

- [ADR-0004](0004-share-logic-mirror-stable-config.md) — the library surface
  that the TUI actually consumes.
- [ADR-0008](0008-pasted-install-commands-are-parsed-never-executed.md) — where
  paste-install really lands.

## References

- `57c134b` — CLI package added
- `AGENTS.md` "Where the paste actually lands"
