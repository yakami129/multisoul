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

/// HTTP POST must not overwrite an existing runtime pending ask in the same conversation.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime channel     = create_answer_channel("conv-1")（Claude/runtime 正在等待）
///   runtime pending id  = runtime-ask（由 begin_waiting_answer 手动模拟）
///   HTTP ask_id         = http-ask（POST route 创建 HTTP waiter 并记录问题卡片）
///   channel capacity    = 1（runtime_rx 应能接收 runtime-ask answer）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. runtime 创建 answer channel 并设置 pending_ask_id=runtime-ask
///   2. HTTP POST /api/v1/ask-question 记录 http-ask
///   3. POST 的 shared recording 逻辑不得调用 begin_waiting_answer 覆盖 runtime-ask
///   4. state.send_answer("runtime-ask") 应路由到 runtime_rx
///
/// 预期结果：
///   - 断言 A：HTTP POST 返回 200 pending，说明 http-ask 正常记录
///   - 断言 B：runtime answer Accepted，说明 runtime pending ask 未被 http-ask 覆盖
///   - 断言 C：runtime_rx 收到 runtime-ask，说明 runtime channel 未被 clobber
///   - 断言 D：runtime_rx 收到的 choice_id == runtime，说明 answer payload 未串线
#[tokio::test]
async fn post_http_ask_preserves_existing_runtime_pending_ask() {
    let state = test_state();
    let app = build_router(state.clone()).await;
    let runtime_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "runtime-ask");

    let post_resp = post_ask(&app, "http-ask").await;
    let post_status = post_resp.status();
    let post_json = response_json(post_resp).await;
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "runtime-ask".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive runtime-ask after HTTP POST");

    assert_eq!(
        post_status,
        StatusCode::OK,
        "HTTP POST must still record http-ask successfully"
    );
    assert_eq!(
        post_json["status"].as_str(),
        Some("pending"),
        "HTTP POST response must report pending for http-ask"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "runtime-ask answer must remain Accepted after HTTP POST"
    );
    assert_eq!(
        delivered._ask_id, "runtime-ask",
        "runtime_rx must receive the original runtime ask id"
    );
    assert_eq!(
        delivered.choice_id.as_deref(),
        Some("runtime"),
        "runtime_rx must receive the runtime answer choice, not the HTTP ask"
    );
}

/// Duplicate HTTP POST for the same ask id is rejected before recording a second message.
///
/// 数据构造（含关键数值的推导过程）：
///   first POST ask_id   = ask-dup（creates one HTTP waiter and one ask_question row）
///   second POST ask_id  = ask-dup（same conversation_id + ask_id while waiter is live）
///   expected rows       = 1（duplicate must not insert another ask_question message）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST ask-dup 第一次返回 pending 并写入 DB
///   2. POST ask-dup 第二次应检测 live HTTP waiter 冲突
///   3. 第二次返回 409 ask_already_pending，且不调用 record_ask_question
///   4. 查询 DB 中 ask-dup 的 ask_question rows
///
/// 预期结果：
///   - 断言 A：第一次 POST 返回 200 pending
///   - 断言 B：第二次 POST 返回 409，说明 duplicate live waiter 被拒绝
///   - 断言 C：第二次 response.error == ask_already_pending，说明冲突原因明确
///   - 断言 D：DB 中 ask-dup row count == 1，说明 duplicate 未写入 timeline
#[tokio::test]
async fn duplicate_http_ask_post_returns_conflict_without_duplicate_message() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let first = post_ask(&app, "ask-dup").await;
    let first_status = first.status();
    let first_json = response_json(first).await;
    let second = post_ask(&app, "ask-dup").await;
    let second_status = second.status();
    let second_json = response_json(second).await;
    let duplicate_count = ask_message_count(&state, "ask-dup");

    assert_eq!(
        first_status,
        StatusCode::OK,
        "first POST ask-dup must be accepted"
    );
    assert_eq!(
        first_json["status"].as_str(),
        Some("pending"),
        "first POST ask-dup must return pending"
    );
    assert_eq!(
        second_status,
        StatusCode::CONFLICT,
        "second POST for the same live ask id must return 409"
    );
    assert_eq!(
        second_json["error"].as_str(),
        Some("ask_already_pending"),
        "duplicate POST must identify ask_already_pending"
    );
    assert_eq!(
        duplicate_count, 1,
        "duplicate POST must not insert a second ask_question row for ask-dup"
    );
}

