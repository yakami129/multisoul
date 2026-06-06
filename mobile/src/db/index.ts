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
    CREATE TABLE IF NOT EXISTS app_migrations (
      key        TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS specs (
      id                      TEXT PRIMARY KEY,
      title                   TEXT NOT NULL,
      slug                    TEXT NOT NULL,
      status                  TEXT NOT NULL,
      target_agent_id         TEXT NOT NULL,
      target_endpoint_id      TEXT NOT NULL,
      target_repo_path        TEXT NOT NULL,
      target_agent_name       TEXT NOT NULL,
      target_runtime          TEXT NOT NULL,
      questions_json          TEXT NOT NULL,
      answers_json            TEXT NOT NULL,
      markdown_preview        TEXT,
      repo_spec_path          TEXT,
      linked_conversation_id  TEXT,
      linked_activity_item_id TEXT,
      error_message           TEXT,
      created_at              INTEGER NOT NULL,
      updated_at              INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_specs_status_updated
      ON specs(status, updated_at DESC);
  `);
  await applyMigration(
    'spec_assets_schema_v1',
    `
    CREATE TABLE IF NOT EXISTS spec_ideas (
      id                        TEXT PRIMARY KEY,
      title                     TEXT NOT NULL,
      status                    TEXT NOT NULL,
      target_agent_id           TEXT NOT NULL,
      target_endpoint_id        TEXT NOT NULL,
      target_repo_path          TEXT NOT NULL,
      target_agent_name         TEXT NOT NULL,
      body                      TEXT NOT NULL,
      notes_json                TEXT NOT NULL,
      attachments_json          TEXT NOT NULL,
      interview_conversation_id TEXT,
      converted_spec_id         TEXT,
      error_message             TEXT,
      pending_mutation          TEXT,
      last_sync_error           TEXT,
      created_at                INTEGER NOT NULL,
      updated_at                INTEGER NOT NULL,
      archived_at               INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_spec_ideas_endpoint_status_updated
      ON spec_ideas(target_endpoint_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spec_ideas_pending
      ON spec_ideas(target_endpoint_id, pending_mutation);
    CREATE TABLE IF NOT EXISTS spec_artifacts (
      id                                      TEXT PRIMARY KEY,
      title                                   TEXT NOT NULL,
      slug                                    TEXT NOT NULL,
      status                                  TEXT NOT NULL,
      target_agent_id                         TEXT NOT NULL,
      target_endpoint_id                      TEXT NOT NULL,
      target_repo_path                        TEXT NOT NULL,
      repo_spec_path                          TEXT NOT NULL,
      latest_version_id                       TEXT NOT NULL,
      source_idea_id                          TEXT,
      interview_conversation_id               TEXT NOT NULL,
      latest_implementation_conversation_id   TEXT,
      linked_activity_item_id                 TEXT,
      created_at                              INTEGER NOT NULL,
      updated_at                              INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spec_artifacts_endpoint_status_updated
      ON spec_artifacts(target_endpoint_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_spec_artifacts_repo_path
      ON spec_artifacts(target_endpoint_id, repo_spec_path);
    CREATE TABLE IF NOT EXISTS spec_artifact_versions (
      id                     TEXT PRIMARY KEY,
      spec_id                TEXT NOT NULL,
      revision               INTEGER NOT NULL,
      repo_spec_path         TEXT NOT NULL,
      markdown               TEXT NOT NULL,
      markdown_sha256        TEXT NOT NULL,
      source_conversation_id TEXT NOT NULL,
      created_at             INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spec_artifact_versions_spec_revision
      ON spec_artifact_versions(spec_id, revision DESC);
  `,
  );
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

async function applyMigration(key: string, sql: string): Promise<void> {
  if (!_db) throw new Error('DB not initialized');
  const existing = await _db.getAllAsync<{ key: string }>(
    'SELECT key FROM app_migrations WHERE key = ?',
    [key],
  );
  if (existing.length > 0) return;
  await _db.execAsync(sql);
  await _db.runAsync('INSERT INTO app_migrations (key, applied_at) VALUES (?, ?)', [
    key,
    Date.now(),
  ]);
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('DB not initialized — call initDb() first');
  return _db;
}
