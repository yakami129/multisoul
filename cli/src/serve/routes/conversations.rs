use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub last_message_at: i64,
    pub status: String,
    pub first_user_message: Option<String>,
    pub last_ai_reply: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateConversationBody {
    pub title: Option<String>,
}

pub async fn list_conversations(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Vec<ConversationRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db
        .prepare(
            "SELECT c.id, c.agent_id, c.title, c.created_at, c.last_message_at, c.status,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'user_text'
                 ORDER BY m.seq ASC LIMIT 1) AS first_user_message,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'agent_text'
                 ORDER BY m.seq DESC LIMIT 1) AS last_ai_reply
         FROM conversations c WHERE c.agent_id = ?1 ORDER BY c.last_message_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<ConversationRow> = stmt
        .query_map([&agent_id], |r| {
            Ok(ConversationRow {
                id: r.get(0)?,
                agent_id: r.get(1)?,
                title: r.get(2)?,
                created_at: r.get(3)?,
                last_message_at: r.get(4)?,
                status: r.get(5)?,
                first_user_message: r.get(6)?,
                last_ai_reply: r.get(7)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Json(rows))
}

pub async fn create_conversation(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<CreateConversationBody>,
) -> Result<(StatusCode, Json<ConversationRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let exists: bool = db
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE id = ?1",
            [&agent_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = body.title.unwrap_or_else(|| "New conversation".to_string());
    db.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1,?2,?3,?4,?5,'idle')",
        rusqlite::params![id, agent_id, title, now, now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((
        StatusCode::CREATED,
        Json(ConversationRow {
            id,
            agent_id,
            title,
            created_at: now,
            last_message_at: now,
            status: "idle".into(),
            first_user_message: None,
            last_ai_reply: None,
        }),
    ))
}

pub async fn delete_conversation(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let n = db
        .execute("DELETE FROM conversations WHERE id = ?1", [&conv_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        Err(StatusCode::NOT_FOUND)
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

#[cfg(test)]
mod tests {
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
        let state = AppState::new(conn, token.to_string(), std::path::PathBuf::from("/tmp/uploads"));
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
        let state = AppState::new(conn, token.to_string(), std::path::PathBuf::from("/tmp/uploads"));
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
}
