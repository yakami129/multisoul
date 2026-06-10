use super::*;
use crate::serve::state::SessionHandle;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tempfile::tempdir;

/// 首次启动 Claude 后，即使还没读到 stdout，也必须已经注册 pid。
///
/// 这覆盖 Claude Code 升级后可能出现的启动期无 stdout 场景：worker 会阻塞在
/// 首个 turn 的 stdout 读取里，如果 pid 没注册，HTTP abort 只能设置 cooperative flag，杀不掉子进程。
#[cfg(unix)]
#[test]
fn initial_spawn_registers_pid_before_first_turn_read() {
    let state = make_runtime_abort_state();
    let dir = tempdir().unwrap();
    let fake_claude = dir.path().join("claude");
    let initial_pid_file = dir.path().join("initial.pid");
    std::fs::write(
        &fake_claude,
        "#!/bin/sh\necho $$ > \"$CLAUDE_INITIAL_PID_FILE\"\nsleep 30\n",
    )
    .unwrap();
    make_executable(&fake_claude);

    let _path_guard = PathEnvGuard::prepend(dir.path());
    let _pid_file_guard = EnvVarGuard::set("CLAUDE_INITIAL_PID_FILE", &initial_pid_file);

    let (tx, rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx.clone());
    let handle_for_worker = handle.clone();
    let state_for_worker = state.clone();
    let project_path = dir.path().to_path_buf();
    let worker_thread = std::thread::spawn(move || {
        session_worker(
            state_for_worker,
            "conv-1".to_string(),
            project_path.to_string_lossy().to_string(),
            None,
            rx,
            handle_for_worker,
        );
    });
    tx.send(crate::serve::state::SessionMessage {
        user_text: "hello".to_string(),
        file_id: None,
        model_id: None,
        seq: 1,
    })
    .expect("initial message should be queued to the Claude worker");

    assert!(
        wait_until(Duration::from_millis(3000), || initial_pid_file.exists()),
        "initial fake Claude pid file should appear within 3000ms after spawn"
    );
    let initial_pid: u32 = std::fs::read_to_string(&initial_pid_file)
        .expect("initial pid file should be readable")
        .trim()
        .parse()
        .expect("initial pid file should contain a numeric pid");
    assert_eq!(
        *handle.current_pid.lock().unwrap(),
        Some(initial_pid),
        "initial Claude pid must be registered before blocking on first-turn stdout"
    );

    assert!(
        handle.abort_current_process(),
        "abort_current_process should kill the registered initial Claude process group"
    );
    drop(tx);
    let worker_result = join_with_timeout(worker_thread, Duration::from_millis(1000));
    assert!(
        worker_result.is_some(),
        "Claude worker should exit within 1000ms after abort kills initial child"
    );
    worker_result
        .unwrap()
        .expect("Claude worker thread should not panic after aborting initial child");
}

