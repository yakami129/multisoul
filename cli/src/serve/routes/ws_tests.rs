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

fn seed_user_message_mode_ask(state: &AppState, ask_id: &str, payload: serde_json::Value) {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1, 'conv-1', 'ask_question', ?2, 40, 1)",
        rusqlite::params![format!("msg-{ask_id}"), payload.to_string()],
    )
    .unwrap();
}

fn user_text_rows(state: &AppState) -> Vec<String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT json_extract(payload, '$.text')
             FROM messages
             WHERE conversation_id='conv-1' AND role='user_text'
             ORDER BY seq ASC",
        )
        .unwrap();
    stmt.query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

fn ask_answer_exists(state: &AppState, ask_id: &str) -> bool {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM ask_answers
             WHERE conversation_id='conv-1' AND ask_id=?1
         )",
        [ask_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|value| value == 1)
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

/// WS answer for an msctl ask card becomes a structured Markdown user_text and queues runtime work.
///
/// 数据构造（含关键数值的推导过程）：
///   ask payload.response_mode = user_message（HTTP msctl ask 的新语义）
///   questions = 2:
///     q0 options: 0 → 方案 A, 1 → 方案 B
///     q1 multi_select options: a → Alpha, b → Beta
///   incoming choice_ids = {"0":"1","1":"a,custom note"}
///   existing user_text rows = 0，因此 injected user_text seq = MAX(seq 1 ask row) + 1 = 2
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 插入 response_mode=user_message 的 ask_question row
///   2. 注册已有 runtime SessionHandle，避免测试 spawn 真实 CLI
///   3. 发送 WS answer choice_ids={"0":"1","1":"a,custom note"}
///   4. handler 解析 option id 为 label，未知片段 custom note 作为输入
///   5. handler 写 ask_answers、插入 user_text，并通过 runtime dispatch queue 发送给 session
///
/// 预期结果：
///   - 断言 A：ask_answers 中存在 ask-msctl，说明原卡片被标记 answered
///   - 断言 B：DB 中正好一条 user_text，说明 answer 被注入为用户消息
///   - 断言 C：Markdown 包含“选择：方案 B”和“选择：Alpha”，说明 option id 被解析为 label
///   - 断言 D：Markdown 包含“输入：custom note”，说明未知片段被保留为自定义输入
///   - 断言 E：runtime queue 收到同一 Markdown，说明复用了 user message dispatch
#[tokio::test]
async fn user_message_mode_answer_injects_markdown_user_text_and_queues_runtime() {
    let state = test_state();
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE agents SET runtime='codex', mode='full-auto' WHERE id='agent-1'",
            [],
        )
        .unwrap();
    }
    seed_user_message_mode_ask(
        &state,
        "ask-msctl",
        serde_json::json!({
            "ask_id": "ask-msctl",
            "response_mode": "user_message",
            "questions": [
                {
                    "id": "0",
                    "text": "iOS 测试：选哪个？",
                    "options": [
                        {"id": "0", "label": "方案 A"},
                        {"id": "1", "label": "方案 B"}
                    ],
                    "multi_select": false
                },
                {
                    "id": "1",
                    "text": "选择要执行的步骤",
                    "options": [
                        {"id": "a", "label": "Alpha"},
                        {"id": "b", "label": "Beta"}
                    ],
                    "multi_select": true
                }
            ],
            "allow_freeform": false
        }),
    );
    let (tx, rx) = std::sync::mpsc::channel();
    state.sessions.lock().unwrap().insert(
        "conv-1".to_string(),
        crate::serve::state::SessionHandle::new(tx),
    );

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-msctl","choice_ids":{"0":"1","1":"a,custom note"}}"#,
    )
    .await;

    let user_texts = user_text_rows(&state);
    assert!(
        ask_answer_exists(&state, "ask-msctl"),
        "answering a user-message-mode ask must persist ask_answers for ask-msctl"
    );
    assert_eq!(
        user_texts.len(),
        1,
        "user-message-mode answer must insert exactly one user_text row"
    );
    let markdown = &user_texts[0];
    assert!(
        markdown.contains("- 选择：方案 B"),
        "Markdown must resolve q0 option id 1 to label 方案 B: {markdown}"
    );
    assert!(
        markdown.contains("- 选择：Alpha"),
        "Markdown must resolve q1 option id a to label Alpha: {markdown}"
    );
    assert!(
        markdown.contains("- 输入：custom note"),
        "Markdown must preserve unknown multi-select segment as custom input: {markdown}"
    );
    let queued = rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .expect("existing runtime session should receive injected user message");
    assert!(
        queued.user_text.ends_with(markdown),
        "runtime dispatch should queue the injected Markdown user message"
    );
}

/// Cancelled msctl ask only marks the card answered and does not inject a user_text.
///
/// 数据构造（含关键数值的推导过程）：
///   ask payload.response_mode = user_message
///   incoming choice_id        = __cancelled__（iOS Dismiss/Cancel sentinel）
///   existing user_text rows   = 0
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 插入 response_mode=user_message 的 ask_question row
///   2. 发送 WS answer choice_id=__cancelled__
///   3. handler 写 ask_answers 结束卡片
///   4. handler 将 conversation.status 从 awaiting_question 改为 idle
///   5. handler 不插入 user_text、不 queue runtime message
///
/// 预期结果：
///   - 断言 A：ask_answers 存在 ask-cancel，说明卡片被结束
///   - 断言 B：user_text row count == 0，说明取消不会启动 agent
///   - 断言 C：conversation.status == idle，说明 Needs Attention 被清除
#[tokio::test]
async fn cancelled_user_message_mode_answer_marks_answered_without_user_text() {
    let state = test_state();
    seed_user_message_mode_ask(
        &state,
        "ask-cancel",
        serde_json::json!({
            "ask_id": "ask-cancel",
            "response_mode": "user_message",
            "questions": [
                {
                    "id": "0",
                    "text": "继续吗？",
                    "options": [{"id": "yes", "label": "继续"}],
                    "multi_select": false
                }
            ],
            "allow_freeform": false
        }),
    );

    handle_client_message(
        &state,
        "conv-1",
        r#"{"type":"answer","ask_id":"ask-cancel","choice_id":"__cancelled__"}"#,
    )
    .await;

    assert!(
        ask_answer_exists(&state, "ask-cancel"),
        "cancelled user-message-mode ask must still be persisted as answered"
    );
    assert_eq!(
        user_text_rows(&state).len(),
        0,
        "cancelled user-message-mode ask must not inject a user_text message"
    );
    assert_eq!(
        conversation_status(&state),
        "idle",
        "cancelled user-message-mode ask must clear awaiting_question without starting runtime"
    );
}

include!("ws_answer_delivery_tests.rs");
