import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function initDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('multisoul.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS endpoints (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      base_url     TEXT NOT NULL,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agents_cache (
      endpoint_id  TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      name         TEXT NOT NULL,
      project_path TEXT NOT NULL,
      runtime      TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS inbox (
      id              TEXT PRIMARY KEY,
      endpoint_id     TEXT NOT NULL,
      agent_id        TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      kind            TEXT NOT NULL,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      payload         TEXT,
      received_at     INTEGER NOT NULL,
      read_at         INTEGER
    );
    CREATE TABLE IF NOT EXISTS answered_asks (
      ask_id          TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      answered_at     INTEGER NOT NULL,
      choice_id       TEXT,
      choice_ids      TEXT
    );
  `);
  // Migrate: add choice columns if upgrading from an older schema
  await _db
    .execAsync(
      `
    ALTER TABLE answered_asks ADD COLUMN choice_id TEXT;
  `,
    )
    .catch(() => {
      /* column already exists */
    });
  await _db
    .execAsync(
      `
    ALTER TABLE answered_asks ADD COLUMN choice_ids TEXT;
  `,
    )
    .catch(() => {
      /* column already exists */
    });
  return _db;
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('DB not initialized — call initDb() first');
  return _db;
}
