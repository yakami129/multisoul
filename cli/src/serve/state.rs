use crate::serve::interactive::AnswerPayload;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tracing::warn;

pub type ConvBus = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<String>>>>;
pub type AnswerMap = Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<AnswerPayload>>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub token: String,
    pub bus: ConvBus,
    pub sessions: SessionMap,
    pub answer_txs: AnswerMap,
}

impl AppState {
    pub fn new(conn: Connection, token: String) -> Self {
        AppState {
            db: Arc::new(Mutex::new(conn)),
            token,
            bus: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            answer_txs: Arc::new(Mutex::new(HashMap::new())),
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
