use super::ws::handle_client_message;
use crate::{
    db,
    serve::{plugin::PluginManager, state::AppState},
};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use tokio::time::{timeout, Duration};

fn test_state() -> AppState {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("ws.db")).unwrap();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
         VALUES ('agent-1', 'Agent One', '/tmp/project', 'claude-code', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations
         (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-1', 'agent-1', 'Deploy', 10, 20, 'awaiting_question')",
        [],
    )
    .unwrap();
    let plugin_db = db::open_at(&dir.path().join("plugins.db")).unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    )
}

fn ask_answer_count(state: &AppState) -> i64 {
    let db = state.db.lock().unwrap();
    db.query_row("SELECT COUNT(*) FROM ask_answers", [], |r| r.get(0))
        .unwrap()
}

fn conversation_status(state: &AppState) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT status FROM conversations WHERE id = 'conv-1'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

async fn receive_answer_status(
    rx: &mut tokio::sync::broadcast::Receiver<String>,
) -> serde_json::Value {
    let event = timeout(Duration::from_millis(200), rx.recv())
        .await
        .expect("answer status should be broadcast to the client within 200ms")
        .expect("answer status broadcast should not close the conversation bus");
    serde_json::from_str(&event).unwrap()
}

/// WS answer without a waiting runtime session must stay pending and be visible to the client.
///
/// 数据构造（含关键数值的推导过程）：
///   conversation.status = awaiting_question（Activity 应继续显示 pending）
///   answer_txs          = empty（没有 runtime 正在等待 answer）
///   ask_answers         = 0 rows（初始没有任何已回答记录）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 订阅 conv-1 的 WS broadcast bus，用于观察客户端可见反馈
///   2. 发送 {"type":"answer","ask_id":"ask-1","choice_id":"0"}
///   3. send_answer 找不到 channel → 返回 NoSession
///   4. handler 发送 answer_status(ok=false)，且不写 ask_answers、不改 status
///
/// 预期结果：
///   - 断言 A：ask_answers 仍为 0，说明失败交付不会隐藏 pending ask
///   - 断言 B：conversation.status 仍为 awaiting_question，说明 Activity 仍可展示
///   - 断言 C：客户端收到 ok=false/no_waiting_session，说明失败对 mobile 可见
///   - 断言 D：客户端没有收到 ok=true，说明失败不会被误报为成功
#[tokio::test]
async fn answer_without_waiting_session_does_not_write_ask_answers() {
    let state = test_state();
    let mut rx = state.get_or_create_sender("conv-1").subscribe();

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-1","choice_id":"0"}"#,
    )
    .await;

    assert_eq!(
        ask_answer_count(&state),
        0,
        "ask_answers must remain empty when no runtime session accepted the answer"
    );
    assert_eq!(
        conversation_status(&state),
        "awaiting_question",
        "conversation must remain awaiting_question after answer delivery failure"
    );

    let json = receive_answer_status(&mut rx).await;
    assert_eq!(
        json["type"].as_str(),
        Some("answer_status"),
        "failure feedback must use the answer_status event type"
    );
    assert_eq!(
        json["ok"].as_bool(),
        Some(false),
        "answer_status.ok must be false when no waiting session exists"
    );
    assert_eq!(
        json["error"].as_str(),
        Some("no_waiting_session"),
        "failure feedback must identify no_waiting_session so mobile can keep the card pending"
    );
    assert_ne!(
        json["ok"].as_bool(),
        Some(true),
        "answer delivery failure must not be reported as a successful answer"
    );
}

/// WS answer with only a registered channel but no active pending ask must not be persisted.
///
/// 数据构造（含关键数值的推导过程）：
///   conversation.status = awaiting_question（仍需用户处理）
///   answer channel cap  = 1（runtime session 存在，但尚未调用 begin_waiting_answer）
///   pending_ask_id      = None（没有具体 AskUserQuestion 正在等待）
///   ask_answers         = 0 rows
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 只注册 channel，不设置 pending ask
///   2. 发送 {"type":"answer","ask_id":"ask-1","choice_id":"0"}
///   3. send_answer 检查 pending_ask_id=None → 返回 NoPendingAsk
///   4. handler 发送 answer_status(ok=false)，不写 ask_answers，不改 status
///
/// 预期结果：
///   - 断言 A：runtime channel 收不到 answer，说明 idle session 不会吞掉 stale answer
///   - 断言 B：ask_answers 仍为 0，说明 Activity 不会隐藏未确认 ask
///   - 断言 C：conversation.status 仍为 awaiting_question，说明 pending 仍可见
///   - 断言 D：客户端收到 no_pending_ask，而不是 ok=true
#[tokio::test]
async fn answer_with_channel_but_no_pending_ask_does_not_persist() {
    let state = test_state();
    let answer_rx = state.create_answer_channel("conv-1");
    let mut rx = state.get_or_create_sender("conv-1").subscribe();

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-1","choice_id":"0"}"#,
    )
    .await;

    assert!(
        answer_rx.try_recv().is_err(),
        "runtime channel must not receive an answer when no concrete ask is pending"
    );
    assert_eq!(
        ask_answer_count(&state),
        0,
        "ask_answers must remain empty when no pending ask id matched the answer"
    );
    assert_eq!(
        conversation_status(&state),
        "awaiting_question",
        "conversation must remain awaiting_question when answer has no pending ask match"
    );
    let json = receive_answer_status(&mut rx).await;
    assert_eq!(
        json["error"].as_str(),
        Some("no_pending_ask"),
        "answer_status.error must explain that no concrete ask was pending"
    );
    assert_ne!(
        json["ok"].as_bool(),
        Some(true),
        "answer without a pending ask id must not be acknowledged as successful"
    );
}

