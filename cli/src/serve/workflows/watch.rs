use super::{insert_workflow_prompt_message, DueWorkflow};
use crate::serve::{
    push::send_watch_completion_push,
    routes::activity_events::{
        emit_activity_changed, REASON_CONVERSATION_CREATED, REASON_USER_MESSAGE,
        REASON_WORKFLOW_CHANGED,
    },
    runtime,
    state::AppState,
};
use chrono::{Local, TimeZone};
use uuid::Uuid;

type WatchWorkflowRow = (
    String,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    Option<String>,
    i64,
    Option<String>,
);

/// Post-run check for watch workflows: parse stop condition, evaluate stop rules,
/// schedule next run or stop the watch.
pub fn post_run_watch_check(
    db: &rusqlite::Connection,
    conversation_id: &str,
    ended_at: i64,
) -> Result<(), String> {
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
        None => return Ok(()),
    };

    let workflow_result: Option<WatchWorkflowRow> = db
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
            None => return Ok(()),
        };

    if mode != "watch" || watch_status.as_deref() == Some("stopped") {
        return Ok(());
    }

    let summary_text = summary.as_deref().unwrap_or("");
    let stop_condition_satisfied = summary_text.contains("WATCH_STOP_CONDITION: satisfied");
    let stop_condition_reason = if stop_condition_satisfied {
        stop_condition.as_deref().map(|s| s.to_string())
    } else {
        None
    };

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

    let stop_reason = evaluate_watch_stop_conditions(
        ended_at,
        stop_condition_satisfied,
        max_runs,
        expires_at,
        run_count,
    );

    if let Some(new_status) = stop_reason {
        db.execute(
            "UPDATE workflows
             SET enabled = 0, watch_status = ?1, next_run_at = NULL, updated_at = ?2
             WHERE id = ?3",
            rusqlite::params![new_status, ended_at, workflow_id],
        )
        .map_err(|e| e.to_string())?;
        send_watch_end_push(db, &workflow_id, new_status, run_count);
    } else {
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

pub(super) fn process_due_watch(
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

fn evaluate_watch_stop_conditions(
    now: i64,
    stop_condition_satisfied: bool,
    max_runs: Option<i64>,
    expires_at: Option<i64>,
    run_count: i64,
) -> Option<&'static str> {
    if stop_condition_satisfied {
        return Some("completed");
    }
    if let Some(exp) = expires_at {
        if now >= exp {
            return Some("expired");
        }
    }
    if let Some(max) = max_runs {
        if run_count >= max {
            return Some("completed");
        }
    }
    None
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
