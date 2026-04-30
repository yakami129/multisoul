# Codex Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codex as a first-class runtime so agents registered with `--runtime codex` drive the `codex exec` CLI instead of `claude`.

**Architecture:** Split `serve/runtime.rs` into `runtime/mod.rs` (dispatch) + `runtime/claude.rs` (moved verbatim) + `runtime/codex.rs` (new Codex protocol). DB gains `agents.mode` and `conversations.codex_thread_id` columns. `messages.rs` fetches `runtime` + `mode` to pass through dispatch.

**Tech Stack:** Rust, rusqlite, tokio, serde_json, axum, `codex` CLI binary (npm: `@openai/codex`)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `cli/src/db.rs` | Modify | Add 2 migration statements |
| `cli/src/commands/agent.rs` | Modify | Add `--mode` arg to `register`; pass to `insert_agent` |
| `cli/src/serve/runtime.rs` | **Delete** | Replaced by module |
| `cli/src/serve/runtime/mod.rs` | **Create** | Public `send_to_session` dispatch |
| `cli/src/serve/runtime/claude.rs` | **Create** | Verbatim content of old `runtime.rs` |
| `cli/src/serve/runtime/codex.rs` | **Create** | Codex protocol: spawn, parse events, broadcast |
| `cli/src/serve/routes/messages.rs` | Modify | Fetch `runtime`+`mode`; update call to `send_to_session` |

`cli/src/serve/mod.rs` — **no change** (`pub mod runtime;` already resolves to a directory module).

---

## Task 1: DB Migrations

**Files:**
- Modify: `cli/src/db.rs`

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)]` block in `cli/src/db.rs`:

```rust
/// DB migration: agents table has mode column after open_at.
///
/// Execution:
///   1. Open fresh DB
///   2. Query column info for agents table
///
/// Expected:
///   - "mode" column exists in agents
///   - "codex_thread_id" column exists in conversations
#[test]
fn test_schema_has_mode_and_codex_thread_id() {
    let dir = tempdir().unwrap();
    let conn = open_at(&dir.path().join("test.db")).unwrap();

    let has_mode: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('agents') WHERE name='mode'",
        [], |r| r.get::<_, i64>(0),
    ).unwrap() > 0;
    assert!(has_mode, "agents.mode column must exist after migration");

    let has_thread_id: bool = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='codex_thread_id'",
        [], |r| r.get::<_, i64>(0),
    ).unwrap() > 0;
    assert!(has_thread_id, "conversations.codex_thread_id column must exist after migration");
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd cli && cargo test test_schema_has_mode_and_codex_thread_id -- --nocapture
```
Expected: FAIL — columns not found.

- [ ] **Step 3: Add migrations to `init_schema`**

In `cli/src/db.rs`, after the existing migration line at the bottom of `init_schema`:

```rust
fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS agents (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL UNIQUE,
            project_path TEXT NOT NULL,
            runtime      TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
            id              TEXT PRIMARY KEY,
            agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            title           TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            last_message_at INTEGER NOT NULL,
            status          TEXT NOT NULL DEFAULT 'idle',
            claude_session_id TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            TEXT NOT NULL,
            payload         TEXT NOT NULL,
            created_at      INTEGER NOT NULL,
            seq             INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            importance      TEXT NOT NULL DEFAULT 'normal',
            status          TEXT NOT NULL DEFAULT 'running',
            started_at      INTEGER NOT NULL,
            ended_at        INTEGER
        );
        CREATE TABLE IF NOT EXISTS push_tokens (
            id              TEXT PRIMARY KEY,
            expo_push_token TEXT NOT NULL,
            device_label    TEXT NOT NULL,
            registered_at   INTEGER NOT NULL
        );
    "#)?;
    // Migrate existing DBs
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN claude_session_id TEXT;");
    let _ = conn.execute_batch("ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'full-auto';");
    let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT;");
    Ok(())
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd cli && cargo test test_schema_has_mode_and_codex_thread_id -- --nocapture
```
Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
cd cli && cargo test -- --nocapture
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd cli && git add src/db.rs
git commit -m "feat(db): add agents.mode and conversations.codex_thread_id migrations"
```

---

## Task 2: CLI — Add `--mode` to `agent register`

**Files:**
- Modify: `cli/src/commands/agent.rs`

- [ ] **Step 1: Write failing test**

Add to `#[cfg(test)]` in `cli/src/commands/agent.rs`:

