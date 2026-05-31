use crate::{
    db,
    serve::{
        build_router,
        interactive::AnswerPayload,
        plugin::PluginManager,
        state::{AnswerSendResult, AppState},
    },
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

/// Answer route without Bearer token is rejected before handler execution.
///
/// 数据构造（含关键数值的推导过程）：
///   token              = ms_v2_tok（test_state 中配置的唯一合法 token）
///   ask_id path        = ask-http（合法 path 形状，auth 不依赖 DB 是否存在）
///   conversation_id    = conv-1（合法 query 形状，auth 不依赖 DB 是否存在）
///   Authorization      = none（模拟未认证 runtime CLI）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. build_router(state) 将 /api/v1/answer/:ask_id 注册在 authed_router
///   2. 发送不带 Authorization header 的 GET 请求
///   3. bearer_auth 在进入 answer handler 前拒绝请求
///
/// 预期结果：
///   - 断言 A：返回 401，说明 GET answer 不会成为公开路由
///   - 断言 B：不返回 404，说明未认证请求不会泄露 ask 是否存在
#[tokio::test]
async fn answer_get_without_bearer_returns_401() {
    let state = test_state();
    let app = build_router(state).await;

    let resp = app
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/api/v1/answer/ask-http?conversation_id=conv-1&timeout=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "GET /api/v1/answer/:ask_id without Bearer token must return 401"
    );
    assert_ne!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "unauthenticated answer lookup must not reveal whether the ask exists"
    );
}

/// POST ask-question records a pending ask_question timeline message.
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
///   3. route 调用 shared record_ask_question 写入 ask_question message
///   4. route 返回 JSON pending response
///
/// 预期结果：
///   - 断言 A：HTTP 200，说明请求被接受
///   - 断言 B：response.status == pending，说明 runtime CLI 可立即继续等待 answer
///   - 断言 C：DB 中 ask_question row 正好 1 条，说明没有重复写入
///   - 断言 D：payload.ask_id == ask-http，说明 ask id 被保存
///   - 断言 E：payload.allow_freeform == false，说明 route 强制关闭自由输入
///   - 断言 F：agent_text row 为 0，说明问题卡片不会被误写成普通文本
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
}

/// GET answer waits for and returns the mobile answer matching the pending ask id.
///
/// 数据构造（含关键数值的推导过程）：
///   timeout query       = 2 seconds（足够覆盖本测试 50ms 延迟）
///   send delay          = 50ms（先确保 GET handler 注册 pending ask）
///   choice_ids          = {"0":"approve","1":"notify"}（两题答案原样返回）
///   expected answer map = choice_ids 原样，无 freeform/choice_id 降级
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST ask-http 创建可等待的 HTTP ask
///   2. GET /api/v1/answer/ask-http?conversation_id=conv-1&timeout=2
///   3. 测试线程调用 state.send_answer 发送同 ask_id 的 mobile answer
///   4. handler 用 recv_timeout 收到 answer，并清理 pending ask
///
/// 预期结果：
///   - 断言 A：send_answer Accepted，说明 GET handler 注册了正确 pending ask
///   - 断言 B：HTTP 200，说明等待成功而非超时
///   - 断言 C：response.status == answered，说明 runtime CLI 可继续执行
///   - 断言 D：answers.0 == approve 且 answers.1 == notify，说明 choice_ids 原样返回
///   - 断言 E：answers.2 不存在，说明没有伪造额外答案
#[tokio::test]
async fn get_answer_returns_matching_mobile_answer() {
    let state = test_state();
    let app = build_router(state.clone()).await;
    let post_resp = post_ask(&app, "ask-http").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "POST must create ask-http before GET can wait for its answer"
    );
    let send_state = state.clone();
    let sender = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(50));
        send_state.send_answer(
            "conv-1",
            AnswerPayload {
                _ask_id: "ask-http".to_string(),
                choice_id: None,
                choice_ids: Some(
                    [
                        ("0".to_string(), "approve".to_string()),
                        ("1".to_string(), "notify".to_string()),
                    ]
                    .into_iter()
                    .collect(),
                ),
                freeform: None,
            },
        )
    });

    let resp = get_answer(&app, "ask-http", 2).await;
    let send_result = sender
        .join()
        .expect("answer sender thread should complete without panic");
    let status = resp.status();
    let json = response_json(resp).await;

    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "mobile answer must be accepted after GET handler registers ask-http as pending"
    );
    assert_eq!(
        status,
        StatusCode::OK,
        "GET answer must return 200 when the matching mobile answer arrives before timeout"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("answered"),
        "successful answer response must report answered status"
    );
    assert_eq!(
        json["answers"]["0"].as_str(),
        Some("approve"),
        "choice_ids answer for question 0 must be returned as-is"
    );
    assert_eq!(
        json["answers"]["1"].as_str(),
        Some("notify"),
        "choice_ids answer for question 1 must be returned as-is"
    );
    assert!(
        json["answers"].get("2").is_none(),
        "answer response must not invent answers that mobile did not send"
    );
}

