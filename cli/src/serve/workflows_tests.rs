use super::workflows::{
    finalize_workflow_run_for_conversation, next_run_after_ms,
    run_due_workflows_once_without_dispatch, validate_workflow_input, WorkflowScheduleKind,
    WorkflowScheduleSpec,
};
use crate::{commands::agent::insert_agent, db, serve::state::AppState};
use chrono::{Datelike, Local, TimeZone, Timelike};
use tempfile::tempdir;

fn local_ms(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> i64 {
    Local
        .with_ymd_and_hms(year, month, day, hour, minute, 0)
        .single()
        .expect("test local timestamp should be representable")
        .timestamp_millis()
}

/// Daily schedule: when today's selected time is still in the future, next_run_at is today.
///
/// Data construction:
///   now        = 2026-06-01 08:30 local time
///   schedule   = daily at 09:15
///   expected   = 2026-06-01 09:15 local time
///
/// Execution process:
///   1. Build a daily schedule spec with time_of_day "09:15".
///   2. Call next_run_after_ms(spec, now).
///   3. Compare the returned unix ms timestamp with the expected local timestamp.
///
/// Expected results:
///   - Positive: next run is today at 09:15 because the time has not passed.
///   - Negative: next run is not tomorrow; same-day due schedules must not be skipped.
#[test]
fn daily_schedule_uses_today_when_time_is_future() {
    let now = local_ms(2026, 6, 1, 8, 30);
    let spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Daily,
        time_of_day: "09:15".to_string(),
        day_of_week: None,
    };

    let next = next_run_after_ms(&spec, now).expect("daily future schedule should be valid");

    assert_eq!(
        next,
        local_ms(2026, 6, 1, 9, 15),
        "daily next_run_at should use today's selected time when it is still future"
    );
    assert_ne!(
        next,
        local_ms(2026, 6, 2, 9, 15),
        "daily next_run_at must not skip to tomorrow while today's time is still future"
    );
}

/// Daily schedule: when today's selected time has passed, next_run_at is tomorrow.
///
/// Data construction:
///   now        = 2026-06-01 10:00 local time
///   schedule   = daily at 09:15
///   expected   = 2026-06-02 09:15 local time
///
/// Execution process:
///   1. Build a daily schedule spec with time_of_day "09:15".
///   2. Call next_run_after_ms(spec, now).
///   3. Compare the returned unix ms timestamp with tomorrow's matching local timestamp.
///
/// Expected results:
///   - Positive: next run is tomorrow because today's slot already passed.
///   - Negative: next run is not today in the past.
#[test]
fn daily_schedule_moves_to_tomorrow_when_time_passed() {
    let now = local_ms(2026, 6, 1, 10, 0);
    let spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Daily,
        time_of_day: "09:15".to_string(),
        day_of_week: None,
    };

    let next = next_run_after_ms(&spec, now).expect("daily past schedule should be valid");

    assert_eq!(
        next,
        local_ms(2026, 6, 2, 9, 15),
        "daily next_run_at should move to tomorrow when today's time already passed"
    );
    assert_ne!(
        next,
        local_ms(2026, 6, 1, 9, 15),
        "daily next_run_at must not point to a past timestamp"
    );
}

/// Weekly schedule: next_run_at uses the next matching weekday and time.
///
/// Data construction:
///   now             = 2026-06-01 10:00 local time
///   local weekday   = Monday, represented as 1 by chrono number_from_monday()
///   schedule        = weekly Wednesday(3) at 09:15
///   expected        = 2026-06-03 09:15 local time
///
/// Execution process:
///   1. Assert test fixture weekday is Monday to protect date assumptions.
///   2. Build a weekly schedule spec with day_of_week 3 and time_of_day "09:15".
///   3. Call next_run_after_ms(spec, now).
///
/// Expected results:
///   - Positive: next run is Wednesday 2026-06-03 09:15.
///   - Negative: next run is not the previous or current Monday.
#[test]
fn weekly_schedule_uses_next_matching_weekday() {
    let now = local_ms(2026, 6, 1, 10, 0);
    let now_dt = Local.timestamp_millis_opt(now).single().unwrap();
    assert_eq!(
        now_dt.weekday().number_from_monday(),
        1,
        "fixture date must be Monday so the weekly schedule calculation is meaningful"
    );
    assert_eq!(
        now_dt.hour(),
        10,
        "fixture hour should remain 10:00 before calculating the Wednesday target"
    );

    let spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Weekly,
        time_of_day: "09:15".to_string(),
        day_of_week: Some(3),
    };

    let next = next_run_after_ms(&spec, now).expect("weekly schedule should be valid");

    assert_eq!(
        next,
        local_ms(2026, 6, 3, 9, 15),
        "weekly next_run_at should use the next selected weekday"
    );
    assert_ne!(
        next,
        local_ms(2026, 6, 1, 9, 15),
        "weekly next_run_at must not point to a past timestamp on the current weekday"
    );
}

