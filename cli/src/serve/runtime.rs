//! Runtime adapter: spawns a `claude` subprocess per conversation turn,
//! parses its stream-json stdout, and broadcasts WS messages to connected clients.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use serde_json::Value;
use uuid::Uuid;
use crate::db::now_ms;
use crate::serve::state::AppState;

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
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

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope { kind: "message", seq, role, payload, created_at: now_ms() };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let _ = tx.send(json);
    }
}

pub fn run_agent_turn(state: AppState, conv_id: String, project_path: String) {
    tokio::spawn(async move {
        {
            let db = state.db.lock().unwrap();
            let _ = db.execute(
                "UPDATE conversations SET status = 'running' WHERE id = ?1",
                [&conv_id],
            );
        }

        let user_text: String = {
            let db = state.db.lock().unwrap();
            let mut stmt = match db.prepare(
                "SELECT payload FROM messages WHERE conversation_id = ?1
                 AND role = 'user_text' ORDER BY seq DESC LIMIT 1"
            ) {
                Ok(s) => s,
                Err(_) => return,
            };
            let payload_str: String = match stmt.query_row([&conv_id], |r| r.get(0)) {
                Ok(s) => s,
                Err(_) => return,
            };
            serde_json::from_str::<Value>(&payload_str)
                .ok()
                .and_then(|v| v["text"].as_str().map(|s| s.to_string()))
                .unwrap_or_default()
        };

        if user_text.is_empty() { return; }

        let mut child = match Command::new("claude")
            .args([
                "--output-format", "stream-json",
                "--input-format", "stream-json",
                "--permission-prompt-tool", "stdio",
                "--dangerously-skip-permissions",
            ])
            .current_dir(&project_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[runtime] Failed to spawn claude: {}", e);
                let db = state.db.lock().unwrap();
                let _ = db.execute(
                    "UPDATE conversations SET status = 'failed' WHERE id = ?1",
                    [&conv_id],
                );
                return;
            }
        };

        if let Some(mut stdin) = child.stdin.take() {
            let msg = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": &user_text }]
                }
            });
            let _ = writeln!(stdin, "{}", msg);
        }

        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => return,
        };
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            let line = match line { Ok(l) => l, Err(_) => break };
            if line.is_empty() { continue; }
            let raw: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let event_type = raw["type"].as_str().unwrap_or("");
            match event_type {
                "assistant" => {
                    let content = match raw["message"]["content"].as_array() {
                        Some(c) => c.clone(),
                        None => continue,
                    };
                    for item in &content {
                        match item["type"].as_str().unwrap_or("") {
                            "text" => {
                                let text = item["text"].as_str().unwrap_or("");
                                if text.is_empty() { continue; }
                                let payload = serde_json::json!({ "text": text });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "agent_text", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "agent_text", payload);
                                }
                            }
                            "tool_use" => {
                                let tool = item["name"].as_str().unwrap_or("unknown");
                                let call_id = item["id"].as_str().unwrap_or("").to_string();
                                let args = serde_json::to_string(&item["input"]).unwrap_or_default();
                                let payload = serde_json::json!({
                                    "tool": tool, "args": args, "call_id": call_id
                                });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "tool_call", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "tool_call", payload);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                "user" => {
                    if let Some(content) = raw["message"]["content"].as_array() {
                        for item in content {
                            if item["type"].as_str() == Some("tool_result") {
                                let call_id = item["tool_use_id"].as_str().unwrap_or("").to_string();
                                let is_error = item["is_error"].as_bool().unwrap_or(false);
                                let raw_content = item["content"].as_str().unwrap_or("").to_string();
                                let summary = raw_content[..raw_content.len().min(200)].to_string();
                                let payload = serde_json::json!({
                                    "call_id": call_id, "ok": !is_error, "summary": summary
                                });
                                let db = state.db.lock().unwrap();
                                if let Ok(seq) = insert_message(&db, &conv_id, "tool_result", &payload) {
                                    drop(db);
                                    broadcast(&state, &conv_id, seq, "tool_result", payload);
                                }
                            }
                        }
                    }
                }
                "result" => {
                    let status = if raw["is_error"].as_bool().unwrap_or(false) { "failed" } else { "completed" };
                    {
                        let db = state.db.lock().unwrap();
                        let _ = db.execute(
                            "UPDATE conversations SET status = ?1 WHERE id = ?2",
                            rusqlite::params![status, &conv_id],
                        );
                    }
                    let raw_result = raw["result"].as_str().unwrap_or("").to_string();
                    let summary = raw_result[..raw_result.len().min(200)].to_string();
                    let payload = serde_json::json!({
                        "task_id": &conv_id, "status": status,
                        "importance": "normal", "summary": summary
                    });
                    let db = state.db.lock().unwrap();
                    if let Ok(seq) = insert_message(&db, &conv_id, "task_status", &payload) {
                        drop(db);
                        broadcast(&state, &conv_id, seq, "task_status", payload);
                    }
                    break;
                }
                _ => {}
            }
        }
        let _ = child.wait();
    });
}