/// Claude 启动期不输出 stdout 时，首条用户消息仍应先写入 stdin 并完成 turn。
#[cfg(unix)]
#[test]
fn initial_spawn_without_startup_stdout_processes_first_message() {
    let state = make_runtime_abort_state();
    let dir = tempdir().unwrap();
    let fake_claude = dir.path().join("claude");
    std::fs::write(
        &fake_claude,
        "#!/bin/sh\nread line\nprintf '%s\\n' '{\"type\":\"system\",\"session_id\":\"sid-after-input\"}'\nprintf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}}'\nprintf '%s\\n' '{\"type\":\"result\",\"is_error\":false,\"result\":\"done\"}'\ncat >/dev/null\n",
    )
    .unwrap();
    make_executable(&fake_claude);

    let _path_guard = PathEnvGuard::prepend(dir.path());

    let (tx, rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx.clone());
    let handle_for_worker = handle.clone();
    let state_for_worker = state.clone();
    let project_path = dir.path().to_path_buf();
    let worker_thread = std::thread::spawn(move || {
        session_worker(
            state_for_worker,
            "conv-1".to_string(),
            project_path.to_string_lossy().to_string(),
            None,
            rx,
            handle_for_worker,
        );
    });
    tx.send(crate::serve::state::SessionMessage {
        user_text: "hello".to_string(),
        file_id: None,
        model_id: None,
        seq: 1,
    })
    .expect("initial message should be queued to the Claude worker");

    assert!(
        wait_until(Duration::from_millis(3000), || conversation_status(&state)
            == "completed"),
        "Claude worker should complete the first turn without startup stdout"
    );
    assert_eq!(
        saved_session_id(&state),
        Some("sid-after-input".to_string()),
        "system session_id emitted after stdin should be saved"
    );
    assert!(
        messages_for_role(&state, "agent_text")
            .iter()
            .any(|payload| payload["text"].as_str() == Some("ok")),
        "assistant text emitted after stdin should be persisted"
    );

    let _ = handle.abort_current_process();
    tx.send(crate::serve::state::SessionMessage {
        user_text: "cleanup".to_string(),
        file_id: None,
        model_id: None,
        seq: 2,
    })
    .expect("cleanup message should wake the Claude worker after abort");
    drop(tx);
    let worker_result = join_with_timeout(worker_thread, Duration::from_millis(1000));
    assert!(
        worker_result.is_some(),
        "Claude worker should exit within 1000ms after cleanup abort"
    );
    worker_result
        .unwrap()
        .expect("Claude worker thread should not panic during cleanup");
}

/// model 切换重启 Claude 后，阻塞读取 stdout 之前必须注册新 pid。
///
/// 数据构造（含关键数值推导）：
///   fake claude:
///     - 无 --model 时立即输出 `{"type":"system","session_id":"sid-1"}`，让 worker 进入 rx.recv
///     - 带 `--model claude-sonnet-4-6` 时写入自身 pid 到 replacement.pid，然后 sleep 30 且不输出 stdout
///   wait budget:
///     - 等 replacement pid 文件最多 3000ms
///     - 3000ms << 30s，因此 pid 可见后 worker 仍阻塞在首个 turn 的 stdout 读取里
///
/// 执行过程：
///   1. 用 PATH 前缀注入 fake `claude`
///   2. 启动 session_worker，初始模型为 None，初始 fake child 输出 system event
///   3. 发送 model_id=Some("claude-sonnet-4-6") 的消息触发 model-change restart
///   4. replacement fake child 写 pid 后阻塞 stdout，测试读取 session_handle.current_pid
///
/// 预期结果：
///   - 正断言：replacement pid 文件出现，说明新 child 已 spawn
///   - 正断言：current_pid == replacement_pid，说明阻塞读取 stdout 前已注册新 pid
///   - 负断言：current_pid != None，说明 abort 不会只设置 cooperative flag 而漏杀 replacement child
#[cfg(unix)]
#[test]
fn model_change_restart_registers_replacement_pid_before_first_turn_read() {
    let state = make_runtime_abort_state();
    let dir = tempdir().unwrap();
    let fake_claude = dir.path().join("claude");
    let replacement_pid_file = dir.path().join("replacement.pid");
    std::fs::write(
        &fake_claude,
        "#!/bin/sh\ncase \" $* \" in\n  *\" --model claude-sonnet-4-6 \"*) echo $$ > \"$CLAUDE_REPLACEMENT_PID_FILE\"; sleep 30 ;;\n  *) printf '{\"type\":\"system\",\"session_id\":\"sid-1\"}\\n'; cat >/dev/null ;;\nesac\n",
    )
    .unwrap();
    make_executable(&fake_claude);

    let _path_guard = PathEnvGuard::prepend(dir.path());
    let _pid_file_guard = EnvVarGuard::set("CLAUDE_REPLACEMENT_PID_FILE", &replacement_pid_file);

    let (tx, rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx.clone());
    let handle_for_worker = handle.clone();
    let state_for_worker = state.clone();
    let project_path = dir.path().to_path_buf();
    let worker_thread = std::thread::spawn(move || {
        session_worker(
            state_for_worker,
            "conv-1".to_string(),
            project_path.to_string_lossy().to_string(),
            None,
            rx,
            handle_for_worker,
        );
    });

    tx.send(crate::serve::state::SessionMessage {
        user_text: "switch model".to_string(),
        file_id: None,
        model_id: Some("claude-sonnet-4-6".to_string()),
        seq: 1,
    })
    .expect("model switch message should be queued to the Claude worker");

    assert!(
        wait_until(Duration::from_millis(3000), || replacement_pid_file
            .exists()),
        "replacement fake Claude pid file should appear within 3000ms after model switch"
    );
    let replacement_pid: u32 = std::fs::read_to_string(&replacement_pid_file)
        .expect("replacement pid file should be readable")
        .trim()
        .parse()
        .expect("replacement pid file should contain a numeric pid");
    let registered_pid = *handle.current_pid.lock().unwrap();
    assert_eq!(
        registered_pid,
        Some(replacement_pid),
        "replacement Claude pid must be registered before blocking on first-turn stdout"
    );
    assert!(
        registered_pid.is_some(),
        "replacement Claude pid must not be None while child is blocked before system event"
    );

    assert!(
        handle.abort_current_process(),
        "abort_current_process should kill the registered replacement Claude process group"
    );
    drop(tx);
    let worker_result = join_with_timeout(worker_thread, Duration::from_millis(1000));
    assert!(
        worker_result.is_some(),
        "Claude worker should exit within 1000ms after abort kills replacement child"
    );
    worker_result
        .unwrap()
        .expect("Claude worker thread should not panic after aborting replacement child");
}

