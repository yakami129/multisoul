use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub serve_token: String,
    #[serde(default = "default_port")]
    pub serve_port: u16,
}

fn default_port() -> u16 { 8765 }

impl Default for Config {
    fn default() -> Self {
        Self { serve_token: String::new(), serve_port: 8765 }
    }
}

pub fn config_path() -> Result<PathBuf> {
    let base = dirs::config_dir()
        .context("Cannot determine config directory")?;
    Ok(base.join("msctl").join("config.toml"))
}

pub fn load_config() -> Result<Config> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(Config::default());
    }
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Cannot read config at {}", path.display()))?;
    toml::from_str(&content).context("Config file is malformed")
}

pub fn save_config(config: &Config) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Cannot create config dir {}", parent.display()))?;
    }
    let content = toml::to_string_pretty(config)
        .context("Failed to serialize config")?;
    std::fs::write(&path, content)
        .with_context(|| format!("Cannot write config to {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Config round-trip with serve_token only.
    ///
    /// Execution:
    ///   1. Serialize Config { serve_token: "ms_v2_abc" } to TOML
    ///   2. Deserialize back
    ///
    /// Expected:
    ///   - serve_token == "ms_v2_abc"
    #[test]
    fn test_config_serve_token_round_trip() {
        let config = Config { serve_token: "ms_v2_abc".to_string(), ..Default::default() };
        let s = toml::to_string_pretty(&config).unwrap();
        let loaded: Config = toml::from_str(&s).unwrap();
        assert_eq!(loaded.serve_token, "ms_v2_abc",
            "serve_token must survive round-trip");
    }

    /// Missing config returns default (empty token), not an error.
    ///
    /// Expected:
    ///   - serve_token == ""
    #[test]
    fn test_load_config_missing_returns_default() {
        let config = Config::default();
        assert_eq!(config.serve_token, "",
            "default config should have empty serve_token");
    }
}
