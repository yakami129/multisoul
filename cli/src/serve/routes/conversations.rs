use axum::{extract::{Path, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{db::now_ms, serve::state::AppState};

#[derive(Serialize)]
pub struct ConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub last_message_at: i64,
    pub status: String,
}

#[derive(Deserialize)]
pub struct CreateConversationBody {
    pub title: Option<String>,
}

pub async fn list_conversations(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Vec<ConversationRow>>, StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db.prepare(
        "SELECT id, agent_id, title, created_at, last_message_at, status
         FROM conversations WHERE agent_id = ?1 ORDER BY last_message_at DESC"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<ConversationRow> = stmt.query_map([&agent_id], |r| Ok(ConversationRow {
        id: r.get(0)?, agent_id: r.get(1)?, title: r.get(2)?,
        created_at: r.get(3)?, last_message_at: r.get(4)?, status: r.get(5)?,
    })).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .filter_map(|r| r.ok()).collect();
    Ok(Json(rows))
}

pub async fn create_conversation(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<CreateConversationBody>,
) -> Result<(StatusCode, Json<ConversationRow>), StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let exists: bool = db.query_row(
        "SELECT COUNT(*) FROM agents WHERE id = ?1", [&agent_id], |r| r.get::<_,i64>(0)
    ).map(|c| c > 0).map_err(|_| StatusCode::NOT_FOUND)?;
    if !exists { return Err(StatusCode::NOT_FOUND); }

    let id    = Uuid::new_v4().to_string();
    let now   = now_ms();
    let title = body.title.unwrap_or_else(|| "New conversation".to_string());
    db.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1,?2,?3,?4,?5,'idle')",
        rusqlite::params![id, agent_id, title, now, now],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((StatusCode::CREATED, Json(ConversationRow {
        id, agent_id, title, created_at: now, last_message_at: now, status: "idle".into(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;
    use crate::{db, commands::agent::insert_agent, serve::{auth::bearer_auth, state::AppState}};
    use tempfile::tempdir;

    async fn make_conv_app(token: &str) -> (axum::Router, String) {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code").unwrap();
        let state = AppState::new(conn, token.to_string());
        let app = axum::Router::new()
            .route("/api/v1/agents/:id/conversations",
                axum::routing::get(list_conversations).post(create_conversation))
            .layer(axum::middleware::from_fn_with_state(state.clone(), bearer_auth))
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
        let resp = app.oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string())).unwrap()
        ).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED, "create conversation must return 201");
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["agent_id"], agent_id.as_str(), "agent_id must match");
        assert_eq!(json["status"], "idle", "new conversation status must be idle");
    }
}
