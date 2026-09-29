# ADR-0004: Share behavioural layers, mirror small stable config

## Status

Accepted · 2026-09-19

Backfilled 2026-09-29. Extracted in `49c9ea8`; the governing convention is
recorded in `AGENTS.md` §3.

## Context

SkillsGate ships three runtimes from one repo: a Node CLI, an Electron main
process that bundles to **CJS**, and a Bun TUI. All three need the same source
descriptor logic — how to turn `owner/repo`, `https://…`, `~/path`, and a
pasted `npx skills add …` line into a structured `ParsedSource`.

Initially the desktop carried its own hand-written `parseSource`. It had already
drifted from the CLI's:

| Capability | CLI | Old desktop copy |
| --- | --- | --- |
| `owner/repo@skill` filter | yes | **silently rejected** |
| `tree/<ref>/<path>` URLs | yes (extracts `ref` + `subpath`) | **no** — `subpath` declared but never assigned |
| Failure mode | `SourceParseError` with a message | returns `null` |

Adding a third consumer (the renderer, for the copyable command hint) would have
meant a third copy and a third drift.

Meanwhile the desktop *also* needs the agent registry, the core-sync engine and
the path constants — and those are not being shared, they are being copied.

## Decision Drivers

- **Must** stop behavioural logic from existing in two hand-maintained copies.
- **Must** keep the Electron main process bootable (no `ERR_REQUIRE_ESM`).
- **Must** keep `node:` builtins out of the browser bundle.
- Prefer the smallest change that removes the drift risk.

## Considered Options

### Option 1 (chosen for behaviour): extract `@skillsgate/skill-sources`

- **Pros**: one implementation for CLI, desktop main and desktop renderer; the
  package has no build step — `exports` points straight at `.ts` — so it never
  goes stale against a `dist/`.
- **Cons**: requires explicit bundling at both ends, and forbids a runtime
  `require`.

### Option 2 (chosen for config): mirror small stable modules into the desktop

- **Pros**: no bundler fight; the desktop main process stays free of the CLI's
  ESM-with-`.js`-extensions import style; the mirrored surface is small.
- **Cons**: copies exist and can drift — the same failure that forced Option 1.

### Option 3: import `skillsgate/core/…` from the desktop

- **Pros**: no duplication.
- **Cons**: drags the CLI's build order into the desktop's, and `./dist/*.js`
  deep paths are not a stable public surface. Rejected — this was attempted and
  documented as "Dropped — unreachable".

## Decision

**Behavioural layers are shared as a workspace package; small, stable config is
mirrored.** Concretely:

Shared (`packages/skill-sources`, `"type": "module"`, source-only):

- `parseSource`, `parseInstallCommand`, `formatInstallCommand`,
  `parseFrontmatterFallback`, `UPSTREAM_AGENT_ALIASES`, all types.
- Consumed by `packages/cli` (via a thin re-export shim,
  `core/source-parser.ts:19` lines from 178), by desktop main
  (`ipc-handlers.ts:15`), and by desktop renderer **only** through the
  `@skillsgate/skill-sources/format` subpath — `format-install-command.ts`
  imports zero `node:` modules, whereas the barrel pulls in `node:path` and
  `node:os` and therefore cannot cross into the browser bundle.

Mirrored into `apps/desktop/src/main`:

- `skill-paths.ts` ← `packages/cli/src/constants.ts`
- `core-skills.ts` ← `packages/cli/src/core/core-skills.ts` (agent list injected
  as an argument, to avoid a cycle on `ipc-handlers.ts`)
- agent registry inline at `ipc-handlers.ts:77`
- `skill-lock` constants, `skills-sh-client`

### Bundling rules that make Option 1 work

```ts
// packages/cli/tsup.config.ts:28
noExternal: ["@skillsgate/skill-sources"],          // inline into dist
```

```ts
// apps/desktop/electron-vite.config.ts:4
const bundledWorkspacePackages = ["@skillsgate/skill-sources"]
main:    { plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })] },
preload: { plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })] },
```

If `externalizeDepsPlugin` turned it into a runtime `require()` the app would
throw `ERR_REQUIRE_ESM` at launch, because the package is ESM and the desktop
main is CJS.

## Consequences

### Positive

- The drift that motivated extraction cannot recur in the source-descriptor
  layer — there is exactly one implementation.
- The CLI keeps publishing only `./core/*`, `./utils/*`, `./constants`,
  `./types`; nothing depends on private deep paths.

### Negative

- **The mirrored modules are a standing maintenance cost with no automated
  guard.** `apps/desktop/src/main/core-skills.ts` has no test file; the CLI's
  does. A fix can land on one side only.
- Mirrored copies of `realpathOrResolve` and the lock constants already exist in
  three places each.
- The source-only package means `tsc`/`tsx` must resolve `.ts` exports
  everywhere it is consumed — fine in this repo, but the package cannot be
  published as-is (`private: true`).

### Risks

- **Drift returns where the mirror survives.** Mitigation: the convention and
  the rationale are written at the top of every mirrored file *and* in
  `AGENTS.md`, so a reader hits the warning before editing. The honest fix —
  extracting an `@skillsgate/core` package — remains open.

## Implementation Notes

- `packages/skill-sources/src/index.ts:14-43` — export surface
- `packages/cli/tsup.config.ts:28-32`
- `apps/desktop/electron-vite.config.ts:4-18`
- `apps/desktop/src/main/ipc-handlers.ts:7-15` — why shared, not mirrored

## Related Decisions

- [ADR-0008](0008-pasted-install-commands-are-parsed-never-executed.md) — the
  parser this package centres on.
- [ADR-0005](0005-cli-entry-is-a-platform-binary-forwarder.md) — why the CLI
  package's own entry cannot be that shared surface.

## References

- `49c9ea8` — extraction; also deleted the old spawn-based install bridge
- `docs/install-command-paste.md` §9 "Why a shared package rather than a mirror"
- `AGENTS.md` §3 "Convention"
