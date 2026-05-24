use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub fn db_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config directory")?;
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
    conn.execute_batch(
        r#"
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
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
            ON messages(conversation_id, seq);
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
            endpoint_id     TEXT,
            registered_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ask_answers (
            ask_id          TEXT NOT NULL,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            answered_at     INTEGER NOT NULL,
            choice_id       TEXT,
            choice_ids      TEXT,
            freeform        TEXT,
            PRIMARY KEY (conversation_id, ask_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ask_answers_conversation_ask
            ON ask_answers(conversation_id, ask_id);
        CREATE TABLE IF NOT EXISTS activity_reads (
            conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
            read_at         INTEGER NOT NULL
        );
    "#,
    )?;
    // Migrate existing DBs: add claude_session_id if missing
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN claude_session_id TEXT;");
    let _ =
        conn.execute_batch("ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'full-auto';");
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT;");
    let _ = conn.execute_batch("ALTER TABLE push_tokens ADD COLUMN endpoint_id TEXT;");
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN cursor_session_id TEXT;");
    // plugin_agents: plugin 可执行文件注册表
    let _ = conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plugin_agents (
            id            TEXT PRIMARY KEY,
            name          TEXT NOT NULL UNIQUE,
            version       TEXT NOT NULL,
            executable    TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'stopped',
            restart_count INTEGER NOT NULL DEFAULT 0,
            installed_at  INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );",
    );
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

    /// db::open creates all core tables on a fresh database.
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
    ///   - ask_answers table exists
    #[test]
    fn test_open_creates_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");
        let conn = open_at(&path).unwrap();
        let tables: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                .unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(
            tables.contains(&"agents".to_string()),
            "agents table must exist"
        );
        assert!(
            tables.contains(&"conversations".to_string()),
            "conversations table must exist"
        );
        assert!(
            tables.contains(&"messages".to_string()),
            "messages table must exist"
        );
        assert!(
            tables.contains(&"tasks".to_string()),
            "tasks table must exist"
        );
        assert!(
            tables.contains(&"push_tokens".to_string()),
            "push_tokens table must exist"
        );
        assert!(
            tables.contains(&"ask_answers".to_string()),
            "ask_answers table must exist"
        );
        assert!(
            tables.contains(&"activity_reads".to_string()),
            "activity_reads table must exist so Activity Done read state can persist in msctl"
        );
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

        let has_mode: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('agents') WHERE name='mode'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(has_mode, "agents.mode column must exist after migration");

        let has_thread_id: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='codex_thread_id'",
            [], |r| r.get::<_, i64>(0),
        ).unwrap() > 0;
        assert!(
            has_thread_id,
            "conversations.codex_thread_id column must exist after migration"
        );

        let has_cursor_session: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='cursor_session_id'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(
            has_cursor_session,
            "conversations.cursor_session_id column must exist after migration"
        );

        let has_ask_answers_choice_ids: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('ask_answers') WHERE name='choice_ids'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(
            has_ask_answers_choice_ids,
            "ask_answers.choice_ids column must exist after migration"
        );
    }

    /// now_ms returns a positive unix millisecond timestamp.
    ///
    /// Expected:
    ///   - value > 0
    ///   - value > 1_700_000_000_000 (after Nov 2023)
    #[test]
    fn test_now_ms_is_reasonable() {
        let ts = now_ms();
        assert!(
            ts > 1_700_000_000_000,
            "now_ms should be a recent unix ms timestamp"
        );
    }

    /// plugin_agents 表在 open_at 后存在，且包含所有必要字段
    ///
    /// 执行：
    ///   1. 打开临时 DB
    ///   2. 查询 sqlite_master 确认表存在
    ///   3. 查询 pragma_table_info 确认各字段存在
    ///
    /// 预期：
    ///   - plugin_agents 表存在
    ///   - 字段：id, name, version, executable, status, restart_count, installed_at, updated_at
    #[test]
    fn test_plugin_agents_table_exists() {
        let dir = tempdir().unwrap();
        let conn = open_at(&dir.path().join("test.db")).unwrap();

        let table_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='plugin_agents'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(
            table_exists,
            "plugin_agents table must exist after migration"
        );

        for col in &[
            "id",
            "name",
            "version",
            "executable",
            "status",
            "restart_count",
            "installed_at",
            "updated_at",
        ] {
            let exists: bool = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('plugin_agents') WHERE name='{}'",
                        col
                    ),
                    [],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap()
                > 0;
            assert!(exists, "plugin_agents.{} column must exist", col);
        }
    }

    /// plugin_agents upsert：重复注册同名 plugin 更新版本，不报错
    ///
    /// 执行：
    ///   1. 插入 name="fix-bug-bot" version="0.1.0"
    ///   2. upsert 同名 version="0.2.0"
    ///   3. 查询确认只有一条记录，version 为 "0.2.0"
    ///
    /// 预期：
    ///   - 记录数 = 1（不重复插入）
    ///   - version = "0.2.0"（已更新）
    #[test]
    fn test_plugin_agents_upsert() {
        let dir = tempdir().unwrap();
        let conn = open_at(&dir.path().join("test.db")).unwrap();
        let now = now_ms();

        conn.execute(
            "INSERT INTO plugin_agents (id, name, version, executable, status, restart_count, installed_at, updated_at)
             VALUES ('id1', 'fix-bug-bot', '0.1.0', 'fix-bug-bot', 'stopped', 0, ?1, ?1)",
            [now],
        ).unwrap();

        conn.execute(
            "INSERT INTO plugin_agents (id, name, version, executable, status, installed_at, updated_at)
             VALUES ('id2', 'fix-bug-bot', '0.2.0', 'fix-bug-bot', 'stopped', ?1, ?1)
             ON CONFLICT(name) DO UPDATE SET version=excluded.version, updated_at=excluded.updated_at",
            [now],
        ).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plugin_agents WHERE name='fix-bug-bot'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "upsert should not create duplicate rows");

        let version: String = conn
            .query_row(
                "SELECT version FROM plugin_agents WHERE name='fix-bug-bot'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "0.2.0", "version should be updated by upsert");
    }
}
