use super::*;
use axum::http::StatusCode;

/// Activity Done read state is exposed as an explicit read_at field on Done items only.
///
/// 数据构造（含关键数值的推导过程）：
///   seeded done candidates = conv-completed + conv-failed + conv-idle-with-result
///   seeded read rows       = 0（fresh DB 中没有 activity_reads）
///   limit_per_section      = 50，大于 done 候选数量，因此不会因 limit 缺项
///
/// 执行过程（逐步说明系统如何处理）：
///   1. GET /api/v1/activity?limit_per_section=50
///   2. handler 派生 done section 并左连接 activity_reads
///   3. 检查 Done 与非 Done item 的 read_at 表达
///
/// 预期结果：
///   - 断言 A：done:conv-completed 存在，说明 Done 候选仍正常返回
///   - 断言 B：done item 显式包含 read_at 字段，说明 mobile 可以区分未读与旧 endpoint 缺字段
///   - 断言 C：read_at == null，说明 fresh Done item 默认未读
///   - 断言 D：running item 不包含 read_at 字段，说明 read state 只属于 Done
#[tokio::test]
async fn activity_done_items_expose_unread_read_at_state() {
    let json = get_activity_json("/api/v1/activity?limit_per_section=50").await;

    let completed = find_item(&json, "done:conv-completed")
        .expect("completed conversation should appear in done section");
    assert!(
        completed.get("read_at").is_some(),
        "done item must explicitly include read_at so clients can tell unread from legacy missing data"
    );
    assert!(
        completed["read_at"].is_null(),
        "fresh done item should be unread and expose read_at=null"
    );

    let running = find_item(&json, "running:conv-running")
        .expect("running conversation should appear in running section");
    assert!(
        running.get("read_at").is_none(),
        "running items must not expose read_at because read state only applies to done"
    );
}

/// POST /api/v1/activity/done/:conversation_id/read marks one Done item as read.
///
/// 数据构造（含关键数值的推导过程）：
///   target conversation = conv-completed（status completed，因此属于 Done）
///   initial read rows   = 0
///   timestamp source    = db::now_ms()，期望写入后为正整数
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 使用同一个 router POST /api/v1/activity/done/conv-completed/read
///   2. 再 GET /api/v1/activity?limit_per_section=50
///   3. 检查目标 Done item 的 read_at 与其它 Done item
///
/// 预期结果：
///   - 断言 A：POST 返回 204，说明标记请求成功且无需 response body
///   - 断言 B：conv-completed.read_at 为正数，说明已读状态持久化
///   - 断言 C：conv-failed.read_at 仍为 null，说明单条标记不会误标其它 Done
#[tokio::test]
async fn activity_mark_one_done_item_read_persists_read_at() {
    let app = make_app().await;

    let status = post_activity_status(
        app.clone(),
        "/api/v1/activity/done/conv-completed/read",
        true,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "marking one done item read should return 204 No Content"
    );

    let json = get_activity_json_from(app, "/api/v1/activity?limit_per_section=50").await;
    let completed = find_item(&json, "done:conv-completed")
        .expect("marked completed conversation should still appear in done");
    let read_at = completed["read_at"]
        .as_i64()
        .expect("marked done item should expose read_at as an integer timestamp");
    assert!(
        read_at > 0,
        "read_at should be a positive unix millisecond timestamp after marking read"
    );

    let failed = find_item(&json, "done:conv-failed")
        .expect("unmarked failed conversation should still appear in done");
    assert!(
        failed["read_at"].is_null(),
        "marking one done conversation must not mark another done conversation read"
    );
}

/// POST /api/v1/activity/done/read-all marks every current Done candidate and no non-Done item.
///
/// 数据构造（含关键数值的推导过程）：
///   done candidates     = conv-completed + conv-failed + conv-idle-with-result
///   non-Done candidates = conv-attn-open + conv-running
///   expected writes     = 3 Done rows
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 使用同一个 router POST /api/v1/activity/done/read-all
///   2. 再 GET /api/v1/activity?limit_per_section=50
///   3. 检查所有 Done item read_at 与 non-Done item 字段
///
/// 预期结果：
///   - 断言 A：POST 返回 204，说明批量标记成功
///   - 断言 B：三个 Done item 都有正数 read_at
///   - 断言 C：attention item 不包含 read_at，说明 read-all 不改变 Pending 语义
///   - 断言 D：running item 不包含 read_at，说明 read-all 不改变 Running 语义
#[tokio::test]
async fn activity_mark_all_done_items_read_only_marks_done_candidates() {
    let app = make_app().await;

    let status = post_activity_status(app.clone(), "/api/v1/activity/done/read-all", true).await;
    assert_eq!(
        status,
        StatusCode::NO_CONTENT,
        "mark all done read should return 204 No Content"
    );

    let json = get_activity_json_from(app, "/api/v1/activity?limit_per_section=50").await;
    for id in [
        "done:conv-completed",
        "done:conv-failed",
        "done:conv-idle-with-result",
    ] {
        let item =
            find_item(&json, id).expect("seeded done item should still appear after read-all");
        let read_at = item["read_at"]
            .as_i64()
            .expect("read-all should expose read_at as an integer timestamp on every done item");
        assert!(
            read_at > 0,
            "read-all should write a positive read_at timestamp for {id}"
        );
    }

    let attention = find_item(&json, "attention:conv-attn-open:ask-open")
        .expect("pending attention item should remain visible after read-all");
    assert!(
        attention.get("read_at").is_none(),
        "read-all must not add read_at to pending attention items"
    );
    let running = find_item(&json, "running:conv-running")
        .expect("running item should remain visible after read-all");
    assert!(
        running.get("read_at").is_none(),
        "read-all must not add read_at to running items"
    );
}

/// Activity read mutation endpoints are protected by the same Bearer auth middleware.
///
/// 数据构造（含关键数值的推导过程）：
///   token in state        = ms_v2_tok
///   Authorization headers = missing for both POST requests
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 不带 Authorization POST /api/v1/activity/done/conv-completed/read
///   2. 不带 Authorization POST /api/v1/activity/done/read-all
///   3. bearer_auth 在 handler 前拦截请求
///
/// 预期结果：
///   - 断言 A：单条标记返回 401
///   - 断言 B：批量标记返回 401
///   - 断言 C：两个请求都不返回 204，说明未授权请求不会写入 read state
#[tokio::test]
async fn activity_read_mutation_endpoints_require_bearer_token() {
    let app = make_app().await;

    let one = post_activity_status(
        app.clone(),
        "/api/v1/activity/done/conv-completed/read",
        false,
    )
    .await;
    let all = post_activity_status(app, "/api/v1/activity/done/read-all", false).await;

    assert_eq!(
        one,
        StatusCode::UNAUTHORIZED,
        "single done read endpoint must reject requests without Bearer auth"
    );
    assert_eq!(
        all,
        StatusCode::UNAUTHORIZED,
        "read-all endpoint must reject requests without Bearer auth"
    );
    assert_ne!(
        one,
        StatusCode::NO_CONTENT,
        "unauthorized single read request must not be accepted as a write"
    );
    assert_ne!(
        all,
        StatusCode::NO_CONTENT,
        "unauthorized read-all request must not be accepted as a write"
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
