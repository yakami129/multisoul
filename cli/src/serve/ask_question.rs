use crate::db::now_ms;
use crate::serve::{
    push,
    routes::activity_events::{emit_activity_changed, REASON_AWAITING_QUESTION},
    state::AppState,
};
use serde_json::Value;
use tracing::{debug, info};
use uuid::Uuid;

pub fn record_ask_question(state: &AppState, conv_id: &str, payload: Value) -> bool {
    record_ask_question_with_runtime_waiter(state, conv_id, payload, true)
}

pub fn record_ask_question_for_http(state: &AppState, conv_id: &str, payload: Value) -> bool {
    record_ask_question_with_runtime_waiter(state, conv_id, payload, false)
}

fn record_ask_question_with_runtime_waiter(
    state: &AppState,
    conv_id: &str,
    payload: Value,
    arm_runtime_waiter: bool,
) -> bool {
    let ask_id = payload
        .get("ask_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "ask_question", &payload) {
        let _ = db.execute(
            "UPDATE conversations SET status = 'awaiting_question' WHERE id = ?1",
            [conv_id],
        );
        if !ask_id.is_empty() {
            if arm_runtime_waiter {
                state.begin_waiting_answer(conv_id, &ask_id);
            } else {
                state.begin_waiting_answer_user_message(conv_id, &ask_id);
            }
        }
        push::send_ask_question_push(&db, conv_id, &payload);
        drop(db);
        broadcast(state, conv_id, seq, "ask_question", payload);
        emit_activity_changed(state, conv_id, REASON_AWAITING_QUESTION);
        info!(
            conv_id = %conv_id,
            ask_id = %ask_id,
            seq,
            runtime_waiter = arm_runtime_waiter,
            "ask_question_recorded"
        );
        return true;
    }
    false
}

fn insert_message(
    db: &rusqlite::Connection,
    conv_id: &str,
    role: &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, conv_id, role, payload.to_string(), now, seq],
    )?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok(seq)
}

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
}

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope {
        kind: "message",
        seq,
        role,
        payload,
        created_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let n = tx.send(json).unwrap_or(0);
        debug!(role, seq, receivers = n, "broadcast");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, serve::plugin::PluginManager};
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    /// Shared AskQuestion recording persists an answerable pending ask.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation.status = running（模拟 runtime turn 正在执行）
    ///   messages before     = 0 rows
    ///   answer channel cap  = 1（create_answer_channel 为当前 conversation 建立等待槽）
    ///   ask payload         = ask_id ask-shared + one question + one option
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. create_answer_channel("conv-shared") 注册等待会话
    ///   2. record_ask_question 写入 ask_question message，seq 从 0 + 1 = 1
    ///   3. record_ask_question 更新 conversation.status 为 awaiting_question
    ///   4. record_ask_question 在广播前注册 pending_ask_id=ask-shared
    ///   5. send_answer("ask-shared") 模拟 iOS 立即回答
    ///
    /// 预期结果：
    ///   - 断言 A：record_ask_question 返回 true，说明写入成功
    ///   - 断言 B：conversation.status == awaiting_question，说明 Activity 可进入 Needs Attention
    ///   - 断言 C：ask_question row 存在且 ask_id == ask-shared，说明 timeline 可恢复问题卡片
    ///   - 断言 D：agent_text row 不存在，说明 pending ask 不会被误写为普通文本
    ///   - 断言 E：send_answer Accepted，说明 pending ask 在客户端可见前已可回答
    #[test]
    fn shared_record_ask_question_persists_answerable_pending_ask() {
        let state = make_state();
        let answer_rx = state.create_answer_channel("conv-shared");
        let payload = serde_json::json!({
            "ask_id": "ask-shared",
            "questions": [{"id":"0","text":"Deploy?","options":[{"id":"0","label":"Yes"}],"multi_select":false}],
            "allow_freeform": false
        });

        let ok = record_ask_question(&state, "conv-shared", payload);
        assert!(
            ok,
            "record_ask_question should return true when the ask is persisted"
        );

        let send_result = state.send_answer(
            "conv-shared",
            crate::serve::interactive::AnswerPayload {
                _ask_id: "ask-shared".to_string(),
                choice_id: Some("0".to_string()),
                choice_ids: None,
                freeform: None,
            },
        );
        let delivered = answer_rx
            .try_recv()
            .expect("runtime channel should receive the answer for ask-shared");

        let db = state.db.lock().unwrap();
        let status: String = db
            .query_row(
                "SELECT status FROM conversations WHERE id = 'conv-shared'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ask_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-shared' AND role='ask_question'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ask_id: String = db
            .query_row(
                "SELECT json_extract(payload, '$.ask_id') FROM messages WHERE conversation_id='conv-shared'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let agent_text_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-shared' AND role='agent_text'",
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
            ask_id, "ask-shared",
            "the stored ask_question payload must preserve the ask_id"
        );
        assert_eq!(
            agent_text_count, 0,
            "record_ask_question must not write the pending ask as agent_text"
        );
        assert!(
            matches!(send_result, crate::serve::state::AnswerSendResult::Accepted),
            "fast answer must be accepted because pending ask is registered before broadcast"
        );
        assert_eq!(
            delivered._ask_id, "ask-shared",
            "answer channel must deliver the same ask_id that was recorded"
        );
    }

    fn make_state() -> AppState {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("ask.db")).unwrap();
        conn.execute(
            "INSERT INTO agents (id, name, project_path, runtime, created_at)
             VALUES ('agent-shared', 'Shared Agent', '/tmp/project', 'codex', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-shared', 'agent-shared', 'Shared Conv', 10, 20, 'running')",
            [],
        )
        .unwrap();
        AppState::new(
            conn,
            "token".to_string(),
            dir.path().join("uploads"),
            PluginManager::empty(Arc::new(Mutex::new(
                db::open_at(&dir.path().join("plugin.db")).unwrap(),
            ))),
        )
    }
}
