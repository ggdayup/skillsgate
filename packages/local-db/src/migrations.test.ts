import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations, getCurrentVersion, MIGRATIONS } from "./migrations.js"

function getTableColumns(db: Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function getTableNames(db: Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>
  return rows.map((r) => r.name)
}

describe("canonical migrations", () => {
  it("initializes a fresh database to canonical head with all tables and columns", () => {
    const db = new Database(":memory:")
    runMigrations(db)

    expect(getCurrentVersion(db)).toBe(5)

    const tables = getTableNames(db)
    expect(tables).toContain("schema_version")
    expect(tables).toContain("settings")
    expect(tables).toContain("remote_servers")
    expect(tables).toContain("remote_skills")
    expect(tables).toContain("cached_skills")
    expect(tables).toContain("favorites")
    expect(tables).toContain("trending_cache")

    const serverCols = getTableColumns(db, "remote_servers")
    expect(serverCols).toContain("auto_sync")
    expect(serverCols).toContain("id")
    expect(serverCols).toContain("label")
    expect(serverCols).toContain("host")
    expect(serverCols).toContain("port")
    expect(serverCols).toContain("username")
    expect(serverCols).toContain("skills_base_path")
    expect(serverCols).toContain("ssh_key_path")
    expect(serverCols).toContain("last_sync_at")
    expect(serverCols).toContain("last_sync_error")
    expect(serverCols).toContain("created_at")

    const cachedCols = getTableColumns(db, "cached_skills")
    expect(cachedCols).toContain("project_name")
    expect(cachedCols).toContain("has_supporting_files")
    expect(cachedCols).toContain("supporting_files")
    expect(cachedCols).toContain("installed_at")
    expect(cachedCols).toContain("updated_at")
    expect(cachedCols).toContain("canonical_path")
    expect(cachedCols).toContain("folder_name")
    expect(cachedCols).toContain("name")
    expect(cachedCols).toContain("description")
    expect(cachedCols).toContain("agents")
    expect(cachedCols).toContain("agent_short_codes")
    expect(cachedCols).toContain("scope")
    expect(cachedCols).toContain("source")
    expect(cachedCols).toContain("source_type")
    expect(cachedCols).toContain("file_mod_time")
    expect(cachedCols).toContain("scanned_at")

    db.close()
  })

  it("upgrades a database created by the legacy desktop v4 migration set without data loss", () => {
    const db = new Database(":memory:")

    // 1. Create schema using the exact legacy desktop v1-v4 statements
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
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
      INSERT OR IGNORE INTO schema_version VALUES (1);

      CREATE TABLE IF NOT EXISTS cached_skills (
        canonical_path TEXT PRIMARY KEY,
        folder_name TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        agents TEXT NOT NULL DEFAULT '[]',
        agent_short_codes TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL DEFAULT 'global',
        project_name TEXT,
        has_supporting_files INTEGER NOT NULL DEFAULT 0,
        supporting_files TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        source_type TEXT,
        installed_at TEXT,
        updated_at TEXT,
        file_mod_time TEXT NOT NULL,
        scanned_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_version VALUES (2);

      CREATE TABLE IF NOT EXISTS favorites (
        skill_name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO schema_version VALUES (3);

      CREATE TABLE IF NOT EXISTS trending_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fetched_at TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_version VALUES (4);
    `)

    // Verify initial desktop v4 shape: MAX version is 4, remote_servers has NO auto_sync
    expect(getCurrentVersion(db)).toBe(4)
    expect(getTableColumns(db, "remote_servers")).not.toContain("auto_sync")

    // Insert mock existing data across all tables
    db.exec(`
      INSERT INTO settings (key, value) VALUES ('theme', 'dark');
      INSERT INTO remote_servers (id, label, host, username) VALUES ('srv-1', 'Desktop Server', '10.0.0.1', 'admin');
      INSERT INTO remote_skills (id, server_id, name, remote_path) VALUES ('sk-1', 'srv-1', 'skill-one', '/skills/one');
      INSERT INTO cached_skills (
        canonical_path, folder_name, name, description, agents, agent_short_codes,
        scope, project_name, has_supporting_files, supporting_files, source,
        installed_at, updated_at, file_mod_time, scanned_at
      ) VALUES (
        '/path/to/skill', 'skill-dir', 'My Skill', 'Description', '["agy"]', '["ag"]',
        'project', 'demo-project', 1, '[{"relativePath":"ref.md","size":120}]', 'local',
        '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'
      );
      INSERT INTO favorites (skill_name) VALUES ('My Skill');
      INSERT INTO trending_cache (id, fetched_at, payload) VALUES (1, '2026-05-01', '{"trending":[]}');
    `)

    // 2. Run new migration path
    runMigrations(db)

    // 3. Verify upgraded version
    expect(getCurrentVersion(db)).toBe(5)

    // 4. Verify remote_servers now has auto_sync with default value 1
    const serverCols = getTableColumns(db, "remote_servers")
    expect(serverCols).toContain("auto_sync")

    const serverRow = db.prepare("SELECT * FROM remote_servers WHERE id = 'srv-1'").get() as any
    expect(serverRow.id).toBe("srv-1")
    expect(serverRow.label).toBe("Desktop Server")
    expect(serverRow.host).toBe("10.0.0.1")
    expect(serverRow.username).toBe("admin")
    expect(serverRow.auto_sync).toBe(1)

    // 5. Verify all pre-existing data is completely preserved
    const settingRow = db.prepare("SELECT * FROM settings WHERE key = 'theme'").get() as any
    expect(settingRow.value).toBe("dark")

    const skillRow = db.prepare("SELECT * FROM remote_skills WHERE id = 'sk-1'").get() as any
    expect(skillRow.name).toBe("skill-one")

    const cachedRow = db.prepare("SELECT * FROM cached_skills WHERE canonical_path = '/path/to/skill'").get() as any
    expect(cachedRow.name).toBe("My Skill")
    expect(cachedRow.project_name).toBe("demo-project")
    expect(cachedRow.has_supporting_files).toBe(1)
    expect(cachedRow.supporting_files).toBe('[{"relativePath":"ref.md","size":120}]')
    expect(cachedRow.installed_at).toBe("2026-01-01")
    expect(cachedRow.updated_at).toBe("2026-02-01")

    const favRow = db.prepare("SELECT * FROM favorites WHERE skill_name = 'My Skill'").get() as any
    expect(favRow.skill_name).toBe("My Skill")

    const trendRow = db.prepare("SELECT * FROM trending_cache WHERE id = 1").get() as any
    expect(trendRow.payload).toBe('{"trending":[]}')

    db.close()
  })

  it("upgrades a database created by the legacy TUI v4 migration set without data loss", () => {
    const db = new Database(":memory:")

    // 1. Create schema using the exact legacy TUI v1-v4 statements
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS remote_servers (
        id              TEXT PRIMARY KEY,
        label           TEXT NOT NULL,
        host            TEXT NOT NULL,
        port            INTEGER NOT NULL DEFAULT 22,
        username        TEXT NOT NULL,
        skills_base_path TEXT NOT NULL DEFAULT '~/.agents/skills',
        ssh_key_path    TEXT,
        last_sync_at    TEXT,
        last_sync_error TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(host, port, username)
      );
      CREATE TABLE IF NOT EXISTS remote_skills (
        id          TEXT PRIMARY KEY,
        server_id   TEXT NOT NULL REFERENCES remote_servers(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        remote_path TEXT NOT NULL,
        content     TEXT,
        content_hash TEXT,
        synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(server_id, remote_path)
      );
      CREATE INDEX IF NOT EXISTS idx_remote_skills_server ON remote_skills(server_id);
      INSERT OR IGNORE INTO schema_version VALUES (1);

      CREATE TABLE IF NOT EXISTS cached_skills (
        canonical_path TEXT PRIMARY KEY,
        folder_name TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        agents TEXT NOT NULL DEFAULT '[]',
        agent_short_codes TEXT NOT NULL DEFAULT '[]',
        scope TEXT NOT NULL DEFAULT 'global',
        source TEXT,
        source_type TEXT,
        file_mod_time TEXT NOT NULL,
        scanned_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_version VALUES (2);

      CREATE TABLE IF NOT EXISTS favorites (
        skill_name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO schema_version VALUES (3);

      CREATE TABLE IF NOT EXISTS trending_cache (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fetched_at TEXT NOT NULL,
        payload    TEXT NOT NULL
      );
      INSERT OR IGNORE INTO schema_version VALUES (4);
    `)

    // Verify initial TUI v4 shape: MAX version is 4, remote_servers has NO auto_sync, cached_skills lacks 5 columns
    expect(getCurrentVersion(db)).toBe(4)
    expect(getTableColumns(db, "remote_servers")).not.toContain("auto_sync")

    const initialCachedCols = getTableColumns(db, "cached_skills")
    expect(initialCachedCols).not.toContain("project_name")
    expect(initialCachedCols).not.toContain("has_supporting_files")
    expect(initialCachedCols).not.toContain("supporting_files")
    expect(initialCachedCols).not.toContain("installed_at")
    expect(initialCachedCols).not.toContain("updated_at")

    // Insert mock existing data across all tables
    db.exec(`
      INSERT INTO settings (key, value) VALUES ('font', 'monospace');
      INSERT INTO remote_servers (id, label, host, username) VALUES ('tui-srv', 'TUI Server', '192.168.1.10', 'tuiuser');
      INSERT INTO remote_skills (id, server_id, name, remote_path) VALUES ('tui-sk', 'tui-srv', 'tui-skill', '/path/tui');
      INSERT INTO cached_skills (
        canonical_path, folder_name, name, description, agents, agent_short_codes,
        scope, source, source_type, file_mod_time, scanned_at
      ) VALUES (
        '/tui/skill', 'tui-dir', 'TUI Skill', 'A skill from TUI', '["claude"]', '["c"]',
        'global', 'git', 'repo', '2026-06-01', '2026-06-02'
      );
      INSERT INTO favorites (skill_name) VALUES ('TUI Skill');
      INSERT INTO trending_cache (id, fetched_at, payload) VALUES (1, '2026-06-03', '{"data":1}');
    `)

    // 2. Run new migration path
    runMigrations(db)

    // 3. Verify upgraded version
    expect(getCurrentVersion(db)).toBe(5)

    // 4. Verify remote_servers now has auto_sync
    const serverCols = getTableColumns(db, "remote_servers")
    expect(serverCols).toContain("auto_sync")
    const serverRow = db.prepare("SELECT * FROM remote_servers WHERE id = 'tui-srv'").get() as any
    expect(serverRow.label).toBe("TUI Server")
    expect(serverRow.auto_sync).toBe(1)

    // 5. Verify cached_skills has all five missing columns
    const cachedCols = getTableColumns(db, "cached_skills")
    expect(cachedCols).toContain("project_name")
    expect(cachedCols).toContain("has_supporting_files")
    expect(cachedCols).toContain("supporting_files")
    expect(cachedCols).toContain("installed_at")
    expect(cachedCols).toContain("updated_at")

    // 6. Verify existing data is preserved and defaults are correct
    const cachedRow = db.prepare("SELECT * FROM cached_skills WHERE canonical_path = '/tui/skill'").get() as any
    expect(cachedRow.name).toBe("TUI Skill")
    expect(cachedRow.scope).toBe("global")
    expect(cachedRow.project_name).toBeNull()
    expect(cachedRow.has_supporting_files).toBe(0)
    expect(cachedRow.supporting_files).toBe("[]")
    expect(cachedRow.installed_at).toBeNull()
    expect(cachedRow.updated_at).toBeNull()

    // 7. Verify desktop saveCachedSkills query can execute without errors against this upgraded table
    db.prepare(`
      INSERT OR REPLACE INTO cached_skills (
        canonical_path, folder_name, name, description,
        agents, agent_short_codes, scope, project_name,
        has_supporting_files, supporting_files,
        source, source_type, installed_at, updated_at,
        file_mod_time, scanned_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      "/new/skill", "new-dir", "New Skill", "Desc",
      "[]", "[]", "custom", "my-project",
      1, "[]",
      "local", "custom", "2026-07-01", "2026-07-02",
      "2026-07-03", "2026-07-04"
    )

    const newCachedRow = db.prepare("SELECT * FROM cached_skills WHERE canonical_path = '/new/skill'").get() as any
    expect(newCachedRow.name).toBe("New Skill")
    expect(newCachedRow.project_name).toBe("my-project")
    expect(newCachedRow.has_supporting_files).toBe(1)

    db.close()
  })

  it("is idempotent when run repeatedly", () => {
    const db = new Database(":memory:")
    runMigrations(db)
    expect(getCurrentVersion(db)).toBe(5)

    // Re-running must not throw or change the version
    expect(() => runMigrations(db)).not.toThrow()
    expect(getCurrentVersion(db)).toBe(5)

    expect(() => runMigrations(db)).not.toThrow()
    expect(getCurrentVersion(db)).toBe(5)

    db.close()
  })
})
