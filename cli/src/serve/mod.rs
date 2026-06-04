pub mod answer_markdown;
pub mod ask_question;
pub mod auth;
pub mod daemon;
pub mod interactive;
pub mod plugin;
pub mod push;
#[cfg(test)]
mod push_tests;
pub mod relay;
pub mod routes;
pub mod runtime;
pub mod state;
pub mod workflows;
#[cfg(test)]
mod workflows_tests;

use anyhow::Result;
use axum::{middleware, Router};
use state::AppState;
use tower_http::cors::CorsLayer;

pub async fn build_router(state: AppState) -> Router {
    use routes::*;

    let public_router = Router::new()
        .route("/api/v1/healthz", axum::routing::get(healthz::healthz))
        .route(
            "/webhook/feishu",
            axum::routing::post(webhook::feishu_webhook),
        )
        .route(
            "/webhook/gitlab",
            axum::routing::post(webhook::gitlab_webhook),
        );

    let authed_router = Router::new()
        .route(
            "/api/v1/activity",
            axum::routing::get(activity::get_activity),
        )
        .route(
            "/api/v1/activity/done/read-all",
            axum::routing::post(activity::mark_all_done_read),
        )
        .route(
            "/api/v1/activity/done/:conversation_id/read",
            axum::routing::post(activity::mark_done_read),
        )
        .route(
            "/ws/activity",
            axum::routing::get(activity_events::activity_ws_handler),
        )
        .route("/api/v1/agents", axum::routing::get(agents::list_agents))
        .route(
            "/api/v1/ask-question",
            axum::routing::post(ask_question::post_ask_question),
        )
        .route(
            "/api/v1/runtime-models",
            axum::routing::get(runtime_models::list_runtime_models),
        )
        .route(
            "/api/v1/workflows",
            axum::routing::get(workflows::list_workflows).post(workflows::create_workflow),
        )
        .route(
            "/api/v1/workflows/:id",
            axum::routing::patch(workflows::update_workflow).delete(workflows::delete_workflow),
        )
        .route(
            "/api/v1/workflows/:id/disable",
            axum::routing::post(workflows::disable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/enable",
            axum::routing::post(workflows::enable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/runs",
            axum::routing::get(workflows::list_workflow_runs),
        )
        .route("/ws/logs", axum::routing::get(logs::logs_ws_handler))
        .route("/api/v1/agents/:id", axum::routing::get(agents::get_agent))
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::get(conversations::list_conversations)
                .post(conversations::create_conversation),
        )
        .route(
            "/api/v1/agents/:id/specs/dispatch",
            axum::routing::post(specs::dispatch_spec),
        )
        .route(
            "/api/v1/conversations/:id",
            axum::routing::delete(conversations::delete_conversation),
        )
        .route(
            "/api/v1/conversations/:id/model",
            axum::routing::patch(conversations::patch_conversation_model),
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
        .route(
            "/api/v1/uploads",
            axum::routing::post(uploads::upload_image),
        )
        .route(
            "/api/v1/uploads/:file_id",
            axum::routing::get(uploads::get_uploaded_image),
        )
        .route("/api/v1/files", axum::routing::get(files::get_file))
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
    let router = build_router(state.clone()).await;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Listening on http://{}", addr);
    tracing::info!(addr = %addr, "serve_listening");
    start_workflow_scheduler(state.clone());
    axum::serve(listener, router).await?;
    // serve が終了したら全 plugin agent の status を stopped に更新
    state.plugin_manager.shutdown();
    Ok(())
}

fn start_workflow_scheduler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        // Consume the immediate first tick so the scheduler doesn't fire on startup.
        // Missed runs while the daemon was down are intentionally skipped per spec.
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(err) = workflows::run_due_workflows_once(&state) {
                tracing::warn!(error = %err, "workflow_scheduler_tick_failed");
            }
        }
    });
}

mod http_trace {
    use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
    use std::time::Instant;
    use tracing::{debug, warn, Instrument, Level};
    use uuid::Uuid;

    pub(super) fn log_level_for_status(status: StatusCode) -> Level {
        if status.is_client_error() || status == StatusCode::INTERNAL_SERVER_ERROR {
            Level::WARN
        } else {
            Level::DEBUG
        }
    }

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
            if log_level_for_status(resp.status()) == Level::WARN {
                warn!(status, dur_ms, "http_error");
            } else {
                debug!(status, dur_ms, "http_request");
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
    use crate::db;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tempfile::tempdir;
    use tower::ServiceExt;
    use tracing::Level;

    async fn test_state() -> AppState {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let uploads = dir.path().join("uploads");
        let pm = crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(
            std::sync::Mutex::new(db::open_at(&dir.path().join("p.db")).unwrap()),
        ));
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
            .oneshot(
                Request::builder()
                    .uri("/api/v1/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "healthz should not require auth"
        );
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
            .oneshot(
                Request::builder()
                    .uri("/api/v1/agents")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "agents should require auth"
        );
    }

    /// Release logs websocket is protected by Bearer auth and is not a public endpoint.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   token      = ms_v2_tok（test_state 中配置的唯一合法 token）
    ///   request    = GET /ws/logs，不带 Authorization header 和 token query
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. build_router(state) 将 /ws/logs 放入 authed_router
    ///   2. 发送无 token 的 websocket upgrade 请求
    ///   3. bearer_auth 在进入 handler 前拒绝请求
    ///
    /// 预期结果：
    ///   - 断言 A：返回 401，说明 release logs 不会绕过 REST/WS Bearer 约束
    ///   - 断言 B：不返回 101，说明未认证请求不会升级成 websocket
    #[tokio::test]
    async fn test_logs_ws_no_auth_returns_401() {
        let state = test_state().await;
        let app = build_router(state).await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/ws/logs")
                    .header("Connection", "upgrade")
                    .header("Upgrade", "websocket")
                    .header("Host", "localhost")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "release logs websocket should require auth"
        );
        assert_ne!(
            resp.status(),
            StatusCode::SWITCHING_PROTOCOLS,
            "unauthenticated release logs request must not upgrade to websocket"
        );
    }