/// GET answer for an unknown ask returns a client-visible not found error.
///
/// 数据构造（含关键数值的推导过程）：
///   messages before = 0 ask_question rows（没有 POST unknown-ask）
///   ask_id path     = unknown-ask
///   timeout query   = 1 second（不应等待到 timeout，因为 ask 不存在）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/answer/unknown-ask?conversation_id=conv-1&timeout=1
///   2. handler 查询 messages 中是否存在 payload.ask_id=unknown-ask 的 ask_question
///   3. 未找到时直接返回 404 ask_not_found，不创建 pending answer
///
/// 预期结果：
///   - 断言 A：HTTP 404，说明未知 ask 不会被任意 arm
///   - 断言 B：response.status == error，说明客户端可识别失败
///   - 断言 C：response.error == ask_not_found，说明失败原因明确
///   - 断言 D：后续 send_answer 不 Accepted，说明未知 ask 没有被注册为 pending
#[tokio::test]
async fn get_answer_unknown_ask_returns_404() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let resp = get_answer(&app, "unknown-ask", 1).await;
    let status = resp.status();
    let json = response_json(resp).await;
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "unknown-ask".to_string(),
            choice_id: Some("ship".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );

    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "GET answer for an ask_id with no ask_question message must return 404"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("error"),
        "unknown ask response must report error status"
    );
    assert_eq!(
        json["error"].as_str(),
        Some("ask_not_found"),
        "unknown ask response must include error=ask_not_found"
    );
    assert!(
        !matches!(send_result, AnswerSendResult::Accepted),
        "unknown ask lookup must not register a pending answer channel"
    );
}

/// GET answer returns timeout and clears pending state when no mobile answer arrives.
///
/// 数据构造（含关键数值的推导过程）：
///   POST ask_id      = ask-timeout（先创建真实 ask_question，避免 unknown ask 分支）
///   timeout query    = 1 second（route clamps timeout to minimum 1）
///   sent answers     = 0 before timeout（不调用 send_answer）
///   cleanup probe    = send_answer("ask-timeout") after timeout should not be Accepted
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST /api/v1/ask-question 创建 ask-timeout
///   2. GET /api/v1/answer/ask-timeout?conversation_id=conv-1&timeout=1
///   3. 没有 mobile answer 进入 channel，recv_timeout 到期
///   4. handler 清理 pending ask 和 HTTP stored receiver
///   5. timeout 后再发送 ask-timeout answer，不能被 Accepted
///
/// 预期结果：
///   - 断言 A：HTTP 408，说明 timeout 不会伪装成成功 answer
///   - 断言 B：response.status == error，说明客户端可识别失败
///   - 断言 C：response.error == timeout，说明失败原因明确
///   - 断言 D：answers 不存在，说明 timeout 不会返回空成功答案
///   - 断言 E：timeout 后 send_answer 不 Accepted，说明 pending state 已清理
#[tokio::test]
async fn get_answer_times_out_without_mobile_answer() {
    let state = test_state();
    let app = build_router(state.clone()).await;
    let post_resp = post_ask(&app, "ask-timeout").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "POST must create ask-timeout before timeout behavior is tested"
    );

    let resp = get_answer(&app, "ask-timeout", 1).await;
    let status = resp.status();
    let json = response_json(resp).await;
    let late_send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-timeout".to_string(),
            choice_id: Some("ship".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );

    assert_eq!(
        status,
        StatusCode::REQUEST_TIMEOUT,
        "GET answer without a mobile answer must return HTTP 408"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("error"),
        "timeout response must report error status"
    );
    assert_eq!(
        json["error"].as_str(),
        Some("timeout"),
        "timeout response must include error=timeout"
    );
    assert!(
        json.get("answers").is_none(),
        "timeout response must not include answers because no mobile answer arrived"
    );
    assert!(
        matches!(late_send_result, AnswerSendResult::NoSession),
        "late mobile answer after HTTP timeout must see NoSession because route-owned waiter state was removed"
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
