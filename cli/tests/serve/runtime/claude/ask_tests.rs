use super::*;
use crate::serve::state::AnswerSendResult;
use tempfile::tempdir;

/// Claude AskUserQuestion recording stores the ask message and moves the conversation to awaiting_question.
///
/// 数据构造（含关键数值的推导过程）：
///   conversation.status = running（turn 已开始）
///   ask payload         = ask_id ask-1 + one question "Deploy now?"
///   messages before     = 0 rows
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 crate::serve::ask_question::record_ask_question 写入 ask_question
///   2. record_ask_question 调用 insert_message，seq 从 0 + 1 = 1
///   3. 同一 DB transaction path 更新 conversations.status 为 awaiting_question
///
/// 预期结果：
///   - 断言 A：conversation.status == awaiting_question，说明 Activity 可识别 Needs Attention
///   - 断言 B：ask_question row 存在，说明 timeline 中有 pending ask
///   - 断言 C：ask_id == ask-1，说明持久化的是 runtime 发出的具体 ask
///   - 断言 D：agent_text row 不存在，说明不会把 ask 误写成普通 agent 文本
#[test]
fn record_ask_question_marks_conversation_awaiting_question() {
    let state = make_ask_question_state();
    let payload = serde_json::json!({
        "ask_id": "ask-1",
        "questions": [{"id":"0","text":"Deploy now?","options":[{"id":"0","label":"Yes"}]}],
        "allow_freeform": false
    });

    crate::serve::ask_question::record_ask_question(&state, "conv-ask", payload);

    let db = state.db.lock().unwrap();
    let status: String = db
        .query_row(
            "SELECT status FROM conversations WHERE id = 'conv-ask'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let ask_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-ask' AND role='ask_question'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let ask_id: String = db
        .query_row(
            "SELECT json_extract(payload, '$.ask_id') FROM messages WHERE conversation_id='conv-ask'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let agent_text_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-ask' AND role='agent_text'",
            [],
            |r| r.get(0),
        )
        .unwrap();

    assert_eq!(
        status, "awaiting_question",
        "recording an ask_question must mark the conversation awaiting_question"
    );
    assert_eq!(
        ask_count, 1,
        "recording an ask_question must insert exactly one ask_question message"
    );
    assert_eq!(
        ask_id, "ask-1",
        "the stored ask_question payload must preserve the runtime ask_id"
    );
    assert_eq!(
        agent_text_count, 0,
        "record_ask_question must not write the pending ask as agent_text"
    );
}

/// Claude AskUserQuestion recording makes the ask answerable before it is visible to clients.
///
/// 数据构造（含关键数值的推导过程）：
///   answer channel cap  = 1（create_answer_channel 为当前 turn 注册 runtime session）
///   pending ask         = None（初始没有具体 ask）
///   ask payload         = ask_id ask-1 + one option "Yes"
///
/// 执行过程（逐步说明系统如何处理）：
///   1. create_answer_channel("conv-ask") 建立 runtime answer channel
///   2. record_ask_question("ask-1") 写 DB、更新状态并广播 ask_question
///   3. 立刻 send_answer("ask-1") 模拟客户端收到广播后马上点击
///
/// 预期结果：
///   - 断言 A：send_answer 返回 Accepted，说明广播前 pending ask 已经就绪
///   - 断言 B：runtime channel 收到 ask-1，说明快速回答不会被 no_pending_ask 拒绝
///   - 断言 C：runtime channel 没有 ask-2，说明只接受当前 ask
#[test]
fn record_ask_question_registers_pending_before_client_can_answer() {
    let state = make_ask_question_state();
    let answer_rx = state.create_answer_channel("conv-ask");
    let payload = serde_json::json!({
        "ask_id": "ask-1",
        "questions": [{"id":"0","text":"Deploy now?","options":[{"id":"0","label":"Yes"}]}],
        "allow_freeform": false
    });

    crate::serve::ask_question::record_ask_question(&state, "conv-ask", payload);

    let send_result = state.send_answer(
        "conv-ask",
        crate::serve::interactive::AnswerPayload {
            _ask_id: "ask-1".to_string(),
            choice_id: Some("0".to_string()),
            choice_ids: None,
            freeform: None,
        },
    );
    let delivered = answer_rx
        .try_recv()
        .expect("runtime channel should receive a fast answer for the just-recorded ask");

    assert!(
        matches!(send_result, AnswerSendResult::Accepted),
        "fast answer after ask broadcast must be accepted because pending ask is registered first"
    );
    assert_eq!(
        delivered._ask_id, "ask-1",
        "runtime channel must receive the current ask id, not reject it as no_pending_ask"
    );
    assert_ne!(
        delivered._ask_id, "ask-2",
        "runtime channel must not receive an unrelated ask id while ask-1 is pending"
    );
}

fn make_ask_question_state() -> AppState {
    let dir = tempdir().unwrap();
    let conn = crate::db::open_at(&dir.path().join("ask.db")).unwrap();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
         VALUES ('agent-ask', 'Ask Agent', '/tmp/project', 'claude-code', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-ask', 'agent-ask', 'Ask Conv', 10, 20, 'running')",
        [],
    )
    .unwrap();
    AppState::new(
        conn,
        "token".to_string(),
        dir.path().join("uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("plugin.db")).unwrap(),
        ))),
    )
}
