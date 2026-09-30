import type { SqliteDriver, SqliteStatement } from "./types.js"

export interface MigrationDriver {
  exec(sql: string): void
  prepare?: (sql: string) => SqliteStatement
  query?: (sql: string) => SqliteStatement
}

export type MigrationDb = SqliteDriver | MigrationDriver

export interface Migration {
  version: number
  up: string | ((driver: MigrationDb) => void)
}

function prepareStatement(driver: MigrationDb, sql: string): SqliteStatement {
  if ("prepare" in driver && typeof driver.prepare === "function") {
    return driver.prepare(sql)
  }
  if ("query" in driver && typeof (driver as any).query === "function") {
    return (driver as any).query(sql)
  }
  throw new Error("SQLite driver must provide prepare() or query()")
}

function getTableColumns(driver: MigrationDb, tableName: string): Set<string> {
  try {
    const rows = prepareStatement(driver, `PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  } catch {
    return new Set()
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS remote_servers (
        id               TEXT PRIMARY KEY,
        label            TEXT NOT NULL,
        host             TEXT NOT NULL,
        port             INTEGER NOT NULL DEFAULT 22,
        username         TEXT NOT NULL,
        skills_base_path TEXT NOT NULL DEFAULT '~/.agents/skills',
        ssh_key_path     TEXT,
        auto_sync        INTEGER NOT NULL DEFAULT 1,
        last_sync_at     TEXT,
        last_sync_error  TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(host, port, username)
      );

      CREATE TABLE IF NOT EXISTS remote_skills (
        id           TEXT PRIMARY KEY,
        server_id    TEXT NOT NULL REFERENCES remote_servers(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        description  TEXT,
        remote_path  TEXT NOT NULL,
        content      TEXT,
        content_hash TEXT,
        synced_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(server_id, remote_path)
      );

      CREATE INDEX IF NOT EXISTS idx_remote_skills_server ON remote_skills(server_id);
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS cached_skills (
        canonical_path       TEXT PRIMARY KEY,
        folder_name          TEXT NOT NULL,
        name                 TEXT NOT NULL,
        description          TEXT NOT NULL DEFAULT '',
        agents               TEXT NOT NULL DEFAULT '[]',
        agent_short_codes    TEXT NOT NULL DEFAULT '[]',
        scope                TEXT NOT NULL DEFAULT 'global',
        project_name         TEXT,
        has_supporting_files INTEGER NOT NULL DEFAULT 0,
        supporting_files     TEXT NOT NULL DEFAULT '[]',
        source               TEXT,
        source_type          TEXT,
        installed_at         TEXT,
        updated_at           TEXT,
        file_mod_time        TEXT NOT NULL,
        scanned_at           TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS favorites (
        skill_name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS trending_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fetched_at TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
    `,
  },
  {
    version: 5,
    up: (driver: MigrationDb) => {
      // Reconcile schema drift across surfaces without data loss.
      // 1. Ensure remote_servers has auto_sync.
      const serverCols = getTableColumns(driver, "remote_servers")
      if (serverCols.size > 0 && !serverCols.has("auto_sync")) {
        driver.exec("ALTER TABLE remote_servers ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 1;")
      }

      // 2. Ensure cached_skills has the five desktop-specific columns.
      const cachedCols = getTableColumns(driver, "cached_skills")
      if (cachedCols.size > 0) {
        if (!cachedCols.has("project_name")) {
          driver.exec("ALTER TABLE cached_skills ADD COLUMN project_name TEXT;")
        }
        if (!cachedCols.has("has_supporting_files")) {
          driver.exec("ALTER TABLE cached_skills ADD COLUMN has_supporting_files INTEGER NOT NULL DEFAULT 0;")
        }
        if (!cachedCols.has("supporting_files")) {
          driver.exec("ALTER TABLE cached_skills ADD COLUMN supporting_files TEXT NOT NULL DEFAULT '[]';")
        }
        if (!cachedCols.has("installed_at")) {
          driver.exec("ALTER TABLE cached_skills ADD COLUMN installed_at TEXT;")
        }
        if (!cachedCols.has("updated_at")) {
          driver.exec("ALTER TABLE cached_skills ADD COLUMN updated_at TEXT;")
        }
      }
    },
  },
]

export function getCurrentVersion(driver: MigrationDb): number {
  try {
    const row = prepareStatement(driver, "SELECT MAX(version) as v FROM schema_version")
      .get() as { v: number | null } | undefined
    return row?.v ?? 0
  } catch {
    return 0
  }
}

export function runMigrations(driver: MigrationDb): void {
  // Ensure schema_version table exists before reading or inserting versions
  driver.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `)

  const current = getCurrentVersion(driver)

  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      if (typeof migration.up === "string") {
        driver.exec(migration.up)
      } else {
        migration.up(driver)
      }

      prepareStatement(driver, "INSERT OR IGNORE INTO schema_version (version) VALUES (?)")
        .run(migration.version)
    }
  }
}
