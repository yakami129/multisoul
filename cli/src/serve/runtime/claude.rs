//! Runtime adapter: one long-lived claude process per conversation.
//! Each conversation has a session_worker thread that owns the child process.
//! Messages are sent via std::sync::mpsc channel from the HTTP handler.

use crate::logging;
use crate::serve::state::{start_new_process_group, AppState, SessionHandle};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdin, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};

#[path = "claude_stream.rs"]
mod claude_stream;

#[path = "claude_db.rs"]
mod claude_db;

use claude_db::{
    broadcast, clear_session_id, insert_message, load_session_id, mark_failed, save_session_id,
};
use claude_stream::process_turn;

// ─── public API ──────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives.
/// Gets or creates a long-lived session for this conversation.
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    user_seq: i64,
    project_path: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(conv_id) {
        // Session already running — enqueue the message
        if session
            .tx
            .send(crate::serve::state::SessionMessage {
                user_text: user_text.to_string(),
                file_id: file_id.map(str::to_string),
                seq: user_seq,
            })
            .is_ok()
        {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        // Channel broken (worker crashed) — fall through to create a new one
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    // Create a new session
    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    let session_handle = SessionHandle::new(tx.clone());
    sessions.insert(conv_id.to_string(), session_handle.clone());
    drop(sessions); // release lock before spawn_blocking

    // Enqueue the first message
    let _ = tx.send(crate::serve::state::SessionMessage {
        user_text: user_text.to_string(),
        file_id: file_id.map(str::to_string),
        seq: user_seq,
    });

    // Spawn the session worker in a blocking thread
    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path, rx, session_handle);
    });
}

// ─── session worker ───────────────────────────────────────────────────────────

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
    session_handle: SessionHandle,
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
        let msg = match rx.recv() {
            Ok(msg) => msg,
            Err(_) => {
                // Channel closed — serve is shutting down
                info!("session_channel_closed_shutting_down");
                let _ = child.kill();
                session_handle.clear_current_pid(child.id());
                return;
            }
        };
        let user_text = msg.user_text;
        let file_id = msg.file_id;
        let user_seq = msg.seq;
        session_handle.set_current_pid(child.id());
        let text_preview = logging::truncate(&user_text, 200);
        info!(
            user_text_len = user_text.chars().count(),
            user_text_preview = %text_preview,
            "turn_start"
        );

        // Try to process the turn; on failure, respawn and retry (up to 3x)
        let mut ok = false;
        for attempt in 1..=3 {
            let turn_input = claude_stream::TurnInput {
                user_text: &user_text,
                file_id: file_id.as_deref(),
                uploads_dir: &state.uploads_dir,
                seq: user_seq,
            };
            match process_turn(
                &mut stdin,
                &mut reader,
                &state,
                &conv_id,
                &turn_input,
                &answer_rx,
            ) {
                Ok(()) => {
                    if session_handle.is_aborted() {
                        info!("turn_aborted");
                        return;
                    }
                    ok = true;
                    info!(attempt, "turn_end");
                    break;
                }
                Err(e) => {
                    if session_handle.is_aborted() {
                        info!(error = %e, "turn_aborted");
                        return;
                    }
                    warn!(attempt, error = %e, "turn_error");
                    // Kill the dead process and respawn
                    let _ = child.kill();
                    session_handle.clear_current_pid(child.id());
                    let _ = child.wait();
                    match spawn_claude(&project_path, session_id.as_deref()) {
                        Some((c, s)) => {
                            warn!(attempt, reason = "turn_error", "agent_respawn");
                            child = c;
                            session_handle.set_current_pid(child.id());
                            stdin = s;
                            reader = BufReader::new(child.stdout.take().expect("no stdout"));
                            if read_system_event(&mut reader, &state, &conv_id, &mut session_id) {
                                warn!("agent_stale_session_on_respawn");
                                clear_session_id(&state, &conv_id);
                                session_id = None;
                                let _ = child.kill();
                                session_handle.clear_current_pid(child.id());
                                let _ = child.wait();
                                if let Some((fresh_child, fresh_stdin)) =
                                    spawn_claude(&project_path, None)
                                {
                                    child = fresh_child;
                                    session_handle.set_current_pid(child.id());
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

    let mut command = Command::new("claude");
    command
        .args(&args)
        .current_dir(project_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    start_new_process_group(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| error!(error = %e, "agent_spawn_failed"))
        .ok()?;

    let stdin = child.stdin.take()?;
    Some((child, stdin))
}

#[path = "claude_io.rs"]
mod claude_io;

pub(super) use claude_io::{write_user_message, write_user_message_with_image};

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
#[path = "claude_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "claude_ask_tests.rs"]
mod ask_tests;
