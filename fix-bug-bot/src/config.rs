// fix-bug-bot/src/config.rs
use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
pub struct Config {
    pub feishu: FeishuConfig,
    pub gitlab: GitlabConfig,
    #[serde(default)]
    pub module_repo_map: HashMap<String, RepoEntry>,
}

#[derive(Debug, Deserialize)]
pub struct FeishuConfig {
    pub webhook_token: String,
    pub bot_app_id: String,
    pub bot_app_secret: String,
}

#[derive(Debug, Deserialize)]
pub struct GitlabConfig {
    pub base_url: String,
    pub access_token: String,
    #[serde(default = "default_blocked_label")]
    pub blocked_label: String,
}

fn default_blocked_label() -> String {
    "bot:blocked".to_string()
}

#[derive(Debug, Deserialize, Clone)]
pub struct RepoEntry {
    pub local_path: String,
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        Self::load_from(&path)
    }

    pub fn load_from(path: &Path) -> Result<Self> {
        let s = std::fs::read_to_string(path)
            .with_context(|| format!("Cannot read config: {}", path.display()))?;
        toml::from_str(&s).context("Invalid fix-bug-bot.toml")
    }
}

pub fn config_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config dir")?;
    Ok(base.join("msctl").join("fix-bug-bot.toml"))
}

pub fn db_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config dir")?;
    Ok(base.join("msctl").join("fix-bug-bot.db"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    /// Config::load_from 正确解析 TOML
    ///
    /// 数据构造：包含 feishu/gitlab/module_repo_map 的最小 TOML
    /// 预期：gitlab.base_url = "https://gl.example.com"
    #[test]
    fn test_config_load_from_toml() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, r#"
[feishu]
webhook_token = "tok"
bot_app_id = "app1"
bot_app_secret = "sec1"

[gitlab]
base_url = "https://gl.example.com"
access_token = "glpat-xxx"
blocked_label = "bot:blocked"

[module_repo_map]
"用户中心" = {{ local_path = "/tmp/user-service" }}
"#).unwrap();
        let cfg = Config::load_from(f.path()).unwrap();
        assert_eq!(cfg.gitlab.base_url, "https://gl.example.com");
        assert_eq!(cfg.feishu.bot_app_id, "app1");
        assert_eq!(cfg.module_repo_map.get("用户中心").unwrap().local_path, "/tmp/user-service");
    }

    /// 缺少 gitlab 段时返回 Err
    #[test]
    fn test_config_missing_gitlab_returns_err() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "[feishu]\nwebhook_token = \"\"\nbot_app_id = \"\"\nbot_app_secret = \"\"\n").unwrap();
        let result = Config::load_from(f.path());
        assert!(result.is_err(), "missing gitlab section must return Err");
    }
}