    /// Release logs websocket accepts query token auth and reaches the upgrade handler.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   token      = ms_v2_tok（test_state 中配置的合法 token）
    ///   request    = GET /ws/logs?token=ms_v2_tok，带标准 websocket upgrade headers
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. bearer_auth 从 query string 读取 token
    ///   2. logs_ws_handler 接收 WebSocketUpgrade
    ///   3. 单元测试环境没有 hyper upgrade extension，因此 WebSocketUpgrade 返回 426
    ///
    /// 预期结果：
    ///   - 断言 A：返回 426，说明请求已通过 auth 并到达 websocket upgrade extractor
    ///   - 断言 B：不返回 401，说明合法 token 未被误拒
    #[tokio::test]
    async fn test_logs_ws_query_token_reaches_upgrade_handler() {
        let state = test_state().await;
        let app = build_router(state).await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/ws/logs?token=ms_v2_tok")
                    .header("Connection", "upgrade")
                    .header("Upgrade", "websocket")
                    .header("Host", "localhost")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UPGRADE_REQUIRED,
            "valid token should pass auth and reach websocket upgrade handling in tower test"
        );
        assert_ne!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "valid query token should not be rejected"
        );
    }

    /// Activity websocket is protected by Bearer auth and is not a public endpoint.
    ///
    /// Execution:
    ///   1. build_router(state) places /ws/activity in the authenticated router.
    ///   2. Send an unauthenticated websocket upgrade request.
    ///   3. bearer_auth rejects before the handler can upgrade the socket.
    ///
    /// Expected:
    ///   - status == 401 Unauthorized.
    ///   - status != 101 Switching Protocols.
    #[tokio::test]
    async fn test_activity_ws_no_auth_returns_401() {
        let state = test_state().await;
        let app = build_router(state).await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/ws/activity")
                    .header("Connection", "upgrade")
                    .header("Upgrade", "websocket")
                    .header("Host", "localhost")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "activity websocket should require auth"
        );
        assert_ne!(
            resp.status(),
            StatusCode::SWITCHING_PROTOCOLS,
            "unauthenticated activity request must not upgrade to websocket"
        );
    }

    /// Activity websocket accepts query token auth and reaches the upgrade handler.
    ///
    /// Execution:
    ///   1. bearer_auth reads the valid query token.
    ///   2. activity_ws_handler receives WebSocketUpgrade.
    ///   3. The tower unit-test request has no hyper upgrade extension, so the extractor returns 426.
    ///
    /// Expected:
    ///   - status == 426 Upgrade Required, proving auth passed and the handler was reached.
    ///   - status != 401 Unauthorized.
    #[tokio::test]
    async fn test_activity_ws_query_token_reaches_upgrade_handler() {
        let state = test_state().await;
        let token = state.token.clone();
        let app = build_router(state).await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/ws/activity?token={token}"))
                    .header("Connection", "upgrade")
                    .header("Upgrade", "websocket")
                    .header("Host", "localhost")
                    .header("Sec-WebSocket-Version", "13")
                    .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UPGRADE_REQUIRED,
            "valid token should pass auth and reach activity websocket upgrade handling"
        );
        assert_ne!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "valid query token should not be rejected"
        );
    }

    /// http_trace：成功请求降为 DEBUG，认证/服务错误仍保留 WARN。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   status_ok       = 200 OK（典型健康检查/轮询成功响应）
    ///   status_redirect = 307 Temporary Redirect（非错误响应，不应污染 INFO）
    ///   status_auth     = 401 Unauthorized（认证失败，需要默认可见）
    ///   status_error    = 500 Internal Server Error（服务错误，需要默认可见）
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 调用 http_trace::log_level_for_status(200)   → 期望 DEBUG
    ///   2. 调用 http_trace::log_level_for_status(307)   → 期望 DEBUG
    ///   3. 调用 http_trace::log_level_for_status(401)   → 期望 WARN
    ///   4. 调用 http_trace::log_level_for_status(500)   → 期望 WARN
    ///
    /// 预期结果：
    ///   - 断言 A：200 不再是 INFO/WARN，说明成功轮询不会进入默认 info 日志
    ///   - 断言 B：307 不再是 INFO/WARN，说明非错误响应同样保持低噪声
    ///   - 断言 C：401 是 WARN，说明认证问题仍会被默认 `msctl logs` 看见
    ///   - 断言 D：500 是 WARN，说明服务端错误仍会被默认 `msctl logs` 看见
    #[test]
    fn test_http_trace_success_statuses_are_debug_errors_warn() {
        assert_eq!(
            http_trace::log_level_for_status(StatusCode::OK),
            Level::DEBUG,
            "200 OK http_request should be DEBUG so successful polling is hidden at default info"
        );
        assert_eq!(
            http_trace::log_level_for_status(StatusCode::TEMPORARY_REDIRECT),
            Level::DEBUG,
            "307 redirect should remain DEBUG because it is not an HTTP error"
        );
        assert_eq!(
            http_trace::log_level_for_status(StatusCode::UNAUTHORIZED),
            Level::WARN,
            "401 Unauthorized should stay WARN so auth failures remain visible"
        );
        assert_eq!(
            http_trace::log_level_for_status(StatusCode::INTERNAL_SERVER_ERROR),
            Level::WARN,
            "500 Internal Server Error should stay WARN so server failures remain visible"
        );
    }
}
