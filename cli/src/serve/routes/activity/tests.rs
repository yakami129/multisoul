use super::*;
use crate::{
    db,
    serve::{build_router, plugin::PluginManager},
};
use axum::{body::Body, http::Request, Router};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use tower::ServiceExt;

async fn make_app() -> Router {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("activity.db")).unwrap();
    seed_activity_rows(&conn);
    let plugin_db = db::open_at(&dir.path().join("plugins.db")).unwrap();
    let state = AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    );
    build_router(state).await
}

fn seed_activity_rows(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
             VALUES ('agent-1', 'Deploy Project', '/tmp/project', 'claude-code', 1)",
        [],
    )
    .unwrap();

    insert_conversation(conn, "conv-attn-open", "awaiting_question", 100, 900);
    insert_message(
        conn,
        "msg-attn-user",
        "conv-attn-open",
        "user_text",
        &serde_json::json!({"text":"Ship release notes"}),
        110,
        1,
    );
    insert_message(
        conn,
        "msg-attn-ask",
        "conv-attn-open",
        "ask_question",
        &ask_payload("ask-open", "Deploy now?"),
        910,
        2,
    );

    insert_conversation(conn, "conv-attn-answered", "awaiting_question", 200, 920);
    insert_message(
        conn,
        "msg-answered-ask",
        "conv-attn-answered",
        "ask_question",
        &ask_payload("ask-answered", "Answered question?"),
        920,
        1,
    );
    conn.execute(
        "INSERT INTO ask_answers
             (ask_id, conversation_id, answered_at, choice_id, choice_ids, freeform)
             VALUES ('ask-answered', 'conv-attn-answered', 930, '0', NULL, NULL)",
        [],
    )
    .unwrap();

    insert_conversation(conn, "conv-attn-completed", "completed", 300, 940);
    insert_message(
        conn,
        "msg-completed-ask",
        "conv-attn-completed",
        "ask_question",
        &ask_payload("ask-completed", "Completed question?"),
        940,
        1,
    );

    insert_conversation(conn, "conv-running", "running", 400, 950);
    insert_message(
        conn,
        "msg-running-user",
        "conv-running",
        "user_text",
        &serde_json::json!({"text":"Run tests"}),
        410,
        1,
    );

    insert_conversation(conn, "conv-completed", "completed", 500, 960);
    insert_message(
        conn,
        "msg-completed-user",
        "conv-completed",
        "user_text",
        &serde_json::json!({"text":"Build app"}),
        510,
        1,
    );

    insert_conversation(conn, "conv-failed", "failed", 600, 970);
    insert_message(
        conn,
        "msg-failed-user",
        "conv-failed",
        "user_text",
        &serde_json::json!({"text":"Deploy app"}),
        610,
        1,
    );

    insert_conversation(conn, "conv-idle-with-result", "idle", 700, 990);
    insert_message(
        conn,
        "msg-idle-user",
        "conv-idle-with-result",
        "user_text",
        &serde_json::json!({"text":"Summarize old thread"}),
        710,
        1,
    );
    insert_message(
        conn,
        "msg-idle-agent",
        "conv-idle-with-result",
        "agent_text",
        &serde_json::json!({"text":"Old thread summary is ready"}),
        980,
        2,
    );
    insert_message(
        conn,
        "msg-idle-task-status",
        "conv-idle-with-result",
        "task_status",
        &serde_json::json!({
            "task_id":"conv-idle-with-result",
            "status":"completed",
            "importance":"normal",
            "summary":"Old result summary"
        }),
        990,
        3,
    );
}

fn insert_conversation(
    conn: &rusqlite::Connection,
    id: &str,
    status: &str,
    created: i64,
    last: i64,
) {
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES (?1, 'agent-1', ?2, ?3, ?4, ?5)",
        rusqlite::params![id, format!("Title {}", id), created, last, status],
    )
    .unwrap();
}

fn insert_message(
    conn: &rusqlite::Connection,
    id: &str,
    conversation_id: &str,
    role: &str,
    payload: &serde_json::Value,
    created_at: i64,
    seq: i64,
) {
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            conversation_id,
            role,
            payload.to_string(),
            created_at,
            seq
        ],
    )
    .unwrap();
}

fn ask_payload(ask_id: &str, question: &str) -> serde_json::Value {
    serde_json::json!({
        "ask_id": ask_id,
        "questions": [{"id":"0","text":question,"options":[{"id":"0","label":"Yes"}]}],
        "allow_freeform": false
    })
}

