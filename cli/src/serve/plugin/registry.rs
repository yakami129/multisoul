use anyhow::Result;
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct PluginConfig {
    pub id: String,
    pub name: String,
    pub version: String,
    pub executable: PathBuf,
    pub triggers: Vec<TriggerConfig>,
}

#[derive(Debug, Clone)]
pub struct TriggerConfig {
    pub event: String,
    pub filter: Option<String>,
}

#[derive(Deserialize)]
struct PluginToml {
    agent: PluginAgentSection,
    #[serde(default)]
    triggers: Vec<TriggerToml>,
}

#[derive(Deserialize)]
struct PluginAgentSection {
    executable: String,
}

#[derive(Deserialize)]
struct TriggerToml {
    event: String,
    filter: Option<String>,
}

/// DB から plugin_agents を読み込み、toml から triggers を補完して返す
pub fn load_plugins(db: &Arc<Mutex<Connection>>, agents_dir: &std::path::Path) -> Result<Vec<PluginConfig>> {
    let rows: Vec<(String, String, String, String)> = {
        let conn = db.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, version, executable FROM plugin_agents ORDER BY installed_at ASC",
        )?;
        let collected: Vec<_> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    let mut configs = Vec::new();
    for (id, name, version, executable) in rows {
        let toml_path = agents_dir.join(format!("{}.toml", name));
        let (resolved_exe, triggers) = if toml_path.exists() {
            let s = std::fs::read_to_string(&toml_path).unwrap_or_default();
            let cfg: PluginToml = toml::from_str(&s).unwrap_or(PluginToml {
                agent: PluginAgentSection { executable: executable.clone() },
                triggers: vec![],
            });
            // toml の executable が DB と異なる場合は toml を優先
            let exe = cfg.agent.executable;
            let trigs = cfg.triggers
                .into_iter()
                .map(|t| TriggerConfig { event: t.event, filter: t.filter })
                .collect();
            (exe, trigs)
        } else {
            (executable, vec![])
        };
        configs.push(PluginConfig {
            id,
            name,
            version,
            executable: agents_dir.join(&resolved_exe),
            triggers,
        });
    }
    Ok(configs)
}

/// event_type → plugin names のルーティングテーブルを構築
pub fn build_routes(configs: &[PluginConfig]) -> HashMap<String, Vec<String>> {
    let mut routes: HashMap<String, Vec<String>> = HashMap::new();
    for cfg in configs {
        tracing::debug!(id = %cfg.id, name = %cfg.name, version = %cfg.version, "loading plugin routes");
        for trigger in &cfg.triggers {
            if let Some(filter) = &trigger.filter {
                tracing::debug!(event = %trigger.event, filter = %filter, "trigger with filter");
            }
            routes.entry(trigger.event.clone()).or_default().push(cfg.name.clone());
        }
    }
    routes
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build_routes が event_type → agent names を正しくマッピングする
    ///
    /// 预期：feishu.issue.updated → ["fix-bug-bot"]
    #[test]
    fn test_build_routes_maps_event_to_agents() {
        let configs = vec![PluginConfig {
            id: "id1".to_string(),
            name: "fix-bug-bot".to_string(),
            version: "0.1.0".to_string(),
            executable: PathBuf::from("fix-bug-bot"),
            triggers: vec![TriggerConfig {
                event: "feishu.issue.updated".to_string(),
                filter: None,
            }],
        }];
        let routes = build_routes(&configs);
        assert!(routes.contains_key("feishu.issue.updated"), "route must exist");
        assert_eq!(routes["feishu.issue.updated"], vec!["fix-bug-bot"]);
    }
}
