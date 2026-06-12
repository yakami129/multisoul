use crate::serve::state::AppState;
use serde_json::Value;
use std::sync::{Mutex, OnceLock};

pub(super) struct InfcodeBinGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
    previous: Option<String>,
}

impl InfcodeBinGuard {
    pub(super) fn clear() -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let mutex = ENV_LOCK.get_or_init(|| Mutex::new(()));
        let lock = match mutex.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let previous = std::env::var("INFCODE_BIN").ok();
        std::env::remove_var("INFCODE_BIN");
        Self {
            _lock: lock,
            previous,
        }
    }

    pub(super) fn set(value: &std::path::Path) -> Self {
        static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let mutex = ENV_LOCK.get_or_init(|| Mutex::new(()));
        let lock = match mutex.lock() {
            Ok(lock) => lock,
            Err(poisoned) => poisoned.into_inner(),
        };
        let previous = std::env::var("INFCODE_BIN").ok();
        std::env::set_var("INFCODE_BIN", value);
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for InfcodeBinGuard {
    fn drop(&mut self) {
        if let Some(value) = &self.previous {
            std::env::set_var("INFCODE_BIN", value);
        } else {
            std::env::remove_var("INFCODE_BIN");
        }
    }
}

pub(super) fn make_infcode_state() -> AppState {
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
        "INSERT INTO agents (id, name) VALUES ('agent-1', 'InfCode')",
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

pub(super) fn conversation_status(state: &AppState) -> String {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT status FROM conversations WHERE id = 'conv-1'",
        [],
        |r| r.get(0),
    )
    .unwrap()
}

pub(super) fn messages_for(state: &AppState) -> Vec<(String, Value)> {
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

pub(super) fn make_executable(path: &std::path::Path) {
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

pub(super) fn write_fake_infcode(
    dir: &std::path::Path,
    unix_script: &str,
    windows_script: &str,
) -> std::path::PathBuf {
    let (path, script) = if cfg!(windows) {
        (dir.join("infcode.cmd"), windows_script)
    } else {
        (dir.join("infcode"), unix_script)
    };

    std::fs::write(&path, script).unwrap();
    make_executable(&path);
    path
}
