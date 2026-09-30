# Review Report: [skillsgate-1w5u] - Code Review

- **Bean ID**: `skillsgate-1w5u`
- **Agent**: `spark-reviewer-1`
- **Reviewed Commit**: `e9fc45a1c17ad54c7777933cbb1466d2b1c81323`
- **Status**: Approved

## Gated Rubric
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE

## Assessment

### 1. Specification Compliance

Bean `skillsgate-1w5u` ("consolidate three drifted SQLite migration sets") checklist, verified item by item. Note: the reviewed commit `e9fc45a` itself is docs-only (bean status flip + completion report); the functional change is the four commits beneath it (`b512d1b`, `513b847`, `741eb8d`, `9049cd2`), reviewed here as the unit (diff `5cfd872..e9fc45a`, 10 files, +574/-295):

- [x] **Single source of truth, consumed by desktop and TUI** — MET. `packages/local-db/src/migrations.ts` now owns `MIGRATIONS` (v1–v5), `getCurrentVersion`, `runMigrations`. `apps/desktop/src/main/db/migrations.ts` and `packages/tui/src/db/migrations.ts` are each a one-line re-export; `db/index.ts` on both surfaces imports `runMigrations` from `@skillsgate/local-db`. No table definitions remain outside the canonical module (grep confirms zero other `from '.*migrations'` importers).
- [x] **Existing databases keep working, no data loss** — MET. Migration v5 is purely additive (`ALTER TABLE ... ADD COLUMN` for `remote_servers.auto_sync` + the five desktop-only `cached_skills` columns), each guarded by a `PRAGMA table_info` existence check. Committed suite proves desktop-v4→v5 and TUI-v4→v5 upgrades preserve every row across all six data tables. I additionally proved the legacy **local-db v1-only** shape (the third drift source, not covered by the suite) upgrades to v5 with data intact.
- [x] **New installs get one canonical schema** — MET. Fresh `runMigrations` lands directly at v5 with all seven tables and the full 16-column `cached_skills` / 11-column `remote_servers` (asserted column-by-column in suite; re-verified).
- [x] **Tests prove both old shapes upgrade** — MET. `packages/local-db/src/migrations.test.ts`: 4 tests, 85 assertions, all passing.

Domain/architectural compliance: layering is respected (migration engine lives in the `local-db` package; surfaces only call `runMigrations(db)` at open). The driver union (`SqliteDriver | MigrationDriver`, `prepare` vs `query`) correctly keeps the package runtime-agnostic across better-sqlite3 (desktop) and `bun:sqlite` (TUI). Error path is sane: a driver with neither method throws `SQLite driver must provide prepare() or query()` (verified) instead of a `TypeError`. No `DROP TABLE` / destructive recreation anywhere (verified by source scan). Idempotency verified (triple-run stable at v5); future-version (99) DBs are left untouched (verified). Version bookkeeping was unified without breaking legacy rows: old surfaces wrote versions via inline `INSERT OR IGNORE ... VALUES (N)`, the new runner writes via parameterized `INSERT OR IGNORE`, and `MAX(version)` reads both identically.

### 2. Code Quality, Security & Performance

No blocking defects. Two non-blocking observations for follow-up (neither violates the bean spec):

1. **Undeclared dependency (minor, follow-up recommended).** `apps/desktop` and `packages/tui` both import `@skillsgate/local-db`, but neither declares it in `package.json` — resolution works only via workspace hoisting. I verified the desktop production build (`electron-vite build`, exit 0) inlines the migrations into `out/main/index.js` (no runtime `require` of the package), so this is safe today. Latent trap: if someone later "fixes" this by adding local-db to desktop `dependencies` without also adding it to `bundledWorkspacePackages` in `electron-vite.config.ts`, `externalizeDepsPlugin` will externalize a source-only ESM/TS package and the app will die with `ERR_REQUIRE_ESM` at launch — the exact failure mode that config's own comment documents for `skill-sources`. The correct fix pairs both changes.
2. **Concurrent first-open ALTER race (minor, accepted risk).** Both surfaces share `~/.skillsgate/skillsgate.db` in WAL mode, and v5's `PRAGMA`-guard is check-then-act, not atomic: two processes opening a v4 DB simultaneously could both issue the same `ADD COLUMN` and the loser gets `duplicate column name`. Pre-existing class of issue (old code was `CREATE TABLE IF NOT EXISTS`, which is race-safe), narrow window, single-owner reality, and any failure self-heals on retry since the guard skips present columns. Not a land-blocker; a `try/catch` around the v5 ALTERs for that specific error would close it.

`PRAGMA table_info(${tableName})` interpolates only hardcoded table names — no injection surface. No perf concern (migrations run once per open; v5 does two PRAGMA reads + at most six ALTERs on upgrade, zero writes on steady state).

### 3. Verification Output (cd packages/cli && bun run test)

```
# Gate (brief-specified): cd packages/cli && bun run test
# tests 35, # suites 10, # pass 35, # fail 0   (duration ~0.8s)

# Supporting verification (all real runs, this worktree):
packages/local-db  bun test ............ 4 pass, 0 fail, 85 expect() calls
packages/cli       tsc --noEmit ........ exit 0
packages/tui       bun x tsc --noEmit .. exit 0
apps/desktop       npx tsc --noEmit .... exit 0
apps/desktop       electron-vite build . exit 0 (main+preload+renderer)
```

Adversarial edge script (12 checks, throwaway, all PASS — file removed after run):
- legacy local-db v1-only shape → v5, full schema, row preserved
- prepare-only (better-sqlite3-shaped, no `query()`) driver: fresh → v5; partial v4 → v5 with `auto_sync` + cached columns added (this is the actual desktop runtime path; the committed suite only exercises `bun:sqlite`)
- driver with neither method → clear `prepare()/query()` error, not a TypeError
- future schema version 99 → untouched
- no `DROP TABLE` in shipped migration source
