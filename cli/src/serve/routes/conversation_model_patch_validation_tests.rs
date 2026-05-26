async fn send_patch_model_raw(
    app: axum::Router,
    conv_id: &str,
    body: serde_json::Value,
) -> axum::response::Response {
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

/// PATCH model rejects an omitted model_id instead of clearing a concrete override.
///
/// 数据构造（含关键数值的推导过程）：
///   starting model = "gpt-5.5"（已持久化的 concrete override）
///   request body   = {}（缺少 model_id 字段，不是显式 null）
///   initial msgs   = 0；若误清空会插入 1 条 system_event
///
/// 执行过程（逐步说明系统如何处理）：
///   1. Seed conversations.model_id to "gpt-5.5".
///   2. PATCH {} with a valid Bearer token.
///   3. Handler validates request shape before interpreting null/default semantics.
///
/// 预期结果：
///   - 正断言：HTTP 400 reports the malformed request.
///   - 负断言：DB model_id must not be cleared to NULL.
///   - 负断言：no system_event is inserted for the malformed request.
#[tokio::test]
async fn test_patch_conversation_model_rejects_missing_model_id_field() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE conversations SET model_id = 'gpt-5.5' WHERE id = ?1",
            [&conv_id],
        )
        .unwrap();
    }

    let resp = send_patch_model_raw(app, &conv_id, serde_json::json!({})).await;

    assert_status(
        resp.status(),
        StatusCode::BAD_REQUEST,
        "PATCH {} should be rejected because model_id is required",
    );
    assert_eq!(
        conversation_model_id(&state, &conv_id),
        Some("gpt-5.5".to_string()),
        "missing model_id must not clear an existing concrete model override",
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        0,
        "missing model_id must not insert a model_changed system_event",
    );
}

/// PATCH model checks active conversation status before provider validation.
///
/// 数据构造（含关键数值的推导过程）：
///   status        = "running"（active turn cannot switch model）
///   request model = "not-a-codex-model"（unsupported if validation were reached）
///   stored model  = NULL before request
///   initial msgs  = 0；任何 side effect 都会使消息数变为 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. Set conversation status to running.
///   2. PATCH { "model_id": "not-a-codex-model" }.
///   3. Handler rejects active status before consulting the model provider.
///
/// 预期结果：
///   - 正断言：HTTP 409 wins over unsupported-model 400.
///   - 负断言：DB model_id remains NULL.
///   - 负断言：no system_event is inserted.
#[tokio::test]
async fn test_patch_conversation_model_rejects_running_status_before_model_validation() {
    let (app, state, conv_id) = make_patch_model_app("tok").await;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [&conv_id],
        )
        .unwrap();
    }

    let resp = send_patch_model(app, &conv_id, serde_json::json!("not-a-codex-model")).await;

    assert_status(
        resp.status(),
        StatusCode::CONFLICT,
        "running status should return 409 before unsupported-model validation can return 400",
    );
    assert!(
        conversation_model_id(&state, &conv_id).is_none(),
        "running-status rejection must leave DB model_id as NULL",
    );
    assert_eq!(
        conversation_messages(&state, &conv_id).len(),
        0,
        "running-status rejection must not insert a model_changed system_event",
    );
}
