//! Runtime adapter: one long-lived claude process per conversation.
//! Each conversation has a session_worker thread that owns the child process.
//! Messages are sent via std::sync::mpsc channel from the HTTP handler.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use serde_json::Value;
use uuid::Uuid;
use crate::db::now_ms;
use crate::serve::state::AppState;

// ─── public API ──────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives.
/// Gets or creates a long-lived session for this conversation.
pub fn send_to_session(state: &AppState, conv_id: &str, user_text: &str, project_path: &str) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        // Session already running — enqueue the message
        if tx.send(user_text.to_string()).is_ok() {
            eprintln!("[runtime] queued message for existing session conv_id={}", conv_id);
            return;
        }
        // Channel broken (worker crashed) — fall through to create a new one
        eprintln!("[runtime] session channel broken, respawning conv_id={}", conv_id);
    }

    // Create a new session
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions); // release lock before spawn_blocking

    // Enqueue the first message
    let _ = tx.send(user_text.to_string());

    // Spawn the session worker in a blocking thread
    let state2       = state.clone();
    let conv_id2     = conv_id.to_string();
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path, rx);
    });
}

// ─── session worker ───────────────────────────────────────────────────────────

fn session_worker(
    state:        AppState,
    conv_id:      String,
    project_path: String,
    rx:           std::sync::mpsc::Receiver<String>,
) {
    eprintln!("[runtime] session_worker started conv_id={}", conv_id);

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
    eprintln!("[runtime] claude spawned pid={:?} conv_id={}", child.id(), conv_id);

    // Read the system event to capture/update session_id
    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));
    read_system_event(&mut reader, &state, &conv_id, &mut session_id);

    // Main loop: wait for message → write → read until result → repeat
    loop {
        let user_text = match rx.recv() {
            Ok(t)  => t,
            Err(_) => {
                // Channel closed — serve is shutting down
                eprintln!("[runtime] channel closed, killing claude conv_id={}", conv_id);
                let _ = child.kill();
                return;
            }
        };
        eprintln!("[runtime] processing message conv_id={} text={:?}", conv_id,
                  &user_text[..user_text.len().min(80)]);

        // Try to process the turn; on failure, respawn and retry (up to 3x)
        let mut ok = false;
        for attempt in 1..=3 {
            match process_turn(&mut stdin, &mut reader, &state, &conv_id, &user_text) {
                Ok(()) => { ok = true; break; }
                Err(e) => {
                    eprintln!("[runtime] turn error (attempt {}): {} conv_id={}", attempt, e, conv_id);
                    // Kill the dead process and respawn
                    let _ = child.kill();
                    let _ = child.wait();
                    match spawn_claude(&project_path, session_id.as_deref()) {
                        Some((c, s)) => {
                            child  = c;
                            stdin  = s;
                            reader = BufReader::new(child.stdout.take().expect("no stdout"));
                            read_system_event(&mut reader, &state, &conv_id, &mut session_id);
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
        "--output-format", "stream-json",
        "--input-format",  "stream-json",
        "--permission-prompt-tool", "stdio",
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
    stdin.write_all(line.as_bytes()).map_err(|e| format!("stdin write: {}", e))
}

/// Read the `system` event from stdout to capture the session_id.
/// Stops after the first system event or first non-system event.
fn read_system_event(
    reader:     &mut BufReader<std::process::ChildStdout>,
    state:      &AppState,
    conv_id:    &str,
    session_id: &mut Option<String>,
) {
    let mut line = String::new();
    for _ in 0..20 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        eprintln!("[runtime] system read: {}", &trimmed[..trimmed.len().min(120)]);
        if let Ok(raw) = serde_json::from_str::<Value>(trimmed) {
            if raw["type"].as_str() == Some("system") {
                if let Some(sid) = raw["session_id"].as_str().filter(|s| !s.is_empty()) {
                    *session_id = Some(sid.to_string());
                    save_session_id(state, conv_id, sid);
                    eprintln!("[runtime] captured session_id={}", sid);
                }
                return; // system event consumed
            }
            // Non-system event — stop looking (claude may not emit system on resume)
            return;
        }
    }
}

/// Write user message and read stdout until the `result` event.
/// Returns Ok(()) on success, Err if the process pipe breaks.
fn process_turn(
    stdin:    &mut ChildStdin,
    reader:   &mut BufReader<std::process::ChildStdout>,
    state:    &AppState,
    conv_id:  &str,
    user_text: &str,
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
            Ok(0)  => return Err("stdout EOF (claude exited)".into()),
            Err(e) => return Err(format!("read error: {}", e)),
            Ok(_)  => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        eprintln!("[runtime] stdout: {}", &trimmed[..trimmed.len().min(120)]);

        let raw: Value = match serde_json::from_str(trimmed) {
            Ok(v)  => v,
            Err(_) => continue,
        };

        match raw["type"].as_str().unwrap_or("") {
            "system" => {
                // session_id can appear again on reconnect; ignore here (already captured)
            }
            "assistant" => {
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

fn handle_assistant_event(raw: &Value, state: &AppState, conv_id: &str) {
    let content = match raw["message"]["content"].as_array() {
        Some(c) => c.clone(),
        None    => return,
    };
    for item in &content {
        match item["type"].as_str().unwrap_or("") {
            "text" => {
                let text = item["text"].as_str().unwrap_or("");
                if text.is_empty() { continue; }
                let payload = serde_json::json!({ "text": text });
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "agent_text", payload);
                }
            }
            "tool_use" => {
                let tool    = item["name"].as_str().unwrap_or("unknown");
                let call_id = item["id"].as_str().unwrap_or("").to_string();
                let args    = serde_json::to_string(&item["input"]).unwrap_or_default();
                let payload = serde_json::json!({ "tool": tool, "args": args, "call_id": call_id });
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "tool_call", payload);
                }
            }
            _ => {}
        }
    }
}

fn handle_user_event(raw: &Value, state: &AppState, conv_id: &str) {
    let content = match raw["message"]["content"].as_array() {
        Some(c) => c,
        None    => return,
    };
    for item in content {
        if item["type"].as_str() != Some("tool_result") { continue; }
        let call_id     = item["tool_use_id"].as_str().unwrap_or("").to_string();
        let is_error    = item["is_error"].as_bool().unwrap_or(false);
        let raw_content = item["content"].as_str().unwrap_or("").to_string();
        let summary     = raw_content[..raw_content.len().min(200)].to_string();
        let payload     = serde_json::json!({ "call_id": call_id, "ok": !is_error, "summary": summary });
        let db = state.db.lock().unwrap();
        if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &payload) {
            drop(db);
            broadcast(state, conv_id, seq, "tool_result", payload);
        }
    }
}

fn handle_result_event(raw: &Value, state: &AppState, conv_id: &str) {
    let status      = if raw["is_error"].as_bool().unwrap_or(false) { "failed" } else { "completed" };
    let raw_result  = raw["result"].as_str().unwrap_or("").to_string();
    let summary     = raw_result[..raw_result.len().min(200)].to_string();
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
    ).ok().flatten()
}

fn save_session_id(state: &AppState, conv_id: &str, session_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET claude_session_id = ?1 WHERE id = ?2",
        rusqlite::params![session_id, conv_id],
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
        drop(db2);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}

fn insert_message(
    db:      &rusqlite::Connection,
    conv_id: &str,
    role:    &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id  = Uuid::new_v4().to_string();
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
    kind:       &'static str,
    seq:        i64,
    role:       &'static str,
    payload:    Value,
    created_at: i64,
}

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope { kind: "message", seq, role, payload, created_at: now_ms() };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let n  = tx.send(json).unwrap_or(0);
        eprintln!("[runtime] broadcast role={} seq={} receivers={}", role, seq, n);
    }
}
