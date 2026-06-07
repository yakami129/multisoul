//! Codex turn: one prompt/stdout cycle and item handlers.

use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::serve::{
    push,
    routes::activity_events::{emit_activity_changed, REASON_ABORTED, REASON_TASK_TERMINAL},
    state::AppState,
};

use super::events::parse_tool_item;
use super::{broadcast, extract_text_from_array, insert_message, save_thread_id};

pub(super) fn process_turn(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    user_seq: i64,
    mut child: Child,
    stdin: ChildStdin,
    thread_id: &mut Option<String>,
) -> Result<(), String> {
    debug!(pid = ?child.id(), conv_id = %conv_id, "codex_process_turn");

    // Write prompt then drop stdin → EOF → codex starts processing
    {
        let mut stdin = stdin;
        let line = format!("{}\n", user_text);
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("stdin write: {}", e))?;
        stdin.flush().map_err(|e| format!("stdin flush: {}", e))?;
        // stdin dropped here → EOF sent to codex
    }
    debug!("codex_prompt_written_awaiting_stdout");

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));
    let mut stderr = child.stderr.take();

    let mut line = String::new();
    let mut tool_calls = ToolCallTracker::default();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = child.kill();
                let _ = child.wait();
                let stderr_tail = read_stderr_tail(&mut stderr);
                if stderr_tail.is_empty() {
                    return Err("stdout EOF (codex exited)".into());
                }
                return Err(format!("stdout EOF (codex exited): {}", stderr_tail));
            }
            Err(e) => return Err(format!("read error: {}", e)),
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        debug!(line = %trimmed, "codex_stdout_line");

        let raw: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match raw["type"].as_str().unwrap_or("") {
            "thread.started" => {
                if let Some(tid) = raw["thread_id"].as_str() {
                    *thread_id = Some(tid.to_string());
                    save_thread_id(state, conv_id, tid);
                    debug!(thread_id = %tid, "codex_thread_captured");
                }
            }
            "item.completed" => {
                handle_item_completed(&raw, state, conv_id, &mut tool_calls);
            }
            "item.started" | "item.updated" => {
                handle_item_started_or_updated(&raw, state, conv_id, &mut tool_calls);
            }
            "turn.completed" => {
                // Reap the child without risking a stdout-pipe deadlock:
                // we've stopped reading stdout, so any further writes by
                // codex could block it. kill is harmless after turn.completed.
                let _ = child.kill();
                let _ = child.wait();
                complete_turn(state, conv_id, "completed", user_seq);
                return Ok(());
            }
            "turn.failed" => {
                let msg = raw["error"]["message"]
                    .as_str()
                    .unwrap_or("turn failed")
                    .to_string();
                let _ = child.kill();
                let _ = child.wait();
                complete_turn(state, conv_id, "failed", user_seq);
                return Err(msg);
            }
            _ => {}
        }
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

// ─── event handlers ──────────────────────────────────────────────────────────

#[derive(Default)]
struct ToolCallTracker {
    by_native_id: HashMap<String, String>,
}

impl ToolCallTracker {
    fn start_call(&mut self, native_id: Option<&str>) -> (String, bool) {
        let Some(native_id) = native_id.filter(|id| !id.is_empty()) else {
            return (Uuid::new_v4().to_string(), true);
        };
        if let Some(call_id) = self.by_native_id.get(native_id) {
            return (call_id.clone(), false);
        }
        let call_id = native_id.to_string();
        self.by_native_id
            .insert(native_id.to_string(), call_id.clone());
        (call_id, true)
    }

    fn complete_call(&mut self, native_id: Option<&str>) -> (String, bool) {
        let Some(native_id) = native_id.filter(|id| !id.is_empty()) else {
            return (Uuid::new_v4().to_string(), true);
        };
        match self.by_native_id.remove(native_id) {
            Some(call_id) => (call_id, false),
            None => (native_id.to_string(), true),
        }
    }
}

fn handle_item_started_or_updated(
    raw: &Value,
    state: &AppState,
    conv_id: &str,
    tracker: &mut ToolCallTracker,
) {
    let Some(item) = raw["item"].as_object() else {
        return;
    };
    let Some(tool_item) = parse_tool_item(item) else {
        return;
    };
    let (call_id, should_emit) = tracker.start_call(tool_item.native_id.as_deref());
    if should_emit || is_todo_tool(&tool_item.tool) {
        emit_tool_call(state, conv_id, tool_item.tool, tool_item.args, call_id);
    }
}

fn handle_item_completed(
    raw: &Value,
    state: &AppState,
    conv_id: &str,
    tracker: &mut ToolCallTracker,
) {
    let item = match raw["item"].as_object() {
        Some(i) => i,
        None => return,
    };
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if let Some(tool_item) = parse_tool_item(item) {
        let is_todo = is_todo_tool(&tool_item.tool);
        let (call_id, should_emit_call) = tracker.complete_call(tool_item.native_id.as_deref());
        if should_emit_call || is_todo {
            emit_tool_call(
                state,
                conv_id,
                tool_item.tool.clone(),
                tool_item.args.clone(),
                call_id.clone(),
            );
        }
        emit_tool_result(
            state,
            conv_id,
            call_id,
            tool_item.ok.unwrap_or(true),
            tool_item.summary,
        );
        return;
    }

    match item_type {
        "agent_message" | "message" => {
            let text = extract_text_from_array(item, "content", "output_text");
            if !text.is_empty() {
                let payload = serde_json::json!({ "text": text });
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "agent_text", payload);
                }
            }
        }
        "reasoning" => {
            let text = extract_text_from_array(item, "summary", "summary_text");
            if !text.is_empty() {
                let payload = serde_json::json!({ "text": text });
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "agent_text", &payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "agent_text", payload);
                }
            }
        }
        _ => {
            warn!(item_type = %item_type, "codex_unhandled_item_type");
        }
    }
}

fn is_todo_tool(tool: &str) -> bool {
    tool == "todo_list"
}

fn emit_tool_call(state: &AppState, conv_id: &str, tool: String, args: String, call_id: String) {
    let payload = serde_json::json!({ "tool": tool, "args": args, "call_id": call_id });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &payload) {
        drop(db);
        broadcast(state, conv_id, seq, "tool_call", payload);
    }
}

fn emit_tool_result(state: &AppState, conv_id: &str, call_id: String, ok: bool, summary: String) {
    let payload = serde_json::json!({ "call_id": call_id, "ok": ok, "summary": summary });
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &payload) {
        drop(db);
        broadcast(state, conv_id, seq, "tool_result", payload);
    }
}

pub(super) fn complete_turn(state: &AppState, conv_id: &str, status: &str, turn_seq: i64) {
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
    let ended_at = crate::db::now_ms();
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        let _ = crate::serve::workflows::finalize_workflow_run_for_conversation(
            &db,
            conv_id,
            status,
            Some(""),
            if status == "failed" { Some("") } else { None },
            ended_at,
        );
        let _ = crate::serve::workflows::post_run_watch_check(&db, conv_id, ended_at);
        push::send_task_status_push(&db, conv_id, status, "");
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
        emit_activity_changed(
            state,
            conv_id,
            if status == "aborted" {
                REASON_ABORTED
            } else {
                REASON_TASK_TERMINAL
            },
        );
    }
}
