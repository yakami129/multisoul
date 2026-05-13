use super::*;
use crate::serve::state::{start_new_process_group, SessionHandle};
use std::{
    io::{BufReader, Cursor},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tempfile::tempdir;

/// 检测 stale session 错误（保留已有测试）
#[test]
fn detects_claude_stale_resume_session_error() {
    let raw = serde_json::json!({
        "type": "result",
        "subtype": "error_during_execution",
        "is_error": true,
        "errors": ["No conversation found with session ID: 382eb2d5-0809-4899-83ec-bcde02c4b62b"]
    });
    assert!(is_stale_session_error(&raw));
}

/// write_user_message 写入正确的 stream-json 格式（纯文本）。
///
/// 数据构造：
///   user_text = "hello"
///
/// 执行过程：
///   1. 用 Cursor<Vec<u8>> 替代 ChildStdin 作为 sink
///   2. 调用 write_user_message
///   3. 解析写入的 JSON，验证结构
///
/// 预期结果：
///   - type == "user"
///   - message.role == "user"
///   - content[0].type == "text"
///   - content[0].text == "hello"
#[test]
fn test_write_user_message_text_format() {
    let mut buf = Cursor::new(Vec::<u8>::new());
    write_user_message(&mut buf, "hello").unwrap();
    let written = String::from_utf8(buf.into_inner()).unwrap();
    let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();
    assert_eq!(json["type"].as_str(), Some("user"), "type should be 'user'");
    assert_eq!(
        json["message"]["role"].as_str(),
        Some("user"),
        "role should be 'user'"
    );
    let content = &json["message"]["content"][0];
    assert_eq!(
        content["type"].as_str(),
        Some("text"),
        "content type should be 'text'"
    );
    assert_eq!(
        content["text"].as_str(),
        Some("hello"),
        "text should be 'hello'"
    );
}

/// write_user_message_with_image 写入图片 + 文本 content blocks。
///
/// 数据构造：
///   file_path = 临时 JPEG 文件（内容 b"fake_jpeg"）
///   user_text = "look at this"
///
/// 执行过程：
///   1. 创建临时文件，写入 fake_jpeg 字节
///   2. 调用 write_user_message_with_image
///   3. 解析 JSON，验证 content array
///
/// 预期结果：
///   - content[0].type == "image"
///   - content[0].source.type == "base64"
///   - content[0].source.media_type == "image/jpeg"
///   - content[0].source.data == base64("fake_jpeg")
///   - content[1].type == "text"
///   - content[1].text == "look at this"
#[test]
fn test_write_user_message_with_image_format() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("test.jpg");
    std::fs::write(&file_path, b"fake_jpeg").unwrap();

    let mut buf = Cursor::new(Vec::<u8>::new());
    write_user_message_with_image(&mut buf, "look at this", &file_path).unwrap();

    let written = String::from_utf8(buf.into_inner()).unwrap();
    let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();

    let content = &json["message"]["content"];
    assert_eq!(
        content.as_array().map(|a| a.len()),
        Some(2),
        "should have 2 content blocks"
    );

    let img = &content[0];
    assert_eq!(
        img["type"].as_str(),
        Some("image"),
        "first block should be image"
    );
    assert_eq!(
        img["source"]["type"].as_str(),
        Some("base64"),
        "source type should be base64"
    );
    assert_eq!(
        img["source"]["media_type"].as_str(),
        Some("image/jpeg"),
        "media_type should be image/jpeg"
    );
    let expected_b64 = STANDARD.encode(b"fake_jpeg");
    assert_eq!(
        img["source"]["data"].as_str(),
        Some(expected_b64.as_str()),
        "base64 data should match"
    );

    let txt = &content[1];
    assert_eq!(
        txt["type"].as_str(),
        Some("text"),
        "second block should be text"
    );
    assert_eq!(
        txt["text"].as_str(),
        Some("look at this"),
        "text should match"
    );
}

