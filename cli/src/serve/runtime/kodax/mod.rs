//! KodaX runtime adapter.
//! Spawns one `kodax --mode json` subprocess per user turn and maps JSONL stdout into MultiSoul messages.

mod events;

use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tracing::{debug, error, info, info_span, warn};
use uuid::Uuid;

use crate::db::now_ms;
use crate::logging;
use crate::serve::runtime::DispatchMessage;
use crate::serve::state::{start_new_process_group, AppState, SessionHandle};
use events::{parse_json_event, KodaxEvent};

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
    let span = info_span!("session_worker", conv_id = %conv_id, runtime = "kodax", mode = %mode);
    let _enter = span.enter();
    info!("session_worker_started");

    loop {
        let msg = match rx.recv() {
            Ok(msg) => msg,
            Err(_) => {
                info!("session_channel_closed_shutting_down");
                return;
            }
        };
        let preview = logging::truncate(&msg.user_text, 200);
        info!(
            user_text_len = msg.user_text.chars().count(),
            user_text_preview = %preview,
            "turn_start"
        );

        match process_turn(
            &state,
            &conv_id,
            KodaxTurn {
                prompt: &msg.user_text,
                user_seq: msg.seq,
                project_path: &project_path,
                model_id: msg.model_id.as_deref(),
            },
            &session_handle,
        ) {
            Ok(()) => {
                session_handle.clear_current_pid_if_any();
                if session_handle.is_aborted() {
                    info!("turn_aborted");
                    return;
                }
                info!("turn_end");
            }
            Err(e) => {
                session_handle.clear_current_pid_if_any();
                if session_handle.is_aborted() {
                    info!(error = %e, "turn_aborted");
                    complete_turn(&state, &conv_id, "aborted", msg.seq);
                    return;
                }
                error!(error = %e, "turn_failed");
                complete_turn(&state, &conv_id, "failed", msg.seq);
            }
        }
    }
}

struct KodaxTurn<'a> {
    prompt: &'a str,
    user_seq: i64,
    project_path: &'a str,
    model_id: Option<&'a str>,
}

fn process_turn(
    state: &AppState,
    conv_id: &str,
    turn: KodaxTurn<'_>,
    session_handle: &SessionHandle,
) -> Result<(), String> {
    let mut child = spawn_kodax(conv_id, turn.prompt, turn.project_path, turn.model_id)?;
    let child_pid = child.id();
    session_handle.set_current_pid(child_pid);
    debug!(pid = child_pid, conv_id = %conv_id, "kodax_spawned");

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    let result = read_kodax_stdout(state, conv_id, turn.user_seq, &mut child);
    session_handle.clear_current_pid(child_pid);
    result
}

fn read_kodax_stdout(
    state: &AppState,
    conv_id: &str,
    user_seq: i64,
    child: &mut Child,
) -> Result<(), String> {
    let mut reader = BufReader::new(child.stdout.take().ok_or("no stdout")?);
    let stderr_tail = drain_stderr_tail(child.stderr.take());
    let mut line = String::new();
    let mut fallback_text = String::new();
    let mut terminal_status: Option<Result<(), String>> = None;

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Err(e) => return Err(format!("read: {}", e)),
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        debug!(line = %trimmed, "kodax_stdout_line");

        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => match parse_json_event(&value) {
                KodaxEvent::AgentText(text) => emit_agent_text(state, conv_id, text),
                KodaxEvent::ToolCall {
                    call_id,
                    tool,
                    args,
                } => emit_tool_call(state, conv_id, call_id, tool, args),
                KodaxEvent::ToolResult {
                    call_id,
                    ok,
                    summary,
                } => emit_tool_result(state, conv_id, call_id, ok, summary),
                KodaxEvent::Completed => terminal_status = Some(Ok(())),
                KodaxEvent::Failed(message) => terminal_status = Some(Err(message)),
                KodaxEvent::Ignored => {
                    debug!(event_type = ?value.get("type"), "kodax_unhandled_event")
                }
            },
            Err(_) => {
                if !fallback_text.is_empty() {
                    fallback_text.push('\n');
                }
                fallback_text.push_str(trimmed);
            }
        }
    }

    if !fallback_text.is_empty() {
        emit_agent_text(state, conv_id, fallback_text);
    }

    let status = child.wait().map_err(|e| format!("wait: {}", e))?;
    let stderr_tail = stderr_tail.tail();
    if !status.success() {
        let message = if stderr_tail.is_empty() {
            format!("kodax exited with status {}", status)
        } else {
            format!("kodax exited with status {}: {}", status, stderr_tail)
        };
        return Err(message);
    }

    match terminal_status.unwrap_or(Ok(())) {
        Ok(()) => {
            complete_turn(state, conv_id, "completed", user_seq);
            Ok(())
        }
        Err(message) => Err(message),
    }
}

