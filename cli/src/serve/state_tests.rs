use crate::{
    db,
    serve::{
        interactive::AnswerPayload,
        plugin::PluginManager,
        state::{AnswerSendResult, AppState, StoredAnswerCreateResult},
    },
};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

/// HTTP waiter creation rejects an ask id already owned by a runtime pending channel.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime channel       = create_answer_channel("conv-1")
///   runtime pending id    = ask-race（begin_waiting_answer 写入 answer_txs[conv-1]）
///   HTTP waiter ask_id    = ask-race（same conversation_id + ask_id）
///   channel capacity      = 1（runtime_rx 应能接收一个 answer）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 创建 runtime receiver
///   2. begin_waiting_answer("conv-1", "ask-race") 标记 runtime ownership
///   3. create_stored_answer_channel("conv-1", "ask-race") 尝试创建 HTTP waiter
///   4. send_answer("ask-race") 应继续路由到 runtime receiver
///
/// 预期结果：
///   - 断言 A：create_stored_answer_channel 返回 OwnedByRuntime，说明原子创建拒绝 runtime-owned ask
///   - 断言 B：send_answer Accepted，说明 runtime pending ask 未被 HTTP waiter 抢占
///   - 断言 C：runtime_rx 收到 ask-race，说明 answer 落在 runtime channel
///   - 断言 D：runtime_rx 收到 choice_id == runtime，说明 answer payload 未串线
#[test]
fn stored_answer_channel_creation_rejects_runtime_owned_ask_id() {
    let state = test_state();
    let runtime_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "ask-race");

    let create_result = state.create_stored_answer_channel("conv-1", "ask-race");
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-race".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive ask-race after HTTP waiter creation is rejected");

    assert_eq!(
        create_result,
        StoredAnswerCreateResult::OwnedByRuntime,
        "HTTP waiter creation must reject an ask id currently owned by runtime"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "runtime answer must remain Accepted after HTTP waiter creation is rejected"
    );
    assert_eq!(
        delivered._ask_id, "ask-race",
        "runtime_rx must receive the runtime-owned ask id"
    );
    assert_eq!(
        delivered.choice_id.as_deref(),
        Some("runtime"),
        "runtime_rx must receive the runtime answer choice"
    );
}

/// Runtime pending answer wins when an old HTTP waiter exists for the same ask id.
///
/// 数据构造（含关键数值的推导过程）：
///   HTTP waiter key      = "conv-1\nask-race"（conversation_id + "\n" + ask_id）
///   runtime channel      = create_answer_channel("conv-1")
///   runtime pending id   = ask-race（begin_waiting_answer 写入 answer_txs[conv-1]）
///   channel capacities   = 1（HTTP 与 runtime 都最多接收一个 answer）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 创建 runtime receiver
///   2. begin_waiting_answer("conv-1", "ask-race") 标记 runtime pending ask
///   3. 手动插入 stored_answer_txs["conv-1\nask-race"]，模拟 cleanup 竞争后两边同时存在
///   4. send_answer("ask-race") 必须优先检查 runtime ownership 并投递 runtime_rx
///
/// 预期结果：
///   - 断言 A：send_answer 返回 Accepted，说明 answer 被合法接收
///   - 断言 B：runtime_rx 收到 ask-race，说明 runtime pending ownership 优先
///   - 断言 C：runtime_rx 收到 choice_id == runtime，说明 payload 未串线
///   - 断言 D：http_rx 不应收到 answer，说明旧 HTTP waiter 没有抢走 runtime answer
#[test]
fn send_answer_routes_to_runtime_when_runtime_and_http_waiters_overlap() {
    let state = test_state();
    let runtime_rx = state.create_answer_channel("conv-1");
    let (http_tx, http_rx) = std::sync::mpsc::sync_channel(1);
    state.begin_waiting_answer("conv-1", "ask-race");
    state
        .stored_answer_txs
        .lock()
        .unwrap()
        .insert("conv-1\nask-race".to_string(), http_tx);

    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-race".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive ask-race when runtime and HTTP waiters overlap");
    let http_result = http_rx.try_recv();

    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "overlapping runtime-owned answer should be Accepted"
    );
    assert_eq!(
        delivered._ask_id, "ask-race",
        "runtime_rx must receive the runtime-owned ask id"
    );
    assert_eq!(
        delivered.choice_id.as_deref(),
        Some("runtime"),
        "runtime_rx must receive the runtime answer choice"
    );
    assert!(
        http_result.is_err(),
        "HTTP waiter must not receive an answer once runtime owns the same ask id"
    );
}

