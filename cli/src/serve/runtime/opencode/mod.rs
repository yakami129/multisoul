//! opencode runtime adapter.
//! Drives `opencode run --format json --dir <path>` as a subprocess per turn.
//! Message is passed as a positional argument. Session continuation via `--session <id>`.
//!
//! ## Event protocol (opencode 1.x)
//!
//! Each turn spawns a fresh `opencode run` process.  Events stream as JSON lines on stdout:
//!   - `step_start`      — new agent step begins (ignore)
//!   - `text`            — `part.text` fragment; accumulate into reply buffer
//!   - `tool_use`        — `part.state.status == "completed"` → emit tool_call + tool_result
//!   - `step_finish` — `part.reason`: `"stop"` (final answer), `"tool-calls"` (more steps), or `"error"` (turn failed)
//!
//! Session ID (`sessionID` field on every event) is stored in `conversations.opencode_session_id`
//! and passed as `--session <id>` on subsequent turns.

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};

use crate::logging;
use crate::serve::runtime::DispatchMessage;
use crate::serve::state::{start_new_process_group, AppState, SessionHandle};

mod db;
mod events;

use db::{broadcast, complete_turn, insert_message, load_session_id, mark_failed, save_session_id};
use events::{extract_session_id, extract_text, parse_tool_event};

// ─── public API ───────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives for an opencode agent.
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    message: DispatchMessage<'_>,
    project_path: &str,
    _mode: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(conv_id) {
        if session
            .tx
            .send(crate::serve::state::SessionMessage {
                user_text: message.text.to_string(),
                file_id: message.file_id.map(str::to_string),
                model_id: normalize_model_id(message.model_id),
                seq: message.seq,
            })
            .is_ok()
        {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    let session_handle = SessionHandle::new(tx.clone());
    sessions.insert(conv_id.to_string(), session_handle.clone());
    drop(sessions);

    let _ = tx.send(crate::serve::state::SessionMessage {
        user_text: message.text.to_string(),
        file_id: message.file_id.map(str::to_string),
        model_id: normalize_model_id(message.model_id),
        seq: message.seq,
    });

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, rx, session_handle);
    });
}

// ─── session worker ──────────────────────────────────────────────────────────

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
    session_handle: SessionHandle,
) {
    let span = info_span!("session_worker", conv_id = %conv_id, runtime = "opencode");
    let _enter = span.enter();
    info!("session_worker_started");

    let mut session_id: Option<String> = load_session_id(&state, &conv_id);

    loop {
        let msg = match rx.recv() {
            Ok(msg) => msg,
            Err(_) => {
                info!("session_channel_closed_shutting_down");
                return;
            }
        };

        let user_text = msg.user_text;
        let user_seq = msg.seq;
        let model_id = msg.model_id;
        let preview = logging::truncate(&user_text, 200);
        info!(
            user_text_len = user_text.chars().count(),
            user_text_preview = %preview,
            "turn_start"
        );

        let mut ok = false;
        for attempt in 1..=3 {
            let child = if attempt == 1 {
                spawn_opencode(
                    &user_text,
                    &project_path,
                    session_id.as_deref(),
                    model_id.as_deref(),
                )
            } else {
                warn!(attempt, "opencode_retry_spawn");
                spawn_opencode(
                    &user_text,
                    &project_path,
                    session_id.as_deref(),
                    model_id.as_deref(),
                )
            };

            let child = match child {
                Some(c) => c,
                None => {
                    error!(attempt, "agent_spawn_failed");
                    continue;
                }
            };
            session_handle.set_current_pid(child.id());

            match process_turn(
                &state,
                &conv_id,
                child,
                user_seq,
                &mut session_id,
                &session_handle,
            ) {
                Ok(()) => {
                    session_handle.clear_current_pid(0);
                    if session_handle.is_aborted() {
                        info!("turn_aborted");
                        return;
                    }
                    ok = true;
                    info!(attempt, "turn_end");
                    break;
                }
                Err(e) => {
                    session_handle.clear_current_pid(0);
                    if session_handle.is_aborted() {
                        info!(error = %e, "turn_aborted");
                        return;
                    }
                    warn!(attempt, error = %e, "turn_error");
                }
            }
        }

        if !ok {
            error!("turn_failed_after_retries");
            mark_failed(&state, &conv_id, user_seq);
        }
    }
}

