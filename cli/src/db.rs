use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn db_path() -> Result<PathBuf> {
    let base = dirs::config_dir()
        .context("Cannot determine config directory")?;
    Ok(base.join("msctl").join("serve.db"))
}

pub fn open() -> Result<Connection> {
    let path = db_path()?;
    open_at(&path)
}

pub fn open_at(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Cannot create dir {}", parent.display()))?;
    }
    let conn = Connection::open(path)
        .with_context(|| format!("Cannot open SQLite at {}", path.display()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS agents (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL UNIQUE,
            project_path TEXT NOT NULL,
            runtime      TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id              TEXT PRIMARY KEY,
            agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            title           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            last_message_at INTEGER NOT NULL,
            status          TEXT NOT NULL DEFAULT 'idle',
            claude_session_id TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            TEXT NOT NULL,
            payload         TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            seq             INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            importance      TEXT NOT NULL DEFAULT 'normal',
            status          TEXT NOT NULL DEFAULT 'running',
            started_at      INTEGER NOT NULL,
            ended_at        INTEGER
        );
        CREATE TABLE IF NOT EXISTS push_tokens (
            id              TEXT PRIMARY KEY,
            expo_push_token TEXT NOT NULL,
            device_label    TEXT NOT NULL,
            registered_at   INTEGER NOT NULL
        );
    "#)?;
    // Migrate existing DBs: add claude_session_id if missing
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN claude_session_id TEXT;");
    let _ = conn.execute_batch("ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'full-auto';");
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT;");
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// db::open creates all 5 tables on a fresh database.
    ///
    /// Execution:
    ///   1. Open a temp-path SQLite DB
    ///   2. Query sqlite_master for table names
    ///
    /// Expected:
    ///   - agents table exists
    ///   - conversations table exists
    ///   - messages table exists
    ///   - tasks table exists
    ///   - push_tokens table exists
    #[test]
    fn test_open_creates_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        let conn = open_at(&path).unwrap();
        let tables: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).unwrap();
            stmt.query_map([], |r| r.get(0)).unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(tables.contains(&"agents".to_string()),        "agents table must exist");
        assert!(tables.contains(&"conversations".to_string()), "conversations table must exist");
        assert!(tables.contains(&"messages".to_string()),      "messages table must exist");
        assert!(tables.contains(&"tasks".to_string()),         "tasks table must exist");
        assert!(tables.contains(&"push_tokens".to_string()),   "push_tokens table must exist");
    }

    /// DB migration: agents table has mode column after open_at.
    ///
    /// Execution:
    ///   1. Open fresh DB
    ///   2. Query column info for agents table
    ///
    /// Expected:
    ///   - "mode" column exists in agents
    ///   - "codex_thread_id" column exists in conversations
    #[test]
    fn test_schema_has_mode_and_codex_thread_id() {
        let dir = tempdir().unwrap();
        let conn = open_at(&dir.path().join("test.db")).unwrap();

        let has_mode: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('agents') WHERE name='mode'",
            [], |r| r.get::<_, i64>(0),
        ).unwrap() > 0;
        assert!(has_mode, "agents.mode column must exist after migration");

        let has_thread_id: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='codex_thread_id'",
            [], |r| r.get::<_, i64>(0),
        ).unwrap() > 0;
        assert!(has_thread_id, "conversations.codex_thread_id column must exist after migration");
    }

    /// now_ms returns a positive unix millisecond timestamp.
    ///
    /// Expected:
    ///   - value > 0
    ///   - value > 1_700_000_000_000 (after Nov 2023)
    #[test]
    fn test_now_ms_is_reasonable() {
        let ts = now_ms();
        assert!(ts > 1_700_000_000_000, "now_ms should be a recent unix ms timestamp");
    }
}
