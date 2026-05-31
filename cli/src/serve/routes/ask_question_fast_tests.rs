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

/// Fast mobile answer sent after POST but before GET is buffered and returned.
///
/// 数据构造（含关键数值的推导过程）：
///   POST ask_id         = ask-fast（创建 HTTP ask 并广播问题卡片）
///   send_answer timing  = POST 之后、GET 之前（复现 race 窗口）
///   answer channel cap  = 1（一个 pending HTTP ask 只需要缓存一个 mobile answer）
///   GET timeout         = 1 second（答案已缓存，应立即返回，不应等到超时）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST /api/v1/ask-question 记录 ask-fast
///   2. 立即调用 state.send_answer("ask-fast") 模拟 mobile 快速点击
///   3. GET /api/v1/answer/ask-fast 取得 POST 阶段创建的 receiver
///   4. handler 从 receiver 读到已缓存 answer 并返回 answered
///
/// 预期结果：
///   - 断言 A：send_answer Accepted，说明 POST 阶段已经注册可接收 answer 的 channel
///   - 断言 B：GET 返回 200，说明 fast answer 没有丢失成 timeout
///   - 断言 C：response.status == answered，说明 runtime CLI 收到答案
///   - 断言 D：answers.0 == ship，说明 choice_id 被映射为 {"0":"ship"}
#[tokio::test]
async fn post_then_fast_mobile_answer_before_get_is_returned() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let post_resp = post_ask(&app, "ask-fast").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "POST must accept ask-fast before mobile can answer it"
    );
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-fast".to_string(),
            choice_id: Some("ship".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );

    let resp = get_answer(&app, "ask-fast", 1).await;
    let status = resp.status();
    let json = response_json(resp).await;

    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "fast mobile answer after POST must be accepted before GET starts waiting"
    );
    assert_eq!(
        status,
        StatusCode::OK,
        "GET answer must return 200 for a mobile answer buffered between POST and GET"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("answered"),
        "fast-answer response must report answered status"
    );
    assert_eq!(
        json["answers"]["0"].as_str(),
        Some("ship"),
        "choice_id fast answer must be mapped to answers.0"
    );
}

/// Empty freeform answer takes precedence over choice_id fallback.
///
/// 数据构造（含关键数值的推导过程）：
///   POST ask_id         = ask-empty-freeform（创建 HTTP ask 并注册 stored receiver）
///   AnswerPayload       = freeform Some("") + choice_id Some("fallback")
///   expected answers    = {"0": ""}（freeform 字段存在，因此即使为空也优先）
///   forbidden fallback  = "fallback"（只有 freeform 缺失时才可使用 choice_id）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST /api/v1/ask-question 记录 ask-empty-freeform
///   2. state.send_answer 发送 freeform=Some("") 且 choice_id=Some("fallback")
///   3. GET /api/v1/answer/ask-empty-freeform 读取已缓存 answer
///   4. answer_map 应按 freeform presence 生成 answers.0，而不是按非空过滤
///
/// 预期结果：
///   - 断言 A：send_answer Accepted，说明 answer 已进入 HTTP ask receiver
///   - 断言 B：HTTP 200，说明 GET 成功取到 answer
///   - 断言 C：response.status == answered，说明 runtime CLI 可继续执行
///   - 断言 D：answers.0 == ""，说明空 freeform 被作为真实答案返回
///   - 断言 E：answers.0 != fallback，说明 presence of freeform 阻止 choice_id fallback
#[tokio::test]
async fn empty_freeform_answer_does_not_fall_back_to_choice_id() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let post_resp = post_ask(&app, "ask-empty-freeform").await;
    assert_eq!(
        post_resp.status(),
        StatusCode::OK,
        "POST must accept ask-empty-freeform before mobile can answer it"
    );
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-empty-freeform".to_string(),
            choice_id: Some("fallback".to_string()),
            choice_ids: None,
            freeform: Some(String::new()),
        },
    );

    let resp = get_answer(&app, "ask-empty-freeform", 1).await;
    let status = resp.status();
    let json = response_json(resp).await;

    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "empty freeform answer must be accepted by the pending HTTP ask receiver"
    );
    assert_eq!(
        status,
        StatusCode::OK,
        "GET answer must return 200 after receiving the empty freeform answer"
    );
    assert_eq!(
        json["status"].as_str(),
        Some("answered"),
        "empty freeform answer response must report answered status"
    );
    assert_eq!(
        json["answers"]["0"].as_str(),
        Some(""),
        "answers.0 must preserve an explicitly present empty freeform answer"
    );
    assert_ne!(
        json["answers"]["0"].as_str(),
        Some("fallback"),
        "answers.0 must not fall back to choice_id when freeform is present but empty"
    );
}

