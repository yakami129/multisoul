//! Cursor Agent CLI runtime (`agent` binary).
//! Headless: `agent -p <prompt> --print --output-format stream-json --trust --workspace <dir>`.
//! Optional resume: `--resume <session_id>` (same id as `session_id` in stream-json `system` event).
//!
//! Override binary path with `CURSOR_AGENT_BIN` (default: `agent` on `PATH`).

#[path = "cursor_db.rs"]
mod cursor_db;
#[path = "cursor_events.rs"]
mod cursor_events;
#[path = "cursor_text.rs"]
mod cursor_text;

use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};

use crate::logging;
use crate::serve::runtime::DispatchMessage;
use crate::serve::state::{start_new_process_group, AppState, SessionHandle};
use cursor_db::{
    broadcast, clear_cursor_session, complete_turn, insert_message, load_cursor_session,
    mark_failed, save_cursor_session,
};
use cursor_events::{parse_tool_event, CursorToolEvent};
use cursor_text::{extract_assistant_text, merge_stream_fragment};

pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    message: DispatchMessage<'_>,
    project_path: &str,
    mode: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(conv_id) {
        if session
            .tx
            .send(crate::serve::state::SessionMessage {
                user_text: message.text.to_string(),
                file_id: None,
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
        file_id: None,
        model_id: normalize_model_id(message.model_id),
        seq: message.seq,
    });

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();
    let mode2 = mode.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, mode2, rx, session_handle);
    });
}

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    mode: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
    session_handle: SessionHandle,
) {
    let span =
        info_span!("session_worker", conv_id = %conv_id, runtime = "cursor-cli", mode = %mode);
    let _enter = span.enter();
    info!("session_worker_started");

    let mut session_id: Option<String> = load_cursor_session(&state, &conv_id);

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

        match process_turn(
            &state,
            &conv_id,
            CursorTurn {
                prompt: &user_text,
                user_seq,
                project_path: &project_path,
                mode: &mode,
                resume: session_id.as_deref(),
                model_id: model_id.as_deref(),
            },
            &session_handle,
        ) {
            Ok(()) => {
                if session_handle.is_aborted() {
                    info!("turn_aborted");
                    return;
                }
                session_id = load_cursor_session(&state, &conv_id);
                info!("turn_end");
            }
            Err(e) => {
                if session_handle.is_aborted() {
                    info!(error = %e, "turn_aborted");
                    return;
                }
                if is_stale_session_error(&e) {
                    warn!(error = %e, "cursor_stale_session");
                    clear_cursor_session(&state, &conv_id);
                    session_id = None;
                    match process_turn(
                        &state,
                        &conv_id,
                        CursorTurn {
                            prompt: &user_text,
                            user_seq,
                            project_path: &project_path,
                            mode: &mode,
                            resume: None,
                            model_id: model_id.as_deref(),
                        },
                        &session_handle,
                    ) {
                        Ok(()) => {
                            if session_handle.is_aborted() {
                                info!("turn_aborted_after_session_reset");
                                return;
                            }
                            session_id = load_cursor_session(&state, &conv_id);
                            info!("turn_end_after_session_reset");
                        }
                        Err(e2) => {
                            error!(error = %e2, "turn_failed_after_reset");
                            mark_failed(&state, &conv_id, user_seq);
                        }
                    }
                } else {
                    error!(error = %e, "turn_failed");
                    mark_failed(&state, &conv_id, user_seq);
                }
            }
        }
    }
}

fn agent_bin() -> String {
    std::env::var("CURSOR_AGENT_BIN").unwrap_or_else(|_| "agent".to_string())
}

struct CursorTurn<'a> {
    prompt: &'a str,
    user_seq: i64,
    project_path: &'a str,
    mode: &'a str,
    resume: Option<&'a str>,
    model_id: Option<&'a str>,
}

