//! Runtime adapter: one long-lived claude process per conversation.
//! Each conversation has a session_worker thread that owns the child process.
//! Messages are sent via std::sync::mpsc channel from the HTTP handler.

use crate::logging;
use crate::serve::state::AppState;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};

#[path = "claude_stream.rs"]
mod claude_stream;

#[path = "claude_db.rs"]
mod claude_db;

use claude_db::{broadcast, clear_session_id, insert_message, load_session_id, mark_failed, save_session_id};
use claude_stream::process_turn;

// ─── public API ──────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives.
/// Gets or creates a long-lived session for this conversation.
pub fn send_to_session(state: &AppState, conv_id: &str, user_text: &str, project_path: &str) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        // Session already running — enqueue the message
        if tx.send(crate::serve::state::SessionMessage { user_text: user_text.to_string(), file_id: None }).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        // Channel broken (worker crashed) — fall through to create a new one
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    // Create a new session
    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions); // release lock before spawn_blocking

    // Enqueue the first message
    let _ = tx.send(crate::serve::state::SessionMessage { user_text: user_text.to_string(), file_id: None });

    // Spawn the session worker in a blocking thread
    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path, rx);
    });
}

// ─── session worker ───────────────────────────────────────────────────────────

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
) {
    let span = info_span!("session_worker", conv_id = %conv_id, runtime = "claude");
    let _enter = span.enter();
    info!("session_worker_started");

    // Create the answer channel for this conversation (WS handler sends here)
    let answer_rx = state.create_answer_channel(&conv_id);

    // Load existing session_id from DB (for --resume on restart)
    let mut session_id: Option<String> = load_session_id(&state, &conv_id);

    // Spawn the initial claude process
    let (mut child, mut stdin) = match spawn_claude(&project_path, session_id.as_deref()) {
        Some(pair) => pair,
        None => {
            mark_failed(&state, &conv_id);
            return;
        }
    };
    info!(pid = ?child.id(), resume = ?session_id, "agent_spawn");

    // Read the system event to capture/update session_id
    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));
    if read_system_event(&mut reader, &state, &conv_id, &mut session_id) {
        warn!("agent_stale_session_detected");
        clear_session_id(&state, &conv_id);
        session_id = None;
        let _ = child.kill();
        let _ = child.wait();
        let (fresh_child, fresh_stdin) = match spawn_claude(&project_path, None) {
            Some(pair) => pair,
            None => {
                mark_failed(&state, &conv_id);
                return;
            }
        };
        child = fresh_child;
        stdin = fresh_stdin;
        reader = BufReader::new(child.stdout.take().expect("no stdout"));
        let _ = read_system_event(&mut reader, &state, &conv_id, &mut session_id);
    }

    // Main loop: wait for message → write → read until result → repeat
    loop {
        let user_text = match rx.recv() {
            Ok(msg) => msg.user_text,
            Err(_) => {
                // Channel closed — serve is shutting down
                info!("session_channel_closed_shutting_down");
                let _ = child.kill();
                return;
            }
        };
        let text_preview = logging::truncate(&user_text, 200);
        info!(
            user_text_len = user_text.chars().count(),
            user_text_preview = %text_preview,
            "turn_start"
        );

        // Try to process the turn; on failure, respawn and retry (up to 3x)
        let mut ok = false;
        for attempt in 1..=3 {
            match process_turn(
                &mut stdin,
                &mut reader,
                &state,
                &conv_id,
                &user_text,
                &answer_rx,
            ) {
                Ok(()) => {
                    ok = true;
                    info!(attempt, "turn_end");
                    break;
                }
                Err(e) => {
                    warn!(attempt, error = %e, "turn_error");
                    // Kill the dead process and respawn
                    let _ = child.kill();
                    let _ = child.wait();
                    match spawn_claude(&project_path, session_id.as_deref()) {
                        Some((c, s)) => {
                            warn!(attempt, reason = "turn_error", "agent_respawn");
                            child = c;
                            stdin = s;
                            reader = BufReader::new(child.stdout.take().expect("no stdout"));
                            if read_system_event(&mut reader, &state, &conv_id, &mut session_id) {
                                warn!("agent_stale_session_on_respawn");
                                clear_session_id(&state, &conv_id);
                                session_id = None;
                                let _ = child.kill();
                                let _ = child.wait();
                                if let Some((fresh_child, fresh_stdin)) =
                                    spawn_claude(&project_path, None)
                                {
                                    child = fresh_child;
                                    stdin = fresh_stdin;
                                    reader =
                                        BufReader::new(child.stdout.take().expect("no stdout"));
                                    let _ = read_system_event(
                                        &mut reader,
                                        &state,
                                        &conv_id,
                                        &mut session_id,
                                    );
                                }
                            }
                        }
                        None => {
                            error!(attempt, "agent_respawn_failed");
                            break;
                        }
                    }
                }
            }
        }

        if !ok {
            error!("turn_failed_after_retries");
            mark_failed(&state, &conv_id);
        }
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

fn spawn_claude(project_path: &str, session_id: Option<&str>) -> Option<(Child, ChildStdin)> {
    let mut args = vec![
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--permission-prompt-tool",
        "stdio",
        "--dangerously-skip-permissions",
        "--verbose",
    ];
    // resume_owned must live as long as args
    let resume_owned;
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        resume_owned = sid.to_string();
        args.push("--resume");
        args.push(&resume_owned);
    }

    let mut child = Command::new("claude")
        .args(&args)
        .current_dir(project_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| error!(error = %e, "agent_spawn_failed"))
        .ok()?;

    let stdin = child.stdin.take()?;
    Some((child, stdin))
}