/// text が空でも image block だけ送信できること。
///
/// 期待结果：
///   - content array に image block のみ（len == 1）
///   - image media_type == "image/png"（PNG 文件の場合）
#[test]
fn test_write_user_message_with_image_no_text() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("test.png");
    std::fs::write(&file_path, b"fake_png").unwrap();

    let mut buf = Cursor::new(Vec::<u8>::new());
    write_user_message_with_image(&mut buf, "", &file_path).unwrap();

    let written = String::from_utf8(buf.into_inner()).unwrap();
    let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();
    let content = json["message"]["content"].as_array().unwrap();
    assert_eq!(
        content.len(),
        1,
        "should have only image block when text is empty"
    );
    assert_eq!(
        content[0]["type"].as_str(),
        Some("image"),
        "block should be image type"
    );
    assert_eq!(
        content[0]["source"]["media_type"].as_str(),
        Some("image/png"),
        "png file should have image/png media_type"
    );
}

/// abort API: 正在阻塞于 Claude process_turn stdout 读取的真实子进程会被终止。
///
/// 数据构造（含关键数值推导）：
///   child script:
///     - 先读取 stdin 到 EOF，匹配 claude_stream::process_turn 写 user message 后继续读 stdout 的行为
///     - 再 sleep 30s，不输出 result，让 process_turn 卡在 read_line
///   wait budget:
///     - abort 后最多轮询 20 次 * 50ms = 1000ms
///     - 1000ms << 30s，因此预算内返回只能来自 abort kill，不是自然结束
///
/// 执行过程：
///   1. 创建真实 sh 子进程，stdin/stdout/stderr 均为 pipe，并放入独立 process group
///   2. 用独立线程调用 claude_stream::process_turn，线程会写 user message 并阻塞读 stdout
///   3. 将 child pid 注册到 AppState.sessions[conv_id]
///   4. 调用与 HTTP handler 相同的 remove + abort_current_process 路径
///   5. 等待 process_turn 线程返回
///
/// 预期结果：
///   - abort_current_process 返回 true：真实 pid/process group 收到 kill 请求
///   - process_turn 在 1000ms 内返回：没有继续卡在 read_line
///   - process_turn 返回 Err：被杀进程不会被误判成成功 turn
///   - sessions 中 conv_id 不存在：下一条消息会创建新 worker
#[test]
fn abort_kills_child_blocking_inside_claude_process_turn() {
    let state = make_runtime_abort_state();
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
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    let (answer_tx, answer_rx) = std::sync::mpsc::sync_channel(1);
    drop(answer_tx);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);
    handle.set_current_pid(pid);
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle.clone());

    let state_for_turn = state.clone();
    let turn_thread = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let input = claude_stream::TurnInput {
            user_text: "hello",
            file_id: None,
            uploads_dir: std::path::Path::new("/tmp/uploads"),
        };
        claude_stream::process_turn(
            &mut stdin,
            &mut reader,
            &state_for_turn,
            "conv-1",
            &input,
            &answer_rx,
        )
    });

    assert!(
        wait_until(Duration::from_millis(1000), || conversation_status(&state)
            == "running"),
        "claude process_turn should mark the conversation running within 1000ms before abort"
    );
    let removed_session = state.sessions.lock().unwrap().remove("conv-1");
    let removed_session = removed_session.expect("session handle should exist before abort");
    assert!(
        removed_session.abort_current_process(),
        "abort_current_process should kill the registered Claude child process group"
    );

    let turn_result = join_with_timeout(turn_thread, Duration::from_millis(1000));
    assert!(
        turn_result.is_some(),
        "claude process_turn should return within 1000ms after abort kills the child"
    );
    let turn_result = turn_result
        .unwrap()
        .expect("claude process_turn thread should not panic after abort");
    assert!(
        turn_result.is_err(),
        "killed Claude child should make process_turn return an error, not success"
    );
    assert!(
        !state.sessions.lock().unwrap().contains_key("conv-1"),
        "abort should remove the Claude session handle so the next message starts fresh"
    );
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

trait StartNewProcessGroupForTest {
    fn tap_start_new_process_group(&mut self) -> &mut Self;
}

impl StartNewProcessGroupForTest for Command {
    fn tap_start_new_process_group(&mut self) -> &mut Self {
        start_new_process_group(self);
        self
    }
}
