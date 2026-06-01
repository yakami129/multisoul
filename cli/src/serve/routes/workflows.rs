use crate::{
    db::now_ms,
    serve::{
        state::AppState,
        workflows::{
            next_run_after_ms, validate_workflow_input, WorkflowScheduleKind, WorkflowScheduleSpec,
        },
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
}

#[derive(Debug, Deserialize)]
pub struct WorkflowWriteBody {
    pub name: String,
    pub agent_id: String,
    pub prompt: String,
    pub schedule_kind: String,
    pub time_of_day: String,
    pub day_of_week: Option<i64>,
}

pub async fn list_workflows(
    State(state): State<AppState>,
) -> Result<Json<Vec<WorkflowRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db
        .prepare(
            "SELECT id, name, agent_id, prompt, enabled, schedule_kind, time_of_day,
                    day_of_week, next_run_at, last_run_at, created_at, updated_at
             FROM workflows
             ORDER BY updated_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([], row_to_workflow)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn create_workflow(
    State(state): State<AppState>,
    Json(body): Json<WorkflowWriteBody>,
) -> Result<(StatusCode, Json<WorkflowRow>), StatusCode> {
    let spec = schedule_spec_from_body(&body)?;
    validate_workflow_input(&body.name, &body.prompt, &spec)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let now = now_ms();
    let next_run_at = next_run_after_ms(&spec, now).map_err(|_| StatusCode::BAD_REQUEST)?;
    let id = Uuid::new_v4().to_string();

    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        ensure_agent_exists(&db, &body.agent_id)?;
        db.execute(
            "INSERT INTO workflows
             (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
              next_run_at, last_run_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?7, ?8, NULL, ?9, ?9)",
            rusqlite::params![
                id,
                body.name.trim(),
                body.agent_id,
                body.prompt.trim(),
                body.schedule_kind,
                body.time_of_day,
                body.day_of_week,
                next_run_at,
                now
            ],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    load_workflow(&state, &id).map(|row| (StatusCode::CREATED, Json(row)))
}

pub async fn update_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WorkflowWriteBody>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let spec = schedule_spec_from_body(&body)?;
    validate_workflow_input(&body.name, &body.prompt, &spec)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let existing = load_workflow(&state, &id)?;
    let now = now_ms();
    let next_run_at = if existing.enabled {
        next_run_after_ms(&spec, now)
            .map(Some)
            .map_err(|_| StatusCode::BAD_REQUEST)?
    } else {
        None
    };

    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        ensure_agent_exists(&db, &body.agent_id)?;
        let changed = db
            .execute(
                "UPDATE workflows
                 SET name = ?1,
                     agent_id = ?2,
                     prompt = ?3,
                     schedule_kind = ?4,
                     time_of_day = ?5,
                     day_of_week = ?6,
                     next_run_at = ?7,
                     updated_at = ?8
                 WHERE id = ?9",
                rusqlite::params![
                    body.name.trim(),
                    body.agent_id,
                    body.prompt.trim(),
                    body.schedule_kind,
                    body.time_of_day,
                    body.day_of_week,
                    next_run_at,
                    now,
                    id
                ],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if changed == 0 {
            return Err(StatusCode::NOT_FOUND);
        }
    }

    load_workflow(&state, &id).map(Json)
}

pub async fn disable_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let now = now_ms();
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let changed = db
            .execute(
                "UPDATE workflows
                 SET enabled = 0, next_run_at = NULL, updated_at = ?1
                 WHERE id = ?2",
                rusqlite::params![now, id],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if changed == 0 {
            return Err(StatusCode::NOT_FOUND);
        }
    }
    load_workflow(&state, &id).map(Json)
}

pub async fn enable_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let existing = load_workflow(&state, &id)?;
    let spec = WorkflowScheduleSpec {
        kind: parse_schedule_kind(&existing.schedule_kind)?,
        time_of_day: existing.time_of_day.clone(),
        day_of_week: existing.day_of_week.map(|day| day as u32),
    };
    let now = now_ms();
    let next_run_at = next_run_after_ms(&spec, now).map_err(|_| StatusCode::BAD_REQUEST)?;
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.execute(
            "UPDATE workflows
             SET enabled = 1, next_run_at = ?1, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![next_run_at, now, id],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    load_workflow(&state, &id).map(Json)
}

pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<WorkflowRunRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db
        .prepare(
            "SELECT id, workflow_id, conversation_id, status, scheduled_for, started_at,
                    ended_at, summary, error_message, created_at
             FROM workflow_runs
             WHERE workflow_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([id], |row| {
            Ok(WorkflowRunRow {
                id: row.get(0)?,
                workflow_id: row.get(1)?,
                conversation_id: row.get(2)?,
                status: row.get(3)?,
                scheduled_for: row.get(4)?,
                started_at: row.get(5)?,
                ended_at: row.get(6)?,
                summary: row.get(7)?,
                error_message: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

fn load_workflow(state: &AppState, id: &str) -> Result<WorkflowRow, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT id, name, agent_id, prompt, enabled, schedule_kind, time_of_day,
                day_of_week, next_run_at, last_run_at, created_at, updated_at
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

fn row_to_workflow(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkflowRow> {
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
    })
}

fn ensure_agent_exists(db: &rusqlite::Connection, agent_id: &str) -> Result<(), StatusCode> {
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

fn schedule_spec_from_body(body: &WorkflowWriteBody) -> Result<WorkflowScheduleSpec, StatusCode> {
    Ok(WorkflowScheduleSpec {
        kind: parse_schedule_kind(&body.schedule_kind)?,
        time_of_day: body.time_of_day.clone(),
        day_of_week: body.day_of_week.map(|day| day as u32),
    })
}

fn parse_schedule_kind(value: &str) -> Result<WorkflowScheduleKind, StatusCode> {
    match value {
        "daily" => Ok(WorkflowScheduleKind::Daily),
        "weekly" => Ok(WorkflowScheduleKind::Weekly),
        _ => Err(StatusCode::BAD_REQUEST),
    }
}
