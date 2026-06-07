use crate::{
    db,
    serve::{build_router, plugin::PluginManager, state::AppState},
};
use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use tower::ServiceExt;

/// Ask-question route without Bearer token is rejected before handler execution.
///
/// 数据构造（含关键数值的推导过程）：
///   token              = ms_v2_tok（test_state 中配置的唯一合法 token）
///   request body bytes = 2（"{}"，足以构造 JSON 请求但不影响 auth）
///   Authorization      = none（模拟未认证 runtime CLI）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. build_router(state) 将 /api/v1/ask-question 注册在 authed_router
///   2. 发送不带 Authorization header 的 POST 请求
///   3. bearer_auth 在进入 ask_question handler 前拒绝请求
///
/// 预期结果：
///   - 断言 A：返回 401，说明 HTTP ask-question 不会成为公开路由
///   - 断言 B：不返回 501，说明未认证请求没有进入 stub handler
#[tokio::test]
async fn ask_question_without_bearer_returns_401() {
    let state = test_state();
    let app = build_router(state).await;

    let resp = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/ask-question")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "POST /api/v1/ask-question without Bearer token must return 401"
    );
    assert_ne!(
        resp.status(),
        StatusCode::NOT_IMPLEMENTED,
        "unauthenticated ask-question request must be rejected before reaching the handler"
    );
}

/// POST ask-question records a user-message-mode ask_question timeline message.
///
/// 数据构造（含关键数值的推导过程）：
///   messages before     = 0 rows（conv-1 初始没有消息）
///   questions           = 1 item，id=0，options=1 item
///   allow_freeform      = false（HTTP route 固定关闭自由输入）
///   expected seq        = MAX(existing seq 0) + 1 = 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 带 Bearer token POST ask_id=ask-http 到 /api/v1/ask-question
///   2. route 校验 ask_id、conversation_id、questions 非空
///   3. route 写入 response_mode=user_message 的 ask_question message
///   4. route 返回 JSON pending response
///
/// 预期结果：
///   - 断言 A：HTTP 200，说明请求被接受
///   - 断言 B：response.status == pending，说明 runtime CLI 可立即继续等待 answer
///   - 断言 C：DB 中 ask_question row 正好 1 条，说明没有重复写入
///   - 断言 D：payload.ask_id == ask-http，说明 ask id 被保存
///   - 断言 E：payload.allow_freeform == false，说明 route 强制关闭自由输入
///   - 断言 F：agent_text row 为 0，说明问题卡片不会被误写成普通文本
///   - 断言 G：payload.response_mode == user_message，说明 iOS answer 会注入 user_text
#[tokio::test]
async fn post_ask_question_records_pending_ask() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let resp = post_ask(&app, "ask-http").await;
    let status = resp.status();
    let json = response_json(resp).await;
    let db = state.db.lock().unwrap();
    let ask_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-1' AND role='ask_question'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let stored_ask_id: Option<String> = db
        .query_row(
            "SELECT json_extract(payload, '$.ask_id') FROM messages WHERE conversation_id='conv-1' AND role='ask_question'",
            [],
            |r| r.get(0),
        )
        .ok();
    let stored_allow_freeform: Option<bool> = db
        .query_row(
            "SELECT json_extract(payload, '$.allow_freeform') FROM messages WHERE conversation_id='conv-1' AND role='ask_question'",
            [],
            |r| r.get(0),
        )
        .ok();
    let agent_text_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-1' AND role='agent_text'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let response_mode: Option<String> = db
        .query_row(
            "SELECT json_extract(payload, '$.response_mode') FROM messages WHERE conversation_id='conv-1' AND role='ask_question'",
            [],
            |r| r.get(0),
        )
        .ok();
    drop(db);

    assert_eq!(
        status,
        StatusCode::OK,
        "valid ask-question POST must return 200 after recording the ask"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("pending"),
        "accepted ask-question response must report pending status"
    );
    assert_eq!(
        ask_count, 1,
        "POST /api/v1/ask-question must insert exactly one ask_question row"
    );
    assert_eq!(
        stored_ask_id.as_deref(),
        Some("ask-http"),
        "stored ask_question payload must preserve the submitted ask_id"
    );
    assert_eq!(
        stored_allow_freeform,
        Some(false),
        "stored ask_question payload must force allow_freeform=false"
    );
    assert_eq!(
        agent_text_count, 0,
        "ask-question route must not write question cards as agent_text"
    );
    assert_eq!(
        response_mode.as_deref(),
        Some("user_message"),
        "HTTP ask-question payload must mark answers for user message injection"
    );
}

/// Removed GET answer route is unavailable after creating an HTTP ask.
///
/// 数据构造（含关键数值的推导过程）：
///   POST ask_id       = ask-http（创建真实 msctl ask card）
///   removed endpoint  = /api/v1/answer/ask-http（旧 long-poll answer API）
///   expected status   = 404（路由不再注册，而不是 200/409/408 业务响应）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST /api/v1/ask-question 创建 ask-http
///   2. GET /api/v1/answer/ask-http?conversation_id=conv-1&timeout=1
///   3. router 不应再匹配旧 answer endpoint
///
/// 预期结果：
///   - 断言 A：POST 返回 200，说明 ask 本身创建成功
///   - 断言 B：GET 返回 404，说明旧 HTTP GET answer 模式已移除
///   - 断言 C：GET 不返回 409，说明不是旧 handler 的 answer_wait_unavailable
#[tokio::test]
async fn get_answer_route_is_removed_after_http_ask_post() {
    let state = test_state();
    let app = build_router(state).await;
    let post_resp = post_ask(&app, "ask-http").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "POST must still create ask-http before probing the removed GET route"
    );

    let get_resp = get_answer(&app, "ask-http", 1).await;
    assert_eq!(
        get_resp.status(),
        StatusCode::NOT_FOUND,
        "GET /api/v1/answer/:ask_id must be removed from the router"
    );
    assert_ne!(
        get_resp.status(),
        StatusCode::CONFLICT,
        "removed GET answer route must not run the old answer_wait_unavailable handler"
    );
}

async fn post_ask(app: &axum::Router, ask_id: &str) -> axum::response::Response {
    let body = serde_json::json!({
        "ask_id": ask_id,
        "conversation_id": "conv-1",
        "questions": [
            {
                "id": "0",
                "text": "Deploy now?",
                "options": [{"id": "ship", "label": "Ship"}],
                "multi_select": false
            }
        ]
    });
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/v1/ask-question")
                .header("authorization", "Bearer ms_v2_tok")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_answer(app: &axum::Router, ask_id: &str, timeout: u64) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v1/answer/{ask_id}?conversation_id=conv-1&timeout={timeout}"
                ))
                .header("authorization", "Bearer ms_v2_tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn response_json(resp: axum::response::Response) -> Value {
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
}

fn test_state() -> AppState {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("ask-route.db")).unwrap();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
         VALUES ('agent-1', 'Agent One', '/tmp/project', 'codex', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-1', 'agent-1', 'Deploy', 10, 20, 'running')",
        [],
    )
    .unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(
            db::open_at(&dir.path().join("plugin.db")).unwrap(),
        ))),
    )
}
