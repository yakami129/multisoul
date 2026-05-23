use super::*;
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tempfile::tempdir;

/// abort API: 正在阻塞于 Cursor process_turn stdout 读取的 fake agent 子进程会被终止。
///
/// 数据构造（含关键数值推导）：
///   fake agent:
///     - 文件路径 = tempdir/agent
///     - 内容 = sh 脚本 `sleep 30`，不输出 result，让 Cursor process_turn 卡在 read_line
///   wait budget:
///     - abort 后最多轮询 20 次 * 50ms = 1000ms
///     - 1000ms << 30s，因此预算内返回只能来自 abort kill，不是 fake agent 自然结束
///
/// 执行过程：
///   1. 写入可执行 fake agent，并把 CURSOR_AGENT_BIN 指向它
///   2. 独立线程调用 Cursor process_turn，覆盖 spawn_agent → start_new_process_group → pid registration
///   3. 等待 conversation.status 变 running，确认 process_turn 已进入运行态
///   4. 调用与 HTTP handler 相同的 remove + abort_current_process 路径
///   5. 等待 process_turn 线程返回
///
/// 预期结果：
///   - abort_current_process 返回 true：真实 fake agent process group 收到 kill 请求
///   - process_turn 在 1000ms 内返回：没有继续卡在 read_line
///   - process_turn 返回 Err：被杀 Cursor child 不会被误判成成功 turn
///   - sessions 中 conv_id 不存在：下一条消息会创建新 worker
#[cfg(unix)]
#[test]
fn abort_kills_child_blocking_inside_cursor_process_turn() {
    let state = make_runtime_abort_state();
    let dir = tempdir().unwrap();
    let fake_agent = dir.path().join("agent");
    std::fs::write(&fake_agent, "#!/bin/sh\nsleep 30\n").unwrap();
    make_executable(&fake_agent);

    let _env_guard = CursorAgentBinGuard::set(&fake_agent);

    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle.clone());

    let state_for_turn = state.clone();
    let handle_for_turn = handle.clone();
    let project_path = dir.path().to_path_buf();
    let turn_thread = std::thread::spawn(move || {
        process_turn(
            &state_for_turn,
            "conv-1",
            CursorTurn {
                prompt: "hello",
                user_seq: 1,
                project_path: project_path.to_str().unwrap(),
                mode: "full-auto",
                resume: None,
            },
            &handle_for_turn,
        )
    });

    assert!(
        wait_until(Duration::from_millis(1000), || conversation_status(&state)
            == "running"),
        "cursor process_turn should mark the conversation running within 1000ms before abort"
    );
    let registered_pid = *handle.current_pid.lock().unwrap();
    assert!(
        registered_pid.is_some(),
        "cursor process_turn should register the spawned fake agent pid before abort"
    );

    let removed_session = state.sessions.lock().unwrap().remove("conv-1");
    let removed_session = removed_session.expect("session handle should exist before abort");
    assert!(
        removed_session.abort_current_process(),
        "abort_current_process should kill the registered Cursor fake agent process group"
    );

    let turn_result = join_with_timeout(turn_thread, Duration::from_millis(1000));
    assert!(
        turn_result.is_some(),
        "cursor process_turn should return within 1000ms after abort kills the fake agent"
    );
    let turn_result = turn_result
        .unwrap()
        .expect("cursor process_turn thread should not panic after abort");
    assert!(
        turn_result.is_err(),
        "killed Cursor child should make process_turn return an error, not success"
    );
    assert!(
        !state.sessions.lock().unwrap().contains_key("conv-1"),
        "abort should remove the Cursor session handle so the next message starts fresh"
    );
}

fn make_runtime_abort_state() -> AppState {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                last_message_at INTEGER NOT NULL DEFAULT 0,
                cursor_session_id TEXT
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
        "INSERT INTO conversations (id, status, last_message_at, cursor_session_id)
             VALUES ('conv-1', 'idle', 0, NULL)",
        [],
    )
    .unwrap();
    AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    )
}

fn conversation_status(state: &AppState) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT status FROM conversations WHERE id = 'conv-1'",
        [],
        |r| r.get(0),
    )
    .unwrap()
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

fn make_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

struct CursorAgentBinGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    previous: Option<String>,
}

impl CursorAgentBinGuard {
    fn set(value: &std::path::Path) -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var("CURSOR_AGENT_BIN").ok();
        std::env::set_var("CURSOR_AGENT_BIN", value);
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for CursorAgentBinGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var("CURSOR_AGENT_BIN", value);
        } else {
            std::env::remove_var("CURSOR_AGENT_BIN");
        }
    }
}
