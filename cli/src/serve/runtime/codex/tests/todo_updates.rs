use super::super::turn;
use crate::serve::state::AppState;
use serde_json::Value;
use std::process::{Command, Stdio};

#[cfg(unix)]
#[test]
fn codex_process_turn_emits_todo_update_snapshots() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'idle',
                last_message_at INTEGER NOT NULL DEFAULT 0,
                codex_thread_id TEXT
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL
            );",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, status, last_message_at, codex_thread_id)
         VALUES ('conv-1', 'idle', 0, NULL)",
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
    let script = r#"cat >/dev/null
printf '%s\n' '{"type":"item.started","item":{"id":"todo-1","type":"todo_list","items":[{"text":"fix card","status":"pending"}]}}'
printf '%s\n' '{"type":"item.updated","item":{"id":"todo-1","type":"todo_list","items":[{"text":"fix card","status":"in_progress"}]}}'
printf '%s\n' '{"type":"item.completed","item":{"id":"todo-1","type":"todo_list","items":[{"text":"fix card","status":"completed"}],"status":"completed"}}'
printf '%s\n' '{"type":"turn.completed"}'
"#;
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdin = child.stdin.take().unwrap();
    let mut thread_id = None;

    assert!(turn::process_turn(&state, "conv-1", "hello", 1, child, stdin, &mut thread_id).is_ok());

    let db = state.db.lock().unwrap();
    let rows = db
        .prepare("SELECT role, payload FROM messages WHERE conversation_id='conv-1' ORDER BY seq")
        .unwrap()
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                serde_json::from_str::<Value>(&row.get::<_, String>(1)?).unwrap(),
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let tool_calls = rows
        .iter()
        .filter(|(role, _)| role == "tool_call")
        .map(|(_, payload)| payload)
        .collect::<Vec<_>>();

    assert_eq!(tool_calls.len(), 3);
    assert_eq!(tool_calls[0]["call_id"], "todo-1");
    assert!(tool_calls[1]["args"]
        .as_str()
        .unwrap()
        .contains("in_progress"));
    assert!(tool_calls[2]["args"]
        .as_str()
        .unwrap()
        .contains("completed"));
    assert_eq!(
        rows.iter()
            .find(|(role, _)| role == "tool_result")
            .unwrap()
            .1["summary"],
        "1/1 tasks"
    );
}
