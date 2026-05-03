use crate::serve::state::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct AgentRow {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub runtime: String,
    pub created_at: i64,
}

pub async fn list_agents(State(state): State<AppState>) -> Result<Json<Vec<AgentRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db.prepare(
        "SELECT id, name, project_path, runtime, created_at FROM agents ORDER BY created_at DESC"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<AgentRow> = stmt
        .query_map([], |r| {
            Ok(AgentRow {
                id: r.get(0)?,
                name: r.get(1)?,
                project_path: r.get(2)?,
                runtime: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Json(rows))
}

pub async fn get_agent(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<AgentRow>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT id, name, project_path, runtime, created_at FROM agents WHERE id = ?1",
        [&id],
        |r| {
            Ok(AgentRow {
                id: r.get(0)?,
                name: r.get(1)?,
                project_path: r.get(2)?,
                runtime: r.get(3)?,
                created_at: r.get(4)?,
            })
        },
    )
    .map(Json)
    .map_err(|_| StatusCode::NOT_FOUND)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        serve::{auth::bearer_auth, state::AppState},
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tempfile::tempdir;
    use tower::ServiceExt;

    async fn make_agents_app(token: &str) -> axum::Router {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(conn, token.to_string(), std::path::PathBuf::from("/tmp/uploads"));
        axum::Router::new()
            .route("/api/v1/agents", axum::routing::get(list_agents))
            .route("/api/v1/agents/:id", axum::routing::get(get_agent))
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state)
    }

    /// GET /api/v1/agents returns empty array when no agents registered.
    ///
    /// Expected:
    ///   - status == 200
    ///   - body == []
    #[tokio::test]
    async fn test_list_agents_empty() {
        let app = make_agents_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/agents")
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "list agents must return 200");
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            json.as_array().unwrap().is_empty(),
            "no agents -> empty array"
        );
    }

    /// GET /api/v1/agents/:id returns 404 for unknown id.
    ///
    /// Expected:
    ///   - status == 404
    #[tokio::test]
    async fn test_get_agent_not_found() {
        let app = make_agents_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/agents/nonexistent-id")
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "unknown agent id must return 404"
        );
    }
}
