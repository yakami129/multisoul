use crate::{
    db::now_ms,
    serve::{
        push::send_watch_completion_push,
        routes::activity_events::{
            emit_activity_changed, REASON_CONVERSATION_CREATED, REASON_USER_MESSAGE,
            REASON_WORKFLOW_CHANGED,
        },
        runtime,
        state::AppState,
    },
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

/// Post-run check for watch workflows: parse stop condition, evaluate stop rules,
/// schedule next run or stop the watch.
pub fn post_run_watch_check(
    db: &rusqlite::Connection,
    conversation_id: &str,
    ended_at: i64,
) -> Result<(), String> {
    // Find the workflow run for this conversation that just completed
    let run_result: Option<(String, String, Option<String>, i64)> = db
        .query_row(
            "SELECT wr.id, wr.workflow_id, wr.summary, COALESCE(wr.run_number, 1)
             FROM workflow_runs wr
             WHERE wr.conversation_id = ?1
               AND wr.status IN ('completed', 'failed')
             ORDER BY wr.created_at DESC
             LIMIT 1",
            [conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .ok();

    let (run_id, workflow_id, summary, _run_number) = match run_result {
        Some(r) => r,
        None => return Ok(()), // not a workflow run or already processed
    };

    // Check workflow mode
    let workflow_result: Option<(String, Option<i64>, Option<i64>, Option<i64>, Option<String>, i64, Option<String>)> = db
        .query_row(
            "SELECT mode, interval_minutes, max_runs, expires_at, stop_condition, run_count, watch_status
             FROM workflows
             WHERE id = ?1 AND enabled = 1",
            [&workflow_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .ok();

    let (mode, interval_minutes, max_runs, expires_at, stop_condition, run_count, watch_status) =
        match workflow_result {
            Some(r) => r,
            None => return Ok(()), // workflow disabled or not found
        };

    if mode != "watch" {
        return Ok(());
    }

    // If already stopped by user, don't restart
    if watch_status.as_deref() == Some("stopped") {
        return Ok(());
    }

    // Parse stop condition from summary
    let summary_text = summary.as_deref().unwrap_or("");
    let stop_condition_satisfied =
        summary_text.contains("WATCH_STOP_CONDITION: satisfied");
    let stop_condition_reason = if stop_condition_satisfied {
        stop_condition.as_deref().map(|s| s.to_string())
    } else {
        None
    };

    // Update stop_condition fields on the run
    let _ = db.execute(
        "UPDATE workflow_runs
         SET stop_condition_satisfied = ?1,
             stop_condition_reason = ?2
         WHERE id = ?3",
        rusqlite::params![
            stop_condition_satisfied as i64,
            stop_condition_reason,
            run_id
        ],
    );

    // Evaluate stop conditions
    let stop_reason = evaluate_watch_stop_conditions(
        db,
        &workflow_id,
        ended_at,
        stop_condition_satisfied,
        max_runs,
        expires_at,
        run_count,
    )?;

    if let Some(new_status) = stop_reason {
        // Stop the watch
        db.execute(
            "UPDATE workflows
             SET enabled = 0, watch_status = ?1, next_run_at = NULL, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![new_status, ended_at, workflow_id],
        )
        .map_err(|e| e.to_string())?;

        // Send push notification
        send_watch_end_push(db, &workflow_id, new_status, run_count);
    } else {
        // Schedule next run
        let interval = interval_minutes.unwrap_or(10);
        let next_run_at = ended_at + interval * 60_000;
        db.execute(
            "UPDATE workflows
             SET next_run_at = ?1, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![next_run_at, ended_at, workflow_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn evaluate_watch_stop_conditions(
    _db: &rusqlite::Connection,
    _workflow_id: &str,
    now: i64,
    stop_condition_satisfied: bool,
    max_runs: Option<i64>,
    expires_at: Option<i64>,
    run_count: i64,
) -> Result<Option<&'static str>, String> {
    // Priority order per SPEC §4.3:
    // 1. user manual stop (watch_status='stopped') — already handled by caller
    // 2. stop_condition satisfied
    // 3. expires_at reached
    // 4. max_runs reached

    if stop_condition_satisfied {
        return Ok(Some("completed"));
    }
    if let Some(exp) = expires_at {
        if now >= exp {
            return Ok(Some("expired"));
        }
    }
    if let Some(max) = max_runs {
        if run_count >= max {
            return Ok(Some("completed"));
        }
    }
    Ok(None)
}

fn send_watch_end_push(
    db: &rusqlite::Connection,
    workflow_id: &str,
    stop_status: &str,
    run_count: i64,
) {
    let workflow_name: Option<String> = db
        .query_row(
            "SELECT name FROM workflows WHERE id = ?1",
            [workflow_id],
            |r| r.get(0),
        )
        .ok();
    let name = workflow_name.as_deref().unwrap_or("Watch");
    send_watch_completion_push(db, name, workflow_id, stop_status, run_count);
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
        if workflow.workflow_mode == "watch" {
            process_due_watch(state, &workflow, now, dispatch_runtime)?;
        } else {
            process_due_recurring(state, &workflow, now, dispatch_runtime)?;
        }
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
    // Watch mode fields
    workflow_mode: String,
    interval_minutes: Option<i64>,
    max_runs: Option<i64>,
    expires_at: Option<i64>,
    stop_condition: Option<String>,
    run_count: i64,
}

fn load_due_workflows(state: &AppState, now: i64) -> Result<Vec<DueWorkflow>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT w.id, w.name, w.agent_id, w.prompt, w.schedule_kind, w.time_of_day,
                    w.day_of_week, w.next_run_at, a.project_path, a.runtime, a.mode,
                    w.mode as workflow_mode,
                    w.interval_minutes, w.max_runs, w.expires_at, w.stop_condition, w.run_count
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
                workflow_mode: row.get(11)?,
                interval_minutes: row.get(12)?,
                max_runs: row.get(13)?,
                expires_at: row.get(14)?,
                stop_condition: row.get(15)?,
                run_count: row.get(16)?,
            })
        })
        .map_err(|err| err.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|err| err.to_string())?;
    Ok(rows)
}

fn process_due_recurring(
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

    if let Some((conversation_id, seq)) = maybe_dispatch {
        emit_activity_changed(state, &conversation_id, REASON_WORKFLOW_CHANGED);
        emit_activity_changed(state, &conversation_id, REASON_CONVERSATION_CREATED);
        emit_activity_changed(state, &conversation_id, REASON_USER_MESSAGE);
        if dispatch_runtime {
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

fn process_due_watch(
    state: &AppState,
    workflow: &DueWorkflow,
    now: i64,
    dispatch_runtime: bool,
) -> Result<(), String> {
    let run_number = workflow.run_count + 1;

    let maybe_dispatch = {
        let db = state
            .db
            .lock()
            .map_err(|_| "db lock poisoned".to_string())?;

        // Overlap check
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
            // Skip: record overlap and schedule next interval
            let interval = workflow.interval_minutes.unwrap_or(10);
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
                rusqlite::params![now + interval * 60_000, now, workflow.id],
            )
            .map_err(|err| err.to_string())?;
            return Ok(());
        }

        // Check expires_at before starting
        if let Some(exp) = workflow.expires_at {
            if now >= exp {
                db.execute(
                    "UPDATE workflows
                     SET enabled = 0, watch_status = 'expired', next_run_at = NULL, updated_at = ?1
                     WHERE id = ?2",
                    rusqlite::params![now, workflow.id],
                )
                .map_err(|err| err.to_string())?;
                send_watch_end_push(&db, &workflow.id, "expired", workflow.run_count);
                return Ok(());
            }
        }

        // Check max_runs before starting
        if let Some(max) = workflow.max_runs {
            if workflow.run_count >= max {
                db.execute(
                    "UPDATE workflows
                     SET enabled = 0, watch_status = 'completed', next_run_at = NULL, updated_at = ?1
                     WHERE id = ?2",
                    rusqlite::params![now, workflow.id],
                )
                .map_err(|err| err.to_string())?;
                send_watch_end_push(&db, &workflow.id, "completed", workflow.run_count);
                return Ok(());
            }
        }

        // Create conversation and run
        let run_id = Uuid::new_v4().to_string();
        let conversation_id = Uuid::new_v4().to_string();
        let title = format!("Watch: {} #{}", workflow.name, run_number);
        db.execute(
            "INSERT INTO conversations
             (id, agent_id, title, created_at, last_message_at, status)
             VALUES (?1, ?2, ?3, ?4, ?4, 'idle')",
            rusqlite::params![conversation_id, workflow.agent_id, title, now],
        )
        .map_err(|err| err.to_string())?;

        let assembled_prompt = assemble_watch_prompt(
            &workflow.prompt,
            run_number,
            workflow.max_runs,
            workflow.expires_at,
            workflow.stop_condition.as_deref(),
        );
        let (seq, _message_id, _created_at, _payload) =
            insert_workflow_prompt_message(&db, &conversation_id, &assembled_prompt, now)?;

        db.execute(
            "INSERT INTO workflow_runs
             (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
              summary, error_message, created_at, run_number)
             VALUES (?1, ?2, ?3, 'running', ?4, ?5, NULL, NULL, NULL, ?5, ?6)",
            rusqlite::params![
                run_id,
                workflow.id,
                conversation_id,
                workflow.scheduled_for,
                now,
                run_number
            ],
        )
        .map_err(|err| err.to_string())?;

        // Update workflow: increment run_count, clear next_run_at (set after run completes)
        db.execute(
            "UPDATE workflows
             SET run_count = ?1, next_run_at = NULL, last_run_at = ?2, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![run_number, now, workflow.id],
        )
        .map_err(|err| err.to_string())?;

        Some((conversation_id, assembled_prompt, seq))
    };

    if let Some((conversation_id, prompt_text, seq)) = maybe_dispatch {
        emit_activity_changed(state, &conversation_id, REASON_WORKFLOW_CHANGED);
        emit_activity_changed(state, &conversation_id, REASON_CONVERSATION_CREATED);
        emit_activity_changed(state, &conversation_id, REASON_USER_MESSAGE);
        if dispatch_runtime {
            runtime::send_to_session(
                state,
                &conversation_id,
                runtime::DispatchMessage {
                    text: &prompt_text,
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

fn assemble_watch_prompt(
    user_prompt: &str,
    run_number: i64,
    max_runs: Option<i64>,
    expires_at: Option<i64>,
    stop_condition: Option<&str>,
) -> String {
    let max_runs_str = max_runs
        .map(|n| n.to_string())
        .unwrap_or_else(|| "\u{221e}".to_string());
    let expires_str = expires_at
        .map(|ts| {
            Local
                .timestamp_millis_opt(ts)
                .single()
                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| "unknown".to_string())
        })
        .unwrap_or_else(|| "no expiry".to_string());
    let stop_cond_str = stop_condition.unwrap_or("none");

    format!(
        "{user_prompt}

--- Watch Context ---
Run: {run_number} of {max_runs_str}
Watch expires at: {expires_str} (local time)
Stop condition: {stop_cond_str}

After completing your checks, include in your response ONE of these lines:
WATCH_STOP_CONDITION: satisfied
WATCH_STOP_CONDITION: not_satisfied

Behavior boundary:
Before commit, push, merge, release, rollback, delete, migration, tag creation,
dependency upgrade, production-impacting command, or remote state change,
ask the user first through AskUserQuestion / msctl ask-question."
    )
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
