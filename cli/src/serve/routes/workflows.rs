use crate::{
    db::now_ms,
    serve::{
        state::AppState,
        workflows::{next_run_after_ms, validate_workflow_input, WorkflowScheduleSpec},
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

mod support;

pub use support::{WorkflowRow, WorkflowRunRow, WorkflowWriteBody};

use support::{
    ensure_agent_exists, load_workflow, parse_schedule_kind, row_to_workflow, validate_watch_body,
};

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
                    day_of_week, next_run_at, last_run_at, created_at, updated_at,
                    mode, interval_minutes, max_runs, expires_at, stop_condition,
                    watch_status, run_count
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
    let now = now_ms();
    let mode = body.mode.as_deref().unwrap_or("recurring");
    let id = Uuid::new_v4().to_string();

    if mode == "watch" {
        validate_watch_body(&body, now)?;
        let interval = body.interval_minutes.unwrap_or(10);
        let (sk, tod) = ("none".to_string(), "00:00".to_string());
        {
            let db = state
                .db
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            ensure_agent_exists(&db, &body.agent_id)?;
            db.execute(
                "INSERT INTO workflows
                 (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
                  next_run_at, last_run_at, created_at, updated_at,
                  mode, interval_minutes, max_runs, expires_at, stop_condition,
                  watch_status, run_count)
                 VALUES (?1,?2,?3,?4,1,?5,?6,NULL,?7,NULL,?8,?8,'watch',?9,?10,?11,?12,'active',0)",
                rusqlite::params![
                    id,
                    body.name.trim(),
                    body.agent_id,
                    body.prompt.trim(),
                    sk,
                    tod,
                    now, // next_run_at = now => immediate first run
                    now,
                    interval,
                    body.max_runs,
                    body.expires_at,
                    body.stop_condition
                ],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    } else {
        let sk = body.schedule_kind.as_deref().unwrap_or("daily");
        let tod = body.time_of_day.as_deref().unwrap_or("09:00");
        let spec = WorkflowScheduleSpec {
            kind: parse_schedule_kind(sk)?,
            time_of_day: tod.to_string(),
            day_of_week: body.day_of_week.map(|d| d as u32),
        };
        validate_workflow_input(&body.name, &body.prompt, &spec)
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let next_run_at = next_run_after_ms(&spec, now).map_err(|_| StatusCode::BAD_REQUEST)?;
        {
            let db = state
                .db
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            ensure_agent_exists(&db, &body.agent_id)?;
            db.execute(
                "INSERT INTO workflows
                 (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
                  next_run_at, last_run_at, created_at, updated_at,
                  mode, interval_minutes, max_runs, expires_at, stop_condition,
                  watch_status, run_count)
                 VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,NULL,?9,?9,'recurring',NULL,NULL,NULL,NULL,NULL,0)",
                rusqlite::params![
                    id,
                    body.name.trim(),
                    body.agent_id,
                    body.prompt.trim(),
                    sk,
                    tod,
                    body.day_of_week,
                    next_run_at,
                    now
                ],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
    }

    load_workflow(&state, &id).map(|row| (StatusCode::CREATED, Json(row)))
}

pub async fn update_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<WorkflowWriteBody>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let mode = body.mode.as_deref().unwrap_or("recurring");
    let existing = load_workflow(&state, &id)?;
    let now = now_ms();

    if mode == "watch" {
        validate_watch_body(&body, now)?;
        let interval = body.interval_minutes.unwrap_or(10);
        let next_run_at = if existing.enabled { Some(now) } else { None };
        {
            let db = state
                .db
                .lock()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            ensure_agent_exists(&db, &body.agent_id)?;
            let changed = db
                .execute(
                    "UPDATE workflows
                     SET name=?1, agent_id=?2, prompt=?3, schedule_kind='none',
                         time_of_day='00:00', day_of_week=NULL,
                         mode='watch', interval_minutes=?4, max_runs=?5,
                         expires_at=?6, stop_condition=?7,
                         next_run_at=?8, updated_at=?9
                     WHERE id=?10",
                    rusqlite::params![
                        body.name.trim(),
                        body.agent_id,
                        body.prompt.trim(),
                        interval,
                        body.max_runs,
                        body.expires_at,
                        body.stop_condition,
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
    } else {
        let sk = body.schedule_kind.as_deref().unwrap_or("daily");
        let tod = body.time_of_day.as_deref().unwrap_or("09:00");
        let spec = WorkflowScheduleSpec {
            kind: parse_schedule_kind(sk)?,
            time_of_day: tod.to_string(),
            day_of_week: body.day_of_week.map(|d| d as u32),
        };
        validate_workflow_input(&body.name, &body.prompt, &spec)
            .map_err(|_| StatusCode::BAD_REQUEST)?;
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
                     SET name=?1, agent_id=?2, prompt=?3, schedule_kind=?4,
                         time_of_day=?5, day_of_week=?6, next_run_at=?7, updated_at=?8
                     WHERE id=?9",
                    rusqlite::params![
                        body.name.trim(),
                        body.agent_id,
                        body.prompt.trim(),
                        sk,
                        tod,
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
    let now = now_ms();
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let row = db
            .query_row(
                "SELECT schedule_kind, time_of_day, day_of_week, mode FROM workflows WHERE id = ?1",
                [&id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            })?;
        let next_run_at = if row.3 == "watch" {
            // For watch workflows, enabling sets next_run_at = now (immediate)
            now
        } else {
            let spec = WorkflowScheduleSpec {
                kind: parse_schedule_kind(&row.0)?,
                time_of_day: row.1,
                day_of_week: row.2.map(|d| d as u32),
            };
            next_run_after_ms(&spec, now).map_err(|_| StatusCode::BAD_REQUEST)?
        };
        let changed = db
            .execute(
                "UPDATE workflows
                 SET enabled = 1, next_run_at = ?1, updated_at = ?2
                 WHERE id = ?3 AND enabled = 0",
                rusqlite::params![next_run_at, now, id],
            )
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if changed == 0 {
            db.query_row("SELECT 1 FROM workflows WHERE id = ?1", [&id], |_| Ok(()))
                .map_err(|_| StatusCode::NOT_FOUND)?;
        }
    }
    load_workflow(&state, &id).map(Json)
}

pub async fn stop_watch(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let now = now_ms();
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let mode: Option<String> = db
            .query_row("SELECT mode FROM workflows WHERE id = ?1", [&id], |row| {
                row.get(0)
            })
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            })?;
        if mode.as_deref() != Some("watch") {
            return Err(StatusCode::BAD_REQUEST);
        }
        let changed = db
            .execute(
                "UPDATE workflows
                 SET enabled = 0, watch_status = 'stopped', next_run_at = NULL, updated_at = ?1
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

pub async fn restart_watch(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WorkflowRow>, StatusCode> {
    let now = now_ms();
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let (mode, watch_status): (Option<String>, Option<String>) = db
            .query_row(
                "SELECT mode, watch_status FROM workflows WHERE id = ?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            })?;
        if mode.as_deref() != Some("watch") {
            return Err(StatusCode::BAD_REQUEST);
        }
        let is_ended = matches!(
            watch_status.as_deref(),
            Some("completed") | Some("stopped") | Some("expired") | Some("failed")
        );
        if !is_ended {
            return Err(StatusCode::BAD_REQUEST);
        }
        db.execute(
            "UPDATE workflows
             SET enabled = 1, watch_status = 'active', run_count = 0,
                 next_run_at = ?1, updated_at = ?1
             WHERE id = ?2",
            rusqlite::params![now, id],
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
    let exists = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM workflows WHERE id = ?1)",
            [&id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        != 0;
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }
    let mut stmt = db
        .prepare(
            "SELECT id, workflow_id, conversation_id, status, scheduled_for, started_at,
                    ended_at, summary, error_message, created_at,
                    run_number, stop_condition_satisfied, stop_condition_reason
             FROM workflow_runs
             WHERE workflow_id = ?1
             ORDER BY created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([id], |row| {
            let satisfied_raw: Option<i64> = row.get(11)?;
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
                run_number: row.get(10)?,
                stop_condition_satisfied: satisfied_raw.map(|v| v != 0),
                stop_condition_reason: row.get(12)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn delete_workflow(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let changed = db
        .execute("DELETE FROM workflows WHERE id = ?1", [&id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if changed == 0 {
        Err(StatusCode::NOT_FOUND)
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}
