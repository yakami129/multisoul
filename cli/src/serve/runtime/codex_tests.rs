use super::*;
use serde_json::json;
use std::{
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

/// extract_text_from_array: agent_message with content array.
///
/// Execution:
///   1. Build item JSON with content: [{type: output_text, text: "Hello"}, {type: output_text, text: "world"}]
///   2. Call extract_text_from_array(&item, "content", "output_text")
///
/// Expected:
///   - returns "Hello\nworld"
#[test]
fn test_extract_text_from_agent_message() {
    let v = json!({
        "type": "agent_message",
        "content": [
            {"type": "output_text", "text": "Hello"},
            {"type": "output_text", "text": "world"}
        ]
    });
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(
        text, "Hello\nworld",
        "should join output_text elements with newline"
    );
}

/// extract_text_from_array: filters out non-matching element types.
///
/// Execution:
///   1. Build item with mixed content types
///   2. Call extract_text_from_array filtering for "output_text"
///
/// Expected:
///   - only "output_text" elements included
#[test]
fn test_extract_text_filters_by_type() {
    let v = json!({
        "content": [
            {"type": "other", "text": "ignored"},
            {"type": "output_text", "text": "kept"}
        ]
    });
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(text, "kept", "should exclude non-output_text elements");
}

/// extract_text_from_array: fallback to top-level text field.
///
/// Execution:
///   1. Build item with no content array but a top-level text field
///   2. Call extract_text_from_array
///
/// Expected:
///   - returns the top-level text value
#[test]
fn test_extract_text_fallback_to_text_field() {
    let v = json!({"text": "fallback value"});
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(
        text, "fallback value",
        "should fall back to top-level text field"
    );
}

/// mode_flags: maps fresh exec mode strings to Codex CLI top-level flags.
///
/// Data construction:
///   full-auto / auto-edit = danger-full-access sandbox + non-interactive approval
///   yolo                  = bypass approvals and sandbox
///   suggest / ""          = no runtime overrides
///
/// Execution:
///   1. Call mode_flags for each mode
///   2. Compare each exact argv fragment
///   3. Check unsupported modes return no flags
///
/// Expected:
///   - full-auto uses top-level `codex -s danger-full-access -a never`
///   - full-auto does not use `-c approval_policy=...` for fresh exec
///   - auto-edit matches full-auto
///   - yolo uses bypass flag
///   - suggest and empty mode add no flags
#[test]
fn test_mode_flags() {
    assert_eq!(
        mode_flags("full-auto"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "fresh full-auto should use top-level Codex sandbox and approval flags"
    );
    assert!(
        !mode_flags("full-auto").contains(&"approval_policy=\"never\""),
        "fresh full-auto should not rely on config override when -a never is available"
    );
    assert_eq!(
        mode_flags("auto-edit"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "fresh auto-edit should match full-auto top-level Codex flags"
    );
    assert_eq!(
        mode_flags("yolo"),
        vec!["--dangerously-bypass-approvals-and-sandbox"],
        "yolo must bypass approvals and sandbox explicitly"
    );
    assert!(
        mode_flags("suggest").is_empty(),
        "suggest should add no flags"
    );
    assert!(mode_flags("").is_empty(), "empty mode should add no flags");
}

/// resume_mode_flags: maps resume mode strings to Codex CLI top-level flags.
///
/// Data construction:
///   `codex -s danger-full-access -a never exec resume ...` parses successfully.
///   Therefore resume can use the same top-level sandbox and approval flags as fresh exec.
///
/// Execution:
///   1. Call resume_mode_flags("full-auto")
///   2. Call resume_mode_flags("auto-edit")
///   3. Call resume_mode_flags("suggest")
///
/// Expected:
///   - full-auto includes -s danger-full-access
///   - full-auto includes -a never
///   - full-auto does not include config overrides
///   - auto-edit matches full-auto
///   - suggest returns no flags
#[test]
fn test_resume_mode_flags() {
    assert_eq!(
        resume_mode_flags("full-auto"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "resume full-auto should use top-level Codex sandbox and approval flags"
    );
    assert!(
        !resume_mode_flags("full-auto").contains(&"-c"),
        "resume full-auto should not need config overrides"
    );
    assert_eq!(
        resume_mode_flags("auto-edit"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "resume auto-edit should match resume full-auto"
    );
    assert!(
        resume_mode_flags("suggest").is_empty(),
        "resume suggest should add no flags"
    );
}

/// build_codex_args: 默认 full-auto 新会话用 Codex 顶层 flags 启动。
///
/// 数据构造（含关键数值的推导过程）：
///   project_path = "/repo"（只作为 --cd 参数，无 token/预算/阈值计算）
///   thread_id    = None（表示新会话，因此应追加 exec 而不是 exec resume）
///   mode         = "full-auto"（agent register 默认值）
///
/// 执行过程：
///   1. 调用 build_codex_args("/repo", None, "full-auto")
///   2. mode_flags 先产出 ["-s", "danger-full-access", "-a", "never"]
///   3. 新会话分支追加 ["exec", "--skip-git-repo-check", "--json", "--cd", "/repo", "-"]
///
/// 预期结果：
///   - 正断言：argv 前四项是 `codex -s danger-full-access -a never` 的参数部分
///   - 正断言：随后进入 `exec` 非交互 JSON 模式
///   - 负断言：不再出现 approval_policy 配置覆盖
///   - 负断言：不再出现 sandbox_mode 配置覆盖
#[test]
fn test_build_codex_args_full_auto_fresh_uses_top_level_defaults() {
    let args = build_codex_args("/repo", None, "full-auto", None);

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
            "-"
        ],
        "fresh full-auto should start as `codex -s danger-full-access -a never exec ...`"
    );
    assert!(
        !args.iter().any(|arg| arg == "approval_policy=\"never\""),
        "fresh full-auto should not pass approval_policy config override"
    );
    assert!(
        !args
            .iter()
            .any(|arg| arg == "sandbox_mode=\"danger-full-access\""),
        "fresh full-auto should not pass sandbox_mode config override"
    );
}

/// send_to_session: 已存在的 Codex session 必须把 file_id 放进队列消息。
///
/// 数据构造（含关键数值的推导过程）：
///   conv_id     = "conv-1"（已有 session key）
///   user_text   = "请看图"
///   file_id     = "img-1.jpg"（上传接口返回的文件名）
///   uploads_dir = /tmp/uploads（本测试不 spawn Codex，因此不读取文件）
///
/// 执行过程：
///   1. 手动创建 SessionHandle 并插入 state.sessions["conv-1"]
///   2. 调用 codex::send_to_session(..., Some("img-1.jpg"), ...)
///   3. 从 session channel 接收消息
///
/// 预期结果：
///   - 正断言：queued.user_text == "请看图"，说明文本未丢
///   - 正断言：queued.file_id == Some("img-1.jpg")，说明图片 id 没在 Codex 分支丢失
///   - 负断言：queued.file_id != None，防止退回旧实现的纯文本队列
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
        "请看图",
        Some("img-1.jpg"),
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

#[test]
fn clears_stale_codex_thread_id() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                codex_thread_id TEXT
            );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, codex_thread_id) VALUES ('conv-1', 'thread-old')",
        [],
    )
    .unwrap();
    let state = AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    );

    clear_thread_id(&state, "conv-1");

    let db = state.db.lock().unwrap();
    let thread_id: Option<String> = db
        .query_row(
            "SELECT codex_thread_id FROM conversations WHERE id = 'conv-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(thread_id, None);
}

