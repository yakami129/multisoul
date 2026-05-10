use crate::db::now_ms;
use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::Deserialize;
use uuid::Uuid;

/// Minimal manifest parsed from <name>.toml in the agents directory.
#[derive(Deserialize)]
struct PluginManifest {
    agent: PluginAgentSection,
}

#[derive(Deserialize)]
struct PluginAgentSection {
    version: String,
    executable: String,
}

pub fn plugin_agents_dir() -> Result<std::path::PathBuf> {
    let base = dirs::config_dir().context("Cannot determine config directory")?;
    let dir = base.join("msctl").join("agents");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn register_plugin(conn: &Connection, name: &str, agents_dir: &std::path::Path) -> Result<()> {
    let toml_path = agents_dir.join(format!("{}.toml", name));
    let toml_str = std::fs::read_to_string(&toml_path)
        .with_context(|| format!("Cannot read {}", toml_path.display()))?;
    let cfg: PluginManifest = toml::from_str(&toml_str)
        .with_context(|| format!("Invalid toml: {}", toml_path.display()))?;

    let exe_path = agents_dir.join(&cfg.agent.executable);
    anyhow::ensure!(exe_path.exists(), "Executable not found: {}", exe_path.display());

    let now = now_ms();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO plugin_agents (id, name, version, executable, status, restart_count, installed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'stopped', 0, ?5, ?5)
         ON CONFLICT(name) DO UPDATE SET version=excluded.version, executable=excluded.executable, updated_at=excluded.updated_at",
        rusqlite::params![id, name, cfg.agent.version, cfg.agent.executable, now],
    )?;
    println!("Plugin agent '{}' v{} registered.", name, cfg.agent.version);
    Ok(())
}

pub fn install_plugin(source: &str) -> Result<()> {
    let agents_dir = plugin_agents_dir()?;
    if source.starts_with("http://") || source.starts_with("https://") {
        println!("Downloading {}...", source);
        let bytes = reqwest::blocking::get(source)?.bytes()?;
        let decoder = flate2::read::GzDecoder::new(std::io::Cursor::new(bytes));
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(&agents_dir)?;
    } else {
        let src = std::path::Path::new(source);
        anyhow::ensure!(src.exists(), "Source not found: {}", src.display());
        let name = src.file_name().context("Invalid source path")?;
        std::fs::copy(src, agents_dir.join(name))?;
        let toml_src = src.with_extension("toml");
        if toml_src.exists() {
            std::fs::copy(&toml_src, agents_dir.join(name).with_extension("toml"))?;
        }
    }
    println!("Installed. Run: msctl agent register --type plugin --name <name>");
    Ok(())
}

pub fn uninstall_plugin(name: &str) -> Result<()> {
    let agents_dir = plugin_agents_dir()?;
    let exe = agents_dir.join(name);
    let toml = agents_dir.join(format!("{}.toml", name));
    if exe.exists() {
        std::fs::remove_file(&exe)?;
    }
    if toml.exists() {
        std::fs::remove_file(&toml)?;
    }
    println!("Uninstalled '{}'. Run: msctl agent delete <id> to remove DB record.", name);
    Ok(())
}

pub fn restart_plugin(conn: &Connection, id: &str) -> Result<()> {
    let n = conn.execute(
        "UPDATE plugin_agents SET status='stopped', restart_count=0 WHERE id=?1 AND status='failed'",
        [id],
    )?;
    if n == 0 {
        println!("No failed plugin agent found with id {}.", id);
    } else {
        println!("Plugin agent {} reset to stopped. Restart msctl serve to reload.", id);
    }
    Ok(())
}