/// HTTP GET for a runtime-owned ask must not replace the runtime answer channel.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime channel       = create_answer_channel("conv-1")（Claude/runtime 正在等待）
///   runtime ask_id        = ask-runtime（通过 shared record_ask_question 记录，不走 HTTP POST）
///   HTTP stored receiver  = none（没有 create_stored_answer_channel）
///   GET timeout           = 1 second（应立即返回 409，不应创建 HTTP wait）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. runtime 创建 answer channel 并持有 runtime_rx
///   2. record_ask_question 写入 ask-runtime，并设置 runtime pending ask
///   3. HTTP GET /api/v1/answer/ask-runtime 尝试等待非 HTTP ask
///   4. route 应返回 answer_wait_unavailable，且不能调用 create_answer_channel 覆盖 runtime channel
///   5. state.send_answer("ask-runtime") 应仍投递到 runtime_rx
///
/// 预期结果：
///   - 断言 A：HTTP 409，说明 GET 不会 arm runtime/Claude ask
///   - 断言 B：error == answer_wait_unavailable，说明失败原因明确
///   - 断言 C：send_answer Accepted，说明 runtime pending ask 仍存在
///   - 断言 D：runtime_rx 收到 ask-runtime，说明 runtime channel 未被 HTTP GET clobber
#[tokio::test]
async fn get_runtime_owned_ask_does_not_replace_runtime_channel() {
    let state = test_state();
    let app = build_router(state.clone()).await;
    let runtime_rx = state.create_answer_channel("conv-1");
    let payload = serde_json::json!({
        "ask_id": "ask-runtime",
        "questions": [{"id":"0","text":"Runtime?","options":[{"id":"runtime","label":"Runtime"}]}],
        "allow_freeform": false
    });
    let recorded = crate::serve::ask_question::record_ask_question(&state, "conv-1", payload);
    assert!(
        recorded,
        "runtime ask must be recorded before HTTP GET attempts to wait for it"
    );

    let resp = get_answer(&app, "ask-runtime", 1).await;
    let status = resp.status();
    let json = response_json(resp).await;
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-runtime".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime channel should still receive ask-runtime after HTTP GET rejection");

    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "HTTP GET for a runtime-owned ask must return 409 instead of creating a waiter"
    );
    assert_eq!(
        json["error"].as_str(),
        Some("answer_wait_unavailable"),
        "runtime-owned ask GET must explain that no HTTP waiter is available"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "runtime answer must still be accepted after HTTP GET rejection"
    );
    assert_eq!(
        delivered._ask_id, "ask-runtime",
        "runtime_rx must receive the original ask-runtime answer"
    );
}

/// Two HTTP asks in one conversation keep independent waiters keyed by ask id.
///
/// 数据构造（含关键数值的推导过程）：
///   POST ask-a         = first HTTP ask in conv-1
///   POST ask-b         = second HTTP ask in same conv-1
///   answer A           = choice_id "answer-a" for ask-a
///   answer B           = choice_id "answer-b" for ask-b
///   channel capacity   = 1 per ask id（two asks require two independent channels）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. POST ask-a 创建 HTTP waiter keyed by (conv-1, ask-a)
///   2. POST ask-b 创建 HTTP waiter keyed by (conv-1, ask-b)
///   3. send_answer ask-a 后 GET ask-a，应读取 answer-a
///   4. send_answer ask-b 后 GET ask-b，应读取 answer-b
///
/// 预期结果：
///   - 断言 A：ask-a answer Accepted，说明 ask-b POST 未覆盖 ask-a sender
///   - 断言 B：GET ask-a 返回 answers.0 == answer-a
///   - 断言 C：ask-b answer Accepted，说明 ask-b sender 独立可用
///   - 断言 D：GET ask-b 返回 answers.0 == answer-b
///   - 断言 E：ask-b answers.0 != answer-a，说明两个 ask 的 receiver 没有串线
#[tokio::test]
async fn two_http_asks_in_one_conversation_keep_independent_waiters() {
    let state = test_state();
    let app = build_router(state.clone()).await;

    let post_a = post_ask(&app, "ask-a").await;
    let post_b = post_ask(&app, "ask-b").await;
    assert_eq!(
        post_a.status(),
        StatusCode::OK,
        "POST ask-a must create the first HTTP waiter"
    );
    assert_eq!(
        post_b.status(),
        StatusCode::OK,
        "POST ask-b must create the second HTTP waiter in the same conversation"
    );

    let send_a = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-a".to_string(),
            choice_id: Some("answer-a".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let resp_a = get_answer(&app, "ask-a", 1).await;
    let status_a = resp_a.status();
    let json_a = response_json(resp_a).await;

    let send_b = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-b".to_string(),
            choice_id: Some("answer-b".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let resp_b = get_answer(&app, "ask-b", 1).await;
    let status_b = resp_b.status();
    let json_b = response_json(resp_b).await;

    assert!(
        matches!(send_a, AnswerSendResult::Accepted),
        "answer for ask-a must be accepted after ask-b is posted"
    );
    assert_eq!(
        status_a,
        StatusCode::OK,
        "GET ask-a must return 200 with its independent answer"
    );
    assert_eq!(
        json_a["answers"]["0"].as_str(),
        Some("answer-a"),
        "GET ask-a must return answer-a from the ask-a receiver"
    );
    assert!(
        matches!(send_b, AnswerSendResult::Accepted),
        "answer for ask-b must be accepted by its independent sender"
    );
    assert_eq!(
        status_b,
        StatusCode::OK,
        "GET ask-b must return 200 with its independent answer"
    );
    assert_eq!(
        json_b["answers"]["0"].as_str(),
        Some("answer-b"),
        "GET ask-b must return answer-b from the ask-b receiver"
    );
    assert_ne!(
        json_b["answers"]["0"].as_str(),
        Some("answer-a"),
        "GET ask-b must not read ask-a's answer from a shared conversation-level receiver"
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
    let conn = db::open_at(&dir.path().join("ask-fast-route.db")).unwrap();
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