/// HTTP waiter receives its answer when the runtime channel exists but is idle.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime channel      = create_answer_channel("conv-1")
///   runtime pending id   = None（不调用 begin_waiting_answer）
///   HTTP waiter ask_id   = ask-http（create_stored_answer_channel 创建）
///   channel capacities   = 1（HTTP 与 runtime 都最多接收一个 answer）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 创建 idle runtime receiver
///   2. create_stored_answer_channel("conv-1", "ask-http") 创建 HTTP waiter
///   3. send_answer("ask-http") 应跳过 idle runtime 并投递精确匹配的 HTTP waiter
///   4. take_stored_answer_receiver("conv-1", "ask-http") 读取 HTTP receiver
///
/// 预期结果：
///   - 断言 A：HTTP waiter 创建成功，说明 idle runtime 不拥有 ask-http
///   - 断言 B：send_answer 返回 Accepted，说明 HTTP waiter 接收 answer
///   - 断言 C：HTTP receiver 收到 ask-http，说明按 exact key 投递
///   - 断言 D：runtime_rx 不应收到 answer，说明 idle runtime 没有抢走 HTTP answer
#[test]
fn send_answer_routes_to_http_when_runtime_channel_is_idle() {
    let state = test_state();
    let runtime_rx = state.create_answer_channel("conv-1");

    let create_result = state.create_stored_answer_channel("conv-1", "ask-http");
    let send_result = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "ask-http".to_string(),
            choice_id: Some("http".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let http_rx = state
        .take_stored_answer_receiver("conv-1", "ask-http")
        .expect("HTTP receiver should still be claimable after answer delivery");
    let http_answer = http_rx
        .try_recv()
        .expect("HTTP receiver should receive ask-http while runtime is idle");
    let runtime_result = runtime_rx.try_recv();

    assert_eq!(
        create_result,
        StoredAnswerCreateResult::Created,
        "idle runtime channel must not block HTTP waiter creation"
    );
    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "HTTP answer should be Accepted when runtime channel is idle"
    );
    assert_eq!(
        http_answer._ask_id, "ask-http",
        "HTTP receiver must receive the exact HTTP ask id"
    );
    assert!(
        runtime_result.is_err(),
        "idle runtime receiver must not receive an HTTP-owned answer"
    );
}

/// HTTP waiter receives a different ask while runtime pending ask remains answerable.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime pending id   = runtime-ask（begin_waiting_answer 写入 answer_txs[conv-1]）
///   HTTP waiter ask_id   = http-ask（same conversation, different ask）
///   first answer         = http-ask（应进入 HTTP receiver）
///   second answer        = runtime-ask（应进入 runtime receiver）
///   channel capacities   = 1（每条 path 各接收一个 answer）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 创建 runtime receiver
///   2. begin_waiting_answer("conv-1", "runtime-ask") 标记 runtime pending ask
///   3. create_stored_answer_channel("conv-1", "http-ask") 创建不同 ask 的 HTTP waiter
///   4. send_answer("http-ask") 应投递 HTTP waiter 而不是返回 AskMismatch
///   5. send_answer("runtime-ask") 应继续投递 runtime receiver
///
/// 预期结果：
///   - 断言 A：HTTP waiter 创建成功，说明不同 ask 可并存
///   - 断言 B：http-ask Accepted 且 HTTP receiver 收到 http-ask
///   - 断言 C：runtime-ask Accepted 且 runtime_rx 收到 runtime-ask
///   - 断言 D：两个 receiver 的 choice_id 分别为 http/runtime，说明 payload 未串线
#[test]
fn send_answer_routes_to_http_for_different_ask_without_breaking_runtime_pending() {
    let state = test_state();
    let runtime_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "runtime-ask");

    let create_result = state.create_stored_answer_channel("conv-1", "http-ask");
    let http_send = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "http-ask".to_string(),
            choice_id: Some("http".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let http_rx = state
        .take_stored_answer_receiver("conv-1", "http-ask")
        .expect("HTTP receiver should exist for http-ask");
    let http_answer = http_rx
        .try_recv()
        .expect("HTTP receiver should receive http-ask");

    let runtime_send = state.send_answer(
        "conv-1",
        AnswerPayload {
            _ask_id: "runtime-ask".to_string(),
            choice_id: Some("runtime".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let runtime_answer = runtime_rx
        .try_recv()
        .expect("runtime_rx should receive runtime-ask after HTTP ask is answered");

    assert_eq!(
        create_result,
        StoredAnswerCreateResult::Created,
        "runtime pending ask must allow a distinct HTTP ask waiter"
    );
    assert!(
        matches!(http_send, AnswerSendResult::Accepted),
        "http-ask should be Accepted via exact HTTP waiter instead of AskMismatch"
    );
    assert_eq!(
        http_answer._ask_id, "http-ask",
        "HTTP receiver must receive the distinct HTTP ask id"
    );
    assert_eq!(
        http_answer.choice_id.as_deref(),
        Some("http"),
        "HTTP receiver must receive the HTTP answer choice"
    );
    assert!(
        matches!(runtime_send, AnswerSendResult::Accepted),
        "runtime-ask should remain Accepted after distinct HTTP answer"
    );
    assert_eq!(
        runtime_answer._ask_id, "runtime-ask",
        "runtime receiver must receive the runtime pending ask id"
    );
    assert_eq!(
        runtime_answer.choice_id.as_deref(),
        Some("runtime"),
        "runtime receiver must receive the runtime answer choice"
    );
}

fn test_state() -> AppState {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("state-tests.db")).unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(
            db::open_at(&dir.path().join("plugin.db")).unwrap(),
        ))),
    )
}
