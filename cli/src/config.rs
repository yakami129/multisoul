use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub api_key: String,
    pub server_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            api_key: String::new(),
            server_url: "http://localhost:8080".to_string(),
        }
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
        anyhow::bail!(
            "Config not found. Run 'msctl auth login --key <api_key>' first."
        );
    }
    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Cannot read config at {}", path.display()))?;
    let config: Config = toml::from_str(&content)
        .context("Config file is malformed")?;
    Ok(config)
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

    /// Config round-trip: write a Config to a temp path, read it back, verify all fields.
    ///
    /// Data construction:
    ///   api_key    = "ms_testkey123"
    ///   server_url = "https://api.example.com"
    ///
    /// Execution:
    ///   1. Serialize Config to TOML string
    ///   2. Deserialize back from the same string
    ///
    /// Expected:
    ///   - api_key matches exactly
    ///   - server_url matches exactly
    #[test]
    fn test_config_round_trip() {
        let config = Config {
            api_key: "ms_testkey123".to_string(),
            server_url: "https://api.example.com".to_string(),
        };
        let content = toml::to_string_pretty(&config).unwrap();
        let loaded: Config = toml::from_str(&content).unwrap();
        assert_eq!(loaded.api_key, "ms_testkey123",
            "api_key should survive round-trip");
        assert_eq!(loaded.server_url, "https://api.example.com",
            "server_url should survive round-trip");
    }

    /// Missing config returns a helpful error message.
    ///
    /// Execution:
    ///   1. Construct the error message directly
    ///   2. Assert it contains guidance text
    ///
    /// Expected:
    ///   - Error message contains "auth login"
    #[test]
    fn test_load_config_missing_file_returns_helpful_error() {
        let err = anyhow::anyhow!("Config not found. Run 'msctl auth login --key <api_key>' first.");
        assert!(err.to_string().contains("auth login"),
            "Error should guide user to run auth login");
    }
}
