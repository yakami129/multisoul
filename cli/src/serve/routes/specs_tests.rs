use super::*;
use crate::{
    db,
    serve::{plugin::PluginManager, state::AppState},
};
use axum::{extract::Path, http::StatusCode, Json};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

struct SpecDispatchTestState {
    state: AppState,
    project_dir: tempfile::TempDir,
}

fn spec_dispatch_test_state() -> SpecDispatchTestState {
    let project_dir = tempdir().expect("test project dir should be created");
    let db_dir = tempdir().expect("test db dir should be created");
    let conn = db::open_at(&db_dir.path().join("specs.db"))
        .expect("test database should open with production schema");
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at, mode)
         VALUES ('agent-1', 'Agent One', ?1, 'codex', 1, 'full-auto')",
        [project_dir.path().to_string_lossy().as_ref()],
    )
    .expect("seed agent should be inserted with project path and codex runtime");
    let plugin_db = db::open_at(&db_dir.path().join("plugins.db"))
        .expect("plugin database should open with production schema");
    let state = AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        db_dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    );
    SpecDispatchTestState { state, project_dir }
}

/// dispatch_spec_core: 派发 Spec 时必须原子化地落盘、创建会话、入库首条指令并投递到已有 runtime session。
///
/// 数据构造（含关键数值的推导过程）：
///   agent.id        = agent-1
///   runtime         = codex（测试插入已有 SessionHandle，避免真实启动 Codex 子进程）
///   conversation_id = conv-spec-1（固定值，便于断言 DB 和 runtime queue）
///   date_prefix     = 2026-05-31
///   slug            = spec-management-module
///   repo path       = docs/product-specs/2026-05-31-SPEC-spec-management-module.md
///   existing msgs   = 0 条，因此首条 user_text seq = COALESCE(MAX(seq),0)+1 = 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 将 agent 指向临时 project_dir，并为 conv-spec-1 注入已有 runtime channel
///   2. 调用 dispatch_spec_core(..., dispatch_runtime=true)
///   3. handler 校验 slug，写入 repo spec 文件
///   4. handler 创建 running conversation，并插入首条 user_text 指令
///   5. handler 复用 runtime::send_to_session，把同一条指令排入已有 channel
///
/// 预期结果：
///   - 断言 A：HTTP 状态为 201，说明派发请求成功
///   - 断言 B：spec 文件存在且内容等于 markdown，说明不会只创建 conversation 不落盘
///   - 断言 C：conversation.status 为 running，说明派发后 Activity 可复用运行中状态
///   - 断言 D：首条消息 seq=1 且包含 repo path，说明 agent 收到可定位的 spec 路径
///   - 断言 E：runtime queue 收到 seq=1，说明不是只写 DB 未真正派发
#[tokio::test]
async fn dispatch_spec_core_writes_file_creates_running_conversation_and_queues_runtime() {
    let fixture = spec_dispatch_test_state();
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = crate::serve::state::SessionHandle::new(tx);
    fixture
        .state
        .sessions
        .lock()
        .expect("sessions mutex should be available")
        .insert("conv-spec-1".to_string(), handle);

    let (status, Json(response)) = dispatch_spec_core(
        fixture.state.clone(),
        "agent-1".to_string(),
        DispatchSpecBody {
            title: "Spec Management Module".to_string(),
            slug: "spec-management-module".to_string(),
            markdown: "# Spec Management Module\n\nShip the MVP.\n".to_string(),
        },
        DispatchSpecOptions {
            date_prefix: "2026-05-31".to_string(),
            conversation_id: "conv-spec-1".to_string(),
            dispatch_runtime: true,
        },
    )
    .await
    .expect("valid dispatch request should succeed");

    assert_eq!(
        status,
        StatusCode::CREATED,
        "dispatch_spec_core should return 201 for a valid spec dispatch"
    );
    assert_eq!(
        response.conversation_id, "conv-spec-1",
        "response should expose the created conversation id for mobile navigation"
    );
    assert_eq!(
        response.repo_spec_path, "docs/product-specs/2026-05-31-SPEC-spec-management-module.md",
        "response should expose the repo-relative spec path used by the agent"
    );

    let spec_path = fixture.project_dir.path().join(&response.repo_spec_path);
    let written = std::fs::read_to_string(&spec_path)
        .expect("dispatch should write the spec markdown into the project");
    assert_eq!(
        written, "# Spec Management Module\n\nShip the MVP.\n",
        "spec file content should exactly match the approved markdown"
    );
    assert!(
        spec_path.exists(),
        "repo spec path should exist after dispatch: {}",
        spec_path.display()
    );

    let (status, title): (String, String) = fixture
        .state
        .db
        .lock()
        .expect("database mutex should be available")
        .query_row(
            "SELECT status, title FROM conversations WHERE id = 'conv-spec-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("dispatch should create a conversation row");
    assert_eq!(
        status, "running",
        "created spec conversation should be running immediately after dispatch"
    );
    assert_eq!(
        title, "Spec: Spec Management Module",
        "conversation title should be derived from the spec title"
    );

    let (seq, payload): (i64, String) = fixture
        .state
        .db
        .lock()
        .expect("database mutex should be available")
        .query_row(
            "SELECT seq, payload FROM messages WHERE conversation_id = 'conv-spec-1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("dispatch should create the initial user_text message");
    assert_eq!(
        seq, 1,
        "first dispatch message should use seq=1 for a new conversation"
    );
    assert!(
        payload.contains("docs/product-specs/2026-05-31-SPEC-spec-management-module.md"),
        "initial message payload should contain the repo-relative spec path"
    );
    assert!(
        !payload.contains("missing-spec.md"),
        "initial message payload should not contain unrelated placeholder paths"
    );

    let queued = rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .expect("existing runtime session should receive queued spec dispatch");
    assert_eq!(
        queued.seq, 1,
        "runtime dispatch should carry the same seq as the DB message"
    );
    assert!(
        queued.user_text.contains("Spec Management Module"),
        "runtime dispatch should contain the spec title for agent context"
    );
    assert!(
        queued
            .user_text
            .contains("docs/product-specs/2026-05-31-SPEC-spec-management-module.md"),
        "runtime dispatch should contain the spec path for agent execution"
    );
}

/// dispatch_spec_core: 非安全 slug 必须在落盘和建会话之前被拒绝。
///
/// 数据构造（含关键数值的推导过程）：
///   slug       = "../escape"（包含点号和斜杠，可能逃出 docs/product-specs）
///   date       = 2026-05-31
///   expected DB writes = 0 条 conversations，因为校验应先于任何副作用
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 dispatch_spec_core，传入恶意 slug
///   2. slug 校验失败，直接返回 400
///   3. 不写 spec 文件，不创建 conversation
///
/// 预期结果：
///   - 断言 A：返回 400 BAD_REQUEST
///   - 断言 B：conversations 数量仍为 0，说明拒绝发生在 DB 写入之前
///   - 断言 C：docs/product-specs 目录不存在，说明拒绝发生在文件写入之前
#[tokio::test]
async fn dispatch_spec_core_rejects_unsafe_slug_before_side_effects() {
    let fixture = spec_dispatch_test_state();

    let err = dispatch_spec_core(
        fixture.state.clone(),
        "agent-1".to_string(),
        DispatchSpecBody {
            title: "Unsafe Spec".to_string(),
            slug: "../escape".to_string(),
            markdown: "# Unsafe\n".to_string(),
        },
        DispatchSpecOptions {
            date_prefix: "2026-05-31".to_string(),
            conversation_id: "conv-unsafe".to_string(),
            dispatch_runtime: false,
        },
    )
    .await
    .expect_err("unsafe slug should be rejected before side effects");

    assert_eq!(
        err,
        StatusCode::BAD_REQUEST,
        "unsafe slug containing path traversal should return 400"
    );
    let conversation_count: i64 = fixture
        .state
        .db
        .lock()
        .expect("database mutex should be available")
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .expect("conversation count query should succeed");
    assert_eq!(
        conversation_count, 0,
        "invalid slug must not create any conversation rows"
    );
    assert!(
        !fixture
            .project_dir
            .path()
            .join("docs/product-specs")
            .exists(),
        "invalid slug must not create docs/product-specs on disk"
    );
}

/// dispatch_spec_core: 目标 spec 文件已存在时必须返回 409，不能覆盖用户已审阅的文档。
///
/// 数据构造（含关键数值的推导过程）：
///   date_prefix = 2026-05-31
///   slug        = spec-management-module
///   repo path   = docs/product-specs/2026-05-31-SPEC-spec-management-module.md
///   existing content = "# Existing\n"
///   expected DB writes = 0 条 conversations，因为文件冲突应在建会话前停止
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 预先创建 docs/product-specs/2026-05-31-SPEC-spec-management-module.md
///   2. 调用 dispatch_spec_core，传入同一 slug/date
///   3. OpenOptions::create_new(true) 命中 AlreadyExists
///   4. handler 返回 409，不创建 conversation，不覆盖文件内容
///
/// 预期结果：
///   - 断言 A：返回 409 CONFLICT，说明冲突被明确暴露给移动端
///   - 断言 B：文件内容仍是 "# Existing\n"，说明不会覆盖已有 spec
///   - 断言 C：conversations 数量仍为 0，说明不会创建无法执行的新会话
///   - 断言 D：没有排入 runtime session，说明冲突不会触发 agent
#[tokio::test]
async fn dispatch_spec_core_rejects_existing_file_without_db_or_runtime_side_effects() {
    let fixture = spec_dispatch_test_state();
    let repo_spec_path = fixture
        .project_dir
        .path()
        .join("docs/product-specs/2026-05-31-SPEC-spec-management-module.md");
    std::fs::create_dir_all(
        repo_spec_path
            .parent()
            .expect("repo spec path should have a parent directory"),
    )
    .expect("test should create docs/product-specs directory");
    std::fs::write(&repo_spec_path, "# Existing\n")
        .expect("test should seed an existing spec file");
    let (tx, rx) = std::sync::mpsc::channel();
    fixture
        .state
        .sessions
        .lock()
        .expect("sessions mutex should be available")
        .insert(
            "conv-existing-file".to_string(),
            crate::serve::state::SessionHandle::new(tx),
        );

    let err = dispatch_spec_core(
        fixture.state.clone(),
        "agent-1".to_string(),
        DispatchSpecBody {
            title: "Spec Management Module".to_string(),
            slug: "spec-management-module".to_string(),
            markdown: "# New Content\n".to_string(),
        },
        DispatchSpecOptions {
            date_prefix: "2026-05-31".to_string(),
            conversation_id: "conv-existing-file".to_string(),
            dispatch_runtime: true,
        },
    )
    .await
    .expect_err("existing spec file should reject dispatch");

    assert_eq!(
        err,
        StatusCode::CONFLICT,
        "existing repo spec file should return 409 CONFLICT"
    );
    let preserved = std::fs::read_to_string(&repo_spec_path)
        .expect("existing spec file should remain readable");
    assert_eq!(
        preserved, "# Existing\n",
        "dispatch must not overwrite an existing spec file"
    );
    let conversation_count: i64 = fixture
        .state
        .db
        .lock()
        .expect("database mutex should be available")
        .query_row("SELECT COUNT(*) FROM conversations", [], |row| row.get(0))
        .expect("conversation count query should succeed");
    assert_eq!(
        conversation_count, 0,
        "file conflict must not create any conversation rows"
    );
    assert!(
        rx.recv_timeout(std::time::Duration::from_millis(50))
            .is_err(),
        "file conflict must not queue any runtime message"
    );
}

/// dispatch_spec: axum handler 应把 Path(agent_id) 和 Json body 转交给派发核心。
///
/// 数据构造（含关键数值的推导过程）：
///   request agent = missing-agent
///   agents table  = only agent-1，因此查询结果 0 行
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 直接调用 axum handler dispatch_spec
///   2. handler 生成真实日期和 conversation_id 后进入核心逻辑
///   3. 核心逻辑查询不到 agent，返回 404
///
/// 预期结果：
///   - 断言 A：返回 404，说明 handler 正确使用 URL 中的 agent id
///   - 断言 B：不返回 201，说明不会在缺失 agent 时创建孤儿 conversation
#[tokio::test]
async fn dispatch_spec_handler_returns_404_for_missing_agent() {
    let fixture = spec_dispatch_test_state();

    let err = dispatch_spec(
        axum::extract::State(fixture.state.clone()),
        Path("missing-agent".to_string()),
        Json(DispatchSpecBody {
            title: "Missing Agent Spec".to_string(),
            slug: "missing-agent-spec".to_string(),
            markdown: "# Missing Agent Spec\n".to_string(),
        }),
    )
    .await
    .expect_err("dispatching to a missing agent should fail");

    assert_eq!(
        err,
        StatusCode::NOT_FOUND,
        "dispatch_spec should return 404 when the URL agent id is unknown"
    );
    assert_ne!(
        err,
        StatusCode::CREATED,
        "missing agent must not be treated as a successful dispatch"
    );
}
