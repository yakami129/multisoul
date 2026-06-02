use crate::{
    db::now_ms,
    serve::{runtime, state::AppState},
};
use chrono::{Datelike, Duration, Local, NaiveTime, TimeZone, Timelike};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkflowScheduleKind {
    Daily,
    Weekly,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkflowScheduleSpec {
    pub kind: WorkflowScheduleKind,
    pub time_of_day: String,
    pub day_of_week: Option<u32>,
}

pub fn validate_workflow_input(
    name: &str,
    prompt: &str,
    spec: &WorkflowScheduleSpec,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("workflow name is required".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("workflow prompt is required".to_string());
    }
    parse_time_of_day(&spec.time_of_day)?;
    match spec.kind {
        WorkflowScheduleKind::Daily => {
            if spec.day_of_week.is_some() {
                return Err("daily schedule must not include day_of_week".to_string());
            }
        }
        WorkflowScheduleKind::Weekly => match spec.day_of_week {
            Some(1..=7) => {}
            _ => return Err("weekly schedule requires day_of_week 1..=7".to_string()),
        },
    }
    Ok(())
}

pub fn next_run_after_ms(spec: &WorkflowScheduleSpec, now_ms: i64) -> Result<i64, String> {
    let time = parse_time_of_day(&spec.time_of_day)?;
    let now = Local
        .timestamp_millis_opt(now_ms)
        .single()
        .ok_or_else(|| "now_ms cannot be represented in local timezone".to_string())?;

    match spec.kind {
        WorkflowScheduleKind::Daily => {
            let mut candidate = local_datetime_ms(
                now.year(),
                now.month(),
                now.day(),
                time.hour(),
                time.minute(),
            )?;
            if candidate <= now_ms {
                let tomorrow = now.date_naive() + Duration::days(1);
                candidate = local_datetime_ms(
                    tomorrow.year(),
                    tomorrow.month(),
                    tomorrow.day(),
                    time.hour(),
                    time.minute(),
                )?;
            }
            Ok(candidate)
        }
        WorkflowScheduleKind::Weekly => {
            let target = spec
                .day_of_week
                .filter(|day| (1..=7).contains(day))
                .ok_or_else(|| "weekly schedule requires day_of_week 1..=7".to_string())?;
            let today = now.weekday().number_from_monday();
            let mut days_until = (target + 7 - today) % 7;
            let mut target_date = now.date_naive() + Duration::days(days_until as i64);
            let mut candidate = local_datetime_ms(
                target_date.year(),
                target_date.month(),
                target_date.day(),
                time.hour(),
                time.minute(),
            )?;
            if candidate <= now_ms {
                days_until += 7;
                target_date = now.date_naive() + Duration::days(days_until as i64);
                candidate = local_datetime_ms(
                    target_date.year(),
                    target_date.month(),
                    target_date.day(),
                    time.hour(),
                    time.minute(),
                )?;
            }
            Ok(candidate)
        }
    }
}

pub fn run_due_workflows_once(state: &AppState) -> Result<usize, String> {
    run_due_workflows_once_inner(state, now_ms(), true)
}

pub fn finalize_workflow_run_for_conversation(
    db: &rusqlite::Connection,
    conversation_id: &str,
    status: &str,
    summary: Option<&str>,
    error_message: Option<&str>,
    ended_at: i64,
) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE workflow_runs
         SET status = ?1,
             ended_at = ?2,
             summary = ?3,
             error_message = ?4
         WHERE conversation_id = ?5
           AND status = 'running'",
        rusqlite::params![status, ended_at, summary, error_message, conversation_id],
    )
}

#[cfg(test)]
pub(crate) fn run_due_workflows_once_without_dispatch(
    state: &AppState,
    now: i64,
) -> Result<usize, String> {
    run_due_workflows_once_inner(state, now, false)
}

fn run_due_workflows_once_inner(
    state: &AppState,
    now: i64,
    dispatch_runtime: bool,
) -> Result<usize, String> {
    let due = load_due_workflows(state, now)?;
    let count = due.len();
    for workflow in due {
        process_due_workflow(state, &workflow, now, dispatch_runtime)?;
    }
    Ok(count)
}

#[derive(Debug)]
struct DueWorkflow {
    id: String,
    name: String,
    agent_id: String,
    prompt: String,
    schedule_kind: String,
    time_of_day: String,
    day_of_week: Option<i64>,
    scheduled_for: i64,
    project_path: String,
    runtime: String,
    mode: String,
}

