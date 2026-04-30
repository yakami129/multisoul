//! Codex runtime adapter.
//! Drives `codex exec` (or `codex exec resume`) as a subprocess.
//! Stdin: plain-text prompt. Stdout: JSON lines per the Codex event protocol.
//!
//! ## Performance design
//!
//! After each successful turn, the worker immediately pre-warms the next
//! `codex exec resume` process.  Node.js startup (~1-2 s) happens in the
//! background while the user composes their next message, so by the time
//! the next message arrives the process is already waiting for stdin.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use uuid::Uuid;

use crate::db::now_ms;
use crate::serve::state::AppState;

// ─── public API ───────────────────────────────────────────────────────────────

/// Called from the HTTP handler when a new user message arrives for a codex agent.
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    project_path: &str,
    mode: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        if tx.send(user_text.to_string()).is_ok() {
            eprintln!("[codex] queued message for existing session conv_id={}", conv_id);
            return;
        }
        eprintln!("[codex] session channel broken, respawning conv_id={}", conv_id);
    }

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions);

    let _ = tx.send(user_text.to_string());

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();
    let mode2 = mode.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, mode2, rx);
    });
}

// ─── session worker ──────────────────────────────────────────────────────────

fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    mode: String,
    rx: std::sync::mpsc::Receiver<String>,
) {
    eprintln!("[codex] session_worker started conv_id={}", conv_id);

    let mut thread_id: Option<String> = load_thread_id(&state, &conv_id);

    // Pre-warmed process: spawned after each successful turn so that Node.js
    // startup happens in the background while the user types their next message.
    let mut pre_spawned: Option<(Child, ChildStdin)> = None;

    loop {
        let user_text = match rx.recv() {
            Ok(t) => t,
            Err(_) => {
                eprintln!("[codex] channel closed conv_id={}", conv_id);
                // Kill the pre-warmed process if nobody sent a follow-up message.
                if let Some((mut c, _s)) = pre_spawned.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                return;
            }
        };
        eprintln!("[codex] processing message conv_id={}", conv_id);

        let mut ok = false;
        for attempt in 1..=3 {
            // First attempt uses the pre-warmed process (already started).
            // Retries always spawn fresh.
            let process = if attempt == 1 {
                pre_spawned.take().or_else(|| {
                    eprintln!("[codex] no pre-warm, spawning fresh conv_id={}", conv_id);
                    spawn_codex(&project_path, thread_id.as_deref(), &mode)
                })
            } else {
                eprintln!("[codex] retry spawn attempt={} conv_id={}", attempt, conv_id);
                spawn_codex(&project_path, thread_id.as_deref(), &mode)
            };

            let (child, stdin) = match process {
                Some(p) => p,
                None => {
                    eprintln!("[codex] spawn failed attempt={} conv_id={}", attempt, conv_id);
                    continue;
                }
            };

            match process_turn(&state, &conv_id, &user_text, child, stdin, &mut thread_id) {
                Ok(()) => {
                    ok = true;
                    break;
                }
                Err(e) => {
                    eprintln!(
                        "[codex] turn error attempt={} error={} conv_id={}",
                        attempt, e, conv_id
                    );
                }
            }
        }

        if ok {
            // Pre-warm the next resume process in the background.
            // If thread_id is not yet known (first turn), skip — the next turn
            // will fall back to a fresh spawn.
            if let Some(tid) = thread_id.as_deref().filter(|s| !s.is_empty()) {
                match spawn_codex(&project_path, Some(tid), &mode) {
                    Some(p) => {
                        pre_spawned = Some(p);
                        eprintln!(
                            "[codex] pre-warmed next resume process tid={} conv_id={}",
                            tid, conv_id
                        );
                    }
                    None => {
                        eprintln!(
                            "[codex] pre-warm spawn failed, will spawn on demand conv_id={}",
                            conv_id
                        );
                    }
                }
            }
        } else {
            mark_failed(&state, &conv_id);
        }
    }
}

// ─── subprocess ──────────────────────────────────────────────────────────────