```rust
/// agent register: mode column is stored correctly.
///
/// Data construction:
///   name    = "codex-agent"
///   runtime = "codex"
///   mode    = "full-auto"
///
/// Execution:
///   1. Open temp DB
///   2. Call insert_agent with mode="full-auto"
///   3. Query agents.mode
///
/// Expected:
///   - mode == "full-auto"
#[test]
fn test_insert_agent_stores_mode() {
    let dir = tempfile::tempdir().unwrap();
    let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
    insert_agent(&conn, "codex-agent", "/p", "codex", "full-auto").unwrap();
    let mode: String = conn.query_row(
        "SELECT mode FROM agents WHERE name = 'codex-agent'",
        [], |r| r.get(0),
    ).unwrap();
    assert_eq!(mode, "full-auto", "mode should be stored as-is");
}
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd cli && cargo test test_insert_agent_stores_mode -- --nocapture
```
Expected: FAIL — `insert_agent` doesn't accept `mode` yet.

- [ ] **Step 3: Update `AgentCommands::Register`, `insert_agent`, and `register`**

Replace the relevant parts of `cli/src/commands/agent.rs`:

```rust
#[derive(Subcommand)]
pub enum AgentCommands {
    /// Register a new agent in local serve.db
    Register {
        #[arg(long)] name: String,
        #[arg(long)] project: String,
        #[arg(long, default_value = "claude-code")] runtime: String,
        /// Permission mode (codex only): suggest | auto-edit | full-auto | yolo
        #[arg(long, default_value = "full-auto")] mode: String,
    },
    // ... rest unchanged
}
```

Update `handle`:
```rust
AgentCommands::Register { name, project, runtime, mode } => register(&conn, &name, &project, &runtime, &mode),
```

Update `insert_agent`:
```rust
pub fn insert_agent(conn: &Connection, name: &str, project_path: &str, runtime: &str, mode: &str) -> Result<String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, mode, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, name, project_path, runtime, mode, now_ms()],
    ).context("Failed to insert agent")?;
    Ok(id)
}
```

Update `register`:
```rust
fn register(conn: &Connection, name: &str, project: &str, runtime: &str, mode: &str) -> Result<()> {
    let id = insert_agent(conn, name, project, runtime, mode)?;
    println!("Agent registered. ID: {}", id);
    Ok(())
}
```

- [ ] **Step 4: Fix existing tests that call `insert_agent`**

In the same file, update the two existing tests to pass `"claude-code"` as the mode arg:

```rust
// test_insert_agent_writes_row: change call to:
insert_agent(&conn, "blog-fixer", "/home/user/blog", "claude-code", "full-auto").unwrap();

// test_insert_agent_duplicate_name_errors: change calls to:
insert_agent(&conn, "dup-agent", "/p", "claude-code", "full-auto").unwrap();
let result = insert_agent(&conn, "dup-agent", "/p2", "codex", "full-auto");
```

- [ ] **Step 5: Run test — verify new test passes**

```bash
cd cli && cargo test test_insert_agent -- --nocapture
```
Expected: all 3 `test_insert_agent_*` tests pass.

- [ ] **Step 6: Run all tests**

```bash
cd cli && cargo test -- --nocapture
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd cli && git add src/commands/agent.rs
git commit -m "feat(cli): add --mode flag to agent register for codex permission mode"
```

---

## Task 3: Convert `runtime.rs` to Module

**Files:**
- Create: `cli/src/serve/runtime/mod.rs`
- Create: `cli/src/serve/runtime/claude.rs`
- Delete: `cli/src/serve/runtime.rs`

No functional changes in this task — just reorganization.

- [ ] **Step 1: Create `cli/src/serve/runtime/` directory and `claude.rs`**

Copy the entire content of `cli/src/serve/runtime.rs` verbatim into `cli/src/serve/runtime/claude.rs`.

The file starts with the existing imports and `send_to_session` function — no modifications.

- [ ] **Step 2: Create `cli/src/serve/runtime/mod.rs`**

```rust
mod claude;
pub mod codex;

use crate::serve::state::AppState;

/// Dispatch a user message to the appropriate runtime backend.
/// `runtime` matches the agent's `runtime` column ("claude-code" | "codex").
/// `mode` is the agent's `mode` column (only used by codex).
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    project_path: &str,
    runtime: &str,
    mode: &str,
) {
    match runtime {
        "codex" => codex::send_to_session(state, conv_id, user_text, project_path, mode),
        _ => claude::send_to_session(state, conv_id, user_text, project_path),
    }
}
```

- [ ] **Step 3: Create stub `cli/src/serve/runtime/codex.rs`**

So the project compiles before the real implementation:

```rust
use crate::serve::state::AppState;

pub fn send_to_session(
    _state: &AppState,
    _conv_id: &str,
    _user_text: &str,
    _project_path: &str,
    _mode: &str,
) {
    eprintln!("[codex] send_to_session: not yet implemented");
}
```

- [ ] **Step 4: Delete `cli/src/serve/runtime.rs`**

```bash
rm cli/src/serve/runtime.rs
```

- [ ] **Step 5: Update `messages.rs` to pass `runtime` and `mode`**

In `cli/src/serve/routes/messages.rs`, replace the `project_path` fetch block and `send_to_session` call:

```rust
// Replace the existing block:
//   let project_path: Option<String> = { ... }
//   if let Some(path) = project_path { runtime::send_to_session(...) }
// With:

let agent_info: Option<(String, String, String)> = {
    let db2 = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db2.query_row(
        "SELECT a.project_path, a.runtime, a.mode FROM agents a
         JOIN conversations c ON c.agent_id = a.id
         WHERE c.id = ?1",
        [&conv_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).ok()
};
if let Some((path, rt, mode)) = agent_info {
    runtime::send_to_session(&state, &conv_id, &body.text, &path, &rt, &mode);
}
```

- [ ] **Step 6: Build — verify it compiles**

```bash
cd cli && cargo build 2>&1
```
Expected: compiles with no errors (codex stub just prints and returns).

- [ ] **Step 7: Run all tests**

```bash
cd cli && cargo test -- --nocapture
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd cli && git add src/serve/runtime/ src/serve/routes/messages.rs
git rm src/serve/runtime.rs
git commit -m "refactor(runtime): split runtime.rs into runtime/{mod,claude,codex}.rs module"
```

---

## Task 4: Implement `runtime/codex.rs`

**Files:**
- Modify: `cli/src/serve/runtime/codex.rs`

This task replaces the stub with the full Codex protocol implementation.

- [ ] **Step 1: Write unit tests for event parsing helpers**

Add to the bottom of `cli/src/serve/runtime/codex.rs`:

```rust
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

    /// mode_flags: full-auto maps to --full-auto.
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd cli && cargo test --lib runtime::codex -- --nocapture
```
Expected: FAIL — functions not defined yet.

- [ ] **Step 3: Write the full implementation**

Replace the stub content of `cli/src/serve/runtime/codex.rs` with:

```rust
//! Codex runtime adapter.
//! Drives `codex exec` (or `codex exec resume`) as a subprocess.
//! Stdin: plain-text prompt. Stdout: JSON lines per the Codex event protocol.

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

    let (mut child, mut stdin) =
        match spawn_codex(&project_path, thread_id.as_deref(), &mode) {
            Some(pair) => pair,
            None => {
                mark_failed(&state, &conv_id);
                return;
            }
        };
    eprintln!("[codex] spawned pid={:?} conv_id={}", child.id(), conv_id);

    let mut reader = BufReader::new(child.stdout.take().expect("no stdout"));

    loop {
        let user_text = match rx.recv() {
            Ok(t) => t,
            Err(_) => {
                eprintln!("[codex] channel closed, killing codex conv_id={}", conv_id);
                let _ = child.kill();
                return;
            }
        };
        eprintln!("[codex] processing message conv_id={}", conv_id);

        let mut ok = false;
        for attempt in 1..=3 {
            match process_turn(&mut stdin, &mut reader, &state, &conv_id, &user_text, &mut thread_id) {
                Ok(()) => {
                    ok = true;
                    break;
                }
                Err(e) => {
                    eprintln!("[codex] turn error attempt={} error={} conv_id={}", attempt, e, conv_id);
                    let _ = child.kill();
                    let _ = child.wait();
                    match spawn_codex(&project_path, thread_id.as_deref(), &mode) {
                        Some((c, s)) => {
                            child = c;
                            stdin = s;
                            reader = BufReader::new(child.stdout.take().expect("no stdout"));
                        }
                        None => {
                            eprintln!("[codex] respawn failed conv_id={}", conv_id);
                            break;
                        }
                    }
                }
            }
        }

        if !ok {
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
        // Resume an existing thread
        vec![
            "exec".into(),
            "resume".into(),
            "--skip-git-repo-check".into(),
            tid.to_string(),
            "--json".into(),
            "-".into(),
        ]
    } else {
        // Start a new thread
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

fn write_prompt(stdin: &mut ChildStdin, prompt: &str) -> Result<(), String> {
    let line = format!("{}\n", prompt);
    stdin
        .write_all(line.as_bytes())
        .map_err(|e| format!("stdin write: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("stdin flush: {}", e))
}

// ─── turn processing ─────────────────────────────────────────────────────────

fn process_turn(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<std::process::ChildStdout>,
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    thread_id: &mut Option<String>,
) -> Result<(), String> {
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    write_prompt(stdin, user_text)?;
    eprintln!("[codex] wrote prompt, reading stdout...");

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
                complete_turn(state, conv_id, "completed");
                return Ok(());
            }
            "turn.failed" => {
                let msg = raw["error"]["message"]
                    .as_str()
                    .unwrap_or("turn failed")
                    .to_string();
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
/// Falls back to the item's top-level `text` field if the array is missing.
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
    // tests defined in Step 1 go here
}
```