fn make_runtime_abort_state() -> AppState {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                last_message_at INTEGER NOT NULL DEFAULT 0,
                claude_session_id TEXT
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
        "INSERT INTO conversations (id, status, last_message_at, claude_session_id)
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
        |row| row.get::<_, String>(0),
    )
    .unwrap()
}

fn saved_session_id(state: &AppState) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT claude_session_id FROM conversations WHERE id = 'conv-1'",
        [],
        |row| row.get::<_, Option<String>>(0),
    )
    .unwrap()
}

fn messages_for_role(state: &AppState, role: &str) -> Vec<serde_json::Value> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT payload FROM messages
             WHERE conversation_id = 'conv-1' AND role = ?1
             ORDER BY seq ASC",
        )
        .unwrap();
    stmt.query_map([role], |row| row.get::<_, String>(0))
        .unwrap()
        .filter_map(|row| row.ok())
        .filter_map(|payload| serde_json::from_str(&payload).ok())
        .collect()
}

fn make_executable(path: &Path) {
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

struct EnvVarGuard {
    key: String,
    previous: Option<String>,
    _lock: std::sync::MutexGuard<'static, ()>,
}

impl EnvVarGuard {
    fn set(key: &str, value: &Path) -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var(key).ok();
        std::env::set_var(key, value);
        Self {
            key: key.to_string(),
            previous,
            _lock: lock,
        }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var(&self.key, value);
        } else {
            std::env::remove_var(&self.key);
        }
    }
}

struct PathEnvGuard {
    previous: Option<String>,
    _lock: std::sync::MutexGuard<'static, ()>,
}

impl PathEnvGuard {
    fn prepend(path: &Path) -> Self {
        static PATH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let lock = PATH_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var("PATH").ok();
        let mut paths = vec![PathBuf::from(path)];
        if let Some(previous) = &previous {
            paths.extend(std::env::split_paths(previous));
        }
        let joined = std::env::join_paths(paths).expect("test PATH entries should be joinable");
        std::env::set_var("PATH", joined);
        Self {
            previous,
            _lock: lock,
        }
    }
}

impl Drop for PathEnvGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var("PATH", value);
        } else {
            std::env::remove_var("PATH");
        }
    }
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
