# ADR-0007: Shared local SQLite for state common to Desktop and TUI

## Status

Accepted · 2026-03-22

Backfilled 2026-09-29. Backend removal `bd86587` (2026-04-04); shared auth
`48652c2` and `1e59254`.

## Context

SkillsGate began with a cloud backend (`apps/api` Hono + `packages/database`
Prisma). The local-first pivot removed it:

> `bd86587` — *Backend is no longer needed after local-first pivot.*

That left a gap: the Desktop app and the TUI are separate processes over the
same machine, and users expect a change in one to be visible in the other —
install scope, default agents, telemetry opt-in, favorites, SSH servers, auth
login.

Options considered were a JSON file, the OS keyring, and per-app stores. A JSON
file has no locking or transaction semantics, which matters because **both
processes can be running at once**. The keyring was already in use for auth and
was explicitly abandoned because it is per-app and cannot be shared:

> `48652c2` — *use shared SQLite for auth instead of keyring. Syncs between TUI
> and Electron since both use the same SQLite file.*

## Decision Drivers

- **Must** be safe for two concurrent processes.
- **Must** live entirely on the machine — no service to run.
- **Must** support indexed queries (the skill scan cache is the startup path).
- Must work under both Electron's Node and Bun.

## Considered Options

### Option 1: one SQLite file, WAL mode, shared by both surfaces

- **Pros**: transactions, concurrency, indexes; both runtimes have a built-in
  driver; a single path is trivially shareable.
- **Cons**: native module under Electron (see below); schema migrations exist in
  more than one place.

### Option 2: JSON file with a write lock

- **Pros**: no native code, human-readable.
- **Cons**: full-file rewrite, no index, hand-rolled locking that is easy to get
  wrong. Rejected for the concurrent case.

### Option 3: a local HTTP service owning the state

- **Pros**: single writer, clean concurrency.
- **Cons**: reintroduces exactly the running-backend problem the local-first
  pivot removed. Rejected.

### Option 4: per-app stores, sync via file watcher

- **Pros**: no shared schema.
- **Cons**: two truths and a sync protocol. Rejected — it is the bug, not the
  fix.

## Decision

All state common to the Desktop app and the TUI lives in **one SQLite database**:

```
~/.skillsgate/skillsgate.db
```

Declared identically in all three places (`packages/local-db/src/db.ts:11`,
`apps/desktop/src/main/db/index.ts:12`, `packages/tui/src/db/index.ts:8`),
opened with `PRAGMA journal_mode=WAL` and `foreign_keys=ON`.

| Table | Purpose |
| --- | --- |
| `settings` | JSON-encoded key/value — the sync surface (`install.scope`, `install.method`, `install.defaultAgents`, `telemetry.enabled`, `scan.customPaths`, `collections.skills`) |
| `favorites` | starred skills, keyed by skill name so uninstall does not lose them |
| `remote_servers` / `remote_skills` | SSH targets and the cached contents of their skills |
| `cached_skills` | local scan cache — instant startup on relaunch |
| `trending_cache` | 6-hour TTL single-row payload |
| `schema_version` | migration head |

Drivers are **injected**, not assumed, so the package stays runtime-agnostic:

```ts
// packages/local-db/src/types.ts:13
export interface SqliteDriver {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}
```

Desktop passes `better-sqlite3`, TUI passes `bun:sqlite`.

`apps/web` does not touch this database — it runs on Cloudflare Workers against
Postgres via Hyperdrive.

## Consequences

### Positive

- Logging in on either surface is immediately visible on the other.
- Startup is cached rather than rescanned (`cached_skills`).
- Favorites survived the local-first pivot by being rebuilt against this file
  (`190125d`).

### Negative

- **`better-sqlite3` is a native module under Electron** and has needed four
  separate fixes: `createRequire` so Vite does not bundle it (`04a95f0`), a
  `postinstall` electron-rebuild (`bbf2faf`), `asarUnpack` for `*.node` because
  the OS loader cannot read inside asar (`9e97a79`), and per-arch CI builds
  after an x64 DMG shipped an arm64 `.node` (`b77bd6e`). Failure now surfaces as
  a dialog rather than a white screen (`apps/desktop/src/main/index.ts:113`).
- **Migrations exist three times and have drifted.**
  `apps/desktop/src/main/db/migrations.ts` (v1–v4), `packages/tui/src/db/migrations.ts`
  (v1–v4) and `packages/local-db/src/migrations.ts` (v1 only) disagree —
  desktop's `cached_skills` has five columns TUI's does not, and local-db's
  `remote_servers` has an `auto_sync` column the others lack. Because every
  statement is `CREATE TABLE IF NOT EXISTS`, the first process to open the file
  defines the schema and later ones silently run against a table missing their
  columns. This is masked, not solved.
- **"Settings sync" is not total.** `ui.theme` is stored by the TUI but the
  Desktop theme lives in `localStorage`, so theme does not cross over.

### Risks

- **A migration added on one surface only.** The `IF NOT EXISTS` pattern will
  not error; it will just never apply. A single shared migrations module is the
  obvious fix and is not yet done.

## Implementation Notes

- `packages/local-db/src/db.ts` — `DB_PATH`, driver interface
- `apps/desktop/src/main/db/index.ts` — `createRequire` + WAL
- `packages/tui/src/db/index.ts` — `bun:sqlite`
- `apps/desktop/package.json:18` — `postinstall` native rebuild

## Related Decisions

- [ADR-0004](0004-share-logic-mirror-stable-config.md) — the same
  mirror-vs-share tension, reproduced in the DB layer.

## References

- `bd86587` backend removal · `f51208b` local-db added
- `48652c2`, `1e59254` shared auth · `e41facb` WAL · `e277a25` scan cache
- `190125d` favorites local-first