fn spawn_codex(
    project_path: &str,
    thread_id: Option<&str>,
    mode: &str,
) -> Option<(Child, ChildStdin)> {
    let args: Vec<String> = if let Some(tid) = thread_id.filter(|s| !s.is_empty()) {
        // Resume: re-apply mode flags. codex's sandbox/approval policy is
        // per-invocation, not stored in the session — without --full-auto
        // resume falls back to interactive approval and would hang on stdin
        // (which we close after writing the prompt).
        let mut a = vec![
            "exec".to_string(),
            "resume".to_string(),
            "--skip-git-repo-check".to_string(),
        ];
        for flag in mode_flags(mode) {
            a.push(flag.to_string());
        }
        a.push(tid.to_string());
        a.extend_from_slice(&["--json".to_string(), "-".to_string()]);
        a
    } else {
        let mut a = vec!["exec".to_string(), "--skip-git-repo-check".to_string()];
        for flag in mode_flags(mode) {
            a.push(flag.to_string());
        }
        a.extend_from_slice(&[
            "--json".to_string(),
            "--cd".to_string(),
            project_path.to_string(),
            "-".to_string(),
        ]);
        a
    };

    eprintln!("[codex] spawn args: {:?}", args);

    let mut child = Command::new("codex")
        .args(&args)
        .current_dir(project_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| eprintln!("[codex] spawn failed: {}", e))
        .ok()?;

    let stdin = child.stdin.take()?;
    Some((child, stdin))
}

// ─── turn processing ─────────────────────────────────────────────────────────

/// Process one turn using the already-spawned `child` and `stdin`.
/// Writes the prompt, closes stdin (→ EOF so codex starts), then reads
/// stdout until `turn.completed` or `turn.failed`.
fn process_turn(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    mut child: Child,
    stdin: ChildStdin,
    thread_id: &mut Option<String>,
) -> Result<(), String> {
    eprintln!("[codex] process_turn pid={:?} conv_id={}", child.id(), conv_id);

    // Write prompt then drop stdin → EOF → codex starts processing
    {
        let mut stdin = stdin;
        let line = format!("{}\n", user_text);
        stdin.write_all(line.as_bytes()).map_err(|e| format!("stdin write: {}", e))?;
        stdin.flush().map_err(|e| format!("stdin flush: {}", e))?;
        // stdin dropped here → EOF sent to codex
    }
    eprintln!("[codex] wrote prompt (stdin closed), reading stdout...");

    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));

    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Err("stdout EOF (codex exited)".into()),
            Err(e) => return Err(format!("read error: {}", e)),
            Ok(_) => {}
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        eprintln!("[codex] stdout: {}", &trimmed[..trimmed.len().min(300)]);

        let raw: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        match raw["type"].as_str().unwrap_or("") {
            "thread.started" => {
                if let Some(tid) = raw["thread_id"].as_str() {
                    *thread_id = Some(tid.to_string());
                    save_thread_id(state, conv_id, tid);
                    eprintln!("[codex] thread_id={}", tid);
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
                complete_turn(state, conv_id, "completed");
                return Ok(());
            }
            "turn.failed" => {
                let msg = raw["error"]["message"]
                    .as_str()
                    .unwrap_or("turn failed")
                    .to_string();
                let _ = child.kill();
                let _ = child.wait();
                complete_turn(state, conv_id, "failed");
                return Err(msg);
            }
            _ => {}
        }
    }
}

// ─── event handlers ──────────────────────────────────────────────────────────

fn handle_item_completed(raw: &Value, state: &AppState, conv_id: &str) {
    let item = match raw["item"].as_object() {
        Some(i) => i,
        None => return,
    };
    let item_type = item
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("");

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
            let exit_code = item
                .get("exit_code")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
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
            eprintln!("[codex] unhandled item type: {}", item_type);
        }
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
        drop(db);
        broadcast(state, conv_id, seq, "task_status", payload);
    }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/// Returns the `codex exec` mode flags for the given mode string.
pub fn mode_flags(mode: &str) -> Vec<&'static str> {
    match mode.to_lowercase().as_str() {
        "auto-edit" | "full-auto" => vec!["--full-auto"],
        "yolo" => vec!["--dangerously-bypass-approvals-and-sandbox"],
        _ => vec![],
    }
}

