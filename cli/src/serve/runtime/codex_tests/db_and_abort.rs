use super::super::clear_thread_id;
use super::super::codex_turn;
use super::test_helpers::{
    join_with_timeout, process_exists, wait_until, StartNewProcessGroupForTest,
};
use crate::serve::state::AppState;
use std::{
    process::{Command, Stdio},
    time::Duration,
};

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
        codex_turn::process_turn(
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
