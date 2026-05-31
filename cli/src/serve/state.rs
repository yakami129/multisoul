use crate::serve::interactive::AnswerPayload;
use crate::serve::plugin::PluginManager;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tokio::sync::broadcast;
use tracing::{info, warn};

/// Message sent from HTTP handler to session worker via channel.
#[derive(Debug)]
pub struct SessionMessage {
    pub user_text: String,
    pub file_id: Option<String>,
    pub model_id: Option<String>,
    pub seq: i64,
}

#[derive(Clone)]
pub struct SessionHandle {
    pub tx: std::sync::mpsc::Sender<SessionMessage>,
    pub current_pid: Arc<Mutex<Option<u32>>>,
    aborted: Arc<AtomicBool>,
    kill_process: Arc<dyn Fn(u32) -> bool + Send + Sync>,
}

impl SessionHandle {
    pub fn new(tx: std::sync::mpsc::Sender<SessionMessage>) -> Self {
        Self {
            tx,
            current_pid: Arc::new(Mutex::new(None)),
            aborted: Arc::new(AtomicBool::new(false)),
            kill_process: Arc::new(kill_pid),
        }
    }

    #[cfg(test)]
    pub fn new_with_killer(
        tx: std::sync::mpsc::Sender<SessionMessage>,
        kill_process: Arc<dyn Fn(u32) -> bool + Send + Sync>,
    ) -> Self {
        Self {
            tx,
            current_pid: Arc::new(Mutex::new(None)),
            aborted: Arc::new(AtomicBool::new(false)),
            kill_process,
        }
    }

    pub fn set_current_pid(&self, pid: u32) {
        *self.current_pid.lock().unwrap() = Some(pid);
    }

    pub fn clear_current_pid(&self, pid: u32) {
        let mut current = self.current_pid.lock().unwrap();
        if *current == Some(pid) {
            *current = None;
        }
    }

    pub fn abort_current_process(&self) -> bool {
        self.aborted.store(true, Ordering::SeqCst);
        let registered_pid = *self.current_pid.lock().unwrap();
        let Some(pid) = registered_pid else {
            warn!(
                target: "multisoul::abort",
                phase = "handle",
                outcome = "no_registered_pid",
                "abort skips SIGKILL — set Cooperative `aborted` flag only",
            );
            return false;
        };
        info!(
            target: "multisoul::abort",
            phase = "handle",
            outcome = "kill_attempt",
            pid,
            "abort sending SIGKILL to registered child / process-group",
        );
        let killed = (self.kill_process)(pid);
        if killed {
            self.clear_current_pid(pid);
            info!(
                target: "multisoul::abort",
                phase = "handle",
                outcome = "kill_ok_pid_cleared",
                pid,
                "abort kill returned success",
            );
        } else {
            warn!(
                target: "multisoul::abort",
                phase = "handle",
                outcome = "kill_failed",
                pid,
                "abort kill syscall returned failure (child may still run)",
            );
        }
        killed
    }

    pub fn is_aborted(&self) -> bool {
        self.aborted.load(Ordering::SeqCst)
    }
}

fn kill_pid(pid: u32) -> bool {
    kill_process_group(pid) || kill_single_process(pid)
}

#[cfg(unix)]
pub fn start_new_process_group(command: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;

    // SAFETY: pre_exec runs in the child after fork and before exec. setpgid is async-signal-safe
    // and makes the runtime process a process-group leader so abort can kill descendants too.
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}

#[cfg(not(unix))]
pub fn start_new_process_group(_command: &mut std::process::Command) {}

fn kill_process_group(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: negative pid targets the process group whose id equals the child pid.
        unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn kill_single_process(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: kill is called with a concrete child pid captured from std::process::Child.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) == 0 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };

        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if h.is_null() {
                return false;
            }
            let ok = TerminateProcess(h, 1) != 0;
            CloseHandle(h);
            ok
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
}

pub type ConvBus = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, SessionHandle>>>;

pub struct AnswerChannel {
    pub tx: std::sync::mpsc::SyncSender<AnswerPayload>,
    pub pending_ask_id: Option<String>,
}

