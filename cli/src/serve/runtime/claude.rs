//! Runtime adapter: one long-lived claude process per conversation.
//! Each conversation has a session_worker thread that owns the child process.
//! Messages are sent via std::sync::mpsc channel from the HTTP handler.

use crate::db::now_ms;
use crate::serve::interactive::{self, AnswerPayload};
use crate::serve::{push, state::AppState};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use uuid::Uuid;

// ─── public API ──────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives.
/// Gets or creates a long-lived session for this conversation.
pub fn send_to_session(state: &AppState, conv_id: &str, user_text: &str, project_path: &str) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        // Session already running — enqueue the message
        if tx.send(user_text.to_string()).is_ok() {
            eprintln!(
                "[runtime] queued message for existing session conv_id={}",
                conv_id
            );
            return;
        }
        // Channel broken (worker crashed) — fall through to create a new one
        eprintln!(
            "[runtime] session channel broken, respawning conv_id={}",
            conv_id
        );
    }

    // Create a new session
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions); // release lock before spawn_blocking

    // Enqueue the first message
    let _ = tx.send(user_text.to_string());

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
    rx: std::sync::mpsc::Receiver<String>,
) {
    eprintln!("[runtime] session_worker started conv_id={}", conv_id);

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
    eprintln!(
        "[runtime] claude spawned pid={:?} conv_id={}",
        child.id(),
        conv_id
    );

    // Read the system event to capture/update session_id
    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));
    if read_system_event(&mut reader, &state, &conv_id, &mut session_id) {
        eprintln!(
            "[runtime] stale claude session_id detected, starting fresh conv_id={}",
            conv_id
        );
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
            Ok(t) => t,
            Err(_) => {
                // Channel closed — serve is shutting down
                eprintln!(
                    "[runtime] channel closed, killing claude conv_id={}",
                    conv_id
                );
                let _ = child.kill();
                return;
            }
        };
        eprintln!(
            "[runtime] processing message conv_id={} text={:?}",
            conv_id, user_text
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
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[runtime] turn error (attempt {}): {} conv_id={}",
                        attempt, e, conv_id
                    );
                    // Kill the dead process and respawn
                    let _ = child.kill();
                    let _ = child.wait();
                    match spawn_claude(&project_path, session_id.as_deref()) {
                        Some((c, s)) => {
                            child = c;
                            stdin = s;
                            reader = BufReader::new(child.stdout.take().expect("no stdout"));
                            if read_system_event(&mut reader, &state, &conv_id, &mut session_id) {
                                eprintln!("[runtime] stale claude session_id detected on respawn, retrying fresh conv_id={}", conv_id);
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
                            eprintln!("[runtime] respawn failed conv_id={}", conv_id);
                            break;
                        }
                    }
                }
            }
        }

        if !ok {
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
        .map_err(|e| eprintln!("[runtime] spawn failed: {}", e))
        .ok()?;

    let stdin = child.stdin.take()?;
    Some((child, stdin))
}