/// abort API: 正在阻塞于 codex process_turn stdout 读取的真实子进程会被终止。
///
/// 数据构造（含关键数值推导）：
///   child script:
///     - 先读取 stdin 到 EOF，匹配 codex_turn 写 prompt 后关闭 stdin 的行为
///     - 再 sleep 30s，不输出 turn.completed，让 process_turn 卡在 read_line
///   wait budget:
///     - abort 后最多轮询 20 次 * 50ms = 1000ms
///     - 1000ms << 30s，因此若进程在预算内退出，只能来自 abort kill，不是自然结束
///
/// 执行过程：
///   1. 创建真实 sh 子进程，stdin/stdout/stderr 均为 pipe
///   2. 用独立线程调用 codex_turn::process_turn，线程会写 prompt、关闭 stdin、阻塞读 stdout
///   3. 将 child pid 注册到 AppState.sessions[conv_id]
///   4. 调用与 HTTP handler 相同的 remove + abort_current_process 路径
///   5. 等待 process_turn 线程返回，并检查子进程不再存活
///
/// 预期结果：
///   - abort_current_process 返回 true：真实 pid 收到 kill 请求
///   - process_turn 在 1000ms 内返回：没有继续卡在 read_line
///   - child pid 在 1000ms 内不可 kill(pid, 0)：真实子进程已退出
///   - sessions 中 conv_id 不存在：下一条消息会创建新 worker
#[cfg(unix)]
#[test]
fn abort_kills_child_blocking_inside_codex_process_turn() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                last_message_at INTEGER NOT NULL DEFAULT 0,
                codex_thread_id TEXT
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL
            );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, status, last_message_at, codex_thread_id)
         VALUES ('conv-1', 'idle', 0, NULL)",
        [],
    )
    .unwrap();
    let state = AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    );

    let mut child = Command::new("sh")
        .arg("-c")
        .arg("cat >/dev/null; sleep 30")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .tap_start_new_process_group()
        .spawn()
        .unwrap();
    let pid = child.id();
    let stdin = child.stdin.take().unwrap();

    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = crate::serve::state::SessionHandle::new(tx);
    handle.set_current_pid(pid);
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle.clone());

    let state_for_turn = state.clone();
    let turn_thread = std::thread::spawn(move || {
        let mut thread_id = None;
        super::codex_turn::process_turn(
            &state_for_turn,
            "conv-1",
            "hello",
            child,
            stdin,
            &mut thread_id,
        )
    });

    assert!(
        wait_until(Duration::from_millis(1000), || {
            let db = state.db.lock().unwrap();
            let status: String = db
                .query_row(
                    "SELECT status FROM conversations WHERE id = 'conv-1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            status == "running"
        }),
        "process_turn should mark the conversation running within 1000ms before abort"
    );
    {
        let db = state.db.lock().unwrap();
        let status: String = db
            .query_row(
                "SELECT status FROM conversations WHERE id = 'conv-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            status, "running",
            "process_turn should have started and marked the conversation running before abort"
        );
    }

    let removed_session = state.sessions.lock().unwrap().remove("conv-1");
    let removed_session = removed_session.expect("session handle should exist before abort");
    assert!(
        removed_session.abort_current_process(),
        "abort_current_process should send SIGKILL to the registered child pid"
    );

    let turn_result = join_with_timeout(turn_thread, Duration::from_millis(1000));
    assert!(
        turn_result.is_some(),
        "process_turn should return within 1000ms after abort kills the child"
    );
    let turn_result = turn_result
        .unwrap()
        .expect("process_turn thread should not panic after abort");
    assert!(
        turn_result.is_err(),
        "killed child should make process_turn return an error instead of a successful turn"
    );
    assert!(
        wait_until(Duration::from_millis(1000), || !process_exists(pid)),
        "child pid should be gone within 1000ms after abort, proving the running process was killed"
    );
    assert!(
        !state.sessions.lock().unwrap().contains_key("conv-1"),
        "abort should remove the session handle so the next message starts a fresh worker"
    );
}

fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    condition()
}

fn join_with_timeout<T>(
    handle: std::thread::JoinHandle<T>,
    timeout: Duration,
) -> Option<std::thread::Result<T>> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if handle.is_finished() {
            return Some(handle.join());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

fn process_exists(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill(pid, 0) only checks whether the pid exists; it does not send a signal.
        unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return false;
            }
            CloseHandle(h);
            true
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

trait StartNewProcessGroupForTest {
    fn tap_start_new_process_group(&mut self) -> &mut Self;
}

impl StartNewProcessGroupForTest for Command {
    fn tap_start_new_process_group(&mut self) -> &mut Self {
        crate::serve::state::start_new_process_group(self);
        self
    }
}
