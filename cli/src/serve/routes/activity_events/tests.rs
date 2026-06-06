use super::*;
use crate::{
    db,
    serve::{
        plugin::PluginManager,
        state::{AppState, SessionHandle},
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

fn make_state() -> AppState {
    let dir = tempdir().unwrap();
    AppState::new(
        db::open_at(&dir.path().join("activity-events.db")).unwrap(),
        "test-token".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(
            db::open_at(&dir.path().join("plugins.db")).unwrap(),
        ))),
    )
}

/// emit_activity_changed broadcasts the canonical lightweight refresh payload.
///
/// Data construction:
///   - One Activity subscriber is attached before each emit.
///   - Each supported reason is emitted once for the same conversation id.
///
/// Expected:
///   - type is activity_changed.
///   - conversation_id and reason are preserved exactly.
///   - timestamp is a positive millisecond value.
#[tokio::test]
async fn emit_activity_changed_broadcasts_all_supported_reasons() {
    let state = make_state();
    let reasons = [
        REASON_CONVERSATION_CREATED,
        REASON_USER_MESSAGE,
        REASON_AWAITING_QUESTION,
        REASON_ANSWER_ACCEPTED,
        REASON_TASK_TERMINAL,
        REASON_ABORTED,
        REASON_DELETED,
        REASON_READ_STATE_CHANGED,
        REASON_WORKFLOW_CHANGED,
    ];

    for reason in reasons {
        let mut rx = state.activity_bus.subscribe();
        emit_activity_changed(&state, "conv-activity", reason);
        let raw = rx
            .recv()
            .await
            .expect("activity subscriber should receive the refresh event");
        let json: serde_json::Value =
            serde_json::from_str(&raw).expect("activity event should be valid JSON");

        assert_eq!(
            json.get("type").and_then(|value| value.as_str()),
            Some("activity_changed"),
            "Activity refresh signal must use the canonical type"
        );
        assert_eq!(
            json.get("conversation_id").and_then(|value| value.as_str()),
            Some("conv-activity"),
            "Activity refresh signal must preserve the changed conversation id"
        );
        assert_eq!(
            json.get("reason").and_then(|value| value.as_str()),
            Some(reason),
            "Activity refresh signal must preserve the specific reason"
        );
        assert!(
            json.get("timestamp")
                .and_then(|value| value.as_i64())
                .unwrap_or(0)
                > 0,
            "Activity refresh signal must include a concrete timestamp"
        );
    }
}

/// post_message emits a user_message Activity refresh after a successful write.
///
/// Data construction:
///   - A codex conversation has an existing in-memory SessionHandle so no runtime is spawned.
///   - An Activity subscriber is attached before POST handling.
///
/// Expected:
///   - post_message returns 201.
///   - The Activity subscriber receives user_message for the same conversation.
#[tokio::test]
async fn post_message_emits_user_message_activity_refresh() {
    let state = make_state();
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO agents (id, name, project_path, runtime, mode, created_at)
             VALUES ('agent-activity', 'Activity Agent', '/tmp/project', 'codex', 'full-auto', 1)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO conversations
             (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-message', 'agent-activity', 'Activity Conv', 10, 20, 'idle')",
            [],
        )
        .unwrap();
    }

    let (tx, _runtime_rx) = std::sync::mpsc::channel();
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-message".to_string(), SessionHandle::new(tx));
    let mut activity_rx = state.activity_bus.subscribe();

    let (status, Json(row)) = crate::serve::routes::messages::post_message(
        State(state.clone()),
        Path("conv-message".to_string()),
        Json(crate::serve::routes::messages::PostMessageBody {
            text: "Refresh Activity".to_string(),
            file_id: None,
        }),
    )
    .await
    .expect("post_message should create the user_text row");

    assert_eq!(
        status,
        StatusCode::CREATED,
        "post_message should return 201 before checking Activity refresh"
    );
    assert_eq!(
        row.conversation_id, "conv-message",
        "created message should belong to the seeded conversation"
    );

    let raw_event = activity_rx
        .recv()
        .await
        .expect("post_message should emit an Activity refresh event");
    let event: serde_json::Value =
        serde_json::from_str(&raw_event).expect("Activity refresh event should be JSON");
    assert_eq!(
        event.get("type").and_then(|value| value.as_str()),
        Some("activity_changed"),
        "post_message should emit the canonical Activity refresh event type"
    );
    assert_eq!(
        event
            .get("conversation_id")
            .and_then(|value| value.as_str()),
        Some("conv-message"),
        "post_message Activity refresh should identify the changed conversation"
    );
    assert_eq!(
        event.get("reason").and_then(|value| value.as_str()),
        Some(REASON_USER_MESSAGE),
        "post_message Activity refresh should use the user_message reason"
    );
}

/// record_ask_question persists Activity attention state and emits a refresh signal.
///
/// Data construction:
///   - A conversation starts idle.
///   - An Activity subscriber is attached before recording ask_question.
///
/// Expected:
///   - record_ask_question returns true.
///   - Conversation status becomes awaiting_question.
///   - Activity subscriber receives awaiting_question for the same conversation.
#[tokio::test]
async fn record_ask_question_emits_awaiting_question_activity_refresh() {
    let state = make_state();
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO agents (id, name, project_path, runtime, mode, created_at)
             VALUES ('agent-ask', 'Ask Agent', '/tmp/project', 'claude-code', 'suggest', 1)",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO conversations
             (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-ask', 'agent-ask', 'Ask Conv', 10, 20, 'idle')",
            [],
        )
        .unwrap();
    }

    let mut activity_rx = state.activity_bus.subscribe();
    let recorded = crate::serve::ask_question::record_ask_question(
        &state,
        "conv-ask",
        serde_json::json!({
            "ask_id": "ask-activity",
            "questions": [
                {
                    "id": "0",
                    "label": "Continue?",
                    "kind": "single_select",
                    "options": [{ "id": "yes", "label": "Yes" }]
                }
            ]
        }),
    );

    assert!(
        recorded,
        "record_ask_question should persist the ask before Activity refresh assertions"
    );
    let status: String = state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT status FROM conversations WHERE id='conv-ask'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "awaiting_question",
        "record_ask_question must make the conversation visible in Activity attention"
    );

    let raw_event = activity_rx
        .recv()
        .await
        .expect("record_ask_question should emit an Activity refresh event");
    let event: serde_json::Value =
        serde_json::from_str(&raw_event).expect("Activity refresh event should be JSON");
    assert_eq!(
        event
            .get("conversation_id")
            .and_then(|value| value.as_str()),
        Some("conv-ask"),
        "ask_question Activity refresh should identify the changed conversation"
    );
    assert_eq!(
        event.get("reason").and_then(|value| value.as_str()),
        Some(REASON_AWAITING_QUESTION),
        "ask_question Activity refresh should use the awaiting_question reason"
    );
}
