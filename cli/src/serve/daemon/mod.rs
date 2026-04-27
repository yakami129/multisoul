use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const SERVICE_LABEL: &str = "com.multisoul.msctl";

pub struct Config {
    pub binary_path: String,
    pub token: String,
    pub port: u16,
    pub log_file: String,
    pub env_path: String,
}

pub struct Status {
    pub installed: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub platform: &'static str,
}

pub trait Manager {
    fn install(&self, cfg: &Config) -> Result<()>;
    fn uninstall(&self) -> Result<()>;
    fn start(&self) -> Result<()>;
    fn stop(&self) -> Result<()>;
    fn restart(&self) -> Result<()>;
    fn status(&self) -> Result<Status>;
    fn platform(&self) -> &'static str;
}

#[derive(Serialize, Deserialize)]
pub struct Meta {
    pub log_file: String,
    pub binary_path: String,
    pub port: u16,
    pub installed_at: String,
}

pub fn meta_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("msctl")
        .join("daemon.json")
}

pub fn default_log_file() -> String {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("msctl")
        .join("msctl.log")
        .to_string_lossy()
        .into_owned()
}

pub fn save_meta(m: &Meta) -> Result<()> {
    let path = meta_path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    let data = serde_json::to_string_pretty(m)?;
    std::fs::write(&path, data)?;
    Ok(())
}

pub fn load_meta() -> Result<Meta> {
    let data = std::fs::read_to_string(meta_path())?;
    Ok(serde_json::from_str(&data)?)
}

pub fn remove_meta() {
    let _ = std::fs::remove_file(meta_path());
}

pub fn resolve_binary() -> Result<String> {
    let exe = std::env::current_exe()?;
    let real = std::fs::canonicalize(&exe).unwrap_or(exe);
    Ok(real.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
mod launchd;
#[cfg(target_os = "macos")]
pub use launchd::new_manager;

#[cfg(not(target_os = "macos"))]
pub fn new_manager() -> Result<Box<dyn Manager>> {
    anyhow::bail!("daemon management is only supported on macOS")
}
