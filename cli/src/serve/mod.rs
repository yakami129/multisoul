pub mod auth;
pub mod daemon;
pub mod interactive;
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
    Router::new()
        .route("/api/v1/healthz", axum::routing::get(healthz::healthz))
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
        .layer(middleware::from_fn(http_trace::trace_request))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::bearer_auth,
        ))
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

    /// Per-request span with request_id + structured http_request event at exit.
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
