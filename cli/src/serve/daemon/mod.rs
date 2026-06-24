use crate::config::ServeMode;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[cfg(target_os = "macos")]
pub const SERVICE_LABEL: &str = "com.multisoul.msctl";

#[cfg(target_os = "macos")]
pub struct Config {
    pub binary_path: String,
    pub token: String,
    pub port: u16,
    pub serve_mode: ServeMode,
    pub relay_url: String,
    pub log_file: String,
    pub env_path: String,
    pub proxy_env: Vec<(String, String)>,
}

/// Proxy variables checked by Rust's http client crates and most CLIs.
#[cfg(target_os = "macos")]
const PROXY_ENV_VARS: [&str; 8] = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
];

/// launchd does not inherit the installing shell's environment, so proxy
/// variables must be captured here and baked into the service's plist.
#[cfg(target_os = "macos")]
pub fn capture_proxy_env() -> Vec<(String, String)> {
    PROXY_ENV_VARS
        .iter()
        .filter_map(|name| {
            std::env::var(name)
                .ok()
                .map(|value| (name.to_string(), value))
        })
        .collect()
}

pub struct Status {
    pub installed: bool,
    pub running: bool,
    pub pid: Option<u32>,
    pub platform: &'static str,
}

pub trait Manager {
    #[cfg(target_os = "macos")]
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
    #[serde(default)]
    pub serve_mode: ServeMode,
    #[serde(default = "crate::config::default_relay_url")]
    pub relay_url: String,
    /// Legacy field from installs before serve_mode existed.
    #[serde(default)]
    pub tailnet: bool,
    pub installed_at: String,
}

/// Whether daemon.json predates the `serve_mode` field.
pub fn meta_json_has_serve_mode(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.as_object().map(|o| o.contains_key("serve_mode")))
        .unwrap_or(false)
}

pub fn load_meta_with_legacy() -> Result<(Meta, bool)> {
    let path = meta_path();
    let data = std::fs::read_to_string(&path)?;
    let legacy = !meta_json_has_serve_mode(&data);
    Ok((serde_json::from_str(&data)?, legacy))
}

pub fn resolve_serve_mode(meta: &Meta, meta_legacy: bool) -> ServeMode {
    if meta_legacy {
        if meta.tailnet {
            ServeMode::Tailnet
        } else {
            ServeMode::Relay
        }
    } else {
        meta.serve_mode
    }
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

/// Paths under IDE sandboxes or OS temp dirs must not be baked into launchd.
pub fn is_unstable_binary_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized.contains("cursor-sandbox-cache")
        || normalized.contains("/T/cargo-target/")
        || normalized.contains("/tmp/")
        || normalized.contains("/var/folders/") && normalized.contains("/T/")
}

fn is_usable_binary(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
}

fn path_from_which(name: &str) -> Option<String> {
    use std::process::Command;
    let out = Command::new("which").arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    let p = PathBuf::from(&path);
    if is_usable_binary(&p) && !is_unstable_binary_path(&path) {
        Some(path)
    } else {
        None
    }
}

fn stable_binary_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        paths.push(home.join(".cargo/bin/msctl"));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin/msctl"));
    paths.push(PathBuf::from("/usr/local/bin/msctl"));
    paths
}

fn find_stable_binary_candidate() -> Option<String> {
    if let Ok(meta) = load_meta() {
        let path = PathBuf::from(&meta.binary_path);
        if is_usable_binary(&path) && !is_unstable_binary_path(&meta.binary_path) {
            return Some(meta.binary_path);
        }
    }
    if let Some(path) = path_from_which("msctl") {
        return Some(path);
    }
    for path in stable_binary_candidates() {
        if is_usable_binary(&path) {
            let s = path.to_string_lossy().into_owned();
            if !is_unstable_binary_path(&s) {
                return Some(s);
            }
        }
    }
    None
}

/// Pick a binary path safe to persist in launchd.
pub fn select_daemon_binary(current: &Path) -> Result<String> {
    select_daemon_binary_with_stable(current, find_stable_binary_candidate())
}

