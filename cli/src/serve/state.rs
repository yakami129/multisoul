use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use tokio::sync::broadcast;
use std::collections::HashMap;

pub type ConvBus    = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<String>>>>;

#[derive(Clone)]
pub struct AppState {
    pub db:       Arc<Mutex<Connection>>,
    pub token:    String,
    pub bus:      ConvBus,
    pub sessions: SessionMap,
}

impl AppState {
    pub fn new(conn: Connection, token: String) -> Self {
        AppState {
            db:       Arc::new(Mutex::new(conn)),
            token,
            bus:      Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_or_create_sender(&self, conv_id: &str) -> broadcast::Sender<String> {
        let mut bus = self.bus.lock().unwrap();
        bus.entry(conv_id.to_string())
            .or_insert_with(|| broadcast::channel(64).0)
            .clone()
    }
}
