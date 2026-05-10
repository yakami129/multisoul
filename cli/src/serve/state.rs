use crate::serve::interactive::AnswerPayload;
use crate::serve::plugin::PluginManager;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tracing::warn;

/// Message sent from HTTP handler to session worker via channel.
#[derive(Debug)]
pub struct SessionMessage {
    pub user_text: String,
    pub file_id: Option<String>,
}

pub type ConvBus = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<SessionMessage>>>>;
pub type AnswerMap = Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<AnswerPayload>>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub token: String,
    pub uploads_dir: PathBuf,
    pub bus: ConvBus,
    pub sessions: SessionMap,
    pub answer_txs: AnswerMap,
    pub plugin_manager: Arc<PluginManager>,
}

impl AppState {
    pub fn new(
        conn: Connection,
        token: String,
        uploads_dir: PathBuf,
        plugin_manager: Arc<PluginManager>,
    ) -> Self {
        AppState {
            db: Arc::new(Mutex::new(conn)),
            token,
            uploads_dir,
            bus: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            answer_txs: Arc::new(Mutex::new(HashMap::new())),
            plugin_manager,
        }
    }

    pub fn get_or_create_sender(&self, conv_id: &str) -> broadcast::Sender<String> {
        let mut bus = self.bus.lock().unwrap();
        bus.entry(conv_id.to_string())
            .or_insert_with(|| broadcast::channel(64).0)
            .clone()
    }

    /// Returns (tx, rx) for the answer channel of this conversation.
    /// The tx is stored in `answer_txs`; caller owns the rx.
    /// Capacity 1: one pending answer at a time per conversation.
    pub fn create_answer_channel(&self, conv_id: &str) -> std::sync::mpsc::Receiver<AnswerPayload> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        self.answer_txs
            .lock()
            .unwrap()
            .insert(conv_id.to_string(), tx);
        rx
    }

    /// Send a user answer to the session waiting for it.
    /// Returns false if no session is waiting (answer silently dropped).
    pub fn send_answer(&self, conv_id: &str, answer: AnswerPayload) -> bool {
        let txs = self.answer_txs.lock().unwrap();
        match txs.get(conv_id) {
            None => {
                let registered: Vec<String> = txs.keys().cloned().collect();
                warn!(
                    conv_id = %conv_id,
                    registered = ?registered,
                    "answer_no_channel"
                );
                false
            }
            Some(tx) => match tx.try_send(answer) {
                Ok(()) => true,
                Err(e) => {
                    warn!(
                        conv_id = %conv_id,
                        reason = ?e,
                        "answer_send_failed"
                    );
                    false
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// AppState::new accepts uploads_dir and stores it correctly.
    ///
    /// 执行：构造 AppState，验证 uploads_dir 字段被保留。
    ///
    /// 预期结果：
    ///   - uploads_dir 与传入路径相同
    #[test]
    fn test_app_state_stores_uploads_dir() {
        use crate::db;
        let dir = tempdir().unwrap();
        let uploads_dir = dir.path().join("uploads");
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(
            conn,
            "ms_v2_tok".to_string(),
            uploads_dir.clone(),
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                db::open_at(&dir.path().join("pm.db")).unwrap()
            ))),
        );
        assert_eq!(
            state.uploads_dir, uploads_dir,
            "uploads_dir should be stored in AppState"
        );
    }

    /// SessionMessage carries both user_text and file_id.
    ///
    /// 预期结果：
    ///   - text 和 file_id 都能正确读取
    #[test]
    fn test_session_message_fields() {
        let msg = SessionMessage {
            user_text: "hello".to_string(),
            file_id: Some("abc.jpg".to_string()),
        };
        assert_eq!(msg.user_text, "hello", "user_text should match");
        assert_eq!(
            msg.file_id.as_deref(),
            Some("abc.jpg"),
            "file_id should match"
        );

        let text_only = SessionMessage {
            user_text: "text only".to_string(),
            file_id: None,
        };
        assert!(
            text_only.file_id.is_none(),
            "file_id should be None for text-only"
        );
    }
}
