use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RegisterTokenBody {
    pub expo_push_token: String,
    pub device_label: String,
    pub endpoint_id: Option<String>,
}

#[derive(Serialize)]
pub struct PushTokenRow {
    pub id: String,
    pub expo_push_token: String,
    pub device_label: String,
    pub endpoint_id: Option<String>,
    pub registered_at: i64,
}

pub async fn register_token(
    State(state): State<AppState>,
    Json(body): Json<RegisterTokenBody>,
) -> Result<(StatusCode, Json<PushTokenRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "DELETE FROM push_tokens
         WHERE expo_push_token = ?1
           AND ((endpoint_id IS NULL AND ?2 IS NULL) OR endpoint_id = ?2)",
        rusqlite::params![body.expo_push_token, body.endpoint_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute(
        "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
         VALUES (?1,?2,?3,?4,?5)",
        rusqlite::params![
            id,
            body.expo_push_token,
            body.device_label,
            body.endpoint_id,
            now
        ],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((
        StatusCode::CREATED,
        Json(PushTokenRow {
            id,
            expo_push_token: body.expo_push_token,
            device_label: body.device_label,
            endpoint_id: body.endpoint_id,
            registered_at: now,
        }),
    ))
}

pub async fn delete_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let n = db
        .execute("DELETE FROM push_tokens WHERE id = ?1", [&id])
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
        db,
        serve::{auth::bearer_auth, state::AppState},
    };
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tempfile::tempdir;
    use tower::ServiceExt;

    async fn make_app(token: &str) -> axum::Router {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(
            conn,
            token.to_string(),
            std::path::PathBuf::from("/tmp/uploads"),
        );
        axum::Router::new()
            .route("/api/v1/push-tokens", axum::routing::post(register_token))
            .route(
                "/api/v1/push-tokens/:id",
                axum::routing::delete(delete_token),
            )
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state)
    }

    /// POST /api/v1/push-tokens registers a token and returns 201.
    ///
    /// Expected:
    ///   - status == 201
    ///   - body.expo_push_token == "ExponentPushToken[abc]"
    #[tokio::test]
    async fn test_register_push_token_returns_201() {
        let app = make_app("tok").await;
        let body = serde_json::json!({
            "expo_push_token": "ExponentPushToken[abc]",
            "device_label": "iPhone 15"
        });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/push-tokens")
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
            "register token must return 201"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            json["expo_push_token"], "ExponentPushToken[abc]",
            "token must be stored and returned"
        );
    }
}