/// HTTP POST for the same ask id as a runtime pending ask is rejected.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime channel      = create_answer_channel("conv-1")（Claude/runtime 正在等待）
///   runtime pending id   = ask-collision
///   HTTP POST ask_id     = ask-collision（与 runtime pending ask 完全相同）
///   expected DB rows     = 0（HTTP POST 被拒绝，不应记录 ask_question）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. runtime 创建 answer channel 并设置 pending_ask_id=ask-collision
///   2. HTTP POST /api/v1/ask-question 尝试创建同 ask_id 的 HTTP waiter
///   3. route 应在创建 HTTP waiter 前检测 runtime ownership 并返回 409
///   4. state.send_answer("ask-collision") 应仍路由到 runtime_rx
///
/// 预期结果：
///   - 断言 A：HTTP POST 返回 409，说明 runtime-owned ask 不可被 HTTP 接管
///   - 断言 B：response.error == ask_owned_by_runtime，说明冲突原因明确
///   - 断言 C：runtime answer Accepted，说明 runtime waiter 未被 HTTP waiter 抢占
///   - 断言 D：runtime_rx 收到 ask-collision，说明 answer 未路由到 HTTP map
///   - 断言 E：DB 中 ask-collision row count == 0，说明 rejected POST 未写 timeline
#[tokio::test]
async fn post_http_ask_rejects_same_id_as_runtime_pending_ask() {
    let state = test_state();
    let app = build_router(state.clone()).await;
    let runtime_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "ask-collision");

    let post_resp = post_ask(&app, "ask-collision").await;
    let post_status = post_resp.status();
    let post_json = response_json(post_resp).await;
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-collision".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive ask-collision after rejected HTTP POST");
    let ask_count = ask_message_count(&state, "ask-collision");

    assert_eq!(
        post_status,
        StatusCode::CONFLICT,
        "HTTP POST must reject an ask id currently owned by runtime"
    );
    assert_eq!(
        post_json["error"].as_str(),
        Some("ask_owned_by_runtime"),
        "runtime-owned collision must return error=ask_owned_by_runtime"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "runtime answer must still be accepted after rejected HTTP collision"
    );
    assert_eq!(
        delivered._ask_id, "ask-collision",
        "runtime_rx must receive ask-collision instead of the answer going to HTTP"
    );
    assert_eq!(
        ask_count, 0,
        "rejected HTTP collision must not insert an ask_question row"
    );
}

/// Runtime recording for an ask id already posted over HTTP takes ownership back from HTTP.
///
/// 数据构造（含关键数值的推导过程）：
///   HTTP POST ask_id    = ask-reverse（creates stored HTTP sender+receiver）
///   runtime channel     = create_answer_channel("conv-1") after HTTP POST
///   runtime record id   = ask-reverse（same conversation_id + ask_id as HTTP waiter）
///   expected GET status = 409（runtime record removes HTTP waiter, so HTTP wait unavailable）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. HTTP POST /api/v1/ask-question 创建 ask-reverse stored waiter
///   2. runtime 创建 answer channel，并调用 record_ask_question 记录同 ask_id
///   3. runtime record path 应在 begin_waiting_answer 前移除同 key HTTP waiter
///   4. state.send_answer("ask-reverse") 应 fall through 到 runtime answer_txs
///   5. GET /api/v1/answer/ask-reverse 应返回 answer_wait_unavailable，而不是 answered
///
/// 预期结果：
///   - 断言 A：HTTP POST 返回 200 pending，说明先前 HTTP waiter 确实存在
///   - 断言 B：runtime record 返回 true，说明 runtime ask 正常记录
///   - 断言 C：send_answer Accepted，说明 answer 被 runtime path 接收
///   - 断言 D：runtime_rx 收到 ask-reverse，说明 HTTP waiter 没有偷走 answer
///   - 断言 E：GET 返回 409/error=answer_wait_unavailable，说明 HTTP waiter 已被移除
#[tokio::test]
async fn runtime_record_removes_existing_http_waiter_for_same_ask_id() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let post_resp = post_ask(&app, "ask-reverse").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "HTTP POST must create ask-reverse waiter before runtime records the same ask id"
    );
    let runtime_rx = state.create_answer_channel("conv-1");
    let payload = serde_json::json!({
        "ask_id": "ask-reverse",
        "questions": [{"id":"0","text":"Runtime owns?","options":[{"id":"runtime","label":"Runtime"}]}],
        "allow_freeform": false
    });
    let recorded = crate::serve::ask_question::record_ask_question(&state, "conv-1", payload);
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-reverse".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive ask-reverse after runtime record takes ownership");
    let get_resp = get_answer(&app, "ask-reverse").await;
    let get_status = get_resp.status();
    let get_json = response_json(get_resp).await;

    assert!(
        recorded,
        "runtime record_ask_question must succeed for ask-reverse"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "ask-reverse answer must be accepted by runtime after ownership transfer"
    );
    assert_eq!(
        delivered._ask_id, "ask-reverse",
        "runtime_rx must receive ask-reverse instead of HTTP stored receiver"
    );
    assert_eq!(
        get_status,
        StatusCode::CONFLICT,
        "HTTP GET after runtime ownership transfer must return 409"
    );
    assert_eq!(
        get_json["error"].as_str(),
        Some("answer_wait_unavailable"),
        "HTTP GET must show the HTTP waiter was removed by runtime ownership transfer"
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

async fn get_answer(app: &axum::Router, ask_id: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(format!(
                    "/api/v1/answer/{ask_id}?conversation_id=conv-1&timeout=1"
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

fn ask_message_count(state: &AppState, ask_id: &str) -> i64 {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT COUNT(*) FROM messages
         WHERE conversation_id = 'conv-1'
           AND role = 'ask_question'
           AND json_extract(payload, '$.ask_id') = ?1",
        [ask_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn test_state() -> AppState {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("ask-isolation-route.db")).unwrap();
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
