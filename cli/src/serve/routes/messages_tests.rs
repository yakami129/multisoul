use super::messages::*;
use crate::{
    db,
    serve::{plugin::PluginManager, state::AppState},
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
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

fn empty_test_state() -> AppState {
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
    let plugin_db = db::open_at(&dir.path().join("plugins.db")).unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    )
}

fn seed_numbered_user_messages(state: &AppState, count: i64) {
    let db = state.db.lock().unwrap();
    for seq in 1..=count {
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
                 VALUES (?1, 'conv-1', 'user_text', ?2, ?3, ?4)",
            rusqlite::params![
                format!("msg-{seq}"),
                serde_json::json!({ "text": format!("Message {seq}") }).to_string(),
                100 + seq,
                seq
            ],
        )
        .unwrap();
    }
}

/// Message history limit pagination returns only the latest bounded window.
///
/// 数据构造（含关键数值的推导过程）：
///   user_text rows = seq 1..25，共 25 条
///   limit          = 15
///   expected start = 25 - 15 + 1 = 11
///   expected end   = 25
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造空 conversation 并插入 25 条 user_text
///   2. 调用 list_messages(limit=15)，不传 since_seq/before_seq/around_ask_id
///   3. API 应取最新 15 条，再按 seq ASC 返回给客户端渲染
///
/// 预期结果：
///   - 断言 A：返回 15 条，说明 limit 被执行
///   - 断言 B：第一条 seq=11，说明窗口从最新 15 条的最老消息开始
///   - 断言 C：最后一条 seq=25，说明窗口包含最新消息
///   - 断言 D：seq=10 不存在，说明没有退回旧的全量 since_seq 行为
#[tokio::test]
async fn list_messages_with_limit_returns_latest_window_only() {
    let state = empty_test_state();
    seed_numbered_user_messages(&state, 25);

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(15),
            before_seq: None,
            around_ask_id: None,
        }),
    )
    .await
    .expect("list_messages should return the latest limited page");

    assert_eq!(
        messages.len(),
        15,
        "limit=15 must return exactly the latest 15 messages from a 25-row history"
    );
    assert_eq!(
        messages.first().map(|message| message.seq),
        Some(11),
        "latest 15 of seq 1..25 should start at seq 11 after ASC response ordering"
    );
    assert_eq!(
        messages.last().map(|message| message.seq),
        Some(25),
        "latest limited page must include the newest message seq 25"
    );
    assert!(
        !messages.iter().any(|message| message.seq == 10),
        "seq 10 must not be returned because it is outside the latest 15-message window"
    );
}

/// Message history before_seq pagination returns the older page before an exclusive cursor.
///
/// 数据构造（含关键数值的推导过程）：
///   user_text rows = seq 1..25，共 25 条
///   before_seq     = 11（exclusive，因此 seq 11 不可返回）
///   limit          = 5
///   eligible rows  = seq 1..10
///   expected page  = 最新 5 条 eligible rows = [6, 7, 8, 9, 10]
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造空 conversation 并插入 25 条 user_text
///   2. 调用 list_messages(before_seq=11, limit=5)
///   3. API 应先选出 seq < 11 的最新 5 条，再按 seq ASC 返回
///
/// 预期结果：
///   - 断言 A：返回 seq [6,7,8,9,10]，说明 older page 窗口正确
///   - 断言 B：seq 11 不存在，说明 before_seq 是 exclusive
///   - 断言 C：seq 5 不存在，说明只返回 older page 的最新 limit 条
#[tokio::test]
async fn list_messages_before_seq_returns_older_page() {
    let state = empty_test_state();
    seed_numbered_user_messages(&state, 25);

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(5),
            before_seq: Some(11),
            around_ask_id: None,
        }),
    )
    .await
    .expect("list_messages should return the older page before the cursor");

    let seqs: Vec<i64> = messages.iter().map(|message| message.seq).collect();
    assert_eq!(
        seqs,
        vec![6, 7, 8, 9, 10],
        "before_seq=11 with limit=5 must return the newest older rows in ASC order"
    );
    assert!(
        !messages.iter().any(|message| message.seq == 11),
        "seq 11 must not be returned because before_seq is exclusive"
    );
    assert!(
        !messages.iter().any(|message| message.seq == 5),
        "seq 5 must not be returned because only the newest 5 rows before seq 11 fit"
    );
}

