use super::*;
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn test_schema_has_project_model_tables_and_columns() {
    let dir = tempdir().unwrap();
    let conn = open_at(&dir.path().join("test.db")).unwrap();

    let has_projects_table: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
        > 0;
    assert!(
        has_projects_table,
        "projects table must exist for project/session/resource model"
    );

    for (table, column) in [
        ("agents", "project_id"),
        ("conversations", "project_id"),
        ("workflows", "project_id"),
    ] {
        let exists: bool = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name='{column}'"),
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        assert!(exists, "{table}.{column} column must exist");
    }
}

#[test]
fn test_project_migration_backfills_existing_agents_and_conversations() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE agents (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL UNIQUE,
                project_path TEXT NOT NULL,
                runtime      TEXT NOT NULL,
                created_at   INTEGER NOT NULL
            );
            CREATE TABLE conversations (
                id              TEXT PRIMARY KEY,
                agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                title           TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                last_message_at INTEGER NOT NULL,
                status          TEXT NOT NULL DEFAULT 'idle',
                claude_session_id TEXT
            );
            CREATE TABLE messages (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                payload         TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                seq             INTEGER NOT NULL
            );
            CREATE TABLE tasks (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                importance      TEXT NOT NULL DEFAULT 'normal',
                status          TEXT NOT NULL DEFAULT 'running',
                started_at      INTEGER NOT NULL,
                ended_at        INTEGER
            );
            CREATE TABLE push_tokens (
                id              TEXT PRIMARY KEY,
                expo_push_token TEXT NOT NULL,
                device_label    TEXT NOT NULL,
                registered_at   INTEGER NOT NULL
            );
            CREATE TABLE ask_answers (
                ask_id          TEXT NOT NULL,
                conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                answered_at     INTEGER NOT NULL,
                choice_id       TEXT,
                freeform        TEXT,
                PRIMARY KEY (conversation_id, ask_id)
            );
            CREATE TABLE activity_reads (
                conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
                read_at         INTEGER NOT NULL
            );
            CREATE TABLE workflows (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                prompt          TEXT NOT NULL,
                enabled         INTEGER NOT NULL DEFAULT 1,
                schedule_kind   TEXT NOT NULL,
                time_of_day     TEXT NOT NULL,
                day_of_week     INTEGER,
                next_run_at     INTEGER,
                last_run_at     INTEGER,
                created_at      INTEGER NOT NULL,
                updated_at      INTEGER NOT NULL
            );
            CREATE TABLE workflow_runs (
                id              TEXT PRIMARY KEY,
                workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
                conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
                status          TEXT NOT NULL,
                scheduled_for   INTEGER NOT NULL,
                started_at      INTEGER,
                ended_at        INTEGER,
                summary         TEXT,
                error_message   TEXT,
                created_at      INTEGER NOT NULL
            );
            INSERT INTO agents (id, name, project_path, runtime, created_at)
            VALUES
                ('agent-old', 'old', '/repo/demo', 'codex', 10),
                ('agent-new', 'new', '/repo/demo/', 'claude-code', 20);
            INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
            VALUES ('conv-1', 'agent-new', 'Thread', 30, 40, 'idle');
            "#,
        )
        .unwrap();
    }

    let conn = open_at(&path).unwrap();
    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        project_count, 1,
        "trailing slash variants must backfill to one project"
    );

    let (project_id, default_agent_id): (String, String) = conn
        .query_row("SELECT id, default_agent_id FROM projects", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        default_agent_id, "agent-old",
        "earliest created agent should become the default resource"
    );

    let agent_project_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE project_id = ?1",
            [&project_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        agent_project_count, 2,
        "both existing agents should point to the backfilled project"
    );

    let conversation_project_id: String = conn
        .query_row(
            "SELECT project_id FROM conversations WHERE id = 'conv-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        conversation_project_id, project_id,
        "existing conversations should inherit project_id from their agent"
    );
}
