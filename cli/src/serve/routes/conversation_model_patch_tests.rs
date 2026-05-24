async fn make_patch_model_app(token: &str) -> (axum::Router, AppState, String) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("patch-model.db")).unwrap();
    let agent_id = insert_agent(&conn, "codex-agent", "/p", "codex", "full-auto").unwrap();
    let conv_id = uuid::Uuid::new_v4().to_string();
    let now = db::now_ms();
    conn.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1, ?2, 'Patch model', ?3, ?3, 'idle')",
        rusqlite::params![conv_id, agent_id, now],
    )
    .unwrap();
    let plugin_db = crate::db::open_at(&dir.path().join("pm.db")).unwrap();
    let plugin_manager = crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(
        std::sync::Mutex::new(plugin_db),
    ));
    let state = AppState::new(
        conn,
        token.to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        plugin_manager,
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/conversations/:id/model",
            axum::routing::patch(patch_conversation_model),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state.clone());
    (app, state, conv_id)
}

async fn send_patch_model(
    app: axum::Router,
    conv_id: &str,
    model_id: serde_json::Value,
) -> axum::response::Response {
    let body = serde_json::json!({ "model_id": model_id });
    app.oneshot(
        Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/conversations/{}/model", conv_id))
            .header("Authorization", "Bearer tok")
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

fn conversation_model_id(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT model_id FROM conversations WHERE id = ?1",
        [conv_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn conversation_messages(state: &AppState, conv_id: &str) -> Vec<(i64, String, serde_json::Value)> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT seq, role, payload FROM messages WHERE conversation_id = ?1 ORDER BY seq ASC",
        )
        .unwrap();
    stmt.query_map([conv_id], |row| {
        let payload: String = row.get(2)?;
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            serde_json::from_str(&payload).unwrap(),
        ))
    })
    .unwrap()
    .map(|row| row.unwrap())
    .collect()
}

fn assert_status(actual: StatusCode, expected: StatusCode, msg: &str) {
    assert_eq!(actual, expected, "{}", msg);
}

fn assert_value(actual: &serde_json::Value, expected: &str, msg: &str) {
    assert_eq!(
        *actual,
        serde_json::Value::String(expected.to_string()),
        "{}",
        msg
    );
}

/// PATCH model inserts one system_event for a Codex concrete model.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime       = "codex"（fallback provider contains gpt-5.3-codex）
///   model_id      = NULL（conversation initially uses Default）
///   messages      = 0 existing rows
///   next seq      = COALESCE(MAX(seq), 0) + 1 = 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. PATCH { "model_id": "gpt-5.3-codex" } with a valid Bearer token
///   2. Handler validates the model against the Codex fallback list
///   3. Handler persists conversations.model_id and inserts seq 1 system_event
///
/// 预期结果：
///   - 断言 A：HTTP 200 confirms the supported model switch succeeds
///   - 断言 B：response and DB model_id both equal "gpt-5.3-codex"
///   - 断言 C：exactly one message exists and its seq is 1
///   - 断言 D：message role is system_event and not agent_text
///   - 断言 E：payload records Default/null → Codex 5.3/gpt-5.3-codex
#[tokio::test]
async fn test_patch_conversation_model_inserts_system_event() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    let resp = send_patch_model(app, &conv_id, serde_json::json!("gpt-5.3-codex")).await;

    assert_status(
        resp.status(),
        StatusCode::OK,
        "patching a supported Codex model should return 200",
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_value(
        &json["model_id"],
        "gpt-5.3-codex",
        "response model_id should reflect the selected concrete model",
    );
    assert_eq!(
        conversation_model_id(&state, &conv_id),
        Some("gpt-5.3-codex".to_string()),
        "DB model_id should persist the selected concrete model"
    );
    let messages = conversation_messages(&state, &conv_id);
    assert_eq!(
        messages.len(),
        1,
        "one system_event should be inserted for the first model switch"
    );
    assert_eq!(
        messages[0].0, 1,
        "first inserted model_changed event should use seq 1"
    );
    assert_eq!(
        messages[0].1, "system_event",
        "model changes should be persisted as system_event messages"
    );
    assert_ne!(
        messages[0].1, "agent_text",
        "model changes must not be persisted as agent_text"
    );
    assert_value(
        &messages[0].2["event"],
        "model_changed",
        "system_event payload should identify the model_changed event",
    );
    assert!(
        messages[0].2["from_model_id"].is_null(),
        "from_model_id should be null when switching from the default model"
    );
    assert_value(
        &messages[0].2["to_model_id"],
        "gpt-5.3-codex",
        "to_model_id should record the selected concrete model",
    );
    assert_value(
        &messages[0].2["from_label"],
        "Default",
        "from_label should render the default NULL model as Default",
    );
    assert_value(
        &messages[0].2["to_label"],
        "Codex 5.3",
        "to_label should render gpt-5.3-codex with the product-facing label",
    );
}