/// Workflow validation rejects prompt and schedule values that cannot produce a safe run.
///
/// Data construction:
///   empty_prompt        = "   "
///   invalid_time        = "25:99"
///   invalid_weekday     = 8
///   valid_weekly_prompt = "Run report"
///
/// Execution process:
///   1. Validate an empty prompt daily workflow.
///   2. Validate an invalid HH:mm daily workflow.
///   3. Validate a weekly workflow with day_of_week outside 1..=7.
///
/// Expected results:
///   - Empty prompt is rejected so daemon never starts a meaningless agent run.
///   - Invalid time is rejected so next_run_at calculation is deterministic.
///   - Invalid weekday is rejected so weekly schedules stay in the documented 1..=7 range.
#[test]
fn workflow_validation_rejects_empty_prompt_invalid_time_and_weekday() {
    let empty_prompt_spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Daily,
        time_of_day: "09:15".to_string(),
        day_of_week: None,
    };
    assert!(
        validate_workflow_input("Morning", "   ", &empty_prompt_spec).is_err(),
        "empty prompt must be rejected before a workflow can be saved"
    );

    let invalid_time_spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Daily,
        time_of_day: "25:99".to_string(),
        day_of_week: None,
    };
    assert!(
        validate_workflow_input("Morning", "Run report", &invalid_time_spec).is_err(),
        "invalid HH:mm values must be rejected before next_run_at is calculated"
    );

    let invalid_weekly_spec = WorkflowScheduleSpec {
        kind: WorkflowScheduleKind::Weekly,
        time_of_day: "09:15".to_string(),
        day_of_week: Some(8),
    };
    assert!(
        validate_workflow_input("Weekly", "Run report", &invalid_weekly_spec).is_err(),
        "weekly day_of_week outside 1..=7 must be rejected"
    );
}

fn test_state_with_agent() -> (AppState, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "workflow-agent", "/p", "codex", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        "tok".to_string(),
        dir.path().join("uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    (state, agent_id)
}

/// Due workflow execution creates a workflow run and a brand-new conversation.
///
/// Data construction:
///   now             = 2026-06-01 10:00 local time
///   next_run_at     = now - 1 ms, so the workflow is due
///   schedule        = daily 09:15, used only for calculating the following next_run_at
///   prompt          = "Summarize repository state"
///
/// Execution process:
///   1. Insert one enabled due workflow bound to a registered agent.
///   2. Call run_due_workflows_once_without_dispatch(state, now) to avoid spawning a real CLI runtime.
///   3. Query workflow_runs, conversations, and messages.
///
/// Expected results:
///   - One running workflow_run exists for the workflow.
///   - The run has a non-null conversation_id.
///   - A new conversation exists and belongs to the workflow agent.
///   - The first message in that new conversation is the saved prompt as user_text seq=1.
#[test]
fn due_workflow_creates_new_conversation_and_prompt_message() {
    let (state, agent_id) = test_state_with_agent();
    let now = local_ms(2026, 6, 1, 10, 0);
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO workflows
             (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
              next_run_at, last_run_at, created_at, updated_at)
             VALUES ('wf-1', 'Morning report', ?1, 'Summarize repository state', 1,
                     'daily', '09:15', NULL, ?2, NULL, ?3, ?3)",
            rusqlite::params![agent_id, now - 1, now - 10],
        )
        .expect("seed due workflow should insert");
    }

    let triggered = run_due_workflows_once_without_dispatch(&state, now)
        .expect("due workflow scan should succeed");

    assert_eq!(triggered, 1, "one due enabled workflow should be processed");
    let db = state.db.lock().unwrap();
    let (run_status, run_conversation_id): (String, String) = db
        .query_row(
            "SELECT status, conversation_id FROM workflow_runs WHERE workflow_id='wf-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("workflow run should be created");
    assert_eq!(
        run_status, "running",
        "actual workflow run should start as running"
    );
    assert!(
        !run_conversation_id.is_empty(),
        "actual workflow run must link to the new conversation"
    );
    let conversation_agent: String = db
        .query_row(
            "SELECT agent_id FROM conversations WHERE id=?1",
            [&run_conversation_id],
            |row| row.get(0),
        )
        .expect("new workflow conversation should exist");
    assert_eq!(
        conversation_agent, agent_id,
        "new workflow conversation must use the workflow agent"
    );
    let (role, text, seq): (String, String, i64) = db
        .query_row(
            "SELECT role, json_extract(payload, '$.text'), seq
             FROM messages
             WHERE conversation_id=?1",
            [&run_conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("new workflow conversation should have the prompt message");
    assert_eq!(
        role, "user_text",
        "workflow prompt must be stored as the first user_text message"
    );
    assert_eq!(
        text, "Summarize repository state",
        "workflow prompt message must preserve the saved prompt"
    );
    assert_eq!(
        seq, 1,
        "workflow prompt should be seq=1 in the new conversation"
    );
}

/// Overlap handling skips a new trigger when the previous workflow run is still running.
///
/// Data construction:
///   workflow       = enabled and due at now - 1 ms
///   existing run   = status running, conversation_id conv-existing
///   expected run   = skipped_overlap with no conversation_id
///
/// Execution process:
///   1. Insert an enabled due workflow and one existing running workflow_run.
///   2. Call run_due_workflows_once_without_dispatch(state, now).
///   3. Count conversations and skipped_overlap rows.
///
/// Expected results:
///   - No new conversation is created for the overlapping trigger.
///   - A skipped_overlap record is persisted for auditability.
///   - The original running run remains running.
#[test]
fn overlapping_due_workflow_records_skip_without_new_conversation() {
    let (state, agent_id) = test_state_with_agent();
    let now = local_ms(2026, 6, 1, 10, 0);
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO workflows
             (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
              next_run_at, last_run_at, created_at, updated_at)
             VALUES ('wf-overlap', 'Morning report', ?1, 'Summarize repository state', 1,
                     'daily', '09:15', NULL, ?2, NULL, ?3, ?3)",
            rusqlite::params![agent_id, now - 1, now - 10],
        )
        .expect("seed due workflow should insert");
        db.execute(
            "INSERT INTO workflow_runs
             (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
              summary, error_message, created_at)
             VALUES ('run-existing', 'wf-overlap', NULL, 'running', ?1, ?1, NULL, NULL, NULL, ?1)",
            [now - 1000],
        )
        .expect("seed running workflow run should insert");
    }

    let triggered = run_due_workflows_once_without_dispatch(&state, now)
        .expect("due workflow scan should succeed");

    assert_eq!(
        triggered, 1,
        "one due workflow should be processed even when it is skipped for overlap"
    );
    let db = state.db.lock().unwrap();
    let conversation_count: i64 = db
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .expect("conversation count should be readable");
    assert_eq!(
        conversation_count, 0,
        "overlapping workflow trigger must not create a new conversation"
    );
    let skipped_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM workflow_runs
             WHERE workflow_id='wf-overlap' AND status='skipped_overlap' AND conversation_id IS NULL",
            [],
            |row| row.get(0),
        )
        .expect("skipped overlap count should be readable");
    assert_eq!(
        skipped_count, 1,
        "overlap should create exactly one skipped_overlap record with no conversation"
    );
    let running_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM workflow_runs
             WHERE workflow_id='wf-overlap' AND status='running'",
            [],
            |row| row.get(0),
        )
        .expect("running count should be readable");
    assert_eq!(
        running_count, 1,
        "overlap handling must preserve the original running workflow run"
    );
}