async fn get_activity_json(uri: &str) -> serde_json::Value {
    let app = make_app().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("Authorization", "Bearer ms_v2_tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "authorized activity request should return 200 OK"
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn find_item<'a>(json: &'a serde_json::Value, id: &str) -> Option<&'a serde_json::Value> {
    json["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id)
}

/// GET /api/v1/activity is protected by the existing Bearer auth middleware.
///
/// 数据构造（含关键数值的推导过程）：
///   token in state      = ms_v2_tok
///   Authorization       = missing
///   limit_per_section   = default 50（未鉴权时不会进入 handler）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造只包含 /api/v1/activity 的测试 router
///   2. 不带 Authorization header 发起 GET /api/v1/activity
///   3. bearer_auth 在 handler 前拦截请求
///
/// 预期结果：
///   - 断言 A：HTTP status == 401，说明 Activity 使用既有 auth stack
///   - 断言 B：HTTP status != 200，说明未授权请求不会被当成成功查询
#[tokio::test]
async fn activity_without_bearer_token_returns_401() {
    let app = make_app().await;
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/activity")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "activity route must reject requests without a Bearer token"
    );
    assert_ne!(
        resp.status(),
        StatusCode::OK,
        "activity route must not return 200 for an unauthenticated request"
    );
}

/// Activity attention includes only unanswered asks on awaiting_question conversations.
///
/// 数据构造（含关键数值的推导过程）：
///   conv-attn-open      = awaiting_question + ask-open + no ask_answers row
///   conv-attn-answered  = awaiting_question + ask-answered + ask_answers row
///   conv-attn-completed = completed + ask-completed + no ask_answers row
///   limit_per_section   = 50，远大于 3 个候选 ask，因此不会因 limit 被裁剪
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/activity?limit_per_section=50
///   2. handler 从 messages.role='ask_question' 派生 attention
///   3. 通过 ask_answers 排除已回答 ask，并通过 conversation.status 排除 completed ask
///
/// 预期结果：
///   - 断言 A：attention:conv-attn-open:ask-open 存在，说明未回答等待中 ask 可见
///   - 断言 B：attention:conv-attn-answered:ask-answered 不存在，说明已回答 ask 被隐藏
///   - 断言 C：attention:conv-attn-completed:ask-completed 不存在，说明已完成会话 ask 被隐藏
///   - 断言 D：open item title == Deploy now?，说明 title 优先使用决策问题
#[tokio::test]
async fn activity_attention_filters_answered_and_completed_asks() {
    let json = get_activity_json("/api/v1/activity?limit_per_section=50").await;

    let open = find_item(&json, "attention:conv-attn-open:ask-open")
        .expect("unanswered awaiting ask should appear in attention");
    assert_eq!(
        open["section"].as_str(),
        Some("attention"),
        "unanswered awaiting ask must be returned in the attention section"
    );
    assert_eq!(
        open["title"].as_str(),
        Some("Deploy now?"),
        "attention title should come from the ask_question prompt"
    );
    assert!(
        find_item(&json, "attention:conv-attn-answered:ask-answered").is_none(),
        "answered ask must not remain visible in attention"
    );
    assert!(
        find_item(&json, "attention:conv-attn-completed:ask-completed").is_none(),
        "completed conversation ask must not appear in attention even when unanswered"
    );
}

/// Activity running/done sections are derived from conversation.status.
///
/// 数据构造（含关键数值的推导过程）：
///   conv-running   status = running   → expected id running:conv-running
///   conv-completed status = completed → expected id done:conv-completed, tone done
///   conv-failed    status = failed    → expected id done:conv-failed, tone failed
///   limit_per_section = 50，大于每个 section 的候选数量
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/activity?limit_per_section=50
///   2. handler 查询 running conversations 生成 Running section
///   3. handler 查询 completed/failed conversations 生成 Done section
///
/// 预期结果：
///   - 断言 A：running:conv-running 存在且 section=running
///   - 断言 B：done:conv-completed 存在且 status_label=Done/tone=done
///   - 断言 C：done:conv-failed 存在且 status_label=Failed/tone=failed
///   - 断言 D：running:conv-completed 不存在，说明 completed 不会混入 Running
#[tokio::test]
async fn activity_running_and_done_reflect_conversation_status() {
    let json = get_activity_json("/api/v1/activity?limit_per_section=50").await;

    let running = find_item(&json, "running:conv-running")
        .expect("running conversation should appear in running section");
    assert_eq!(
        running["section"].as_str(),
        Some("running"),
        "running conversation must be returned in the running section"
    );

    let completed = find_item(&json, "done:conv-completed")
        .expect("completed conversation should appear in done section");
    assert_eq!(
        completed["status_label"].as_str(),
        Some("Done"),
        "completed conversation should use Done status_label"
    );
    assert_eq!(
        completed["tone"].as_str(),
        Some("done"),
        "completed conversation should use done tone"
    );

    let failed = find_item(&json, "done:conv-failed")
        .expect("failed conversation should appear in done section");
    assert_eq!(
        failed["status_label"].as_str(),
        Some("Failed"),
        "failed conversation should use Failed status_label"
    );
    assert_eq!(
        failed["tone"].as_str(),
        Some("failed"),
        "failed conversation should use failed tone"
    );
    assert!(
        find_item(&json, "running:conv-completed").is_none(),
        "completed conversation must not be returned as a running item"
    );
}