/// PATCH model rejects running conversations before DB side effects.
///
/// 数据构造（含关键数值的推导过程）：
///   status        = "running"（active turn cannot safely change model）
///   model_id      = NULL before request
///   messages      = 0 existing rows
///   invalid write = any inserted event would make message count 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. Set the conversation status to running in SQLite
///   2. PATCH { "model_id": "gpt-5.3-codex" } with a valid model id
///   3. Handler detects the active status and returns before DB writes
///
/// 预期结果：
///   - 断言 A：HTTP 409 reports the status conflict
///   - 断言 B：DB model_id remains NULL
///   - 断言 C：message count remains 0, proving no system_event was inserted
#[tokio::test]
async fn test_patch_conversation_model_rejects_running_status() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [&conv_id],
        )
        .unwrap();
    }
    let resp = send_patch_model(app, &conv_id, serde_json::json!("gpt-5.3-codex")).await;

    assert_status(
        resp.status(),
        StatusCode::CONFLICT,
        "running conversations should reject model changes with 409",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should remain null after a rejected running-status patch"
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        0,
        "rejected running-status patches must not insert system_event messages"
    );
}

/// PATCH model rejects the literal default sentinel.
///
/// 数据构造（含关键数值的推导过程）：
///   request model = "default"（virtual runtime list item, not a persisted id）
///   stored model  = NULL（the only valid persisted default representation）
///   DB writes     = 0 expected writes because normalization rejects first
///
/// 执行过程（逐步说明系统如何处理）：
///   1. PATCH { "model_id": "default" }
///   2. Handler trims and normalizes model_id
///   3. Handler rejects the sentinel before validation or persistence
///
/// 预期结果：
///   - 断言 A：HTTP 400 tells clients the payload is invalid
///   - 断言 B：DB model_id remains NULL after rejection
#[tokio::test]
async fn test_patch_conversation_model_rejects_default_string() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    let resp = send_patch_model(app, &conv_id, serde_json::json!("default")).await;

    assert_status(
        resp.status(),
        StatusCode::BAD_REQUEST,
        "literal default should be rejected with 400 because NULL stores default",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should remain null after rejecting literal default"
    );
}

/// PATCH model rejects an unsupported concrete model id for a valid Codex runtime.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime        = "codex"（valid runtime, so failure is not UnknownRuntime）
///   request model  = "not-a-codex-model"（not in the Codex fallback model list）
///   stored model   = NULL before request
///   initial msgs   = 0, so any inserted system_event would make count 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. PATCH { "model_id": "not-a-codex-model" } with a valid Bearer token
///   2. Handler normalizes the concrete model id
///   3. Provider validation rejects it as unsupported for the valid Codex runtime
///   4. Handler returns before updating conversations.model_id or inserting a message
///
/// 预期结果：
///   - 断言 A：HTTP 400 reports an invalid unsupported model id
///   - 断言 B：DB conversations.model_id remains NULL after rejection
///   - 断言 C：message count remains 0, proving no system_event was inserted
#[tokio::test]
async fn test_patch_conversation_model_rejects_unsupported_model_id() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    let resp = send_patch_model(app, &conv_id, serde_json::json!("not-a-codex-model")).await;

    assert_status(
        resp.status(),
        StatusCode::BAD_REQUEST,
        "unsupported concrete Codex model should be rejected with 400",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should remain null after rejecting an unsupported concrete model"
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        0,
        "unsupported concrete model patches must not insert system_event messages"
    );
}

