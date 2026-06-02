//! DB helpers and WebSocket broadcast for the Claude runtime.

use crate::db::now_ms;
use crate::serve::{push, state::AppState};
use serde_json::Value;
use tracing::debug;
use uuid::Uuid;

// ─── DB helpers ───────────────────────────────────────────────────────────────

pub(super) fn load_session_id(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT claude_session_id FROM conversations WHERE id = ?1",
        [conv_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

pub(super) fn save_session_id(state: &AppState, conv_id: &str, session_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET claude_session_id = ?1 WHERE id = ?2",
        rusqlite::params![session_id, conv_id],
    );
}

pub(super) fn clear_session_id(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET claude_session_id = NULL WHERE id = ?1",
        [conv_id],
    );
}

pub(super) fn mark_failed(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET status = 'failed' WHERE id = ?1",
        [conv_id],
    );
    drop(db);
    let payload = serde_json::json!({ "task_id": conv_id, "status": "failed", "importance": "normal", "summary": "" });
    let db2 = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db2, conv_id, "task_status", &payload) {
        let _ = crate::serve::workflows::finalize_workflow_run_for_conversation(
            &db2,
            conv_id,
            "failed",
            Some(""),
            Some(""),
            crate::db::now_ms(),
        );
        push::send_task_status_push(&db2, conv_id, "failed", "");
        drop(db2);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
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
        let n = tx.send(json).unwrap_or(0);
        debug!(role, seq, receivers = n, "broadcast");
    }
}