/// Terminal runtime status finalizes the linked workflow run.
///
/// Data construction:
///   workflow       = wf-finalize bound to a registered agent
///   conversation   = conv-finalize
///   run            = run-finalize, status running, conversation_id conv-finalize
///   terminal       = completed with summary "All done"
///
/// Execution process:
///   1. Seed workflow, conversation, and running workflow_run.
///   2. Call finalize_workflow_run_for_conversation for conv-finalize.
///   3. Query workflow_runs terminal fields.
///
/// Expected results:
///   - Positive: status changes to completed.
///   - Positive: ended_at is written with the terminal timestamp.
///   - Positive: summary is stored.
///   - Negative: error_message stays null for completed runs.
#[test]
fn terminal_status_finalizes_workflow_run_for_conversation() {
    let (state, agent_id) = test_state_with_agent();
    let now = local_ms(2026, 6, 1, 10, 0);
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO workflows
             (id, name, agent_id, prompt, enabled, schedule_kind, time_of_day, day_of_week,
              next_run_at, last_run_at, created_at, updated_at)
             VALUES ('wf-finalize', 'Finalize', ?1, 'Run', 1, 'daily', '09:15',
                     NULL, ?2, ?2, ?2, ?2)",
            rusqlite::params![agent_id, now],
        )
        .expect("workflow should insert");
        db.execute(
            "INSERT INTO conversations
             (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-finalize', ?1, 'Workflow: Finalize', ?2, ?2, 'running')",
            rusqlite::params![agent_id, now],
        )
        .expect("conversation should insert");
        db.execute(
            "INSERT INTO workflow_runs
             (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
              summary, error_message, created_at)
             VALUES ('run-finalize', 'wf-finalize', 'conv-finalize', 'running',
                     ?1, ?1, NULL, NULL, NULL, ?1)",
            [now],
        )
        .expect("running workflow run should insert");
    }

    let changed = {
        let db = state.db.lock().unwrap();
        finalize_workflow_run_for_conversation(
            &db,
            "conv-finalize",
            "completed",
            Some("All done"),
            None,
            now + 500,
        )
        .expect("finalization should update the linked workflow run")
    };

    assert_eq!(
        changed, 1,
        "exactly one running workflow run should be finalized"
    );
    let db = state.db.lock().unwrap();
    let (status, ended_at, summary, error_message): (String, i64, String, Option<String>) = db
        .query_row(
            "SELECT status, ended_at, summary, error_message
             FROM workflow_runs
             WHERE id='run-finalize'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("finalized workflow run should be readable");
    assert_eq!(
        status, "completed",
        "terminal task status should finalize the workflow run as completed"
    );
    assert_eq!(
        ended_at,
        now + 500,
        "terminal task status should persist ended_at"
    );
    assert_eq!(
        summary, "All done",
        "terminal task status should persist the runtime summary"
    );
    assert!(
        error_message.is_none(),
        "completed workflow run should not store an error_message"
    );
}