/// Write a user message JSON line to claude's stdin.
pub(super) fn write_user_message(sink: &mut impl Write, user_text: &str) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": user_text }] }
    });
    let line = format!("{}\n", msg);
    sink.write_all(line.as_bytes())
        .map_err(|e| format!("stdin write: {}", e))?;
    sink.flush()
        .map_err(|e| format!("stdin flush (user_message): {}", e))
}

/// Write a user message with an image content block (and optional text) to Claude's stdin.
/// The image is read from `file_path`, base64-encoded, and media_type derived from extension.
/// If `user_text` is non-empty, a text block is appended after the image block.
pub(super) fn write_user_message_with_image(
    sink: &mut impl Write,
    user_text: &str,
    file_path: &std::path::Path,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let media_type = match file_path.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        other => return Err(format!("unsupported image extension: {:?}", other)),
    };

    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("read image file {}: {}", file_path.display(), e))?;
    let data_b64 = STANDARD.encode(&bytes);

    let mut content = vec![serde_json::json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data_b64,
        }
    })];

    if !user_text.is_empty() {
        content.push(serde_json::json!({ "type": "text", "text": user_text }));
    }

    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content }
    });
    let line = format!("{}\n", msg);
    sink.write_all(line.as_bytes())
        .map_err(|e| format!("stdin write (image): {}", e))?;
    sink.flush()
        .map_err(|e| format!("stdin flush (image): {}", e))
}

/// Write a tool_result JSON line to claude's stdin (response to a tool_use).
#[allow(dead_code)]
fn write_tool_result(stdin: &mut ChildStdin, call_id: &str, content: &str) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{
                "type":        "tool_result",
                "tool_use_id": call_id,
                "content":     content,
            }]
        }
    });
    let line = format!("{}\n", msg);
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("stdin write (tool_result): {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("stdin flush (tool_result): {}", e))
}

/// Read the `system` event from stdout to capture the session_id.
/// Stops after the first system event or first non-system event.
/// Returns true when Claude reports that the saved --resume session no longer exists.
fn read_system_event(
    reader: &mut BufReader<std::process::ChildStdout>,
    state: &AppState,
    conv_id: &str,
    session_id: &mut Option<String>,
) -> bool {
    let mut line = String::new();
    for _ in 0..20 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return false,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        debug!(line = %trimmed, "agent_system_line");
        if let Ok(raw) = serde_json::from_str::<Value>(trimmed) {
            if is_stale_session_error(&raw) {
                return true;
            }
            if raw["type"].as_str() == Some("system") {
                if let Some(sid) = raw["session_id"].as_str().filter(|s| !s.is_empty()) {
                    *session_id = Some(sid.to_string());
                    save_session_id(state, conv_id, sid);
                    debug!(session_id = %sid, "agent_session_captured");
                }
                return false; // system event consumed
            }
            // Non-system event — stop looking (claude may not emit system on resume)
            return false;
        }
    }
    false
}

fn is_stale_session_error(raw: &Value) -> bool {
    raw["is_error"].as_bool().unwrap_or(false)
        && raw["errors"]
            .as_array()
            .map(|errors| {
                errors.iter().any(|error| {
                    error
                        .as_str()
                        .map(|s| s.contains("No conversation found with session ID"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false)
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
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
        assert_eq!(content["type"].as_str(), Some("text"), "content type should be 'text'");
        assert_eq!(content["text"].as_str(), Some("hello"), "text should be 'hello'");
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
        assert_eq!(img["type"].as_str(), Some("image"), "first block should be image");
        assert_eq!(img["source"]["type"].as_str(), Some("base64"), "source type should be base64");
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
        assert_eq!(txt["type"].as_str(), Some("text"), "second block should be text");
        assert_eq!(txt["text"].as_str(), Some("look at this"), "text should match");
    }

    /// text が空でも image block だけ送信できること。
    ///
    /// 期待結果：
    ///   - content array に image block のみ（len == 1）
    ///   - image media_type == "image/png"（PNG ファイルの場合）
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
        assert_eq!(content.len(), 1, "should have only image block when text is empty");
        assert_eq!(content[0]["type"].as_str(), Some("image"), "block should be image type");
        assert_eq!(
            content[0]["source"]["media_type"].as_str(),
            Some("image/png"),
            "png file should have image/png media_type"
        );
    }
}
