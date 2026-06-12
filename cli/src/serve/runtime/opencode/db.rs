use serde_json::Value;
use tracing::debug;
use uuid::Uuid;

use crate::db::now_ms;
use crate::serve::{
    push,
    routes::activity_events::{emit_activity_changed, REASON_ABORTED, REASON_TASK_TERMINAL},
    state::AppState,
};

pub(super) fn load_session_id(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT opencode_session_id FROM conversations WHERE id = ?1",
        [conv_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

pub(super) fn save_session_id(state: &AppState, conv_id: &str, session_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET opencode_session_id = ?1 WHERE id = ?2",
        rusqlite::params![session_id, conv_id],
    );
}

pub(super) fn mark_failed(state: &AppState, conv_id: &str, turn_seq: i64) {
    complete_turn(state, conv_id, "failed", turn_seq);
}

pub(super) fn insert_message(
    db: &rusqlite::Connection,
    conv_id: &str,
    role: &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, conv_id, role, payload.to_string(), now, seq],
    )?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok(seq)
}

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
}

pub(super) fn broadcast(
    state: &AppState,
    conv_id: &str,
    seq: i64,
    role: &'static str,
    payload: Value,
) {
    let env = WsEnvelope {
        kind: "message",
        seq,
        role,
        payload,
        created_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let _ = tx.send(json).unwrap_or(0);
    }
}

pub(super) fn complete_turn(state: &AppState, conv_id: &str, status: &str, turn_seq: i64) {
    {
        let db = state.db.lock().unwrap();
        let changed = db
            .execute(
                "UPDATE conversations
                 SET status = ?1
                 WHERE id = ?2
                   AND NOT EXISTS (
                       SELECT 1 FROM messages
                       WHERE conversation_id = ?2
                         AND role = 'user_text'
                         AND seq > ?3
                   )",
                rusqlite::params![status, conv_id, turn_seq],
            )
            .unwrap_or(0);
        if changed == 0 {
            debug!(
                conv_id = %conv_id,
                turn_seq,
                status,
                "stale_task_status_ignored"
            );
            return;
        }
    }
    let payload = serde_json::json!({
        "task_id": conv_id,
        "status": status,
        "importance": "normal",
        "summary": ""
    });
    let ended_at = now_ms();
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        let _ = crate::serve::workflows::finalize_workflow_run_for_conversation(
            &db,
            conv_id,
            status,
            Some(""),
            if status == "failed" { Some("") } else { None },
            ended_at,
        );
        let _ = crate::serve::workflows::post_run_watch_check(&db, conv_id, ended_at);
        push::send_task_status_push(&db, conv_id, status, "");
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
        emit_activity_changed(
            state,
            conv_id,
            if status == "aborted" {
                REASON_ABORTED
            } else {
                REASON_TASK_TERMINAL
            },
        );
    }
}