/// Extract text from an item's array field, filtering by element type.
/// Falls back to the item's top-level `text` field if the array is missing or empty.
pub fn extract_text_from_array(
    item: &serde_json::Map<String, Value>,
    array_field: &str,
    element_type: &str,
) -> String {
    if let Some(arr) = item.get(array_field).and_then(|v| v.as_array()) {
        let parts: Vec<&str> = arr
            .iter()
            .filter_map(|elem| {
                let m = elem.as_object()?;
                if !element_type.is_empty()
                    && m.get("type").and_then(|v| v.as_str()) != Some(element_type)
                {
                    return None;
                }
                m.get("text").and_then(|v| v.as_str()).filter(|s| !s.is_empty())
            })
            .collect();
        if !parts.is_empty() {
            return parts.join("\n");
        }
    }
    item.get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn load_thread_id(state: &AppState, conv_id: &str) -> Option<String> {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT codex_thread_id FROM conversations WHERE id = ?1",
        [conv_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

fn save_thread_id(state: &AppState, conv_id: &str, thread_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET codex_thread_id = ?1 WHERE id = ?2",
        rusqlite::params![thread_id, conv_id],
    );
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
        let n = tx.send(json).unwrap_or(0);
        eprintln!("[codex] broadcast role={} seq={} receivers={}", role, seq, n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// extract_text_from_array: agent_message with content array.
    ///
    /// Execution:
    ///   1. Build item JSON with content: [{type: output_text, text: "Hello"}, {type: output_text, text: "world"}]
    ///   2. Call extract_text_from_array(&item, "content", "output_text")
    ///
    /// Expected:
    ///   - returns "Hello\nworld"
    #[test]
    fn test_extract_text_from_agent_message() {
        let v = json!({
            "type": "agent_message",
            "content": [
                {"type": "output_text", "text": "Hello"},
                {"type": "output_text", "text": "world"}
            ]
        });
        let item = v.as_object().unwrap();
        let text = extract_text_from_array(item, "content", "output_text");
        assert_eq!(text, "Hello\nworld", "should join output_text elements with newline");
    }

    /// extract_text_from_array: filters out non-matching element types.
    ///
    /// Execution:
    ///   1. Build item with mixed content types
    ///   2. Call extract_text_from_array filtering for "output_text"
    ///
    /// Expected:
    ///   - only "output_text" elements included
    #[test]
    fn test_extract_text_filters_by_type() {
        let v = json!({
            "content": [
                {"type": "other", "text": "ignored"},
                {"type": "output_text", "text": "kept"}
            ]
        });
        let item = v.as_object().unwrap();
        let text = extract_text_from_array(item, "content", "output_text");
        assert_eq!(text, "kept", "should exclude non-output_text elements");
    }

    /// extract_text_from_array: fallback to top-level text field.
    ///
    /// Execution:
    ///   1. Build item with no content array but a top-level text field
    ///   2. Call extract_text_from_array
    ///
    /// Expected:
    ///   - returns the top-level text value
    #[test]
    fn test_extract_text_fallback_to_text_field() {
        let v = json!({"text": "fallback value"});
        let item = v.as_object().unwrap();
        let text = extract_text_from_array(item, "content", "output_text");
        assert_eq!(text, "fallback value", "should fall back to top-level text field");
    }

    /// mode_flags: maps mode strings to codex CLI flags.
    ///
    /// Expected:
    ///   - "full-auto" → ["--full-auto"]
    ///   - "auto-edit" → ["--full-auto"]
    ///   - "yolo"      → ["--dangerously-bypass-approvals-and-sandbox"]
    ///   - "suggest"   → []
    #[test]
    fn test_mode_flags() {
        assert_eq!(mode_flags("full-auto"), vec!["--full-auto"]);
        assert_eq!(mode_flags("auto-edit"), vec!["--full-auto"]);
        assert_eq!(mode_flags("yolo"), vec!["--dangerously-bypass-approvals-and-sandbox"]);
        assert!(mode_flags("suggest").is_empty(), "suggest should add no flags");
        assert!(mode_flags("").is_empty(), "empty mode should add no flags");
    }
}