/// WS answer for a different ask id must not be persisted while another ask is pending.
///
/// 数据构造（含关键数值的推导过程）：
///   conversation.status = awaiting_question
///   pending_ask_id      = ask-2（runtime 当前等 ask-2）
///   incoming answer     = ask-1（过期或重复点击产生的旧 answer）
///   ask_answers         = 0 rows
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 注册 runtime answer channel
///   2. begin_waiting_answer("conv-1", "ask-2") 标记当前真实 pending ask
///   3. 发送 {"type":"answer","ask_id":"ask-1","choice_id":"0"}
///   4. send_answer 发现 expected ask-2 != actual ask-1 → 返回 AskMismatch
///   5. handler 发送 answer_status(ok=false)，不写 ask_answers、不改 status
///
/// 预期结果：
///   - 断言 A：runtime channel 收不到 ask-1，说明旧 answer 不会污染 ask-2
///   - 断言 B：ask_answers 中没有 ask-1，说明旧 ask 不会被误标已回答
///   - 断言 C：ask_answers 中没有 ask-2，说明 mismatch 不会伪造当前 ask answer
///   - 断言 D：客户端收到 ask_mismatch，且 ok != true
#[tokio::test]
async fn mismatched_answer_does_not_persist_or_reach_runtime() {
    let state = test_state();
    let answer_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "ask-2");
    let mut rx = state.get_or_create_sender("conv-1").subscribe();

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-1","choice_id":"0"}"#,
    )
    .await;

    assert!(
        answer_rx.try_recv().is_err(),
        "runtime channel must not receive an answer for a different ask_id"
    );
    let (ask_one_count, ask_two_count): (i64, i64) = {
        let db = state.db.lock().unwrap();
        let ask_one_count = db
            .query_row(
                "SELECT COUNT(*) FROM ask_answers WHERE conversation_id='conv-1' AND ask_id='ask-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ask_two_count = db
            .query_row(
                "SELECT COUNT(*) FROM ask_answers WHERE conversation_id='conv-1' AND ask_id='ask-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        (ask_one_count, ask_two_count)
    };

    assert_eq!(
        ask_one_count, 0,
        "mismatched stale ask-1 must not be persisted as answered"
    );
    assert_eq!(
        ask_two_count, 0,
        "mismatched answer must not create a fake record for current ask-2"
    );
    let json = receive_answer_status(&mut rx).await;
    assert_eq!(
        json["error"].as_str(),
        Some("ask_mismatch"),
        "answer_status.error must identify ask_mismatch for retry/debug"
    );
    assert_ne!(
        json["ok"].as_bool(),
        Some(true),
        "mismatched answer must not be acknowledged as successful"
    );
}

/// WS answer accepted by a waiting runtime session is persisted and moves the conversation back to running.
///
/// 数据构造（含关键数值的推导过程）：
///   conversation.status = awaiting_question（正在等 ask-1）
///   answer channel cap  = 1（create_answer_channel 为每个 conversation 建一个待收 answer 槽）
///   ask_answers         = 0 rows（answer 前没有持久化记录）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-1") 注册 waiting session
///   2. begin_waiting_answer("conv-1", "ask-1") 标记当前正在等待的 ask
///   3. 发送 {"type":"answer","ask_id":"ask-1","choice_id":"0","freeform":"ship"}
///   4. send_answer 成功把 payload 放入 channel
///   5. handler 写入 ask_answers，并把 conversation.status 改回 running
///
/// 预期结果：
///   - 断言 A：runtime channel 收到 ask-1，说明 answer 确实交付给等待 session
///   - 断言 B：ask_answers 中有 ask-1，说明成功交付后才持久化
///   - 断言 C：conversation.status == running，说明 pending 状态被解除
///   - 断言 D：不存在 ask-2 记录，说明只持久化当前成功交付的 ask
#[tokio::test]
async fn answer_with_waiting_session_persists_answer_and_marks_running() {
    let state = test_state();
    let answer_rx = state.create_answer_channel("conv-1");
    state.begin_waiting_answer("conv-1", "ask-1");

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-1","choice_id":"0","freeform":"ship"}"#,
    )
    .await;

    let delivered = answer_rx
        .try_recv()
        .expect("waiting runtime session should receive the accepted answer");
    assert_eq!(
        delivered._ask_id, "ask-1",
        "runtime channel must receive the same ask_id that the client answered"
    );

    let db = state.db.lock().unwrap();
    let ask_one_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ask_answers WHERE conversation_id='conv-1' AND ask_id='ask-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let ask_two_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM ask_answers WHERE conversation_id='conv-1' AND ask_id='ask-2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    drop(db);

    assert_eq!(
        ask_one_count, 1,
        "ask_answers must persist ask-1 after the runtime session accepts the answer"
    );
    assert_eq!(
        conversation_status(&state),
        "running",
        "conversation must return to running after a successful answer delivery"
    );
    assert_eq!(
        ask_two_count, 0,
        "ask_answers must not create unrelated ask rows while persisting ask-1"
    );
}
