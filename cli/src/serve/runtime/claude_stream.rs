//! Claude stdout stream: one turn (user message → result) and assistant/user event handlers.

use crate::serve::interactive::{self, AnswerPayload};
use crate::serve::push;
use crate::serve::state::AppState;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::ChildStdin;
use std::time::Instant;
use tracing::{debug, info};

use super::{broadcast, insert_message, write_user_message, write_user_message_with_image};

/// Write user message and read stdout until the `result` event.
/// Returns Ok(()) on success, Err if the process pipe breaks.
///
/// When Claude calls `AskUserQuestion`, this function:
///   1. Emits an `ask_question` WS message (via handle_assistant_event)
///   2. Blocks on `answer_rx.recv()` until the mobile user responds
///   3. Writes the `tool_result` back to Claude's stdin
///   4. Resumes reading stdout
pub(super) fn process_turn(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<std::process::ChildStdout>,
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    uploads_dir: &std::path::Path,
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

    match file_id {
        Some(fid) => {
            let file_path = uploads_dir.join(fid);
            write_user_message_with_image(stdin, user_text, &file_path)?;
        }
        None => {
            write_user_message(stdin, user_text)?;
        }
    }
    debug!("claude_user_message_written");

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
        debug!(line = %trimmed, "claude_stdout_line");

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
                        let options_count = orig_input["questions"]
                            .as_array()
                            .map(|a| a.len())
                            .unwrap_or(0);
                        if let Some(payload) =
                            interactive::build_ask_payload(&tool_name, &request_id, &orig_input)
                        {
                            let db = state.db.lock().unwrap();
                            if let Ok(seq) = insert_message(&db, conv_id, "ask_question", &payload)
                            {
                                drop(db);
                                broadcast(state, conv_id, seq, "ask_question", payload);
                            }
                        }
                        info!(
                            conv_id = %conv_id,
                            ask_id = %request_id,
                            options_count,
                            "ask_question_pending"
                        );
                        let wait_started = Instant::now();
                        let answer = answer_rx.recv().map_err(|_| {
                            "answer channel closed while waiting for AskUserQuestion".to_string()
                        })?;
                        info!(
                            conv_id = %conv_id,
                            ask_id = %request_id,
                            wait_ms = wait_started.elapsed().as_millis() as u64,
                            choice_id = ?answer.choice_id,
                            "ask_question_answered"
                        );
                        interactive::build_updated_input(&tool_name, &orig_input, &answer)
                            .unwrap_or(orig_input)
                    } else {
                        debug!("ask_question_auto_approve_empty_questions");
                        orig_input
                    }
                } else {
                    orig_input
                };

                debug!(
                    request_id = %request_id,
                    tool = %tool_name,
                    "control_request_allowing"
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
                debug!("control_response_sent");
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
                    debug!(call_id = %call_id, "skip_ask_tool_use_handled_at_control_request");
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
    info!(conv_id = %conv_id, status, "task_status");

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
