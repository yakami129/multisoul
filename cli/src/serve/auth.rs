use crate::serve::state::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

pub async fn bearer_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let query_token = req.uri().query().and_then(|q| {
        q.split('&').find_map(|kv| {
            let mut parts = kv.splitn(2, '=');
            if parts.next() == Some("token") {
                parts.next()
            } else {
                None
            }
        })
    });

    let header_token = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let provided = query_token.or(header_token);

    match provided {
        Some(t) if t == state.token => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    async fn make_app(token: &str) -> axum::Router {
        use crate::db;
        use crate::serve::state::AppState;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(
            conn,
            token.to_string(),
            std::path::PathBuf::from("/tmp/uploads"),
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
            ))),
        );
        axum::Router::new()
            .route("/test", axum::routing::get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state)
    }

    /// Missing Authorization header -> 401.
    ///
    /// Expected:
    ///   - status == 401
    #[tokio::test]
    async fn test_missing_token_returns_401() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "missing token should return 401"
        );
    }

    /// Wrong token -> 401.
    ///
    /// Expected:
    ///   - status == 401
    #[tokio::test]
    async fn test_wrong_token_returns_401() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("Authorization", "Bearer ms_v2_wrong")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "wrong token should return 401"
        );
    }

    /// Correct token -> 200.
    ///
    /// Expected:
    ///   - status == 200
    #[tokio::test]
    async fn test_correct_token_passes() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("Authorization", "Bearer ms_v2_secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "correct token should pass through"
        );
    }
}
