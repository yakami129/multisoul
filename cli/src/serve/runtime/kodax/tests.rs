use super::*;
use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tempfile::tempdir;

#[test]
fn build_kodax_args_uses_json_session_agent_mode_and_provider_model() {
    let args = build_kodax_args("conv-1", "hello", Some("openai:gpt-5.4")).unwrap();

    assert_eq!(
        args,
        vec![
            "--mode",
            "json",
            "--session",
            "conv-1",
            "--agent-mode",
            "ama",
            "-m",
            "openai",
            "--model",
            "gpt-5.4",
            "hello",
        ],
        "KodaX argv should use JSON mode, MultiSoul conversation id, AMA mode, provider, model, then prompt"
    );
}

#[test]
fn build_kodax_args_omits_provider_model_for_default() {
    let args = build_kodax_args("conv-1", "hello", None).unwrap();

    assert_eq!(
        args,
        vec![
            "--mode",
            "json",
            "--session",
            "conv-1",
            "--agent-mode",
            "ama",
            "hello",
        ],
        "Default KodaX model should not pass provider/model flags"
    );
    assert!(
        !args.iter().any(|arg| arg == "-m" || arg == "--model"),
        "None model_id must not add KodaX provider/model args"
    );
}

#[test]
fn split_provider_model_requires_non_empty_provider_and_model() {
    assert_eq!(
        split_provider_model("anthropic:claude-sonnet-4-6").unwrap(),
        ("anthropic", "claude-sonnet-4-6")
    );
    assert!(
        split_provider_model("gpt-5.4").is_err(),
        "KodaX model ids must be encoded as provider:model"
    );
    assert!(
        split_provider_model(":gpt-5.4").is_err(),
        "provider cannot be empty"
    );
    assert!(
        split_provider_model("openai:").is_err(),
        "model cannot be empty"
    );
}

#[test]
fn process_turn_maps_jsonl_events_into_messages_and_completion() {
    let state = make_kodax_state();
    let dir = tempdir().unwrap();
    let fake_kodax = dir.path().join("kodax");
    std::fs::write(
        &fake_kodax,
        r#"#!/bin/sh
printf '%s
' '{"type":"session.start","provider":"openai","sessionId":"conv-1"}'
printf '%s
' '{"type":"text.delta","text":"hello"}'
printf '%s
' '{"type":"thinking.delta","text":"thinking"}'
printf '%s
' '{"type":"tool.start","id":"tool-1","name":"bash","input":{"command":"pwd"}}'
printf '%s
' '{"type":"tool.result","id":"tool-1","name":"bash","content":"/repo"}'
printf '%s
' '{"type":"run.result","success":true,"sessionId":"conv-1"}'
"#,
    )
    .unwrap();
    make_executable(&fake_kodax);
    let _env_guard = KodaxBinGuard::set(&fake_kodax);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    process_turn(
        &state,
        "conv-1",
        KodaxTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("fake JSONL KodaX run should complete");

    assert_eq!(conversation_status(&state), "completed");
    let messages = messages_for(&state);
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str()) == Some("hello")),
        "text.delta should be stored as agent_text"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str()) == Some("thinking")),
        "thinking.delta should use the available agent_text role"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "tool_call"
            && payload.get("call_id").and_then(|id| id.as_str()) == Some("tool-1")
            && payload
                .get("args")
                .and_then(|args| args.get("command"))
                .and_then(|c| c.as_str())
                == Some("pwd")),
        "tool.start should be stored as a tool_call with structured args"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "tool_result"
            && payload.get("call_id").and_then(|id| id.as_str()) == Some("tool-1")
            && payload.get("summary").and_then(|summary| summary.as_str()) == Some("/repo")),
        "tool.result should be stored as tool_result"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "task_status"
            && payload.get("status").and_then(|status| status.as_str()) == Some("completed")),
        "run.result success=true should emit completed task_status"
    );
}

#[test]
fn process_turn_falls_back_to_plain_text_stdout() {
    let state = make_kodax_state();
    let dir = tempdir().unwrap();
    let fake_kodax = dir.path().join("kodax");
    std::fs::write(
        &fake_kodax,
        "#!/bin/sh\nprintf '%s\\n' 'plain line one'\nprintf '%s\\n' 'plain line two'\n",
    )
    .unwrap();
    make_executable(&fake_kodax);
    let _env_guard = KodaxBinGuard::set(&fake_kodax);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    process_turn(
        &state,
        "conv-1",
        KodaxTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("plain text fallback should complete on zero exit");

    assert_eq!(conversation_status(&state), "completed");
    let messages = messages_for(&state);
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str())
                == Some("plain line one\nplain line two")),
        "non-JSON stdout should be merged into one agent_text message"
    );
}

