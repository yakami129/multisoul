use super::super::{build_codex_args, send_to_session};
use crate::serve::runtime::DispatchMessage;
use crate::serve::state::AppState;
use std::{path::Path, time::Duration};

/// send_to_session: 已存在的 Codex session 必须把 file_id 和 model_id 放进队列消息。
///
/// 数据构造（含关键数值的推导过程）：
///   conv_id     = "conv-1"（已有 session key）
///   user_text   = "请看图"
///   file_id     = "img-1.jpg"（上传接口返回的文件名）
///   model_id    = "gpt-5.3-codex"（conversation 级运行时模型选择）
///   uploads_dir = /tmp/uploads（本测试不 spawn Codex，因此不读取文件）
///
/// 执行过程：
///   1. 手动创建 SessionHandle 并插入 state.sessions["conv-1"]
///   2. 调用 codex::send_to_session(..., DispatchMessage { file_id, model_id, ... }, ...)
///   3. 从 session channel 接收消息
///
/// 预期结果：
///   - 正断言：queued.user_text == "请看图"，说明文本未丢
///   - 正断言：queued.file_id == Some("img-1.jpg")，说明图片 id 没在 Codex 分支丢失
///   - 正断言：queued.model_id == Some("gpt-5.3-codex")，说明模型选择进入 worker 队列
///   - 负断言：queued.file_id != None，防止退回旧实现的纯文本队列
///   - 负断言：queued.model_id != None，防止后续 spawn 回落默认模型
#[test]
fn test_send_to_existing_codex_session_preserves_file_id() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let state = AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    );
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = crate::serve::state::SessionHandle::new(tx);
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle);

    send_to_session(
        &state,
        "conv-1",
        DispatchMessage {
            text: "请看图",
            file_id: Some("img-1.jpg"),
            model_id: Some("gpt-5.3-codex"),
            seq: 1,
        },
        "/repo",
        "full-auto",
    );

    let queued = rx
        .recv_timeout(Duration::from_millis(100))
        .expect("existing session should receive one queued Codex message");
    assert_eq!(
        queued.user_text, "请看图",
        "Codex queued message should preserve the original user text"
    );
    assert_eq!(
        queued.file_id.as_deref(),
        Some("img-1.jpg"),
        "Codex queued message should preserve file_id for --image spawning"
    );
    assert!(
        queued.file_id.is_some(),
        "Codex queued message must not drop file_id back to None"
    );
    assert_eq!(
        queued.model_id.as_deref(),
        Some("gpt-5.3-codex"),
        "Codex queued message should preserve the selected model_id for per-turn dispatch"
    );
    assert!(
        queued.model_id.is_some(),
        "Codex queued message must not drop model_id back to None"
    );
    assert_eq!(
        queued.seq, 1,
        "Codex queued message should carry the user_text seq for stale turn protection"
    );
}

/// build_codex_args: 新 Codex 会话带图时，把 `--image <path>` 放在 stdin prompt `-` 后。
///
/// 数据构造（含关键数值的推导过程）：
///   project_path = "/repo"（--cd 参数）
///   thread_id    = None（新会话，因此走 `exec` 分支）
///   mode         = "full-auto" → mode_flags = ["-s", "danger-full-access", "-a", "never"]
///   image_path   = "/tmp/uploads/img-1.jpg"
///
/// 执行过程：
///   1. 调用 build_codex_args(..., image_path=Some(...))
///   2. 新会话 argv 先追加 stdin prompt marker "-"
///   3. 再追加 ["--image", "/tmp/uploads/img-1.jpg"]
///
/// 预期结果：
///   - 正断言：argv 精确包含 `- --image /tmp/uploads/img-1.jpg`
///   - 正断言：`--image` 出现在 `-` 之后，避免 Codex CLI 可变参数吞掉 prompt
///   - 负断言：不包含旧的文本路径提示字符串
#[test]
fn test_build_codex_args_fresh_with_image_places_image_after_stdin_marker() {
    let args = build_codex_args(
        "/repo",
        None,
        "full-auto",
        Some(Path::new("/tmp/uploads/img-1.jpg")),
        None,
    );

    assert_eq!(
        args,
        vec![
            "-s",
            "danger-full-access",
            "-a",
            "never",
            "exec",
            "--skip-git-repo-check",
            "--json",
            "--cd",
            "/repo",
            "-",
            "--image",
            "/tmp/uploads/img-1.jpg"
        ],
        "fresh Codex image turn should pass the uploaded image via `--image` after stdin marker"
    );
    let stdin_idx = args
        .iter()
        .position(|arg| arg == "-")
        .expect("fresh Codex args should contain stdin marker");
    let image_idx = args
        .iter()
        .position(|arg| arg == "--image")
        .expect("fresh Codex args should contain --image");
    assert!(
        image_idx > stdin_idx,
        "`--image` should be after `-`; otherwise Codex CLI may treat the prompt marker as an image path"
    );
    assert!(
        !args.iter().any(|arg| arg.contains("[Attached image:")),
        "Codex image args should not use the old text prefix injection"
    );
}

