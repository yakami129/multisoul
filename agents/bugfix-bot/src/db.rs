// bugfix-bot/src/db.rs
use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::Path;

#[derive(Debug)]
pub struct BugTask {
    pub id: String,
    pub feishu_issue_id: String,
    pub gitlab_issue_id: Option<i64>,
    pub gitlab_mr_id: Option<i64>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub status: String,
    pub pipeline_stage: Option<String>,
    pub retry_count: i64,
    pub claude_session_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
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
        CREATE TABLE IF NOT EXISTS bug_tasks (
            id               TEXT PRIMARY KEY,
            feishu_issue_id  TEXT NOT NULL UNIQUE,
            gitlab_issue_id  INTEGER,
            gitlab_mr_id     INTEGER,
            worktree_path    TEXT,
            branch_name      TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            pipeline_stage   TEXT,
            retry_count      INTEGER NOT NULL DEFAULT 0,
            claude_session_id TEXT,
            created_at       INTEGER NOT NULL,
            updated_at       INTEGER NOT NULL
        );
    "#)?;
    Ok(())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn insert_bug_task(conn: &Connection, feishu_issue_id: &str) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO bug_tasks (id, feishu_issue_id, status, retry_count, created_at, updated_at)
         VALUES (?1, ?2, 'pending', 0, ?3, ?3)",
        rusqlite::params![id, feishu_issue_id, now],
    ).context("insert_bug_task failed")?;
    Ok(id)
}

pub fn find_by_feishu_id(conn: &Connection, feishu_issue_id: &str) -> Result<Option<BugTask>> {
    let mut stmt = conn.prepare(
        "SELECT id, feishu_issue_id, gitlab_issue_id, gitlab_mr_id, worktree_path,
                branch_name, status, pipeline_stage, retry_count, claude_session_id,
                created_at, updated_at
         FROM bug_tasks WHERE feishu_issue_id = ?1"
    )?;
    let mut rows = stmt.query_map([feishu_issue_id], |r| {
        Ok(BugTask {
            id: r.get(0)?,
            feishu_issue_id: r.get(1)?,
            gitlab_issue_id: r.get(2)?,
            gitlab_mr_id: r.get(3)?,
            worktree_path: r.get(4)?,
            branch_name: r.get(5)?,
            status: r.get(6)?,
            pipeline_stage: r.get(7)?,
            retry_count: r.get(8)?,
            claude_session_id: r.get(9)?,
            created_at: r.get(10)?,
            updated_at: r.get(11)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

pub fn update_status(conn: &Connection, id: &str, status: &str) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET status=?1, updated_at=?2 WHERE id=?3",
        rusqlite::params![status, now_ms(), id],
    ).context("update_status failed")?;
    Ok(())
}

pub fn update_fields(conn: &Connection, id: &str, fields: &UpdateFields) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET
            status = COALESCE(?1, status),
            pipeline_stage = COALESCE(?2, pipeline_stage),
            gitlab_issue_id = COALESCE(?3, gitlab_issue_id),
            gitlab_mr_id = COALESCE(?4, gitlab_mr_id),
            worktree_path = COALESCE(?5, worktree_path),
            branch_name = COALESCE(?6, branch_name),
            claude_session_id = COALESCE(?7, claude_session_id),
            updated_at = ?8
         WHERE id = ?9",
        rusqlite::params![
            fields.status, fields.pipeline_stage, fields.gitlab_issue_id,
            fields.gitlab_mr_id, fields.worktree_path, fields.branch_name,
            fields.claude_session_id, now_ms(), id
        ],
    ).context("update_fields failed")?;
    Ok(())
}

pub fn increment_retry(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE bug_tasks SET retry_count = retry_count + 1, updated_at=?1 WHERE id=?2",
        rusqlite::params![now_ms(), id],
    ).context("increment_retry failed")?;
    Ok(())
}

/// 部分更新字段，None 表示不修改
#[derive(Default)]
pub struct UpdateFields {
    pub status: Option<String>,
    pub pipeline_stage: Option<String>,
    pub gitlab_issue_id: Option<i64>,
    pub gitlab_mr_id: Option<i64>,
    pub worktree_path: Option<String>,
    pub branch_name: Option<String>,
    pub claude_session_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_conn() -> rusqlite::Connection {
        let dir = tempdir().unwrap();
        open_at(&dir.path().join("t.db")).unwrap()
    }

    /// insert_bug_task 后 find_by_feishu_id 能找到
    ///
    /// 预期：status = "pending", retry_count = 0
    #[test]
    fn test_insert_and_find_bug_task() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-001").unwrap();
        let task = find_by_feishu_id(&conn, "feishu-001").unwrap().unwrap();
        assert_eq!(task.id, id, "id must match");
        assert_eq!(task.status, "pending", "initial status must be pending");
        assert_eq!(task.retry_count, 0, "initial retry_count must be 0");
    }

    /// update_status 正确更新状态
    ///
    /// 预期：status 变为 "analyzing"
    #[test]
    fn test_update_status() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-002").unwrap();
        update_status(&conn, &id, "analyzing").unwrap();
        let task = find_by_feishu_id(&conn, "feishu-002").unwrap().unwrap();
        assert_eq!(task.status, "analyzing", "status must be updated");
    }

    /// increment_retry 正确递增
    ///
    /// 预期：retry_count 从 0 变为 1
    #[test]
    fn test_increment_retry() {
        let conn = make_conn();
        let id = insert_bug_task(&conn, "feishu-003").unwrap();
        increment_retry(&conn, &id).unwrap();
        let task = find_by_feishu_id(&conn, "feishu-003").unwrap().unwrap();
        assert_eq!(task.retry_count, 1, "retry_count must be 1 after increment");
    }

    /// 同一 feishu_issue_id 不能重复插入
    ///
    /// 预期：第二次 insert 返回 Err（UNIQUE constraint）
    #[test]
    fn test_duplicate_feishu_id_returns_err() {
        let conn = make_conn();
        insert_bug_task(&conn, "feishu-004").unwrap();
        let result = insert_bug_task(&conn, "feishu-004");
        assert!(result.is_err(), "duplicate feishu_issue_id must fail");
    }
}
