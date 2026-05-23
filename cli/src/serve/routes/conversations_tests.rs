use super::*;
use crate::{
    commands::agent::insert_agent,
    db,
    serve::{auth::bearer_auth, state::AppState},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tempfile::tempdir;
use tower::ServiceExt;

async fn make_conv_app(token: &str) -> (axum::Router, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        token.to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(list_conversations).post(create_conversation),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state);
    (app, agent_id)
}

/// POST /api/v1/agents/:id/conversations creates a new conversation.
///
/// Data construction:
///   - Register agent "test-agent" in DB
///   - POST body: { "title": "My thread" }
///
/// Expected:
///   - status == 201
///   - body.agent_id == agent_id
///   - body.status == "idle"
#[tokio::test]
async fn test_create_conversation_returns_201() {
    let (app, agent_id) = make_conv_app("tok").await;
    let body = serde_json::json!({ "title": "My thread" });
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::CREATED,
        "create conversation must return 201"
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["agent_id"], agent_id.as_str(), "agent_id must match");
    assert_eq!(
        json["status"], "idle",
        "new conversation status must be idle"
    );
}

async fn make_conv_app_with_delete(token: &str) -> (axum::Router, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        token.to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(list_conversations).post(create_conversation),
        )
        .route(
            "/api/v1/conversations/:id",
            axum::routing::delete(delete_conversation),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state);
    (app, agent_id)
}

/// DELETE /api/v1/conversations/:id removes the conversation and returns 204.
///
/// Data construction:
///   - Insert agent "test-agent" in DB
///   - Insert conversation 'conv-del-1' directly
///
/// Execution:
///   1. DELETE /api/v1/conversations/conv-del-1 with valid token
///   2. DELETE again → 404
///
/// Expected:
///   - first DELETE returns 204
///   - second DELETE returns 404 (already gone)
#[tokio::test]
async fn test_delete_conversation_returns_204() {
    let (app, agent_id) = make_conv_app_with_delete("tok").await;

    // Verify the conversation exists by listing
    let list_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK, "list must succeed");

    // Create a conversation to delete
    let create_body = serde_json::json!({ "title": "To delete" });
    let create_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(create_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        create_resp.status(),
        StatusCode::CREATED,
        "setup: create must succeed"
    );
    let bytes = axum::body::to_bytes(create_resp.into_body(), 4096)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let conv_id = json["id"].as_str().unwrap().to_string();

    // DELETE it
    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/conversations/{}", conv_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        del_resp.status(),
        StatusCode::NO_CONTENT,
        "delete must return 204"
    );

    // DELETE again → 404
    let del_again = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/conversations/{}", conv_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        del_again.status(),
        StatusCode::NOT_FOUND,
        "second delete must return 404"
    );
}

async fn make_abort_app(token: &str) -> (axum::Router, String, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        token.to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(list_conversations).post(create_conversation),
        )
        .route(
            "/api/v1/conversations/:id/abort",
            axum::routing::post(abort_conversation),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state);
    // 创建一个 conversation 返回其 id
    let body = serde_json::json!({ "title": "abort test" });
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let conv_id = json["id"].as_str().unwrap().to_string();
    (app, agent_id, conv_id)
}

/// POST /api/v1/conversations/:id/abort 返回 200 且 body.ok == true
///
/// Data construction:
///   - Insert agent + conversation
/// Execution:
///   - POST /api/v1/conversations/:conv_id/abort with valid Bearer token
/// Expected:
///   - status == 200
///   - body.ok == true
#[tokio::test]
async fn test_abort_conversation_returns_200() {
    let (app, _agent_id, conv_id) = make_abort_app("tok").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/conversations/{}/abort", conv_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "abort must return 200");
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["ok"], true, "body.ok must be true");
}

/// POST /api/v1/conversations/nonexistent/abort 返回 404
///
/// Expected:
///   - status == 404 when conversation does not exist
#[tokio::test]
async fn test_abort_nonexistent_conversation_returns_404() {
    let (app, _agent_id, _conv_id) = make_abort_app("tok").await;
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/conversations/no-such-id/abort")
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "abort unknown conv must be 404"
    );
}