- [ ] **Step 4: Move the test block from Step 1 into the `#[cfg(test)]` module at the bottom of the file**

The tests written in Step 1 reference `extract_text_from_array` and `mode_flags`, which are now defined above.

- [ ] **Step 5: Run unit tests — verify they pass**

```bash
cd cli && cargo test --lib runtime::codex -- --nocapture
```
Expected: all 4 tests pass (`test_extract_text_from_agent_message`, `test_extract_text_filters_by_type`, `test_extract_text_fallback_to_text_field`, `test_mode_flags`).

- [ ] **Step 6: Build the full project**

```bash
cd cli && cargo build 2>&1
```
Expected: compiles with no errors or warnings about unused imports.

- [ ] **Step 7: Run all tests**

```bash
cd cli && cargo test -- --nocapture
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd cli && git add src/serve/runtime/codex.rs
git commit -m "feat(runtime): implement codex session worker and event parsing"
```

---

## Task 5: Smoke Test End-to-End

**Prerequisite:** `codex` CLI must be installed (`npm install -g @openai/codex`) and `OPENAI_API_KEY` set.

- [ ] **Step 1: Build release binary**

```bash
cd cli && cargo build --release 2>&1
```
Expected: `target/release/msctl` produced.

- [ ] **Step 2: Register a codex agent**

```bash
./target/release/msctl agent register \
  --name test-codex \
  --project /tmp/test-project \
  --runtime codex \
  --mode full-auto
```
Expected output: `Agent registered. ID: <uuid>`

- [ ] **Step 3: Start serve in background**

```bash
mkdir -p /tmp/test-project
./target/release/msctl serve &
SERVE_PID=$!
sleep 1
```

- [ ] **Step 4: Create a conversation and send a message**

```bash
# Get agent ID
AGENT_ID=$(./target/release/msctl agent list | grep test-codex | awk '{print $1}')

# Create conversation via API
CONV=$(curl -s -X POST http://localhost:8080/api/v1/agents/$AGENT_ID/conversations \
  -H "Authorization: Bearer $(cat ~/.config/msctl/token 2>/dev/null || echo test)" \
  -H "Content-Type: application/json" \
  -d '{"title":"smoke test"}')
CONV_ID=$(echo $CONV | jq -r '.id')
echo "conv_id=$CONV_ID"

# Send a message
curl -s -X POST http://localhost:8080/api/v1/conversations/$CONV_ID/messages \
  -H "Authorization: Bearer $(cat ~/.config/msctl/token 2>/dev/null || echo test)" \
  -H "Content-Type: application/json" \
  -d '{"text":"echo hello world"}'
```

- [ ] **Step 5: Verify events appear**

```bash
sleep 5
curl -s http://localhost:8080/api/v1/conversations/$CONV_ID/messages \
  -H "Authorization: Bearer $(cat ~/.config/msctl/token 2>/dev/null || echo test)" \
  | jq '.[] | {role, payload}'
```
Expected: messages with `role: "agent_text"` or `role: "tool_call"` visible, and a final `role: "task_status"` with `status: "completed"`.

- [ ] **Step 6: Stop serve**

```bash
kill $SERVE_PID
```

- [ ] **Step 7: Final commit if smoke test passes**

```bash
cd cli && git add -A
git commit -m "chore: verified codex runtime integration end-to-end"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** DB migrations ✓, `--mode` CLI flag ✓, module split ✓, dispatch in mod.rs ✓, codex event protocol ✓ (thread.started, item.completed, turn.completed, turn.failed), messages.rs updated ✓
- [x] **No placeholders:** All code blocks are complete and functional
- [x] **Type consistency:** `extract_text_from_array` and `mode_flags` defined in Task 4 Step 3, referenced in tests in Task 4 Step 1 — match confirmed
- [x] **`insert_agent` signature:** Updated in Task 2, all call sites in tests updated in same task
- [x] **`send_to_session` signature:** Old 4-arg signature in claude.rs (unchanged), new 6-arg signature in mod.rs, messages.rs updated in Task 3 Step 5