fn process_turn(
    state: &AppState,
    conv_id: &str,
    turn: CursorTurn<'_>,
    session_handle: &SessionHandle,
) -> Result<(), String> {
    let mut child = spawn_agent(
        turn.prompt,
        turn.project_path,
        turn.mode,
        turn.resume,
        turn.model_id,
    )?;
    session_handle.set_current_pid(child.id());
    debug!(pid = ?child.id(), conv_id = %conv_id, "cursor_agent_spawned");

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    let mut reader = BufReader::new(child.stdout.take().ok_or("no stdout")?);
    let mut stderr = child.stderr.take();
    let mut line = String::new();
    let mut stream_acc = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = child.kill();
                session_handle.clear_current_pid(child.id());
                let _ = child.wait();
                let tail = read_stderr_tail(&mut stderr);
                return Err(if tail.is_empty() {
                    "stdout EOF before result".into()
                } else {
                    format!("stdout EOF: {}", tail)
                });
            }
            Err(e) => return Err(format!("read: {}", e)),
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        debug!(line = %trimmed, "cursor_stdout_line");

        let v: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "system" if v.get("subtype").and_then(|s| s.as_str()) == Some("init") => {
                if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                    save_cursor_session(state, conv_id, sid);
                }
            }
            "assistant" => {
                let t = extract_assistant_text(&v);
                merge_stream_fragment(&mut stream_acc, &t);
            }
            "tool_call" => {
                handle_tool_event(state, conv_id, &v);
            }
            "result" => {
                let is_err = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
                let summary = v
                    .get("result")
                    .and_then(|r| r.as_str())
                    .unwrap_or("")
                    .to_string();
                let _ = child.kill();
                session_handle.clear_current_pid(child.id());
                let _ = child.wait();

                if is_err {
                    let msg = if !summary.is_empty() {
                        summary
                    } else {
                        "agent result error".into()
                    };
                    return Err(msg);
                }

                let text = if !stream_acc.is_empty() {
                    stream_acc.clone()
                } else {
                    summary
                };
                if !text.is_empty() {
                    let payload = serde_json::json!({ "text": text });
                    let db = state.db.lock().unwrap();
                    if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                        drop(db);
                        broadcast(state, conv_id, seq, "agent_text", payload);
                    }
                }
                complete_turn(state, conv_id, "completed", turn.user_seq);
                return Ok(());
            }
            _ => {}
        }
    }
}

fn handle_tool_event(state: &AppState, conv_id: &str, v: &Value) {
    match parse_tool_event(v) {
        Some(CursorToolEvent::Started {
            call_id,
            tool,
            args,
        }) => {
            let payload = serde_json::json!({ "tool": tool, "args": args, "call_id": call_id });
            let db = state.db.lock().unwrap();
            if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &payload) {
                drop(db);
                broadcast(state, conv_id, seq, "tool_call", payload);
            }
        }
        Some(CursorToolEvent::Completed {
            call_id,
            ok,
            summary,
        }) => {
            let payload = serde_json::json!({ "call_id": call_id, "ok": ok, "summary": summary });
            let db = state.db.lock().unwrap();
            if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &payload) {
                drop(db);
                broadcast(state, conv_id, seq, "tool_result", payload);
            }
        }
        None => {
            warn!(event_type = ?v.get("type"), subtype = ?v.get("subtype"), "cursor_unhandled_tool_event");
        }
    }
}

fn spawn_agent(
    prompt: &str,
    project_path: &str,
    mode: &str,
    resume: Option<&str>,
    model_id: Option<&str>,
) -> Result<Child, String> {
    let bin = agent_bin();
    let mut cmd = Command::new(&bin);
    cmd.args(build_cursor_args(
        prompt,
        project_path,
        mode,
        resume,
        model_id,
    ));

    cmd.current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    start_new_process_group(&mut cmd);
    cmd.spawn().map_err(|e| format!("spawn {}: {}", bin, e))
}

fn build_cursor_args(
    prompt: &str,
    project_path: &str,
    mode: &str,
    resume: Option<&str>,
    model_id: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "-p".to_string(),
        prompt.to_string(),
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--stream-partial-output".to_string(),
        "--trust".to_string(),
        "--workspace".to_string(),
        project_path.to_string(),
        // msctl is always non-interactive: approve shell/tools without a TTY.
        "--force".to_string(),
    ];

    if let Some(model_id) = model_id.filter(|s| !s.trim().is_empty()) {
        args.push("--model".to_string());
        args.push(model_id.to_string());
    }

    match mode.to_lowercase().as_str() {
        "ask" => {
            args.push("--mode".to_string());
            args.push("ask".to_string());
        }
        "plan" => {
            args.push("--plan".to_string());
        }
        _ => {}
    }

    if let Some(sid) = resume.filter(|s| !s.is_empty()) {
        args.push("--resume".to_string());
        args.push(sid.to_string());
    }

    args
}

fn normalize_model_id(model_id: Option<&str>) -> Option<String> {
    model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(ToString::to_string)
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

fn is_stale_session_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("session")
        && (m.contains("not found") || m.contains("invalid") || m.contains("expired"))
}

#[cfg(test)]
#[path = "cursor_tests.rs"]
mod tests;
