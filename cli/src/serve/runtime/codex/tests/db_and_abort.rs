use super::super::clear_thread_id;
use super::super::turn;
use super::test_helpers::{
    join_with_timeout, process_exists, wait_until, StartNewProcessGroupForTest,
};
use crate::serve::state::AppState;
use serde_json::Value;
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

/// 旧 turn 的 completed 事件不能覆盖新 turn 的 running 状态。
///
/// 数据构造（含关键数值推导）：
///   user_text seq=1 = 旧 turn
///   user_text seq=2 = 新 turn（已由 POST /messages 标记 running）
///   conversation.status = running，表示 Activity 应展示 Running
///
/// 执行过程：
///   1. 调用 turn::complete_turn(status=completed, turn_seq=1)
///   2. complete_turn 检查是否存在 seq > 1 的 user_text
///   3. 因 seq=2 已存在，旧 completed 应被忽略
///   4. 再调用 complete_turn(status=completed, turn_seq=2)，模拟当前 turn 正常结束
///
/// 预期结果：
///   - 断言 A：旧 turn completed 后 status 仍为 running，说明 Activity 不会误入 Done
///   - 断言 B：旧 turn completed 不插入 task_status，说明不会广播陈旧完成事件
///   - 断言 C：当前 turn completed 后 status 变 completed，说明正常终态仍可落库
///   - 断言 D：当前 turn completed 插入一条 task_status，说明未破坏完成事件
#[test]
fn stale_codex_turn_completion_does_not_override_newer_user_turn() {
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
         VALUES ('conv-1', 'running', 20, NULL)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES
         ('u1', 'conv-1', 'user_text', '{\"text\":\"old\"}', 10, 1),
         ('u2', 'conv-1', 'user_text', '{\"text\":\"new\"}', 20, 2)",
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

    turn::complete_turn(&state, "conv-1", "completed", 1);

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
            "stale completed from turn seq=1 must not override newer running turn seq=2"
        );
        let task_status_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-1' AND role='task_status'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            task_status_count, 0,
            "stale completed turn must not insert a task_status message"
        );
    }

    turn::complete_turn(&state, "conv-1", "completed", 2);

    let db = state.db.lock().unwrap();
    let status: String = db
        .query_row(
            "SELECT status FROM conversations WHERE id = 'conv-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "completed",
        "current turn seq=2 should still be allowed to mark the conversation completed"
    );
    let task_status_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-1' AND role='task_status'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        task_status_count, 1,
        "current completed turn should insert exactly one task_status message"
    );
}

/// Codex tool lifecycle events should render one mobile card with a matching result.
///
/// Data construction:
///   shell child consumes stdin like `codex exec -` and prints JSONL:
///   - item.started  id=tool-1 type=mcp_tool_call
///   - item.completed id=tool-1 type=mcp_tool_call with result content
///   - turn.completed to make process_turn return normally
///
/// Expected:
///   - one `tool_call` row, not one per lifecycle event
///   - one `tool_result` row with the same call_id
///   - the tool name keeps the MCP shape mobile already formats specially
#[cfg(unix)]
#[test]
fn codex_process_turn_pairs_started_and_completed_tool_events() {
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

    let script = r#"cat >/dev/null
printf '%s\n' '{"type":"item.started","item":{"id":"tool-1","type":"mcp_tool_call","server":"figma","tool":"use_figma","arguments":{"fileKey":"abc"},"status":"running"}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"tool-1","type":"mcp_tool_call","server":"figma","tool":"use_figma","arguments":{"fileKey":"abc"},"status":"completed","result":{"content":[{"type":"text","text":"created frame"}],"structured_content":null}}}'
printf '%s\n' '{"type":"turn.completed"}'
"#;
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = child.stdin.take().unwrap();

    let mut thread_id = None;
    let result = turn::process_turn(&state, "conv-1", "hello", 1, child, stdin, &mut thread_id);
    assert!(result.is_ok(), "mock Codex turn should complete normally");

    let db = state.db.lock().unwrap();
    let rows = {
        let mut stmt = db
            .prepare(
                "SELECT role, payload FROM messages
                 WHERE conversation_id='conv-1'
                 ORDER BY seq ASC",
            )
            .unwrap();
        stmt.query_map([], |row| {
            let role: String = row.get(0)?;
            let payload: String = row.get(1)?;
            Ok((role, serde_json::from_str::<Value>(&payload).unwrap()))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
    };

    let tool_calls = rows
        .iter()
        .filter(|(role, _)| role == "tool_call")
        .collect::<Vec<_>>();
    let tool_results = rows
        .iter()
        .filter(|(role, _)| role == "tool_result")
        .collect::<Vec<_>>();
    assert_eq!(
        tool_calls.len(),
        1,
        "started/completed should produce one card"
    );
    assert_eq!(
        tool_results.len(),
        1,
        "completed should produce one tool result"
    );

    let call_payload = &tool_calls[0].1;
    let result_payload = &tool_results[0].1;
    assert_eq!(call_payload["tool"], "mcp__figma__use_figma");
    assert_eq!(call_payload["call_id"], "tool-1");
    assert_eq!(result_payload["call_id"], "tool-1");
    assert_eq!(result_payload["ok"], true);
    assert_eq!(result_payload["summary"], "created frame");
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
///   2. 用独立线程调用 turn::process_turn，线程会写 prompt、关闭 stdin、阻塞读 stdout
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
        turn::process_turn(
            &state_for_turn,
            "conv-1",
            "hello",
            1,
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