// ─── turn processor ──────────────────────────────────────────────────────────

fn process_turn(
    state: &AppState,
    conv_id: &str,
    mut child: Child,
    user_seq: i64,
    session_id: &mut Option<String>,
    session_handle: &SessionHandle,
) -> Result<(), String> {
    debug!(pid = ?child.id(), conv_id = %conv_id, "opencode_process_turn");

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    let mut reader = BufReader::new(child.stdout.take().ok_or("no stdout")?);
    let mut stderr = child.stderr.take();
    let mut text_acc = String::new();
    let mut line = String::new();

    loop {
        if session_handle.is_aborted() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("aborted".into());
        }

        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = child.kill();
                let _ = child.wait();
                let stderr_tail = read_stderr_tail(&mut stderr);
                return Err(if stderr_tail.is_empty() {
                    "stdout EOF before step_finish(stop)".into()
                } else {
                    format!("stdout EOF: {}", stderr_tail)
                });
            }
            Err(e) => return Err(format!("read: {}", e)),
            Ok(_) => {}
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        debug!(line = %trimmed, "opencode_stdout_line");

        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Capture session ID from any event (first occurrence wins for this turn).
        if session_id.is_none() {
            if let Some(sid) = extract_session_id(&v) {
                *session_id = Some(sid.to_string());
                save_session_id(state, conv_id, sid);
                debug!(session_id = %sid, "opencode_session_captured");
            }
        }

        match v["type"].as_str().unwrap_or("") {
            "text" => {
                if let Some(t) = extract_text(&v) {
                    text_acc.push_str(t);
                }
            }
            "tool_use" => {
                if let Some(evt) = parse_tool_event(&v) {
                    emit_tool_call(state, conv_id, &evt.tool, &evt.args, &evt.call_id);
                    emit_tool_result(state, conv_id, &evt.call_id, evt.ok, &evt.summary);
                } else {
                    debug!(
                        tool = ?v["part"]["tool"].as_str(),
                        status = ?v["part"]["state"]["status"].as_str(),
                        "opencode_tool_event_skipped"
                    );
                }
            }
            "step_finish" => {
                let reason = v["part"]["reason"].as_str().unwrap_or("");
                match reason {
                    "stop" => {
                        let _ = child.kill();
                        let _ = child.wait();
                        if !text_acc.is_empty() {
                            let payload = serde_json::json!({ "text": text_acc });
                            let db = state.db.lock().unwrap();
                            if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                                drop(db);
                                broadcast(state, conv_id, seq, "agent_text", payload);
                            }
                        }
                        complete_turn(state, conv_id, "completed", user_seq);
                        return Ok(());
                    }
                    "error" => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("opencode step error".into());
                    }
                    // "tool-calls" or unknown → more steps coming, continue reading
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

// ─── subprocess ──────────────────────────────────────────────────────────────

fn spawn_opencode(
    user_text: &str,
    project_path: &str,
    session_id: Option<&str>,
    model_id: Option<&str>,
) -> Option<Child> {
    let args = build_opencode_args(user_text, project_path, session_id, model_id);
    debug!(args = ?args, "opencode_spawn_args");

    let bin = opencode_bin();
    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    start_new_process_group(&mut cmd);
    cmd.spawn()
        .map_err(|e| error!(error = %e, bin = %bin, "agent_spawn_failed"))
        .ok()
}

pub fn build_opencode_args(
    user_text: &str,
    project_path: &str,
    session_id: Option<&str>,
    model_id: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "run".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--dir".to_string(),
        project_path.to_string(),
    ];

    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        args.push("--session".to_string());
        args.push(sid.to_string());
    }

    if let Some(mid) = model_id.filter(|s| !s.trim().is_empty()) {
        args.push("-m".to_string());
        args.push(mid.to_string());
    }

    // Message as final positional argument
    args.push(user_text.to_string());

    args
}

fn opencode_bin() -> String {
    std::env::var("OPENCODE_BIN").unwrap_or_else(|_| "opencode".to_string())
}

