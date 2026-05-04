//! Cursor Agent CLI runtime (`agent` binary).
//! Headless: `agent -p <prompt> --print --output-format stream-json --trust --workspace <dir>`.
//! Optional resume: `--resume <session_id>` (same id as `session_id` in stream-json `system` event).
//!
//! Override binary path with `CURSOR_AGENT_BIN` (default: `agent` on `PATH`).

#[path = "cursor_events.rs"]
mod cursor_events;
#[path = "cursor_text.rs"]
mod cursor_text;

use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};
use uuid::Uuid;

use crate::db::now_ms;
use crate::logging;
use crate::serve::{push, state::AppState};
use cursor_events::{parse_tool_event, CursorToolEvent};
use cursor_text::{extract_assistant_text, merge_stream_fragment};

pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    project_path: &str,
    mode: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        if tx
            .send(crate::serve::state::SessionMessage {
                user_text: user_text.to_string(),
                file_id: None,
            })
            .is_ok()
        {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions);

    let _ = tx.send(crate::serve::state::SessionMessage {
        user_text: user_text.to_string(),
        file_id: None,
    });

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();
    let mode2 = mode.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, mode2, rx);
    });
}

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    mode: String,
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
) {
    let span =
        info_span!("session_worker", conv_id = %conv_id, runtime = "cursor-cli", mode = %mode);
    let _enter = span.enter();
    info!("session_worker_started");

    let mut session_id: Option<String> = load_cursor_session(&state, &conv_id);

    loop {
        let user_text = match rx.recv() {
            Ok(msg) => msg.user_text,
            Err(_) => {
                info!("session_channel_closed_shutting_down");
                return;
            }
        };
        let preview = logging::truncate(&user_text, 200);
        info!(
            user_text_len = user_text.chars().count(),
            user_text_preview = %preview,
            "turn_start"
        );

        match process_turn(
            &state,
            &conv_id,
            &user_text,
            &project_path,
            &mode,
            session_id.as_deref(),
        ) {
            Ok(()) => {
                session_id = load_cursor_session(&state, &conv_id);
                info!("turn_end");
            }
            Err(e) => {
                if is_stale_session_error(&e) {
                    warn!(error = %e, "cursor_stale_session");
                    clear_cursor_session(&state, &conv_id);
                    session_id = None;
                    match process_turn(&state, &conv_id, &user_text, &project_path, &mode, None) {
                        Ok(()) => {
                            session_id = load_cursor_session(&state, &conv_id);
                            info!("turn_end_after_session_reset");
                        }
                        Err(e2) => {
                            error!(error = %e2, "turn_failed_after_reset");
                            mark_failed(&state, &conv_id);
                        }
                    }
                } else {
                    error!(error = %e, "turn_failed");
                    mark_failed(&state, &conv_id);
                }
            }
        }
    }
}

fn agent_bin() -> String {
    std::env::var("CURSOR_AGENT_BIN").unwrap_or_else(|_| "agent".to_string())
}

fn process_turn(
    state: &AppState,
    conv_id: &str,
    prompt: &str,
    project_path: &str,
    mode: &str,
    resume: Option<&str>,
) -> Result<(), String> {
    let mut child = spawn_agent(prompt, project_path, mode, resume)?;
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
                complete_turn(state, conv_id, "completed");
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
) -> Result<Child, String> {
    let bin = agent_bin();
    let mut cmd = Command::new(&bin);
    cmd.arg("-p")
        .arg(prompt)
        .arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--stream-partial-output")
        .arg("--trust")
        .arg("--workspace")
        .arg(project_path)
        // msctl is always non-interactive: approve shell/tools without a TTY.
        .arg("--force");

    if let Some(m) = model_from_env() {
        cmd.arg("--model").arg(m);
    }

    match mode.to_lowercase().as_str() {
        "ask" => {
            cmd.arg("--mode").arg("ask");
        }
        "plan" => {
            cmd.arg("--plan");
        }
        _ => {}
    }

    if let Some(sid) = resume.filter(|s| !s.is_empty()) {
        cmd.arg("--resume").arg(sid);
    }

    cmd.current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.spawn().map_err(|e| format!("spawn {}: {}", bin, e))
}

fn model_from_env() -> Option<String> {
    let v = std::env::var("CURSOR_AGENT_MODEL").ok()?;
    let t = v.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
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

fn load_cursor_session(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT cursor_session_id FROM conversations WHERE id = ?1",
        [conv_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

fn save_cursor_session(state: &AppState, conv_id: &str, session_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET cursor_session_id = ?1 WHERE id = ?2",
        rusqlite::params![session_id, conv_id],
    );
}

fn clear_cursor_session(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET cursor_session_id = NULL WHERE id = ?1",
        [conv_id],
    );
}

fn is_stale_session_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("session")
        && (m.contains("not found") || m.contains("invalid") || m.contains("expired"))
}

fn mark_failed(state: &AppState, conv_id: &str) {
    complete_turn(state, conv_id, "failed");
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
        let _ = tx.send(json).unwrap_or(0);
    }
}

fn complete_turn(state: &AppState, conv_id: &str, status: &str) {
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = ?1 WHERE id = ?2",
            rusqlite::params![status, conv_id],
        );
    }
    let payload = serde_json::json!({
        "task_id": conv_id,
        "status": status,
        "importance": "normal",
        "summary": ""
    });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        push::send_task_status_push(&db, conv_id, status, "");
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}
