pub mod process;
pub mod protocol;
pub mod registry;

use crate::serve::plugin::process::{AgentProcess, AgentStatus};
use crate::serve::plugin::protocol::TaskMessage;
use crate::serve::plugin::registry::{build_routes, load_plugins};
use anyhow::Result;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

pub struct PluginManager {
    agents: Mutex<HashMap<String, AgentProcess>>,
    routes: HashMap<String, Vec<String>>,
    db: Arc<Mutex<Connection>>,
}

impl PluginManager {
    /// 空の PluginManager（plugin_agents が 0 件 or 起動失敗時のフォールバック）
    pub fn empty(db: Arc<Mutex<Connection>>) -> Arc<Self> {
        Arc::new(Self {
            agents: Mutex::new(HashMap::new()),
            routes: HashMap::new(),
            db,
        })
    }

    /// DB から plugin_agents を読み込み、全プロセスを起動する
    pub fn start(db: Arc<Mutex<Connection>>, agents_dir: PathBuf) -> Result<Arc<Self>> {
        let configs = load_plugins(&db, &agents_dir)?;
        let routes = build_routes(&configs);
        let mut agents = HashMap::new();

        for cfg in configs {
            let mut proc = AgentProcess::new(&cfg.name, cfg.executable.clone());
            match proc.start() {
                Ok(_) => {
                    tracing::info!(name = %cfg.name, "plugin_agent_started");
                    let _ = db.lock().unwrap().execute(
                        "UPDATE plugin_agents SET status='running', restart_count=0 WHERE name=?1",
                        [&cfg.name],
                    );
                }
                Err(e) => {
                    tracing::error!(name = %cfg.name, err = %e, "plugin_agent_start_failed");
                }
            }
            agents.insert(cfg.name.clone(), proc);
        }

        let manager = Arc::new(Self {
            agents: Mutex::new(agents),
            routes,
            db: Arc::clone(&db),
        });

        // 崩溃监控 task（每 2 秒检查一次）
        let manager_weak = Arc::downgrade(&manager);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                let Some(mgr) = manager_weak.upgrade() else {
                    break;
                };
                mgr.check_and_restart_crashed();
            }
        });

        Ok(manager)
    }

    /// 崩溃检测 + 指数退避重启（上限 5 次）
    fn check_and_restart_crashed(&self) {
        let mut agents = self.agents.lock().unwrap();
        for (name, proc) in agents.iter_mut() {
            if proc.status == AgentStatus::Running && !proc.is_alive() {
                proc.restart_count += 1;
                tracing::warn!(name = %name, count = proc.restart_count, "plugin_agent_crashed");

                if proc.restart_count > 5 {
                    proc.status = AgentStatus::Failed;
                    let _ = self.db.lock().unwrap().execute(
                        "UPDATE plugin_agents SET status='failed', restart_count=?1 WHERE name=?2",
                        rusqlite::params![proc.restart_count, name],
                    );
                    tracing::error!(name = %name, "plugin_agent_failed_max_retries");
                } else {
                    proc.status = AgentStatus::Restarting;
                    let _ = self.db.lock().unwrap().execute(
                        "UPDATE plugin_agents SET status='restarting', restart_count=?1 WHERE name=?2",
                        rusqlite::params![proc.restart_count, name],
                    );
                    if proc.start().is_ok() {
                        let _ = self.db.lock().unwrap().execute(
                            "UPDATE plugin_agents SET status='running' WHERE name=?1",
                            [name.as_str()],
                        );
                    }
                }
            }
        }
    }

    /// イベントを対応する agent に dispatch する
    pub fn dispatch(&self, event_type: &str, conversation_id: &str, payload: serde_json::Value) {
        let agent_names = match self.routes.get(event_type) {
            Some(names) => names.clone(),
            None => return,
        };
        let task_id = Uuid::new_v4().to_string();
        let msg = TaskMessage::new(&task_id, conversation_id, event_type, payload);
        let mut agents = self.agents.lock().unwrap();
        for name in &agent_names {
            if let Some(proc) = agents.get_mut(name) {
                if let Err(e) = proc.send_task(&msg) {
                    tracing::error!(agent = %name, err = %e, "dispatch_failed");
                }
            }
        }
    }

    /// serve 終了時に全 plugin_agents の status を stopped に更新
    pub fn shutdown(&self) {
        let _ = self
            .db
            .lock()
            .unwrap()
            .execute_batch("UPDATE plugin_agents SET status='stopped'");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    fn make_db() -> Arc<Mutex<Connection>> {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        Arc::new(Mutex::new(conn))
    }

    /// PluginManager::empty() は panic せず dispatch も安全
    ///
    /// 预期：dispatch を呼んでも panic しない（plugin_agents が 0 件）
    #[test]
    fn test_empty_manager_dispatch_is_safe() {
        let db = make_db();
        let manager = PluginManager::empty(db);
        // panic しないことを確認
        manager.dispatch("feishu.issue.updated", "conv-1", serde_json::json!({}));
    }

    /// PluginManager::start は plugin_agents が 0 件でも成功する
    ///
    /// 预期：Ok(Arc<PluginManager>) が返る
    #[tokio::test]
    async fn test_start_with_no_plugins_succeeds() {
        let db = make_db();
        let dir = tempdir().unwrap();
        let result = PluginManager::start(Arc::clone(&db), dir.path().to_path_buf());
        assert!(
            result.is_ok(),
            "start should succeed with empty plugin_agents"
        );
    }
}