pub type AnswerMap = Arc<Mutex<HashMap<String, AnswerChannel>>>;
pub type StoredAnswerSenderMap =
    Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<AnswerPayload>>>>;
pub type StoredAnswerReceiverMap =
    Arc<Mutex<HashMap<String, std::sync::mpsc::Receiver<AnswerPayload>>>>;

#[derive(Debug, PartialEq, Eq)]
pub enum AnswerSendResult {
    Accepted,
    NoSession,
    NoPendingAsk,
    AskMismatch { expected: String, actual: String },
    ChannelUnavailable,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StoredAnswerCreateResult {
    Created,
    AlreadyPendingHttp,
    OwnedByRuntime,
}

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub token: String,
    pub uploads_dir: PathBuf,
    pub bus: ConvBus,
    pub sessions: SessionMap,
    pub answer_txs: AnswerMap,
    pub stored_answer_txs: StoredAnswerSenderMap,
    pub stored_answer_rxs: StoredAnswerReceiverMap,
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
            stored_answer_txs: Arc::new(Mutex::new(HashMap::new())),
            stored_answer_rxs: Arc::new(Mutex::new(HashMap::new())),
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
        self.answer_txs.lock().unwrap().insert(
            conv_id.to_string(),
            AnswerChannel {
                tx,
                pending_ask_id: None,
            },
        );
        rx
    }

    /// Create an answer channel whose receiver can be claimed later by HTTP GET /answer.
    pub fn create_stored_answer_channel(
        &self,
        conv_id: &str,
        ask_id: &str,
    ) -> StoredAnswerCreateResult {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let key = answer_receiver_key(conv_id, ask_id);
        let answer_txs = self.answer_txs.lock().unwrap();
        if answer_txs
            .get(conv_id)
            .and_then(|channel| channel.pending_ask_id.as_deref())
            == Some(ask_id)
        {
            return StoredAnswerCreateResult::OwnedByRuntime;
        }
        let mut txs = self.stored_answer_txs.lock().unwrap();
        let mut rxs = self.stored_answer_rxs.lock().unwrap();
        if txs.contains_key(&key) || rxs.contains_key(&key) {
            return StoredAnswerCreateResult::AlreadyPendingHttp;
        }
        txs.insert(key.clone(), tx);
        rxs.insert(key, rx);
        StoredAnswerCreateResult::Created
    }

    pub fn take_stored_answer_receiver(
        &self,
        conv_id: &str,
        ask_id: &str,
    ) -> Option<std::sync::mpsc::Receiver<AnswerPayload>> {
        self.stored_answer_rxs
            .lock()
            .unwrap()
            .remove(&answer_receiver_key(conv_id, ask_id))
    }

    pub fn remove_stored_answer_channel(&self, conv_id: &str, ask_id: &str) {
        self.stored_answer_txs
            .lock()
            .unwrap()
            .remove(&answer_receiver_key(conv_id, ask_id));
        self.stored_answer_rxs
            .lock()
            .unwrap()
            .remove(&answer_receiver_key(conv_id, ask_id));
    }

    pub fn begin_waiting_answer(&self, conv_id: &str, ask_id: &str) {
        let mut txs = self.answer_txs.lock().unwrap();
        if let Some(channel) = txs.get_mut(conv_id) {
            let key = answer_receiver_key(conv_id, ask_id);
            self.stored_answer_txs.lock().unwrap().remove(&key);
            self.stored_answer_rxs.lock().unwrap().remove(&key);
            channel.pending_ask_id = Some(ask_id.to_string());
        }
    }

    pub fn clear_waiting_answer(&self, conv_id: &str, ask_id: &str) {
        let mut txs = self.answer_txs.lock().unwrap();
        if let Some(channel) = txs.get_mut(conv_id) {
            if channel.pending_ask_id.as_deref() == Some(ask_id) {
                channel.pending_ask_id = None;
            }
        }
    }

    /// Send a user answer to the session waiting for it.
    /// Returns a structured status so callers can avoid marking stale answers as delivered.
    pub fn send_answer(&self, conv_id: &str, answer: AnswerPayload) -> AnswerSendResult {
        let txs = self.answer_txs.lock().unwrap();
        if let Some(channel) = txs.get(conv_id) {
            if channel.pending_ask_id.as_deref() == Some(answer._ask_id.as_str()) {
                return match channel.tx.try_send(answer) {
                    Ok(()) => AnswerSendResult::Accepted,
                    Err(e) => {
                        warn!(
                            conv_id = %conv_id,
                            reason = ?e,
                            "answer_send_failed"
                        );
                        AnswerSendResult::ChannelUnavailable
                    }
                };
            }
        }

        let ask_id = answer._ask_id.clone();
        let stored_txs = self.stored_answer_txs.lock().unwrap();
        let key = answer_receiver_key(conv_id, &ask_id);
        if let Some(tx) = stored_txs.get(&key) {
            return match tx.try_send(answer) {
                Ok(()) => AnswerSendResult::Accepted,
                Err(e) => {
                    warn!(
                        conv_id = %conv_id,
                        reason = ?e,
                        "stored_answer_send_failed"
                    );
                    AnswerSendResult::ChannelUnavailable
                }
            };
        }

        match txs.get(conv_id) {
            None => {
                let registered: Vec<String> = txs.keys().cloned().collect();
                warn!(
                    conv_id = %conv_id,
                    registered = ?registered,
                    "answer_no_channel"
                );
                AnswerSendResult::NoSession
            }
            Some(channel) => {
                let Some(expected) = channel.pending_ask_id.as_deref() else {
                    warn!(conv_id = %conv_id, ask_id = %ask_id, "answer_no_pending_ask");
                    return AnswerSendResult::NoPendingAsk;
                };
                warn!(
                    conv_id = %conv_id,
                    expected = %expected,
                    actual = %ask_id,
                    "answer_ask_mismatch"
                );
                AnswerSendResult::AskMismatch {
                    expected: expected.to_string(),
                    actual: ask_id,
                }
            }
        }
    }
}

