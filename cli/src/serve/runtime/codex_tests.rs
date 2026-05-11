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

/// mode_flags: maps fresh exec mode strings to Codex CLI flags.
///
/// Data construction:
///   full-auto / auto-edit = workspace-write sandbox + non-interactive approval
///   yolo                  = bypass approvals and sandbox
///   suggest / ""          = no runtime overrides
///
/// Execution:
///   1. Call mode_flags for each mode
///   2. Compare each exact argv fragment
///   3. Check unsupported modes return no flags
///
/// Expected:
///   - full-auto uses public `codex exec --sandbox workspace-write`
///   - full-auto does not use `-c sandbox_mode=...` for fresh exec
///   - auto-edit matches full-auto
///   - yolo uses bypass flag
///   - suggest and empty mode add no flags
#[test]
fn test_mode_flags() {
    assert_eq!(
        mode_flags("full-auto"),
        vec![
            "--sandbox",
            "workspace-write",
            "-c",
            "approval_policy=\"never\""
        ],
        "fresh full-auto should use the public --sandbox flag plus non-interactive approval"
    );
    assert!(
        !mode_flags("full-auto").contains(&"sandbox_mode=\"workspace-write\""),
        "fresh full-auto should not rely on sandbox_mode config when --sandbox is available"
    );
    assert_eq!(
        mode_flags("auto-edit"),
        vec![
            "--sandbox",
            "workspace-write",
            "-c",
            "approval_policy=\"never\""
        ],
        "fresh auto-edit should match full-auto non-interactive workspace-write behavior"
    );
    assert_eq!(
        mode_flags("yolo"),
        vec!["--dangerously-bypass-approvals-and-sandbox"],
        "yolo must bypass approvals and sandbox explicitly"
    );
    assert!(
        mode_flags("suggest").is_empty(),
        "suggest should add no flags"
    );
    assert!(mode_flags("").is_empty(), "empty mode should add no flags");
}

/// resume_mode_flags: maps resume mode strings to flags supported by `codex exec resume`.
///
/// Data construction:
///   `codex exec resume --help` exposes `-c/--config` but not `--sandbox`.
///   Therefore resume must configure sandbox via config overrides.
///
/// Execution:
///   1. Call resume_mode_flags("full-auto")
///   2. Call resume_mode_flags("auto-edit")
///   3. Call resume_mode_flags("suggest")
///
/// Expected:
///   - full-auto includes approval_policy="never"
///   - full-auto includes sandbox_mode="workspace-write"
///   - full-auto does not include --sandbox
///   - auto-edit matches full-auto
///   - suggest returns no flags
#[test]
fn test_resume_mode_flags() {
    assert_eq!(
        resume_mode_flags("full-auto"),
        vec![
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"workspace-write\""
        ],
        "resume full-auto must use config overrides because resume has no --sandbox option"
    );
    assert!(
        !resume_mode_flags("full-auto").contains(&"--sandbox"),
        "resume full-auto must not pass unsupported --sandbox"
    );
    assert_eq!(
        resume_mode_flags("auto-edit"),
        vec![
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "sandbox_mode=\"workspace-write\""
        ],
        "resume auto-edit should match resume full-auto"
    );
    assert!(
        resume_mode_flags("suggest").is_empty(),
        "resume suggest should add no flags"
    );
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
    let state = AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    );

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