fn load_due_workflows(state: &AppState, now: i64) -> Result<Vec<DueWorkflow>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT w.id, w.name, w.agent_id, w.prompt, w.schedule_kind, w.time_of_day,
                    w.day_of_week, w.next_run_at, a.project_path, a.runtime, a.mode
             FROM workflows w
             JOIN agents a ON a.id = w.agent_id
             WHERE w.enabled = 1 AND w.next_run_at IS NOT NULL AND w.next_run_at <= ?1
             ORDER BY w.next_run_at ASC",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([now], |row| {
            Ok(DueWorkflow {
                id: row.get(0)?,
                name: row.get(1)?,
                agent_id: row.get(2)?,
                prompt: row.get(3)?,
                schedule_kind: row.get(4)?,
                time_of_day: row.get(5)?,
                day_of_week: row.get(6)?,
                scheduled_for: row.get(7)?,
                project_path: row.get(8)?,
                runtime: row.get(9)?,
                mode: row.get(10)?,
            })
        })
        .map_err(|err| err.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

fn process_due_workflow(
    state: &AppState,
    workflow: &DueWorkflow,
    now: i64,
    dispatch_runtime: bool,
) -> Result<(), String> {
    let spec = WorkflowScheduleSpec {
        kind: schedule_kind_from_str(&workflow.schedule_kind)?,
        time_of_day: workflow.time_of_day.clone(),
        day_of_week: workflow.day_of_week.map(|day| day as u32),
    };
    let following_next_run = next_run_after_ms(&spec, now)?;

    let maybe_dispatch = {
        let db = state
            .db
            .lock()
            .map_err(|_| "db lock poisoned".to_string())?;
        let has_running: bool = db
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM workflow_runs
                    WHERE workflow_id = ?1 AND status = 'running'
                 )",
                [&workflow.id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|err| err.to_string())?
            != 0;

        if has_running {
            db.execute(
                "INSERT INTO workflow_runs
                 (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
                  summary, error_message, created_at)
                 VALUES (?1, ?2, NULL, 'skipped_overlap', ?3, NULL, ?4, NULL, NULL, ?4)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    workflow.id,
                    workflow.scheduled_for,
                    now
                ],
            )
            .map_err(|err| err.to_string())?;
            db.execute(
                "UPDATE workflows
                 SET next_run_at = ?1, updated_at = ?2
                 WHERE id = ?3",
                rusqlite::params![following_next_run, now, workflow.id],
            )
            .map_err(|err| err.to_string())?;
            None
        } else {
            let run_id = Uuid::new_v4().to_string();
            let conversation_id = Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO conversations
                 (id, agent_id, title, created_at, last_message_at, status)
                 VALUES (?1, ?2, ?3, ?4, ?4, 'idle')",
                rusqlite::params![
                    conversation_id,
                    workflow.agent_id,
                    format!("Workflow: {}", workflow.name),
                    now
                ],
            )
            .map_err(|err| err.to_string())?;
            let (seq, _message_id, _created_at, _payload) =
                insert_workflow_prompt_message(&db, &conversation_id, &workflow.prompt, now)?;
            db.execute(
                "INSERT INTO workflow_runs
                 (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
                  summary, error_message, created_at)
                 VALUES (?1, ?2, ?3, 'running', ?4, ?5, NULL, NULL, NULL, ?5)",
                rusqlite::params![
                    run_id,
                    workflow.id,
                    conversation_id,
                    workflow.scheduled_for,
                    now
                ],
            )
            .map_err(|err| err.to_string())?;
            db.execute(
                "UPDATE workflows
                 SET next_run_at = ?1, last_run_at = ?2, updated_at = ?2
                 WHERE id = ?3",
                rusqlite::params![following_next_run, now, workflow.id],
            )
            .map_err(|err| err.to_string())?;
            Some((conversation_id, seq))
        }
    };

    if dispatch_runtime {
        if let Some((conversation_id, seq)) = maybe_dispatch {
            runtime::send_to_session(
                state,
                &conversation_id,
                runtime::DispatchMessage {
                    text: &workflow.prompt,
                    file_id: None,
                    model_id: None,
                    seq,
                },
                &workflow.project_path,
                &workflow.runtime,
                &workflow.mode,
            );
        }
    }
    Ok(())
}

fn insert_workflow_prompt_message(
    db: &rusqlite::Connection,
    conversation_id: &str,
    prompt: &str,
    now: i64,
) -> Result<(i64, String, i64, serde_json::Value), String> {
    let seq = 1;
    let id = Uuid::new_v4().to_string();
    let payload = serde_json::json!({ "text": prompt });
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1, ?2, 'user_text', ?3, ?4, ?5)",
        rusqlite::params![id, conversation_id, payload.to_string(), now, seq],
    )
    .map_err(|err| err.to_string())?;
    db.execute(
        "UPDATE conversations
         SET last_message_at = ?1, status = 'running'
         WHERE id = ?2",
        rusqlite::params![now, conversation_id],
    )
    .map_err(|err| err.to_string())?;
    Ok((seq, id, now, payload))
}

fn schedule_kind_from_str(value: &str) -> Result<WorkflowScheduleKind, String> {
    match value {
        "daily" => Ok(WorkflowScheduleKind::Daily),
        "weekly" => Ok(WorkflowScheduleKind::Weekly),
        _ => Err("schedule_kind must be daily or weekly".to_string()),
    }
}

fn parse_time_of_day(value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| "time_of_day must be HH:mm".to_string())
}

fn local_datetime_ms(
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
) -> Result<i64, String> {
    Local
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .ok_or_else(|| "local schedule time is ambiguous or invalid".to_string())
}
