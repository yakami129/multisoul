use crate::serve::{state::AppState, workflows::WorkflowScheduleKind};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct WorkflowRow {
    pub id: String,
    pub name: String,
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub resource_id: String,
    pub resource_name: String,
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
    pub agent_id: Option<String>,
    pub project_id: Option<String>,
    pub resource_id: Option<String>,
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

pub(super) struct WorkflowTarget {
    pub agent_id: String,
    pub project_id: Option<String>,
}

pub(super) fn load_workflow(state: &AppState, id: &str) -> Result<WorkflowRow, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT w.id, w.name, w.agent_id, COALESCE(w.project_id, a.project_id),
                p.name, p.project_path, w.agent_id, a.name, w.prompt, w.enabled,
                w.schedule_kind, w.time_of_day, w.day_of_week, w.next_run_at,
                w.last_run_at, w.created_at, w.updated_at, w.mode, w.interval_minutes,
                w.max_runs, w.expires_at, w.stop_condition, w.watch_status, w.run_count
         FROM workflows w
         JOIN agents a ON a.id = w.agent_id
         LEFT JOIN projects p ON p.id = COALESCE(w.project_id, a.project_id)
         WHERE w.id = ?1",
        [id],
        row_to_workflow,
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })
}

pub(super) fn row_to_workflow(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkflowRow> {
    let enabled: i64 = row.get(9)?;
    Ok(WorkflowRow {
        id: row.get(0)?,
        name: row.get(1)?,
        agent_id: row.get(2)?,
        project_id: row.get(3)?,
        project_name: row.get(4)?,
        project_path: row.get(5)?,
        resource_id: row.get(6)?,
        resource_name: row.get(7)?,
        prompt: row.get(8)?,
        enabled: enabled != 0,
        schedule_kind: row.get(10)?,
        time_of_day: row.get(11)?,
        day_of_week: row.get(12)?,
        next_run_at: row.get(13)?,
        last_run_at: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        mode: row.get(17)?,
        interval_minutes: row.get(18)?,
        max_runs: row.get(19)?,
        expires_at: row.get(20)?,
        stop_condition: row.get(21)?,
        watch_status: row.get(22)?,
        run_count: row.get(23)?,
    })
}

pub(super) fn resolve_workflow_target(
    db: &rusqlite::Connection,
    body: &WorkflowWriteBody,
) -> Result<WorkflowTarget, StatusCode> {
    let agent_id = body
        .resource_id
        .as_deref()
        .or(body.agent_id.as_deref())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let agent_project_id: Option<String> = db
        .query_row(
            "SELECT project_id FROM agents WHERE id = ?1",
            [agent_id],
            |row| row.get(0),
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    if body.project_id.is_some()
        && agent_project_id.is_some()
        && body.project_id.as_ref() != agent_project_id.as_ref()
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(WorkflowTarget {
        agent_id: agent_id.to_string(),
        project_id: body.project_id.clone().or(agent_project_id),
    })
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