fn spawn_kodax(
    conv_id: &str,
    prompt: &str,
    project_path: &str,
    model_id: Option<&str>,
) -> Result<Child, String> {
    let bin = kodax_bin();
    let args = build_kodax_args(conv_id, prompt, model_id)?;
    debug!(args = ?args, "kodax_spawn_args");

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    start_new_process_group(&mut cmd);
    cmd.spawn().map_err(|e| format!("spawn {}: {}", bin, e))
}

fn kodax_bin() -> String {
    std::env::var("KODAX_BIN").unwrap_or_else(|_| "kodax".to_string())
}

fn build_kodax_args(
    conv_id: &str,
    prompt: &str,
    model_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "--mode".to_string(),
        "json".to_string(),
        "--session".to_string(),
        conv_id.to_string(),
        "--agent-mode".to_string(),
        "ama".to_string(),
    ];
    if let Some(model_id) = normalize_model_id(model_id) {
        let (provider, model) = split_provider_model(&model_id)?;
        args.push("-m".to_string());
        args.push(provider.to_string());
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args.push(prompt.to_string());
    Ok(args)
}

fn split_provider_model(model_id: &str) -> Result<(&str, &str), String> {
    let (provider, model) = model_id.split_once(':').ok_or_else(|| {
        format!(
            "invalid KodaX model id `{}`: expected provider:model",
            model_id
        )
    })?;
    let provider = provider.trim();
    let model = model.trim();
    if provider.is_empty() || model.is_empty() {
        return Err(format!(
            "invalid KodaX model id `{}`: provider and model must be non-empty",
            model_id
        ));
    }
    Ok((provider, model))
}

fn normalize_model_id(model_id: Option<&str>) -> Option<String> {
    model_id
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(ToString::to_string)
}

fn emit_agent_text(state: &AppState, conv_id: &str, text: String) {
    if text.is_empty() {
        return;
    }
    let payload = serde_json::json!({ "text": text });
    insert_and_broadcast(state, conv_id, "agent_text", payload);
}

fn emit_tool_call(state: &AppState, conv_id: &str, call_id: String, tool: String, args: Value) {
    let payload = serde_json::json!({ "tool": tool, "args": args, "call_id": call_id });
    insert_and_broadcast(state, conv_id, "tool_call", payload);
}

fn emit_tool_result(state: &AppState, conv_id: &str, call_id: String, ok: bool, summary: String) {
    let payload = serde_json::json!({ "call_id": call_id, "ok": ok, "summary": summary });
    insert_and_broadcast(state, conv_id, "tool_result", payload);
}

fn insert_and_broadcast(state: &AppState, conv_id: &str, role: &'static str, payload: Value) {
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, role, &payload) {
        drop(db);
        broadcast(state, conv_id, seq, role, payload);
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
        let _ = tx.send(json).unwrap_or(0);
    }
}

fn complete_turn(state: &AppState, conv_id: &str, status: &str, turn_seq: i64) {
    {
        let db = state.db.lock().unwrap();
        let changed = db
            .execute(
                "UPDATE conversations
                 SET status = ?1
                 WHERE id = ?2
                   AND NOT EXISTS (
                       SELECT 1 FROM messages
                       WHERE conversation_id = ?2
                         AND role = 'user_text'
                         AND seq > ?3
                   )",
                rusqlite::params![status, conv_id, turn_seq],
            )
            .unwrap_or(0);
        if changed == 0 {
            debug!(
                conv_id = %conv_id,
                turn_seq,
                status,
                "stale_task_status_ignored"
            );
            return;
        }
    }
    let payload = serde_json::json!({
        "task_id": conv_id,
        "status": status,
        "importance": "normal",
        "summary": ""
    });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        crate::serve::push::send_task_status_push(&db, conv_id, status, "");
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}

fn drain_stderr_tail(stderr: Option<std::process::ChildStderr>) -> StderrTail {
    let tail = StderrTail::default();
    let Some(mut stderr) = stderr else {
        return tail;
    };
    let tail_for_thread = tail.clone();
    std::thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        loop {
            match stderr.read(&mut buf) {
                Ok(0) => return,
                Ok(n) => tail_for_thread.push_lossy(&buf[..n]),
                Err(_) => return,
            }
        }
    });
    tail
}

#[derive(Clone, Default)]
struct StderrTail {
    inner: Arc<Mutex<String>>,
}

impl StderrTail {
    fn push_lossy(&self, bytes: &[u8]) {
        let chunk = String::from_utf8_lossy(bytes);
        let mut tail = self.inner.lock().unwrap();
        tail.push_str(&chunk);
        let len = tail.chars().count();
        if len > 500 {
            *tail = tail.chars().skip(len - 500).collect();
        }
    }

    fn tail(&self) -> String {
        self.inner.lock().unwrap().trim().to_string()
    }
}

trait SessionHandleExt {
    fn clear_current_pid_if_any(&self);
}

impl SessionHandleExt for SessionHandle {
    fn clear_current_pid_if_any(&self) {
        let pid = *self.current_pid.lock().unwrap();
        if let Some(pid) = pid {
            self.clear_current_pid(pid);
        }
    }
}

#[cfg(test)]
mod tests;
