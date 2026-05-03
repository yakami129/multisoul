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
use std::process::{Child, ChildStdin, Command, Stdio};
use tracing::{debug, error, info, info_span, warn};
use uuid::Uuid;

use crate::db::now_ms;
use crate::logging;
use crate::serve::state::AppState;

#[path = "codex_turn.rs"]
mod codex_turn;

use codex_turn::{complete_turn, process_turn};

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
        if tx.send(crate::serve::state::SessionMessage { user_text: user_text.to_string(), file_id: None }).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    let (tx, rx) = std::sync::mpsc::channel::<crate::serve::state::SessionMessage>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions);

    let _ = tx.send(crate::serve::state::SessionMessage { user_text: user_text.to_string(), file_id: None });

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
    rx: std::sync::mpsc::Receiver<crate::serve::state::SessionMessage>,
) {
    let span = info_span!("session_worker", conv_id = %conv_id, runtime = "codex", mode = %mode);
    let _enter = span.enter();
    info!("session_worker_started");

    let mut thread_id: Option<String> = load_thread_id(&state, &conv_id);

    // Pre-warmed process: spawned after each successful turn so that Node.js
    // startup happens in the background while the user types their next message.
    let mut pre_spawned: Option<(Child, ChildStdin)> = None;

    loop {
        let user_text = match rx.recv() {
            Ok(msg) => msg.user_text,
            Err(_) => {
                info!("session_channel_closed_shutting_down");
                // Kill the pre-warmed process if nobody sent a follow-up message.
                if let Some((mut c, _s)) = pre_spawned.take() {
                    let _ = c.kill();
                    let _ = c.wait();
                }
                return;
            }
        };
        let preview = logging::truncate(&user_text, 200);
        info!(
            user_text_len = user_text.chars().count(),
            user_text_preview = %preview,
            "turn_start"
        );

        let mut ok = false;
        for attempt in 1..=3 {
            // First attempt uses the pre-warmed process (already started).
            // Retries always spawn fresh.
            let process = if attempt == 1 {
                pre_spawned.take().or_else(|| {
                    debug!("codex_no_pre_warm_spawning_fresh");
                    spawn_codex(&project_path, thread_id.as_deref(), &mode)
                })
            } else {
                warn!(attempt, "codex_retry_spawn");
                spawn_codex(&project_path, thread_id.as_deref(), &mode)
            };

            let (child, stdin) = match process {
                Some(p) => p,
                None => {
                    error!(attempt, "agent_spawn_failed");
                    continue;
                }
            };

            match process_turn(&state, &conv_id, &user_text, child, stdin, &mut thread_id) {
                Ok(()) => {
                    ok = true;
                    info!(attempt, "turn_end");
                    break;
                }
                Err(e) => {
                    if is_stale_thread_error(&e) {
                        warn!(attempt, thread_id = ?thread_id, "codex_stale_thread_detected");
                        clear_thread_id(&state, &conv_id);
                        thread_id = None;
                    }
                    warn!(attempt, error = %e, "turn_error");
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
                        debug!(thread_id = %tid, "codex_pre_warm_ok");
                    }
                    None => {
                        warn!("codex_pre_warm_spawn_failed");
                    }
                }
            }
        } else {
            error!("turn_failed_after_retries");
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

    debug!(args = ?args, "codex_spawn_args");

    let mut child = Command::new("codex")
        .args(&args)
        .current_dir(project_path)
        .env("HUSKY", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| error!(error = %e, "agent_spawn_failed"))
        .ok()?;

    let stdin = child.stdin.take()?;
    Some((child, stdin))
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
                m.get("text")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
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

fn clear_thread_id(state: &AppState, conv_id: &str) {
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "UPDATE conversations SET codex_thread_id = NULL WHERE id = ?1",
        [conv_id],
    );
}

fn is_stale_thread_error(error: &str) -> bool {
    error.contains("thread ") && error.contains(" not found")
}

fn mark_failed(state: &AppState, conv_id: &str) {
    complete_turn(state, conv_id, "failed");
}

pub(super) fn insert_message(
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

pub(super) fn broadcast(
    state: &AppState,
    conv_id: &str,
    seq: i64,
    role: &'static str,
    payload: Value,
) {
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
        debug!(role, seq, receivers = n, "broadcast");
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
        assert_eq!(
            text, "Hello\nworld",
            "should join output_text elements with newline"
        );
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
        assert_eq!(
            text, "fallback value",
            "should fall back to top-level text field"
        );
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
        assert_eq!(
            mode_flags("yolo"),
            vec!["--dangerously-bypass-approvals-and-sandbox"]
        );
        assert!(
            mode_flags("suggest").is_empty(),
            "suggest should add no flags"
        );
        assert!(mode_flags("").is_empty(), "empty mode should add no flags");
    }

    #[test]
    fn clears_stale_codex_thread_id() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                codex_thread_id TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, codex_thread_id) VALUES ('conv-1', 'thread-old')",
            [],
        )
        .unwrap();
        let state = AppState::new(conn, "token".to_string(), std::path::PathBuf::from("/tmp/uploads"));

        clear_thread_id(&state, "conv-1");

        let db = state.db.lock().unwrap();
        let thread_id: Option<String> = db
            .query_row(
                "SELECT codex_thread_id FROM conversations WHERE id = 'conv-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(thread_id, None);
    }
}
