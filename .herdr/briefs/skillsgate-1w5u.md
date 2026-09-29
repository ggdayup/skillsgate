# Assignment Brief: skillsgate-1w5u - Consolidate three drifted SQLite migration sets

- **Bean ID**: skillsgate-1w5u
- **Target Branch/Worktree**: fleet/agy-coder-3
- **Base Commit**: 0df626d
- **Dispatched To**: agy-coder-3 (agy)
- **Complexity**: L
- **Cost tier**: coder
- **Critical**: no

## 1. Objective

Give `~/.skillsgate/skillsgate.db` a single source of truth for its schema.
Today three migration files disagree and `CREATE TABLE IF NOT EXISTS` hides the
disagreement, so whichever process opens the file first defines the schema and
every later one runs against tables missing their columns.

## 2. Context & Evidence

- Primary files to inspect:
  - `apps/desktop/src/main/db/migrations.ts` (v1-v4)
  - `packages/tui/src/db/migrations.ts` (v1-v4)
  - `packages/local-db/src/migrations.ts` (v1 only)
  - `packages/local-db/src/db.ts` — `SqliteDriver` interface; the caller injects
    `better-sqlite3` (desktop) or `bun:sqlite` (TUI), so the shared module must
    stay driver-agnostic.
- The concrete drift:
  - desktop `cached_skills` has `project_name`, `has_supporting_files`,
    `supporting_files`, `installed_at`, `updated_at`; the TUI's does not.
  - local-db `remote_servers` has `auto_sync`; the other two do not.
  - local-db stops at v1 — no `favorites`, `cached_skills`, `trending_cache`.
- Both openers set `PRAGMA journal_mode=WAL` and `foreign_keys=ON`, and both
  write `~/.skillsgate/skillsgate.db`. That is why the race matters: the desktop
  and the TUI can be running at the same moment.
- Reference documentation:
  - `docs/adr/0007-shared-local-sqlite-for-cross-surface-state.md` — Negative
    consequences records this drift and calls the shared-module fix "not yet
    done". This bean is that fix.
- Provenance: `packages/local-db` currently has **zero consumers** — all three
  copies grew independently. It is the natural home for the shared module.

## 3. Strict Rules & Guardrails

- **DO NOT PUSH**: never run `git push`. Commit locally to `fleet/agy-coder-3`.
- **Atomic Commits**: schema-source extraction, then each surface's adoption,
  as separate commits.
- **This is a data-safety change.** Never `DROP`, never rewrite a table, never
  delete a user's database. Prefer additive `ALTER TABLE ... ADD COLUMN` guarded
  by a column-existence check over any recreate.
- **Verification**: write a test that creates a database using the *old* desktop
  v4 shape, then runs the new migration path, and asserts every column the new
  code reads exists afterwards. Repeat for the old TUI shape. Both must pass.
- **Report**: `.herdr/reports/skillsgate-1w5u-agy-coder-3.md` ending with
  `## Lessons Learned` (1-3 bullets).
- **Heartbeat** every 5 minutes and after every commit:
  ```bash
  .herdr/scripts/fleet-heartbeat agy-coder-3 skillsgate-1w5u <pct> "<one-line progress>"
  ```
- **Checkpoint** after each sub-step:
  ```bash
  .herdr/scripts/fleet-checkpoint agy-coder-3 skillsgate-1w5u --done "step1" --next "step2" --artifacts "commit:<sha>"
  ```
- **Quota**: on 429/401/insufficient_quota, stop and announce BLOCKED.
- **Economy**: batch shell commands with `&&`; single heredoc per file write;
  never run `--help`.
- **Frozen contract**: on high-stakes ambiguity, BLOCKED with 2-3 options —
  never guess about schema.

## 4. Acceptance Criteria (numbered, pass/fail)

1. Exactly one module defines the migration list, and both
   `apps/desktop/src/main/db/` and `packages/tui/src/db/` consume it — neither
   keeps its own table definitions.
2. A test proves a database created by the **current desktop** migration set is
   upgraded in place with no data loss and gains every column the new code reads.
3. A test proves the same for a database created by the **current TUI** set.
4. `auto_sync` and the five desktop-only `cached_skills` columns are present in
   the canonical schema regardless of which surface creates the file first.
5. No `DROP TABLE` or destructive rewrite appears in the diff.
6. `cd packages/cli && bun run test` still exits 0.

## 4b. Scope (machine-checked)

- allow: `apps/desktop/src/main/db/*`
- allow: `packages/tui/src/db/*`
- allow: `packages/local-db/*`

## 5. Out of Scope

- Changing what is stored (the `settings` key set, cache TTLs, favorites
  semantics) — schema consolidation only.
- `apps/web` and its Cloudflare/Postgres stack.
- The SSH client's behaviour (`packages/local-db/src/ssh/*`): you may move files,
  but do not change how SSH commands are built or executed.

## 6. Do Not Touch

- `apps/desktop/src/main/core-skills.ts` and `apps/desktop/src/main/core-skills.test.ts`
  (bean skillsgate-o7ni).
- `packages/cli/src/core/*` (bean skillsgate-0m19).
- `docs/adr/*` — the ADR is the record of the decision, not yours to amend.

## 7. Completion Command (Mandatory)

If finished successfully:
```bash
./.herdr/scripts/fleet-done agy-coder-3 skillsgate-1w5u DONE "Consolidated the three drifted SQLite migration sets behind one source of truth with upgrade tests for both legacy shapes" .herdr/reports/skillsgate-1w5u-agy-coder-3.md
```

If blocked:
```bash
./.herdr/scripts/fleet-done agy-coder-3 skillsgate-1w5u BLOCKED "<one-line blocker>" .herdr/reports/skillsgate-1w5u-agy-coder-3.md
```