#[test]
fn process_turn_drains_large_stderr_without_deadlock() {
    let state = make_kodax_state();
    let dir = tempdir().unwrap();
    let fake_kodax = dir.path().join("kodax");
    std::fs::write(
        &fake_kodax,
        r#"#!/bin/sh
for i in $(seq 1 2000); do
  printf 'stderr-line-%04d abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz\n' "$i" >&2
done
printf '%s\n' '{"type":"text.delta","text":"done"}'
printf '%s\n' '{"type":"run.result","success":true,"sessionId":"conv-1"}'
"#,
    )
    .unwrap();
    make_executable(&fake_kodax);
    let _env_guard = KodaxBinGuard::set(&fake_kodax);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    let started = Instant::now();
    process_turn(
        &state,
        "conv-1",
        KodaxTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("large stderr output should be drained while stdout is read");

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "KodaX stderr drain should prevent pipe deadlock"
    );
    assert_eq!(conversation_status(&state), "completed");
    assert!(
        messages_for(&state)
            .iter()
            .any(|(role, payload)| role == "agent_text"
                && payload.get("text").and_then(|text| text.as_str()) == Some("done")),
        "stdout JSONL should still be processed while stderr is drained"
    );
}

#[cfg(unix)]
#[test]
fn abort_kills_child_and_worker_marks_aborted() {
    let state = make_kodax_state();
    let dir = tempdir().unwrap();
    let fake_kodax = dir.path().join("kodax");
    std::fs::write(&fake_kodax, "#!/bin/sh\nsleep 30\n").unwrap();
    make_executable(&fake_kodax);
    let _env_guard = KodaxBinGuard::set(&fake_kodax);

    let (tx, rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx.clone());
    state
        .sessions
        .lock()
        .unwrap()
        .insert("conv-1".to_string(), handle.clone());

    let state_for_worker = state.clone();
    let project_path = dir.path().to_string_lossy().to_string();
    let worker = std::thread::spawn(move || {
        session_worker(
            state_for_worker,
            "conv-1".to_string(),
            project_path,
            "full-auto".to_string(),
            rx,
            handle,
        );
    });

    tx.send(crate::serve::state::SessionMessage {
        user_text: "hello".to_string(),
        file_id: None,
        model_id: None,
        seq: 1,
    })
    .unwrap();

    assert!(
        wait_until(Duration::from_millis(1000), || conversation_status(&state)
            == "running"),
        "KodaX worker should mark conversation running after spawning child"
    );
    let registered_pid = state
        .sessions
        .lock()
        .unwrap()
        .get("conv-1")
        .and_then(|session| *session.current_pid.lock().unwrap());
    assert!(
        registered_pid.is_some(),
        "KodaX worker should register current child pid before abort"
    );

    let removed_session = state.sessions.lock().unwrap().remove("conv-1").unwrap();
    assert!(
        removed_session.abort_current_process(),
        "abort_current_process should kill the registered KodaX process group"
    );

    let worker_result = join_with_timeout(worker, Duration::from_millis(1000));
    assert!(
        worker_result.is_some(),
        "KodaX worker should exit within 1000ms after abort kills child"
    );
    worker_result
        .unwrap()
        .expect("KodaX worker should not panic");
    assert_eq!(conversation_status(&state), "aborted");
    assert!(
        messages_for(&state)
            .iter()
            .any(|(role, payload)| role == "task_status"
                && payload.get("status").and_then(|status| status.as_str()) == Some("aborted")),
        "aborted KodaX turn should emit aborted task_status"
    );
}

fn make_kodax_state() -> AppState {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                last_message_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL
            );
            CREATE TABLE push_tokens (
                expo_push_token TEXT NOT NULL,
                endpoint_id TEXT,
                registered_at INTEGER NOT NULL DEFAULT 0
            );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agents (id, name) VALUES ('agent-1', 'KodaX')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, agent_id, status, last_message_at)
         VALUES ('conv-1', 'agent-1', 'idle', 0)",
        [],
    )
    .unwrap();
    AppState::new(
        conn,
        "token".to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            rusqlite::Connection::open_in_memory().unwrap(),
        ))),
    )
}

fn conversation_status(state: &AppState) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT status FROM conversations WHERE id = 'conv-1'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

fn messages_for(state: &AppState) -> Vec<(String, Value)> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT role, payload FROM messages WHERE conversation_id='conv-1' ORDER BY seq")
        .unwrap();
    stmt.query_map([], |row| {
        let role: String = row.get(0)?;
        let payload: String = row.get(1)?;
        let payload = serde_json::from_str(&payload).unwrap_or(Value::Null);
        Ok((role, payload))
    })
    .unwrap()
    .map(|row| row.unwrap())
    .collect()
}

fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if condition() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    condition()
}

fn join_with_timeout<T>(
    handle: std::thread::JoinHandle<T>,
    timeout: Duration,
) -> Option<std::thread::Result<T>> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if handle.is_finished() {
            return Some(handle.join());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

fn make_executable(path: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

struct KodaxBinGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    previous: Option<String>,
}

impl KodaxBinGuard {
    fn set(value: &std::path::Path) -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let lock = ENV_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let previous = std::env::var("KODAX_BIN").ok();
        std::env::set_var("KODAX_BIN", value);
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for KodaxBinGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var("KODAX_BIN", value);
        } else {
            std::env::remove_var("KODAX_BIN");
        }
    }
}