fn normalize_model_id(model_id: Option<&str>) -> Option<String> {
    model_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

fn emit_tool_call(state: &AppState, conv_id: &str, tool: &str, args: &str, call_id: &str) {
    let payload = serde_json::json!({ "tool": tool, "args": args, "call_id": call_id });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &payload) {
        drop(db);
        broadcast(state, conv_id, seq, "tool_call", payload);
    }
}

fn emit_tool_result(state: &AppState, conv_id: &str, call_id: &str, ok: bool, summary: &str) {
    let payload = serde_json::json!({ "call_id": call_id, "ok": ok, "summary": summary });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &payload) {
        drop(db);
        broadcast(state, conv_id, seq, "tool_result", payload);
    }
}

fn read_stderr_tail(stderr: &mut Option<std::process::ChildStderr>) -> String {
    let Some(stderr) = stderr.as_mut() else {
        return String::new();
    };
    let mut buf = String::new();
    let _ = stderr.read_to_string(&mut buf);
    let trimmed = buf.trim();
    if trimmed.chars().count() <= 500 {
        trimmed.to_string()
    } else {
        trimmed
            .chars()
            .rev()
            .take(500)
            .collect::<String>()
            .chars()
            .rev()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build_opencode_args: basic new session (no session_id, no model).
    ///
    /// Data:
    ///   user_text = "Do something"
    ///   project_path = "/repo"
    ///   session_id = None
    ///   model_id = None
    ///
    /// Expected:
    ///   - args starts with ["run", "--format", "json", "--dir", "/repo"]
    ///   - last arg is the user_text
    ///   - no --session or -m flags
    #[test]
    fn test_build_args_new_session() {
        let args = build_opencode_args("Do something", "/repo", None, None);
        assert_eq!(&args[..5], &["run", "--format", "json", "--dir", "/repo"]);
        assert_eq!(args.last().unwrap(), "Do something");
        assert!(!args.contains(&"--session".to_string()));
        assert!(!args.contains(&"-m".to_string()));
    }

    /// build_opencode_args: resume session passes --session flag before message.
    ///
    /// Data:
    ///   session_id = Some("ses_abc")
    ///
    /// Expected:
    ///   - "--session" and "ses_abc" are present
    ///   - last arg is still the user_text
    #[test]
    fn test_build_args_resume_session() {
        let args = build_opencode_args("Next step", "/repo", Some("ses_abc"), None);
        let session_idx = args
            .iter()
            .position(|a| a == "--session")
            .expect("--session missing");
        assert_eq!(args[session_idx + 1], "ses_abc");
        assert_eq!(args.last().unwrap(), "Next step");
    }

    /// build_opencode_args: model_id is passed via -m flag.
    ///
    /// Data:
    ///   model_id = Some("anthropic/claude-opus-4-5")
    ///
    /// Expected:
    ///   - "-m" and "anthropic/claude-opus-4-5" present in args
    #[test]
    fn test_build_args_with_model() {
        let args = build_opencode_args("Hello", "/repo", None, Some("anthropic/claude-opus-4-5"));
        let m_idx = args.iter().position(|a| a == "-m").expect("-m missing");
        assert_eq!(args[m_idx + 1], "anthropic/claude-opus-4-5");
    }

    /// build_opencode_args: empty session_id is treated as no session (skipped).
    #[test]
    fn test_build_args_empty_session_id_skipped() {
        let args = build_opencode_args("Hello", "/repo", Some(""), None);
        assert!(
            !args.contains(&"--session".to_string()),
            "empty session_id must not produce --session flag"
        );
    }

    /// build_opencode_args: empty model_id is skipped.
    #[test]
    fn test_build_args_empty_model_skipped() {
        let args = build_opencode_args("Hello", "/repo", None, Some("  "));
        assert!(
            !args.contains(&"-m".to_string()),
            "whitespace-only model must not produce -m flag"
        );
    }

    /// build_opencode_args: session and model both present, message is last.
    #[test]
    fn test_build_args_session_and_model() {
        let args = build_opencode_args(
            "Continue",
            "/workspace",
            Some("ses_xyz"),
            Some("openai/gpt-4.1"),
        );
        assert!(args.contains(&"--session".to_string()));
        assert!(args.contains(&"-m".to_string()));
        assert_eq!(args.last().unwrap(), "Continue");
    }
}
