//! Codex turn: one prompt/stdout cycle and item handlers.

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::serve::{push, state::AppState};

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
                handle_item_completed(&raw, state, conv_id);
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

fn handle_item_completed(raw: &Value, state: &AppState, conv_id: &str) {
    let item = match raw["item"].as_object() {
        Some(i) => i,
        None => return,
    };
    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");

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
        "command_execution" => {
            let command = item
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let output = item
                .get("aggregated_output")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let exit_code = item.get("exit_code").and_then(|v| v.as_i64()).unwrap_or(0);
            let ok = exit_code == 0;
            let call_id = Uuid::new_v4().to_string();

            let tool_payload =
                serde_json::json!({ "tool": "Bash", "args": command, "call_id": call_id });
            {
                let db = state.db.lock().unwrap();
                if let Ok(seq) = insert_message(&db, conv_id, "tool_call", &tool_payload) {
                    drop(db);
                    broadcast(state, conv_id, seq, "tool_call", tool_payload);
                }
            }

            let result_payload =
                serde_json::json!({ "call_id": call_id, "ok": ok, "summary": output });
            let db = state.db.lock().unwrap();
            if let Ok(seq) = insert_message(&db, conv_id, "tool_result", &result_payload) {
                drop(db);
                broadcast(state, conv_id, seq, "tool_result", result_payload);
            }
        }
        _ => {
            warn!(item_type = %item_type, "codex_unhandled_item_type");
        }
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
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "task_status", &payload) {
        let _ = crate::serve::workflows::finalize_workflow_run_for_conversation(
            &db,
            conv_id,
            status,
            Some(""),
            if status == "failed" { Some("") } else { None },
            crate::db::now_ms(),
        );
        push::send_task_status_push(&db, conv_id, status, "");
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}
