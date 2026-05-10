pub mod auth;
pub mod daemon;
pub mod interactive;
pub mod plugin;
pub mod push;
#[cfg(test)]
mod push_tests;
pub mod routes;
pub mod runtime;
pub mod state;

use anyhow::Result;
use axum::{middleware, Router};
use state::AppState;
use tower_http::cors::CorsLayer;

pub async fn build_router(state: AppState) -> Router {
    use routes::*;

    let public_router = Router::new()
        .route("/api/v1/healthz", axum::routing::get(healthz::healthz))
        .route("/webhook/feishu", axum::routing::post(webhook::feishu_webhook))
        .route("/webhook/gitlab", axum::routing::post(webhook::gitlab_webhook));

    let authed_router = Router::new()
        .route("/api/v1/agents", axum::routing::get(agents::list_agents))
        .route("/api/v1/agents/:id", axum::routing::get(agents::get_agent))
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(conversations::list_conversations)
                .post(conversations::create_conversation),
        )
        .route(
            "/api/v1/conversations/:id",
            axum::routing::delete(conversations::delete_conversation),
        )
        .route(
            "/api/v1/conversations/:id/abort",
            axum::routing::post(conversations::abort_conversation),
        )
        .route(
            "/api/v1/conversations/:id/messages",
            axum::routing::get(messages::list_messages).post(messages::post_message),
        )
        .route(
            "/api/v1/push-tokens",
            axum::routing::post(push_tokens::register_token),
        )
        .route(
            "/api/v1/push-tokens/:id",
            axum::routing::delete(push_tokens::delete_token),
        )
        .route("/ws/conversations/:id", axum::routing::get(ws::ws_handler))
        .route("/api/v1/uploads", axum::routing::post(uploads::upload_image))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::bearer_auth,
        ));

    Router::new()
        .merge(public_router)
        .merge(authed_router)
        .layer(middleware::from_fn(http_trace::trace_request))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

pub async fn run_server(state: AppState, addr: std::net::SocketAddr) -> Result<()> {
    let router = build_router(state).await;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Listening on http://{}", addr);
    tracing::info!(addr = %addr, "serve_listening");
    axum::serve(listener, router).await?;
    Ok(())
}

mod http_trace {
    use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
    use std::time::Instant;
    use tracing::{info, warn, Instrument};
    use uuid::Uuid;

    pub async fn trace_request(req: Request, next: Next) -> Response {
        let request_id = Uuid::new_v4().to_string();
        let method = req.method().clone();
        let path = req.uri().path().to_string();
        let span = tracing::info_span!(
            "http_request",
            request_id = %request_id,
            method = %method,
            path = %path,
        );
        let started = Instant::now();
        async move {
            let resp = next.run(req).await;
            let dur_ms = started.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            if resp.status().is_client_error() || resp.status() == StatusCode::INTERNAL_SERVER_ERROR
            {
                warn!(status, dur_ms, "http_error");
            } else {
                info!(status, dur_ms, "http_request");
            }
            resp
        }
        .instrument(span)
        .await
    }
}

#[cfg(test)]
mod router_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;
    use crate::db;
    use tempfile::tempdir;

    async fn test_state() -> AppState {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let uploads = dir.path().join("uploads");
        let pm = crate::serve::plugin::PluginManager::empty(
            std::sync::Arc::new(std::sync::Mutex::new(
                db::open_at(&dir.path().join("p.db")).unwrap()
            ))
        );
        AppState::new(conn, "ms_v2_tok".to_string(), uploads, pm)
    }

    /// healthz 无需 Bearer token 应返回 200
    ///
    /// 执行：不带 Authorization header 请求 /api/v1/healthz
    /// 预期：200 OK（healthz 在 public_router，不经过 bearer_auth）
    #[tokio::test]
    async fn test_healthz_no_auth_returns_200() {
        let state = test_state().await;
        let app = build_router(state).await;
        let resp = app
            .oneshot(Request::builder().uri("/api/v1/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "healthz should not require auth");
    }

    /// 受保护路由无 token 应返回 401
    ///
    /// 执行：不带 Authorization header 请求 /api/v1/agents
    /// 预期：401 UNAUTHORIZED
    #[tokio::test]
    async fn test_agents_no_auth_returns_401() {
        let state = test_state().await;
        let app = build_router(state).await;
        let resp = app
            .oneshot(Request::builder().uri("/api/v1/agents").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED, "agents should require auth");
    }
}