/// Write a user message JSON line to claude's stdin.
fn write_user_message(stdin: &mut ChildStdin, user_text: &str) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": user_text }] }
    });
    let line = format!("{}\n", msg);
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("stdin write: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("stdin flush (user_message): {}", e))
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
        eprintln!("[runtime] system read: {}", trimmed);
        if let Ok(raw) = serde_json::from_str::<Value>(trimmed) {
            if is_stale_session_error(&raw) {
                return true;
            }
            if raw["type"].as_str() == Some("system") {
                if let Some(sid) = raw["session_id"].as_str().filter(|s| !s.is_empty()) {
                    *session_id = Some(sid.to_string());
                    save_session_id(state, conv_id, sid);
                    eprintln!("[runtime] captured session_id={}", sid);
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

/// Write user message and read stdout until the `result` event.
/// Returns Ok(()) on success, Err if the process pipe breaks.
///
/// When Claude calls `AskUserQuestion`, this function:
///   1. Emits an `ask_question` WS message (via handle_assistant_event)
///   2. Blocks on `answer_rx.recv()` until the mobile user responds
///   3. Writes the `tool_result` back to Claude's stdin
///   4. Resumes reading stdout
fn process_turn(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<std::process::ChildStdout>,
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    answer_rx: &std::sync::mpsc::Receiver<AnswerPayload>,
) -> Result<(), String> {
    // Update conversation status → running
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    write_user_message(stdin, user_text)?;
    eprintln!("[runtime] wrote user message, reading stdout...");

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Err("stdout EOF (claude exited)".into()),
            Err(e) => return Err(format!("read error: {}", e)),
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        eprintln!("[runtime] stdout: {}", trimmed);

        let raw: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match raw["type"].as_str().unwrap_or("") {
            "system" => {
                // session_id can appear again on reconnect; ignore here (already captured)
            }
            "control_request" => {
                // Claude Code requests permission to use a tool.
                // For AskUserQuestion: intercept here, broadcast ask_question to mobile,
                // wait for the user's answer, then embed answers in updatedInput —
                // matching the cc-connect reference implementation.
                let request_id = raw["request_id"].as_str().unwrap_or("").to_string();
                let tool_name = raw["request"]["tool_name"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let orig_input = raw["request"]
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));

                let updated_input = if interactive::is_interactive(&tool_name) {
                    let has_questions = orig_input["questions"]
                        .as_array()
                        .is_some_and(|a| !a.is_empty());

                    if has_questions {
                        // Broadcast ask_question to mobile and wait for answer
                        if let Some(payload) =
                            interactive::build_ask_payload(&tool_name, &request_id, &orig_input)
                        {
                            eprintln!(
                                "[runtime] ask_question (via control_request) payload={}",
                                payload
                            );
                            let db = state.db.lock().unwrap();
                            if let Ok(seq) = insert_message(&db, conv_id, "ask_question", &payload)
                            {
                                drop(db);
                                broadcast(state, conv_id, seq, "ask_question", payload);
                            }
                        }
                        eprintln!("[runtime] waiting for user answer ask_id={}", request_id);
                        let answer = answer_rx.recv().map_err(|_| {
                            "answer channel closed while waiting for AskUserQuestion".to_string()
                        })?;
                        eprintln!(
                            "[runtime] got answer ask_id={} choice_id={:?}",
                            request_id, answer.choice_id
                        );
                        interactive::build_updated_input(&tool_name, &orig_input, &answer)
                            .unwrap_or(orig_input)
                    } else {
                        eprintln!("[runtime] AskUserQuestion control_request — questions not yet complete, auto-approving");
                        orig_input
                    }
                } else {
                    orig_input
                };

                eprintln!(
                    "[runtime] control_request request_id={} tool={} — responding allow",
                    request_id, tool_name
                );
                let response = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype":    "success",
                        "request_id": request_id,
                        "response": {
                            "behavior":     "allow",
                            "updatedInput": updated_input,
                        }
                    }
                });
                let resp_line = format!(
                    "{}
",
                    response
                );
                stdin
                    .write_all(resp_line.as_bytes())
                    .map_err(|e| format!("control_response write: {}", e))?;
                stdin
                    .flush()
                    .map_err(|e| format!("control_response flush: {}", e))?;
                eprintln!("[runtime] control_response sent (behavior=allow)");
            }
            "assistant" => {
                // AskUserQuestion is handled at control_request time (not here).
                // handle_assistant_event skips AskUserQuestion tool_use items.
                handle_assistant_event(&raw, state, conv_id);
            }
            "user" => {
                handle_user_event(&raw, state, conv_id);
            }
            "result" => {
                handle_result_event(&raw, state, conv_id);
                return Ok(()); // turn complete — loop back to rx.recv()
            }
            _ => {}
        }
    }
}