fn answer_receiver_key(conv_id: &str, ask_id: &str) -> String {
    format!("{conv_id}\n{ask_id}")
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
                db::open_at(&dir.path().join("pm.db")).unwrap(),
            ))),
        );
        assert_eq!(
            state.uploads_dir, uploads_dir,
            "uploads_dir should be stored in AppState"
        );
    }

    /// SessionMessage carries user_text, file_id, model_id, and seq.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   user_text = "hello"（用户输入）
    ///   file_id   = Some("abc.jpg")（上传图片 id）
    ///   model_id  = Some("claude-sonnet-4-6")（conversation 级模型选择）
    ///   seq       = 1（用户消息入库后的消息序号）
    ///
    /// 执行过程：
    ///   1. 构造带图片和模型的 SessionMessage
    ///   2. 构造纯文本 Default 模型的 SessionMessage
    ///
    /// 预期结果：
    ///   - user_text/file_id/model_id/seq 都能正确读取
    ///   - text_only.model_id 为 None，说明 Default 不会被编码成字符串
    ///
    #[test]
    fn test_session_message_fields() {
        let msg = SessionMessage {
            user_text: "hello".to_string(),
            file_id: Some("abc.jpg".to_string()),
            model_id: Some("claude-sonnet-4-6".to_string()),
            seq: 1,
        };
        assert_eq!(msg.user_text, "hello", "user_text should match");
        assert_eq!(
            msg.file_id.as_deref(),
            Some("abc.jpg"),
            "file_id should match"
        );
        assert_eq!(
            msg.model_id.as_deref(),
            Some("claude-sonnet-4-6"),
            "model_id should match the selected runtime model"
        );

        let text_only = SessionMessage {
            user_text: "text only".to_string(),
            file_id: None,
            model_id: None,
            seq: 2,
        };
        assert!(
            text_only.file_id.is_none(),
            "file_id should be None for text-only"
        );
        assert!(
            text_only.model_id.is_none(),
            "model_id should be None for Default model selection"
        );
        assert_eq!(
            text_only.seq, 2,
            "seq should carry the user_text message seq"
        );
    }
}
