use crate::serve::runtime;
use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Serialize)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answered: Option<bool>,
    #[serde(rename = "answeredChoiceId", skip_serializing_if = "Option::is_none")]
    pub answered_choice_id: Option<String>,
    #[serde(rename = "answeredChoiceIds", skip_serializing_if = "Option::is_none")]
    pub answered_choice_ids: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
pub struct SinceSeqQuery {
    pub since_seq: Option<i64>,
}

#[derive(Deserialize)]
pub struct PostMessageBody {
    pub text: String,
    pub file_id: Option<String>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<SinceSeqQuery>,
) -> Result<Json<Vec<MessageRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let since = q.since_seq.unwrap_or(0);
    let mut stmt = db
        .prepare(
            "SELECT
                m.id,
                m.conversation_id,
                m.role,
                m.payload,
                m.created_at,
                m.seq,
                CASE WHEN aa.ask_id IS NULL THEN 0 ELSE 1 END AS answered,
                aa.choice_id,
                aa.choice_ids
             FROM messages m
             LEFT JOIN ask_answers aa
               ON m.role = 'ask_question'
              AND aa.conversation_id = m.conversation_id
              AND aa.ask_id = json_extract(m.payload, '$.ask_id')
             WHERE m.conversation_id = ?1 AND m.seq > ?2
             ORDER BY m.seq ASC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<MessageRow> = stmt
        .query_map(rusqlite::params![conv_id, since], |r| {
            let payload_str: String = r.get(3)?;
            let role: String = r.get(2)?;
            let answered_flag: i64 = r.get(6)?;
            let choice_ids: Option<String> = r.get(8)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                role,
                payload_str,
                r.get(4)?,
                r.get(5)?,
                answered_flag,
                r.get::<_, Option<String>>(7)?,
                choice_ids,
            ))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .map(
            |(
                id,
                conversation_id,
                role,
                payload_str,
                created_at,
                seq,
                answered_flag,
                answered_choice_id,
                answered_choice_ids_json,
            )| {
                let is_ask = role == "ask_question";
                let answered = is_ask.then_some(answered_flag != 0);
                let answered_choice_ids = answered_choice_ids_json
                    .and_then(|json| serde_json::from_str::<HashMap<String, String>>(&json).ok());
                MessageRow {
                    id,
                    conversation_id,
                    role,
                    payload: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
                    created_at,
                    seq,
                    answered,
                    answered_choice_id,
                    answered_choice_ids,
                }
            },
        )
        .collect();
    Ok(Json(rows))
}