fn select_daemon_binary_with_stable(
    current: &Path,
    stable_candidate: Option<String>,
) -> Result<String> {
    let resolved = std::fs::canonicalize(current).unwrap_or_else(|_| current.to_path_buf());
    let current_str = resolved.to_string_lossy().into_owned();

    if is_usable_binary(&resolved) && !is_unstable_binary_path(&current_str) {
        return Ok(current_str);
    }

    if let Some(stable) = stable_candidate {
        if is_unstable_binary_path(&current_str) {
            eprintln!(
                "[warn] Ignoring temporary binary at {current_str}; using stable install at {stable}"
            );
        }
        return Ok(stable);
    }

    if is_unstable_binary_path(&current_str) {
        anyhow::bail!(
            "Refusing to install daemon with temporary binary at {current_str}.\n\
             Install a stable msctl first (e.g. `cargo install --path .` or `npm i -g @yakami129/msctl`),\n\
             then run: msctl daemon install --force"
        );
    }

    anyhow::bail!(
        "msctl binary not found at {}. Build or install msctl before running daemon install.",
        resolved.display()
    )
}

pub fn resolve_binary() -> Result<String> {
    select_daemon_binary(&std::env::current_exe()?)
}

/// Block start/restart when the plist points at a missing binary.
#[cfg(target_os = "macos")]
pub fn require_installed_binary(path: &str) -> Result<()> {
    let p = Path::new(path);
    if is_usable_binary(p) {
        return Ok(());
    }
    anyhow::bail!(
        "Installed binary not found at {path}. Reinstall with: msctl daemon install --force"
    )
}

pub fn ensure_running(mgr: &dyn Manager) -> Result<()> {
    ensure_running_with(mgr, 20, Duration::from_millis(250))
}

pub(crate) fn ensure_running_with(
    mgr: &dyn Manager,
    attempts: u32,
    interval: Duration,
) -> Result<()> {
    for _ in 0..attempts {
        let st = mgr.status()?;
        if st.running {
            return Ok(());
        }
        std::thread::sleep(interval);
    }
    anyhow::bail!(
        "Service did not reach running state. Check `msctl daemon status` and `msctl logs --source service`."
    )
}

#[cfg(target_os = "macos")]
mod launchd;
#[cfg(target_os = "macos")]
pub use launchd::new_manager;

