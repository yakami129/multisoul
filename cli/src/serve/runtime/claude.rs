//! Runtime adapter: one long-lived claude process per conversation.
//! Each conversation has a session_worker thread that owns the child process.
//! Messages are sent via std::sync::mpsc channel from the HTTP handler.

use crate::db::now_ms;
use crate::logging;
use crate::serve::{push, state::AppState};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};
use uuid::Uuid;

#[path = "claude_stream.rs"]
mod claude_stream;

use claude_stream::process_turn;

// ─── public API ──────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives.
/// Gets or creates a long-lived session for this conversation.
pub fn send_to_session(state: &AppState, conv_id: &str, user_text: &str, project_path: &str) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        // Session already running — enqueue the message
        if tx.send(user_text.to_string()).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        // Channel broken (worker crashed) — fall through to create a new one
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
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
            Ok(t) => t,
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
pub(super) fn write_user_message(stdin: &mut ChildStdin, user_text: &str) -> Result<(), String> {
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

pub(super) fn insert_message(
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

pub(super) fn broadcast(
    state: &AppState,
    conv_id: &str,
    seq: i64,
    role: &'static str,
    payload: Value,
) {
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
        debug!(role, seq, receivers = n, "broadcast");
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