use crate::serve::{state::AppState, workflows::WorkflowScheduleKind};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct WorkflowRow {
    pub id: String,
    pub name: String,
    pub agent_id: String,
    pub prompt: String,
    pub enabled: bool,
    pub schedule_kind: String,
    pub time_of_day: String,
    pub day_of_week: Option<i64>,
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub mode: String,
    pub interval_minutes: Option<i64>,
    pub max_runs: Option<i64>,
    pub expires_at: Option<i64>,
    pub stop_condition: Option<String>,
    pub watch_status: Option<String>,
    pub run_count: i64,
}

#[derive(Debug, Serialize)]
pub struct WorkflowRunRow {
    pub id: String,
    pub workflow_id: String,
    pub conversation_id: Option<String>,
    pub status: String,
    pub scheduled_for: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub summary: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub run_number: Option<i64>,
    pub stop_condition_satisfied: Option<bool>,
    pub stop_condition_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WorkflowWriteBody {
    pub name: String,
    pub agent_id: String,
    pub prompt: String,
    pub schedule_kind: Option<String>,
    pub time_of_day: Option<String>,
    pub day_of_week: Option<i64>,
    pub mode: Option<String>,
    pub interval_minutes: Option<i64>,
    pub max_runs: Option<i64>,
    pub expires_at: Option<i64>,
    pub stop_condition: Option<String>,
}

pub(super) fn load_workflow(state: &AppState, id: &str) -> Result<WorkflowRow, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT id, name, agent_id, prompt, enabled, schedule_kind, time_of_day,
                day_of_week, next_run_at, last_run_at, created_at, updated_at,
                mode, interval_minutes, max_runs, expires_at, stop_condition,
                watch_status, run_count
         FROM workflows
         WHERE id = ?1",
        [id],
        row_to_workflow,
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })
}

pub(super) fn row_to_workflow(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkflowRow> {
    let enabled: i64 = row.get(4)?;
    Ok(WorkflowRow {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_id: row.get(2)?,
        prompt: row.get(3)?,
        enabled: enabled != 0,
        schedule_kind: row.get(5)?,
        time_of_day: row.get(6)?,
        day_of_week: row.get(7)?,
        next_run_at: row.get(8)?,
        last_run_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        mode: row.get(12)?,
        interval_minutes: row.get(13)?,
        max_runs: row.get(14)?,
        expires_at: row.get(15)?,
        stop_condition: row.get(16)?,
        watch_status: row.get(17)?,
        run_count: row.get(18)?,
    })
}

pub(super) fn ensure_agent_exists(
    db: &rusqlite::Connection,
    agent_id: &str,
) -> Result<(), StatusCode> {
    let exists = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agents WHERE id = ?1)",
            [agent_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        != 0;
    if exists {
        Ok(())
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

pub(super) fn validate_watch_body(body: &WorkflowWriteBody, now: i64) -> Result<(), StatusCode> {
    if body.name.trim().is_empty() || body.prompt.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let interval = body.interval_minutes.unwrap_or(0);
    if interval <= 0 {
        return Err(StatusCode::BAD_REQUEST);
    }
    if let Some(max) = body.max_runs {
        if max <= 0 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    if let Some(exp) = body.expires_at {
        if exp <= now {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    Ok(())
}

pub(super) fn parse_schedule_kind(value: &str) -> Result<WorkflowScheduleKind, StatusCode> {
    match value {
        "daily" => Ok(WorkflowScheduleKind::Daily),
        "weekly" => Ok(WorkflowScheduleKind::Weekly),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
