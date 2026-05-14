use super::*;
use crate::{
    commands::agent::insert_agent,
    db,
    serve::{auth::bearer_auth, state::AppState},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

/// POST /api/v1/conversations/:id/abort 必须触发运行中 runtime 子进程的中断。
///
/// 数据构造（无 token/预算数值）：
///   - Insert agent + conversation
///   - sessions[conv_id] = fake SessionHandle，current_pid = 4242
///   - fake killer 只记录 pid，不发送真实系统信号
///
/// 执行过程：
///   1. 创建 conversation
///   2. 向 AppState.sessions 写入 fake handle，模拟 runtime worker 正在跑子进程
///   3. POST /api/v1/conversations/:conv_id/abort
///
/// 预期结果：
///   - 断言 A：HTTP status == 200，abort API 对存在的 conversation 成功
///   - 断言 B：sessions 不再包含 conv_id，后续消息会创建新 session
///   - 断言 C：fake killer 收到 pid 4242，证明 abort 触发 runtime 取消路径
///   - 断言 D：fake handle 的 pid 被清空，避免重复 kill 旧进程
#[tokio::test]
async fn test_abort_conversation_cancels_registered_runtime_handle() {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "test-agent", "/p", "claude-code", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        "tok".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/agents/:id/conversations",
            axum::routing::post(create_conversation),
        )
        .route(
            "/api/v1/conversations/:id/abort",
            axum::routing::post(abort_conversation),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state.clone());

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(
                    serde_json::json!({ "title": "abort test" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let conv_id = json["id"].as_str().unwrap().to_string();

    let killed_pid = std::sync::Arc::new(std::sync::Mutex::new(None));
    let killed_pid_for_closure = killed_pid.clone();
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = crate::serve::state::SessionHandle::new_with_killer(
        tx,
        std::sync::Arc::new(move |pid| {
            *killed_pid_for_closure.lock().unwrap() = Some(pid);
            true
        }),
    );
    handle.set_current_pid(4242);
    state
        .sessions
        .lock()
        .unwrap()
        .insert(conv_id.clone(), handle.clone());

    let abort_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/conversations/{}/abort", conv_id))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        abort_resp.status(),
        StatusCode::OK,
        "abort should succeed for an existing conversation"
    );
    assert!(
        !state.sessions.lock().unwrap().contains_key(&conv_id),
        "abort must remove the session handle so the next message starts a fresh worker"
    );
    assert_eq!(
        *killed_pid.lock().unwrap(),
        Some(4242),
        "abort must call the registered runtime killer with the current child pid"
    );
    assert_eq!(
        *handle.current_pid.lock().unwrap(),
        None,
        "abort must clear the registered runtime pid after requesting cancellation"
    );
}