/// PATCH model rolls back the model update if system_event insertion fails.
///
/// 数据构造（含关键数值的推导过程）：
///   runtime       = "codex"（valid runtime and valid target model）
///   model_id      = NULL before request
///   target model  = "gpt-5.3-codex"
///   trigger       = messages_insert_fails raises after next seq can be calculated
///
/// 执行过程（逐步说明系统如何处理）：
///   1. Create a messages BEFORE INSERT trigger that raises an error
///   2. PATCH { "model_id": "gpt-5.3-codex" }
///   3. Handler attempts the model update plus system_event insert as one unit
///   4. Insert failure aborts the unit and the model update is rolled back
///
/// 预期结果：
///   - 断言 A：HTTP 500 reports the failed write path
///   - 断言 B：DB conversations.model_id remains NULL after the failed insert
#[tokio::test]
async fn test_patch_conversation_model_rolls_back_when_system_event_insert_fails() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "CREATE TRIGGER messages_insert_fails
             BEFORE INSERT ON messages
             BEGIN
                 SELECT RAISE(FAIL, 'forced message insert failure');
             END",
            [],
        )
        .expect("setup should create trigger to force insert failure after model update");
    }

    let resp = send_patch_model(app, &conv_id, serde_json::json!("gpt-5.3-codex")).await;

    assert_status(
        resp.status(),
        StatusCode::INTERNAL_SERVER_ERROR,
        "failed system_event insertion should return 500",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should remain null when system_event insertion fails"
    );
}

/// PATCH model clears to default and avoids duplicate events for a no-op.
///
/// 数据构造（含关键数值的推导过程）：
///   starting model = "gpt-5.3-codex"（concrete override already persisted）
///   first request  = NULL（clear override and switch to Default）
///   initial msgs   = 0, so first event seq = COALESCE(MAX(seq), 0) + 1 = 1
///   second request = NULL（same model as current state, so no-op）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. Seed conversations.model_id to "gpt-5.3-codex"
///   2. PATCH { "model_id": null } to clear the override
///   3. PATCH { "model_id": null } again after the conversation is already default
///
/// 预期结果：
///   - 断言 A：first patch returns 200 and DB model_id becomes NULL
///   - 断言 B：first patch inserts exactly one system_event
///   - 断言 C：second patch returns 200 and DB model_id remains NULL
///   - 断言 D：second patch does not insert a duplicate system_event
#[tokio::test]
async fn test_patch_conversation_model_clears_to_default_without_duplicate_for_same_model() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE conversations SET model_id = 'gpt-5.3-codex' WHERE id = ?1",
            [&conv_id],
        )
        .unwrap();
    }
    let first_resp = send_patch_model(app.clone(), &conv_id, serde_json::Value::Null).await;

    assert_status(
        first_resp.status(),
        StatusCode::OK,
        "clearing a concrete model to default should return 200",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should be null after clearing to default"
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        1,
        "first clear-to-default patch should insert exactly one system_event"
    );
    let second_resp = send_patch_model(app, &conv_id, serde_json::Value::Null).await;

    assert_status(
        second_resp.status(),
        StatusCode::OK,
        "repeating the same default model patch should still return 200",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "DB model_id should remain null after repeated default patch"
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        1,
        "same-model patch should not insert a duplicate system_event"
    );
}