/// Message history around_ask_id pagination returns a bounded focus window containing the ask.
///
/// 数据构造（含关键数值的推导过程）：
///   user_text rows       = seq 1..30，共 30 条
///   focused ask_question = seq 18, ask_id=ask-focus（替换原 user_text seq=18）
///   limit                = 9
///   before half          = floor(9 / 2) = 4 rows before target
///   forward capacity     = 9 - 4 = 5 rows from target forward
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造空 conversation 并插入 30 条消息
///   2. 将 seq=18 替换为 ask_question，payload.ask_id=ask-focus
///   3. 调用 list_messages(around_ask_id=ask-focus, limit=9)
///   4. API 应定位同 conversation 内 ask_question，并返回包含它的有界 ASC 窗口
///
/// 预期结果：
///   - 断言 A：返回条数 <= 9，说明 focus window 被 limit 约束
///   - 断言 B：seq 18 存在，说明窗口包含目标 ask
///   - 断言 C：seq 18 的 role/payload.ask_id 正确，说明定位的是目标 ask_question
///   - 断言 D：seq 1 不存在，说明没有退回全量历史
#[tokio::test]
async fn list_messages_around_ask_id_returns_bounded_focus_window() {
    let state = empty_test_state();
    seed_numbered_user_messages(&state, 30);
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE messages
                 SET role = 'ask_question',
                     payload = '{\"ask_id\":\"ask-focus\",\"questions\":[{\"id\":\"0\",\"text\":\"Focus?\",\"options\":[{\"id\":\"0\",\"label\":\"Yes\"}]}],\"allow_freeform\":false}'
                 WHERE conversation_id = 'conv-1' AND seq = 18",
            [],
        )
        .expect("seeded seq 18 message should be replaceable with a focused ask");
    }

    let Json(messages) = list_messages(
        State(state),
        Path("conv-1".to_string()),
        Query(MessagesQuery {
            since_seq: None,
            limit: Some(9),
            before_seq: None,
            around_ask_id: Some("ask-focus".to_string()),
        }),
    )
    .await
    .expect("list_messages should return a bounded focus window around the ask");

    let focus = messages
        .iter()
        .find(|message| message.seq == 18)
        .expect("focused ask at seq 18 should be included in the returned window");
    assert!(
        messages.len() <= 9,
        "around_ask_id limit=9 must return at most 9 messages in the focus window"
    );
    assert_eq!(
        focus.role, "ask_question",
        "seq 18 must remain the ask_question row found by around_ask_id"
    );
    assert_eq!(
        focus.payload.get("ask_id").and_then(|value| value.as_str()),
        Some("ask-focus"),
        "focused ask payload must preserve ask_id=ask-focus"
    );
    assert!(
        !messages.iter().any(|message| message.seq == 1),
        "seq 1 must not be returned because around_ask_id should not return full history"
    );
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
        insert_user_message_and_mark_running(
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

/// post_message: conversation.model_id 必须随用户消息进入运行时队列。
///
/// 数据构造（含关键数值的推导过程）：
///   agent.runtime = "codex"（使用已有 session 避免真实 spawn）
///   conversation.model_id = "gpt-5.5-codex"（具体模型选择）
///   existing messages = 0 条，因此新 user_text seq = COALESCE(MAX(seq),0)+1 = 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 将 agent runtime 改为 codex，并设置 conversations.model_id
///   2. 手动插入 SessionHandle 到 state.sessions["conv-1"]
///   3. 调用 post_message，handler 入库 user_text 后查询 a.project_path/a.runtime/a.mode/c.model_id
///   4. Codex existing-session 分支把 DispatchMessage 写入 channel
///
/// 预期结果：
///   - 断言 A：HTTP 返回 201，说明消息创建成功
///   - 断言 B：queued.model_id == Some("gpt-5.5-codex")
///   - 断言 C：queued.model_id != None，防止 handler 查询时漏掉 c.model_id
#[tokio::test]
async fn post_message_passes_conversation_model_id_to_runtime_queue() {
    let state = empty_test_state();
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE agents SET runtime = 'codex', mode = 'full-auto' WHERE id = 'agent-1'",
            [],
        )
        .expect("seeded agent runtime and mode should be mutable");
        db.execute(
            "UPDATE conversations SET model_id = 'gpt-5.5-codex' WHERE id = 'conv-1'",
            [],
        )
        .expect("seeded conversation model_id should be mutable");
    }

    let (tx, rx) = std::sync::mpsc::channel();
    let handle = crate::serve::state::SessionHandle::new(tx);
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle);

    let (status, Json(row)) = post_message(
        State(state),
        Path("conv-1".to_string()),
        Json(PostMessageBody {
            text: "Use selected model".to_string(),
            file_id: None,
        }),
    )
    .await
    .expect("post_message should create the user_text row");

    assert_eq!(
        status,
        StatusCode::CREATED,
        "post_message should return 201 before checking runtime dispatch"
    );
    assert_eq!(
        row.seq, 1,
        "first message in an empty conversation should use seq=1"
    );
    let queued = rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .expect("existing runtime session should receive queued message");
    assert_eq!(
        queued.model_id.as_deref(),
        Some("gpt-5.5-codex"),
        "post_message should pass conversations.model_id into DispatchMessage"
    );
    assert!(
        queued.model_id.is_some(),
        "queued model_id must not be None when conversation has a selected concrete model"
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
        Query(MessagesQuery {
            since_seq: Some(0),
            limit: None,
            before_seq: None,
            around_ask_id: None,
        }),
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
