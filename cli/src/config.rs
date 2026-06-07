use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ServeMode {
    #[default]
    Relay,
    Tailnet,
    Funnel,
}

impl ServeMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ServeMode::Relay => "relay",
            ServeMode::Tailnet => "tailnet",
            ServeMode::Funnel => "funnel",
        }
    }
}

impl std::fmt::Display for ServeMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub serve_token: String,
    #[serde(default = "default_port")]
    pub serve_port: u16,
    #[serde(default)]
    pub serve_mode: ServeMode,
    #[serde(default = "default_relay_url")]
    pub relay_url: String,
}

fn default_port() -> u16 {
    8765
}

pub fn default_relay_url() -> String {
    "https://multisoul-tunnel.berrymeryl6.workers.dev".into()
}

impl Default for Config {
    fn default() -> Self {
        Self {
            serve_token: String::new(),
            serve_port: 8765,
            serve_mode: ServeMode::Relay,
            relay_url: default_relay_url(),
        }
    }
}

pub fn config_path() -> Result<PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config directory")?;
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
    let content = toml::to_string_pretty(config).context("Failed to serialize config")?;
    std::fs::write(&path, content)
        .with_context(|| format!("Cannot write config to {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_serve_token_round_trip() {
        let config = Config {
            serve_token: "ms_v2_abc".to_string(),
            ..Default::default()
        };
        let s = toml::to_string_pretty(&config).unwrap();
        let loaded: Config = toml::from_str(&s).unwrap();
        assert_eq!(
            loaded.serve_token, "ms_v2_abc",
            "serve_token must survive round-trip"
        );
    }

    #[test]
    fn test_load_config_missing_returns_default() {
        let config = Config::default();
        assert_eq!(
            config.serve_token, "",
            "default config should have empty serve_token"
        );
        assert_eq!(config.serve_mode, ServeMode::Relay);
        assert_eq!(config.relay_url, default_relay_url());
        assert_eq!(config.serve_port, 8765);
    }

    #[test]
    fn test_minimal_toml_deserializes_defaults() {
        let loaded: Config = toml::from_str("serve_token = \"tok\"\n").unwrap();
        assert_eq!(loaded.serve_token, "tok");
        assert_eq!(loaded.serve_port, 8765);
        assert_eq!(loaded.serve_mode, ServeMode::Relay);
        assert_eq!(loaded.relay_url, default_relay_url());
    }

    #[test]
    fn test_serve_mode_round_trip_all_variants() {
        for mode in [ServeMode::Relay, ServeMode::Tailnet, ServeMode::Funnel] {
            let config = Config {
                serve_mode: mode,
                relay_url: "https://custom.example.dev".into(),
                ..Default::default()
            };
            let s = toml::to_string_pretty(&config).unwrap();
            let loaded: Config = toml::from_str(&s).unwrap();
            assert_eq!(loaded.serve_mode, mode);
            assert_eq!(loaded.relay_url, "https://custom.example.dev");
        }
    }
}