/// Activity treats legacy idle conversations with terminal task_status as completed results.
///
/// 数据构造（含关键数值的推导过程）：
///   conv-idle-with-result.status = idle（旧 DB/旧 runtime 遗留状态）
///   msg-idle-user seq=1          = 有用户输入，说明不是空会话
///   msg-idle-agent seq=2         = 有 agent 回复
///   task_status seq=3            = status completed, summary "Old result summary"
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/activity?limit_per_section=50
///   2. handler 查询 done section 时兼容 legacy idle + terminal task_status
///   3. 使用 task_status summary 作为 Done subtitle
///
/// 预期结果：
///   - 断言 A：done:conv-idle-with-result 存在，说明旧 idle 结果不会被过滤为空
///   - 断言 B：status_label == Done，说明 completed task_status 被映射为完成态
///   - 断言 C：subtitle == Old result summary，说明摘要来自 terminal task_status
///   - 断言 D：running:conv-idle-with-result 不存在，说明 terminal idle 不会混入 Running
#[tokio::test]
async fn activity_done_includes_legacy_idle_conversations_with_terminal_task_status() {
    let json = get_activity_json("/api/v1/activity?limit_per_section=50").await;

    let idle_done = find_item(&json, "done:conv-idle-with-result")
        .expect("legacy idle conversation with completed task_status should appear in done");
    assert_eq!(
        idle_done["status_label"].as_str(),
        Some("Done"),
        "completed task_status on idle conversation should map to Done"
    );
    assert_eq!(
        idle_done["subtitle"].as_str(),
        Some("Old result summary"),
        "legacy idle done item should use the terminal task_status summary"
    );
    assert!(
        find_item(&json, "running:conv-idle-with-result").is_none(),
        "legacy idle conversation with terminal status must not also appear in running"
    );
}

/// limit_per_section caps attention/running/done independently.
///
/// 数据构造（含关键数值的推导过程）：
///   seeded attention candidates = 1（open ask）
///   seeded running candidates   = 1（conv-running）
///   seeded done candidates      = 2（conv-completed, conv-failed）
///   limit_per_section           = 1
///   expected total              = 1 attention + 1 running + 1 done = 3
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/activity?limit_per_section=1
///   2. handler applies LIMIT 1 separately to each section query
///   3. Done has two candidates, so only newest done item remains
///
/// 预期结果：
///   - 断言 A：attention count == 1，说明 attention 没有被 done 挤掉
///   - 断言 B：running count == 1，说明 running 独立限流
///   - 断言 C：done count == 1，说明 done section 被自己的 limit 裁剪
///   - 断言 D：total count == 3，说明 limit 不是三个 section 共用一个全局额度
#[tokio::test]
async fn activity_limit_per_section_is_applied_to_each_section() {
    let json = get_activity_json("/api/v1/activity?limit_per_section=1").await;
    let items = json["items"].as_array().unwrap();
    let attention_count = items
        .iter()
        .filter(|item| item["section"] == "attention")
        .count();
    let running_count = items
        .iter()
        .filter(|item| item["section"] == "running")
        .count();
    let done_count = items
        .iter()
        .filter(|item| item["section"] == "done")
        .count();

    assert_eq!(
        attention_count, 1,
        "limit_per_section=1 must still allow the one pending attention item"
    );
    assert_eq!(
        running_count, 1,
        "limit_per_section=1 must allow one running item independently"
    );
    assert_eq!(
        done_count, 1,
        "limit_per_section=1 must cap done items to one"
    );
    assert_eq!(
        items.len(),
        3,
        "limit_per_section=1 should return one item per non-empty section, not one global item"
    );
}