/// build_codex_args: resume Codex 会话带图时，同样使用 `--image <path>`。
///
/// 数据构造（含关键数值的推导过程）：
///   project_path = "/repo"（resume 分支不使用 --cd）
///   thread_id    = Some("thread-1")（已有 Codex thread，因此走 `exec resume`）
///   mode         = "suggest" → mode_flags = []（便于断言 resume argv 主体）
///   image_path   = "/tmp/uploads/img-2.png"
///
/// 执行过程：
///   1. 调用 build_codex_args(..., thread_id=Some("thread-1"), image_path=Some(...))
///   2. resume argv 追加 ["exec", "resume", "--skip-git-repo-check", "thread-1", "--json", "-"]
///   3. 再追加 ["--image", "/tmp/uploads/img-2.png"]
///
/// 预期结果：
///   - 正断言：resume argv 精确包含 image 参数
///   - 正断言：`--image` 出现在 `-` 之后
///   - 负断言：resume 带图时不误加 `--cd`
#[test]
fn test_build_codex_args_resume_with_image_places_image_after_stdin_marker() {
    let args = build_codex_args(
        "/repo",
        Some("thread-1"),
        "suggest",
        Some(Path::new("/tmp/uploads/img-2.png")),
        None,
    );

    assert_eq!(
        args,
        vec![
            "exec",
            "resume",
            "--skip-git-repo-check",
            "thread-1",
            "--json",
            "-",
            "--image",
            "/tmp/uploads/img-2.png"
        ],
        "resume Codex image turn should pass the uploaded image via `--image` after stdin marker"
    );
    let stdin_idx = args
        .iter()
        .position(|arg| arg == "-")
        .expect("resume Codex args should contain stdin marker");
    let image_idx = args
        .iter()
        .position(|arg| arg == "--image")
        .expect("resume Codex args should contain --image");
    assert!(
        image_idx > stdin_idx,
        "`--image` should be after `-` for resume as well"
    );
    assert!(
        !args.iter().any(|arg| arg == "--cd"),
        "resume Codex args should not include --cd when a thread id is provided"
    );
}

/// build_codex_args: 新建和恢复 Codex 会话都应在选中模型时追加 `--model <id>`。
///
/// 数据构造（含关键数值的推导过程）：
///   selected_model = "gpt-5.3-codex"（conversation.model_id 的具体值）
///   default_model  = None（Default/未选择模型，不能生成 CLI 参数）
///   fresh thread   = None → `exec --cd /repo -`
///   resume thread  = Some("thread-1") → `exec resume thread-1 --json -`
///
/// 执行过程：
///   1. 调用 build_codex_args(..., model_id=Some("gpt-5.3-codex"))
///   2. 分别检查 fresh/resume argv 是否包含 `--model gpt-5.3-codex`
///   3. 再调用 model_id=None 的 fresh argv
///
/// 预期结果：
///   - 正断言：fresh argv 包含 `--model gpt-5.3-codex`
///   - 正断言：resume argv 包含 `--model gpt-5.3-codex`
///   - 负断言：None argv 不包含 `--model`
#[test]
fn test_build_codex_args_includes_selected_model() {
    let fresh = build_codex_args("/repo", None, "full-auto", None, Some("gpt-5.3-codex"));
    let resume = build_codex_args(
        "/repo",
        Some("thread-1"),
        "suggest",
        None,
        Some("gpt-5.3-codex"),
    );
    let default = build_codex_args("/repo", None, "full-auto", None, None);

    assert!(
        fresh
            .windows(2)
            .any(|window| window == ["--model", "gpt-5.3-codex"]),
        "fresh Codex args should include the selected concrete model"
    );
    assert!(
        resume
            .windows(2)
            .any(|window| window == ["--model", "gpt-5.3-codex"]),
        "resume Codex args should include the selected concrete model"
    );
    assert!(
        !default.iter().any(|arg| arg == "--model"),
        "Codex args for Default/None should not include --model"
    );
}