pub async fn post_message(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Json(body): Json<PostMessageBody>,
) -> Result<(StatusCode, Json<MessageRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (next_seq, id, now, payload) = insert_user_message_and_mark_running(&db, &conv_id, &body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    // Fetch project_path, runtime, and mode; trigger runtime adapter
    let agent_info: Option<(String, String, String)> = {
        let db2 = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db2.query_row(
            "SELECT a.project_path, a.runtime, a.mode FROM agents a
             JOIN conversations c ON c.agent_id = a.id
             WHERE c.id = ?1",
            [&conv_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()
    };
    if let Some((path, rt, mode)) = agent_info {
        runtime::send_to_session(
            &state,
            &conv_id,
            runtime::DispatchMessage {
                text: &body.text,
                file_id: body.file_id.as_deref(),
                seq: next_seq,
            },
            &path,
            &rt,
            &mode,
        );
    }

    let envelope = serde_json::json!({
        "type": "message", "seq": next_seq, "role": "user_text",
        "payload": payload, "created_at": now
    });
    let sender = state.get_or_create_sender(&conv_id);
    let _ = sender.send(envelope.to_string());

    Ok((
        StatusCode::CREATED,
        Json(MessageRow {
            id,
            conversation_id: conv_id,
            role: "user_text".into(),
            payload,
            created_at: now,
            seq: next_seq,
            answered: None,
            answered_choice_id: None,
            answered_choice_ids: None,
        }),
    ))
}

fn insert_user_message_and_mark_running(
    db: &rusqlite::Connection,
    conv_id: &str,
    body: &PostMessageBody,
) -> rusqlite::Result<(i64, String, i64, serde_json::Value)> {
    let next_seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let payload = if let Some(ref fid) = body.file_id {
        serde_json::json!({ "text": body.text, "file_id": fid })
    } else {
        serde_json::json!({ "text": body.text })
    };
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,'user_text',?3,?4,?5)",
        rusqlite::params![id, conv_id, payload.to_string(), now, next_seq],
    )?;
    db.execute(
        "UPDATE conversations
         SET last_message_at = ?1, status = 'running'
         WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok((next_seq, id, now, payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        serve::{plugin::PluginManager, state::AppState},
    };
    use axum::extract::{Path, Query, State};
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn test_state() -> AppState {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("messages.db")).unwrap();
        conn.execute(
            "INSERT INTO agents (id, name, project_path, runtime, created_at)
             VALUES ('agent-1', 'Agent One', '/tmp/project', 'claude-code', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations
             (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', 'agent-1', 'Deploy', 10, 30, 'awaiting_question')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES
             ('msg-user', 'conv-1', 'user_text', '{\"text\":\"Ship it\"}', 11, 1),
             ('msg-ask-answered', 'conv-1', 'ask_question',
              '{\"ask_id\":\"ask-1\",\"questions\":[{\"id\":\"0\",\"text\":\"Deploy?\",\"options\":[{\"id\":\"0\",\"label\":\"Yes\"}]}],\"allow_freeform\":false}', 20, 2),
             ('msg-ask-open', 'conv-1', 'ask_question',
              '{\"ask_id\":\"ask-2\",\"questions\":[{\"id\":\"0\",\"text\":\"Notify?\",\"options\":[{\"id\":\"0\",\"label\":\"Yes\"}]}],\"allow_freeform\":false}', 30, 3)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ask_answers
             (ask_id, conversation_id, answered_at, choice_id, choice_ids, freeform)
             VALUES ('ask-1', 'conv-1', 25, '0', '{\"0\":\"0\"}', NULL)",
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

    /// 用户发送新消息后，后端 DB 立即进入 running，避免 Activity 轮询读到上一轮 completed。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation.status = completed（上一轮已完成）
    ///   existing messages   = 3 条，MAX(seq)=3
    ///   new user_text       = seq=4（由 MAX(seq)+1 推导）
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 构造 completed conversation，模拟上一轮已结束
    ///   2. 调用消息入库逻辑插入新的 user_text
    ///   3. 查询 conversations.status 和最新 user_text seq
    ///
    /// 预期结果：
    ///   - 断言 A：status == running，说明 Activity 立即会归入 Running
    ///   - 断言 B：new seq == 4，说明 running 状态对应最新用户消息
    ///   - 断言 C：status != completed，说明不会继续暴露上一轮 Done
    #[test]
    fn insert_user_message_marks_completed_conversation_running_immediately() {
        let state = test_state();
        {
            let db = state.db.lock().unwrap();
            db.execute(
                "UPDATE conversations SET status = 'completed' WHERE id = 'conv-1'",
                [],
            )
            .expect("seeded conversation status should be mutable");
        }

        let (new_seq, _id, _now, _payload) = {
            let db = state.db.lock().unwrap();
            super::insert_user_message_and_mark_running(
                &db,
                "conv-1",
                &PostMessageBody {
                    text: "Run another task".to_string(),
                    file_id: None,
                },
            )
            .expect("new user message should be inserted")
        };

        let db = state.db.lock().unwrap();
        let status: String = db
            .query_row(
                "SELECT status FROM conversations WHERE id = 'conv-1'",
                [],
                |r| r.get(0),
            )
            .expect("conversation status should be readable");
        assert_eq!(
            status, "running",
            "newly posted user message must immediately mark the conversation running"
        );
        assert_eq!(
            new_seq, 4,
            "new user message should use MAX(seq)+1 so turn freshness is concrete"
        );
        assert_ne!(
            status, "completed",
            "conversation must not keep the stale completed status after a new user message"
        );
    }

    /// Message history exposes backend ask answer state for chat rendering.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   msg-user         = user_text seq=1，不是 ask_question
    ///   msg-ask-answered = ask_question seq=2, ask_id=ask-1
    ///   ask_answers      = one row for (conv-1, ask-1), choice_id=0, choice_ids={"0":"0"}
    ///   msg-ask-open     = ask_question seq=3, ask_id=ask-2, no ask_answers row
    ///   since_seq        = 0，因此三条消息都会被查询
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 调用 list_messages(conv-1, since_seq=0)
    ///   2. SQL 对 ask_question 通过 payload.ask_id 左连接 ask_answers
    ///   3. 已回答 ask 返回 answered=true 和 choice 信息，未回答 ask 返回 answered=false
    ///   4. 非 ask message 不返回 answered 字段
    ///
    /// 预期结果：
    ///   - 断言 A：user_text.answered == None，说明普通消息不会被误标
    ///   - 断言 B：ask-1.answered == Some(true)，说明 backend answered state 暴露给 Chat
    ///   - 断言 C：ask-1.answered_choice_id == Some("0")，说明单选答案可恢复
    ///   - 断言 D：ask-1.answered_choice_ids["0"] == "0"，说明多问题答案 map 可恢复
    ///   - 断言 E：ask-2.answered == Some(false)，说明未回答 ask 仍保持可回答
    #[tokio::test]
    async fn list_messages_marks_ask_questions_from_backend_answers() {
        let state = test_state();
        let Json(messages) = list_messages(
            State(state),
            Path("conv-1".to_string()),
            Query(SinceSeqQuery { since_seq: Some(0) }),
        )
        .await
        .expect("list_messages should return seeded conversation messages");

        let user = messages
            .iter()
            .find(|message| message.id == "msg-user")
            .expect("seeded user message should be returned");
        let answered = messages
            .iter()
            .find(|message| message.id == "msg-ask-answered")
            .expect("seeded answered ask should be returned");
        let open = messages
            .iter()
            .find(|message| message.id == "msg-ask-open")
            .expect("seeded open ask should be returned");

        assert_eq!(
            user.answered, None,
            "non-ask user_text messages must not expose an answered marker"
        );
        assert_eq!(
            answered.answered,
            Some(true),
            "answered ask_question must expose backend ask_answers state"
        );
        assert_eq!(
            answered.answered_choice_id.as_deref(),
            Some("0"),
            "answered ask_question must expose the persisted single choice id"
        );
        assert_eq!(
            answered
                .answered_choice_ids
                .as_ref()
                .and_then(|ids| ids.get("0"))
                .map(String::as_str),
            Some("0"),
            "answered ask_question must expose persisted choice_ids map"
        );
        assert_eq!(
            open.answered,
            Some(false),
            "unanswered ask_question must remain explicitly unanswered"
        );
    }
}
