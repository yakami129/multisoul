use super::*;
use serde_json::json;
use std::{
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

/// mode_flags: maps fresh exec mode strings to Codex CLI flags.
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
///   - full-auto uses public `codex exec --sandbox danger-full-access`
///   - full-auto does not use `-c sandbox_mode=...` for fresh exec
///   - auto-edit matches full-auto
///   - yolo uses bypass flag
///   - suggest and empty mode add no flags
#[test]
fn test_mode_flags() {
    assert_eq!(
        mode_flags("full-auto"),
        vec![
            "--sandbox",
            "danger-full-access",
            "-c",
            "approval_policy=\"never\""
        ],
        "fresh full-auto should use the public --sandbox flag plus non-interactive approval"
    );
    assert!(
        !mode_flags("full-auto").contains(&"sandbox_mode=\"danger-full-access\""),
        "fresh full-auto should not rely on sandbox_mode config when --sandbox is available"
    );
    assert_eq!(
        mode_flags("auto-edit"),
        vec![
            "--sandbox",
            "danger-full-access",
            "-c",
            "approval_policy=\"never\""
        ],
        "fresh auto-edit should match full-auto non-interactive danger-full-access behavior"
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

/// resume_mode_flags: maps resume mode strings to flags supported by `codex exec resume`.
///
/// Data construction:
///   `codex exec resume --help` exposes `-c/--config` but not `--sandbox`.
///   Therefore resume must configure sandbox via config overrides.
///
/// Execution:
///   1. Call resume_mode_flags("full-auto")
///   2. Call resume_mode_flags("auto-edit")
///   3. Call resume_mode_flags("suggest")
///
/// Expected:
///   - full-auto includes approval_policy="never"
///   - full-auto includes sandbox_mode="danger-full-access"
///   - full-auto does not include --sandbox
///   - auto-edit matches full-auto
///   - suggest returns no flags
#[test]
fn test_resume_mode_flags() {
    assert_eq!(
        resume_mode_flags("full-auto"),
        vec![
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"danger-full-access\""
        ],
        "resume full-auto must use config overrides because resume has no --sandbox option"
    );
    assert!(
        !resume_mode_flags("full-auto").contains(&"--sandbox"),
        "resume full-auto must not pass unsupported --sandbox"
    );
    assert_eq!(
        resume_mode_flags("auto-edit"),
        vec![
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"danger-full-access\""
        ],
        "resume auto-edit should match resume full-auto"
    );
    assert!(
        resume_mode_flags("suggest").is_empty(),
        "resume suggest should add no flags"
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
    // SAFETY: kill(pid, 0) only checks whether the pid exists; it does not send a signal.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
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