#[cfg(not(target_os = "macos"))]
pub fn new_manager() -> Result<Box<dyn Manager>> {
    anyhow::bail!("daemon management is only supported on macOS")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    struct MockManager {
        polls: AtomicU32,
        running_after: u32,
    }

    impl MockManager {
        fn running_after(polls: u32) -> Self {
            Self {
                polls: AtomicU32::new(0),
                running_after: polls,
            }
        }

        fn never_running() -> Self {
            Self::running_after(u32::MAX)
        }
    }

    impl Manager for MockManager {
        #[cfg(target_os = "macos")]
        fn install(&self, _cfg: &Config) -> Result<()> {
            Ok(())
        }

        fn uninstall(&self) -> Result<()> {
            Ok(())
        }

        fn start(&self) -> Result<()> {
            Ok(())
        }

        fn stop(&self) -> Result<()> {
            Ok(())
        }

        fn restart(&self) -> Result<()> {
            Ok(())
        }

        fn status(&self) -> Result<Status> {
            let n = self.polls.fetch_add(1, Ordering::SeqCst) + 1;
            let running = n > self.running_after;
            Ok(Status {
                installed: true,
                running,
                pid: if running { Some(4242) } else { None },
                platform: "mock",
            })
        }

        fn platform(&self) -> &'static str {
            "mock"
        }
    }

    #[test]
    fn unstable_paths_include_cursor_sandbox_and_macos_temp() {
        assert!(is_unstable_binary_path(
            "/private/var/folders/xx/T/cursor-sandbox-cache/abc/cargo-target/debug/msctl"
        ));
        assert!(is_unstable_binary_path("/tmp/msctl"));
        assert!(is_unstable_binary_path(
            "/var/folders/xx/yy/zz/T/cargo-target/debug/msctl"
        ));
    }

    #[test]
    fn stable_paths_are_not_marked_unstable() {
        assert!(!is_unstable_binary_path(
            "/Users/dev/project/cli/target/debug/msctl"
        ));
        assert!(!is_unstable_binary_path("/usr/local/bin/msctl"));
        assert!(!is_unstable_binary_path("/Users/dev/.cargo/bin/msctl"));
    }

    #[test]
    fn select_daemon_binary_rejects_ephemeral_current_without_fallback() {
        let err = select_daemon_binary_with_stable(
            Path::new(
                "/private/var/folders/xx/T/cursor-sandbox-cache/abc/cargo-target/debug/msctl",
            ),
            None,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("Refusing to install daemon"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn select_daemon_binary_uses_stable_fallback_for_ephemeral_current() {
        let selected = select_daemon_binary_with_stable(
            Path::new(
                "/private/var/folders/xx/T/cursor-sandbox-cache/abc/cargo-target/debug/msctl",
            ),
            Some("/usr/local/bin/msctl".into()),
        )
        .expect("select_daemon_binary_with_stable");
        assert_eq!(selected, "/usr/local/bin/msctl");
    }

    #[test]
    fn select_daemon_binary_prefers_stable_current() {
        let path = std::env::current_exe().expect("current_exe");
        if is_unstable_binary_path(&path.to_string_lossy()) {
            return;
        }
        let selected = select_daemon_binary(&path).expect("select_daemon_binary");
        assert!(!is_unstable_binary_path(&selected));
        assert!(Path::new(&selected).is_file());
    }

    #[test]
    fn select_daemon_binary_prefers_stable_current_over_fallback() {
        let path = std::env::current_exe().expect("current_exe");
        if is_unstable_binary_path(&path.to_string_lossy()) {
            return;
        }
        let selected = select_daemon_binary_with_stable(&path, Some("/usr/local/bin/msctl".into()))
            .expect("select_daemon_binary_with_stable");
        let expected = std::fs::canonicalize(&path)
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();
        assert_eq!(selected, expected);
    }

    #[test]
    fn select_daemon_binary_errors_when_current_missing_and_no_fallback() {
        let err = select_daemon_binary_with_stable(Path::new("/nonexistent/msctl-binary"), None)
            .unwrap_err();
        assert!(
            err.to_string().contains("msctl binary not found"),
            "unexpected error: {err}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn require_installed_binary_accepts_existing_file() {
        let path = std::env::current_exe().expect("current_exe");
        require_installed_binary(&path.to_string_lossy()).expect("require_installed_binary");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn require_installed_binary_rejects_missing_file() {
        let err = require_installed_binary("/nonexistent/msctl-binary").unwrap_err();
        assert!(
            err.to_string().contains("Installed binary not found"),
            "unexpected error: {err}"
        );
        assert!(
            err.to_string().contains("daemon install --force"),
            "unexpected error: {err}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn require_installed_binary_rejects_empty_file() {
        let dir = std::env::temp_dir().join(format!("msctl-empty-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let file = dir.join("empty-msctl");
        std::fs::write(&file, []).expect("write empty file");
        let err = require_installed_binary(&file.to_string_lossy()).unwrap_err();
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir(&dir);
        assert!(
            err.to_string().contains("Installed binary not found"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn ensure_running_succeeds_once_manager_reports_running() {
        let mgr = MockManager::running_after(0);
        ensure_running_with(&mgr, 5, Duration::from_millis(1)).expect("ensure_running_with");
        assert_eq!(mgr.polls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn ensure_running_waits_until_manager_reports_running() {
        let mgr = Arc::new(MockManager::running_after(2));
        ensure_running_with(mgr.as_ref(), 5, Duration::from_millis(1))
            .expect("ensure_running_with");
        assert_eq!(mgr.polls.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn ensure_running_fails_when_manager_never_reports_running() {
        let mgr = MockManager::never_running();
        let err = ensure_running_with(&mgr, 3, Duration::from_millis(1)).unwrap_err();
        assert!(
            err.to_string().contains("did not reach running state"),
            "unexpected error: {err}"
        );
        assert_eq!(mgr.polls.load(Ordering::SeqCst), 3);
    }
}