/// Processes an assistant event, broadcasting messages to mobile.
///
/// AskUserQuestion tool_use items are skipped here — they are handled at
/// `control_request` time (before the assistant event) per the cc-connect
/// reference implementation.
fn handle_assistant_event(raw: &Value, state: &AppState, conv_id: &str) {
    let content = match raw["message"]["content"].as_array() {
        Some(c) => c.clone(),
        None => return,
    };

    for item in &content {
        match item["type"].as_str().unwrap_or("") {
            "text" => {
                let text = item["text"].as_str().unwrap_or("");
                if text.is_empty() {
                    continue;
                }
                let payload = serde_json::json!({ "text": text });
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "agent_text", payload);
                }
            }
            "tool_use" => {
                let tool_name = item["name"].as_str().unwrap_or("unknown").to_string();
                let call_id = item["id"].as_str().unwrap_or("").to_string();
                let args = item["input"].clone();

                if interactive::is_interactive(&tool_name) {
                    // AskUserQuestion is handled at control_request time — skip here.
                    eprintln!(
                        "[runtime] skipping AskUserQuestion tool_use in assistant event call_id={}",
                        call_id
                    );
                } else {
                    let args_str = serde_json::to_string(&args).unwrap_or_default();
                    let payload = serde_json::json!({ "tool": tool_name, "args": args_str, "call_id": call_id });
                    let db = state.db.lock().unwrap();
                    if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &payload) {
                        drop(db);
                        broadcast(state, conv_id, seq, "tool_call", payload);
                    }
                }
            }
            _ => {}
        }
    }
}

fn handle_user_event(raw: &Value, state: &AppState, conv_id: &str) {
    let content = match raw["message"]["content"].as_array() {
        Some(c) => c,
        None => return,
    };
    for item in content {
        if item["type"].as_str() != Some("tool_result") {
            continue;
        }
        let call_id = item["tool_use_id"].as_str().unwrap_or("").to_string();
        let is_error = item["is_error"].as_bool().unwrap_or(false);
        let raw_content = item["content"].as_str().unwrap_or("").to_string();
        let summary = raw_content;
        let payload =
            serde_json::json!({ "call_id": call_id, "ok": !is_error, "summary": summary });
        let db = state.db.lock().unwrap();
        if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &payload) {
            drop(db);
            broadcast(state, conv_id, seq, "tool_result", payload);
        }
    }
}

fn handle_result_event(raw: &Value, state: &AppState, conv_id: &str) {
    let status = if raw["is_error"].as_bool().unwrap_or(false) {
        "failed"
    } else {
        "completed"
    };
    let raw_result = raw["result"].as_str().unwrap_or("").to_string();
    let summary = raw_result;
    eprintln!("[runtime] result status={} conv_id={}", status, conv_id);

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = ?1 WHERE id = ?2",
            rusqlite::params![status, conv_id],
        );
    }

    let payload = serde_json::json!({
        "task_id": conv_id, "status": status, "importance": "normal", "summary": summary
    });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        push::send_task_status_push(&db, conv_id, status, &summary);
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

fn load_session_id(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT claude_session_id FROM conversations WHERE id = ?1",
        [conv_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

fn save_session_id(state: &AppState, conv_id: &str, session_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET claude_session_id = ?1 WHERE id = ?2",
        rusqlite::params![session_id, conv_id],
    );
}

fn clear_session_id(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET claude_session_id = NULL WHERE id = ?1",
        [conv_id],
    );
}

fn mark_failed(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET status = 'failed' WHERE id = ?1",
        [conv_id],
    );
    drop(db);
    let payload = serde_json::json!({ "task_id": conv_id, "status": "failed", "importance": "normal", "summary": "" });
    let db2 = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db2, conv_id, "task_status", &payload) {
        push::send_task_status_push(&db2, conv_id, "failed", "");
        drop(db2);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}

fn insert_message(
    db: &rusqlite::Connection,
    conv_id: &str,
    role: &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, conv_id, role, payload.to_string(), now, seq],
    )?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok(seq)
}

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
}

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope {
        kind: "message",
        seq,
        role,
        payload,
        created_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let n = tx.send(json).unwrap_or(0);
        eprintln!(
            "[runtime] broadcast role={} seq={} receivers={}",
            role, seq, n
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
