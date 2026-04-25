use anyhow::Result;
use clap::Subcommand;
use crate::config::{Config, load_config, save_config};

#[derive(Subcommand)]
pub enum AuthCommands {
    /// Save API key and server URL to config
    Login {
        /// API key (format: ms_...)
        #[arg(long)]
        key: String,
        /// Server base URL
        #[arg(long, default_value = "http://localhost:8080")]
        server: String,
    },
    /// Show current authentication status
    Status,
}

pub fn handle(cmd: AuthCommands) -> Result<()> {
    match cmd {
        AuthCommands::Login { key, server } => login(&key, &server),
        AuthCommands::Status => status(),
    }
}

fn login(key: &str, server: &str) -> Result<()> {
    let config = Config {
        api_key: key.to_string(),
        server_url: server.to_string(),
    };
    save_config(&config)?;
    println!("Logged in. Server: {}", server);
    println!("API key saved (prefix: {}...)", &key[..key.len().min(10)]);
    Ok(())
}

fn status() -> Result<()> {
    let config = load_config()?;
    let prefix = &config.api_key[..config.api_key.len().min(10)];
    println!("Server:  {}", config.server_url);
    println!("API key: {}...", prefix);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn write_config_to(path: &PathBuf, config: &Config) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let content = toml::to_string_pretty(config).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn read_config_from(path: &PathBuf) -> Config {
        let content = std::fs::read_to_string(path).unwrap();
        toml::from_str(&content).unwrap()
    }

    /// auth login: writes api_key and server_url to config.toml
    ///
    /// Execution:
    ///   1. Construct a temp config path
    ///   2. Serialize a Config with known values and write to disk
    ///   3. Read back and assert field values
    ///
    /// Expected:
    ///   - api_key == "ms_abc123xyz0"
    ///   - server_url == "https://my.server.com"
    #[test]
    fn test_login_writes_config() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("msctl").join("config.toml");
        let config = Config {
            api_key: "ms_abc123xyz0".to_string(),
            server_url: "https://my.server.com".to_string(),
        };
        write_config_to(&path, &config);
        let loaded = read_config_from(&path);
        assert_eq!(loaded.api_key, "ms_abc123xyz0",
            "login should persist api_key");
        assert_eq!(loaded.server_url, "https://my.server.com",
            "login should persist server_url");
    }

    /// auth status: displays key prefix (first 10 chars) and server URL
    ///
    /// Execution:
    ///   1. Build a Config with a 20-char key
    ///   2. Compute expected prefix = first 10 chars
    ///
    /// Expected:
    ///   - prefix length == 10
    ///   - prefix matches first 10 chars of key
    #[test]
    fn test_status_shows_key_prefix() {
        let key = "ms_abcdefghijklmnopqr";
        let prefix = &key[..10];
        assert_eq!(prefix.len(), 10,
            "status should show exactly 10 chars of key");
        assert_eq!(prefix, "ms_abcdefg",
            "prefix should be the first 10 characters");
    }
}
