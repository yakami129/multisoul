use super::transcript::HiddenMessagesResponse;
use crate::{
    db,
    serve::{
        build_router,
        plugin::PluginManager,
        state::AppState,
        transcript::{TranscriptItem, TranscriptPage},
    },
};
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use tower::ServiceExt;

#[tokio::test]
async fn transcript_routes_require_bearer_auth() {
    let state = seeded_state("completed");
    let app = build_router(state).await;

    let summary = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/conversations/conv-1/transcript-turns")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(summary.status(), StatusCode::UNAUTHORIZED);

    let hidden = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/conversations/conv-1/turns/turn-10/hidden-messages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hidden.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn completed_summary_route_pages_by_turn_and_focuses_around_ask() {
    let state = seeded_state("completed");
    let app = build_router(state).await;

    let latest = get_page(
        &app,
        "/api/v1/conversations/conv-1/transcript-turns?limit=2",
    )
    .await;
    assert_eq!(turn_ids(&latest), vec!["turn-30", "turn-40"]);
    assert_eq!(latest.page_info.oldest_turn_id.as_deref(), Some("turn-30"));
    assert!(latest.page_info.has_older);
    assert!(
        latest
            .items
            .iter()
            .all(|item| matches!(item, TranscriptItem::TurnSummary { .. })),
        "completed conversations should summarize all returned turns"
    );

    let before = get_page(
        &app,
        "/api/v1/conversations/conv-1/transcript-turns?limit=2&before_turn=turn-30",
    )
    .await;
    assert_eq!(turn_ids(&before), vec!["turn-10", "turn-20"]);
    assert!(!before.page_info.has_older);

    let around = get_page(
        &app,
        "/api/v1/conversations/conv-1/transcript-turns?limit=1&around_ask_id=ask-focus",
    )
    .await;
    assert_eq!(turn_ids(&around), vec!["turn-20"]);
}

#[tokio::test]
async fn running_summary_route_returns_latest_turn_raw() {
    let state = seeded_state("running");
    let app = build_router(state).await;
    let page = get_page(
        &app,
        "/api/v1/conversations/conv-1/transcript-turns?limit=2",
    )
    .await;

    assert_eq!(page.items.len(), 2);
    assert_eq!(summary_turn_id(&page.items[0]), Some("turn-30"));
    match &page.items[1] {
        TranscriptItem::CurrentTurnRaw { current } => {
            assert_eq!(current.turn_id, "turn-40");
            assert_eq!(seqs(&current.messages), vec![40, 41]);
        }
        other => panic!("latest running turn should be raw, got {other:?}"),
    }
}

#[tokio::test]
async fn hidden_messages_route_returns_only_turn_hidden_rows_and_matching_results() {
    let state = seeded_state("completed");
    let app = build_router(state).await;
    let hidden = get_hidden(
        &app,
        "/api/v1/conversations/conv-1/turns/turn-10/hidden-messages",
    )
    .await;

    assert_eq!(hidden.conversation_id, "conv-1");
    assert_eq!(hidden.turn_id, "turn-10");
    assert_eq!(seqs(&hidden.messages), vec![11, 12, 15]);
    assert!(
        hidden
            .messages
            .iter()
            .all(|row| row.role != "user_text" && row.role != "ask_question"),
        "hidden expansion must exclude visible user and ask rows"
    );
}

#[tokio::test]
async fn hidden_messages_route_404s_for_unknown_or_cross_conversation_turns() {
    let state = seeded_state("completed");
    let app = build_router(state).await;

    for uri in [
        "/api/v1/conversations/conv-1/turns/turn-999/hidden-messages",
        "/api/v1/conversations/conv-2/turns/turn-10/hidden-messages",
    ] {
        let resp = app
            .clone()
            .oneshot(authed_request(uri))
            .await
            .expect("route should respond");
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}

async fn get_page(app: &axum::Router, uri: &str) -> TranscriptPage {
    let resp = app
        .clone()
        .oneshot(authed_request(uri))
        .await
        .expect("summary route should respond");
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), 16_384).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn get_hidden(app: &axum::Router, uri: &str) -> HiddenMessagesResponse {
    let resp = app
        .clone()
        .oneshot(authed_request(uri))
        .await
        .expect("hidden route should respond");
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), 16_384).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn authed_request(uri: &str) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header("Authorization", "Bearer ms_v2_tok")
        .body(Body::empty())
        .unwrap()
}

fn seeded_state(status: &str) -> AppState {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("transcript-routes.db")).unwrap();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
         VALUES ('agent-1', 'Agent One', '/tmp/project', 'claude-code', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations
         (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-1', 'agent-1', 'Deploy', 1, 41, ?1)",
        [status],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations
         (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-2', 'agent-1', 'Other', 1, 100, 'completed')",
        [],
    )
    .unwrap();
    seed_messages(&conn);
    let plugin_db = db::open_at(&dir.path().join("plugins.db")).unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    )
}

fn seed_messages(conn: &rusqlite::Connection) {
    for (seq, role, payload) in [
        (10, "user_text", serde_json::json!({ "text": "one" })),
        (11, "agent_text", serde_json::json!({ "text": "progress" })),
        (12, "tool_call", tool_call("call-1")),
        (13, "ask_question", ask("ask-10")),
        (14, "agent_text", serde_json::json!({ "text": "final one" })),
        (15, "tool_result", tool_result("call-1")),
        (20, "user_text", serde_json::json!({ "text": "two" })),
        (21, "ask_question", ask("ask-focus")),
        (22, "agent_text", serde_json::json!({ "text": "final two" })),
        (30, "user_text", serde_json::json!({ "text": "three" })),
        (31, "tool_call", tool_call("call-3")),
        (
            32,
            "task_status",
            serde_json::json!({ "status": "completed" }),
        ),
        (
            33,
            "agent_text",
            serde_json::json!({ "text": "final three" }),
        ),
        (40, "user_text", serde_json::json!({ "text": "four" })),
        (41, "tool_call", tool_call("call-4")),
    ] {
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES (?1, 'conv-1', ?2, ?3, ?4, ?5)",
            rusqlite::params![format!("msg-{seq}"), role, payload.to_string(), seq, seq],
        )
        .unwrap();
    }
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES ('other-100', 'conv-2', 'user_text', '{\"text\":\"other\"}', 100, 100)",
        [],
    )
    .unwrap();
}

fn ask(ask_id: &str) -> serde_json::Value {
    serde_json::json!({ "ask_id": ask_id, "questions": [] })
}

fn tool_call(call_id: &str) -> serde_json::Value {
    serde_json::json!({ "call_id": call_id, "tool": "Bash", "args": "pwd" })
}

fn tool_result(call_id: &str) -> serde_json::Value {
    serde_json::json!({ "call_id": call_id, "ok": true, "summary": "done" })
}

fn turn_ids(page: &TranscriptPage) -> Vec<&str> {
    page.items.iter().filter_map(summary_turn_id).collect()
}

fn summary_turn_id(item: &TranscriptItem) -> Option<&str> {
    match item {
        TranscriptItem::TurnSummary { summary } => Some(summary.turn_id.as_str()),
        _ => None,
    }
}

fn seqs(rows: &[crate::serve::message_rows::MessageRow]) -> Vec<i64> {
    rows.iter().map(|row| row.seq).collect()
}
