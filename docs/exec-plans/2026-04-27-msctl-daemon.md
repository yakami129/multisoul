# msctl daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `msctl daemon` subcommand to register `msctl serve` as a macOS launchd LaunchAgent with install/uninstall/start/stop/restart/status/logs.

**Architecture:** New `serve/daemon/` module provides a `Manager` trait with a `launchd.rs` implementation. `commands/daemon.rs` wires up the CLI. Token and port are read from/saved to `~/.config/msctl/config.toml`. Daemon metadata (log path, binary path) stored in `~/.config/msctl/daemon.json`.

**Tech Stack:** Rust, launchctl (macOS), `#[cfg(target_os = "macos")]`, existing `config.rs` + `dirs` crate, `libc` (for `getuid()`), `chrono` (already in Cargo.toml)

---

## File Structure

```
cli/src/
├── config.rs                        MODIFY — add serve_port: u16 field
├── main.rs                          MODIFY — add Daemon subcommand
├── commands/
│   ├── mod.rs                       MODIFY — pub mod daemon
│   └── daemon.rs                    CREATE — CLI subcommand handler
└── serve/
    ├── mod.rs                       MODIFY — pub mod daemon
    └── daemon/
        ├── mod.rs                   CREATE — Manager trait, Config, Status, Meta, helpers
        └── launchd.rs               CREATE — #[cfg(target_os = "macos")] implementation
```

---

## Task 1: config.rs — add serve_port field

**Files:**
- Modify: `cli/src/config.rs`

- [ ] **Step 1: Add serve_port to Config struct**

Replace the `Config` struct and `Default` impl in `cli/src/config.rs`:

```rust
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
```

- [ ] **Step 2: Run existing config tests**

```bash
cd cli && cargo test config -- --nocapture
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add cli/src/config.rs
git commit -m "feat(cli): add serve_port to Config"
```

---

## Task 2: serve/daemon/mod.rs — Manager trait + Meta

**Files:**
- Create: `cli/src/serve/daemon/mod.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 1: Create cli/src/serve/daemon/mod.rs**

```rust
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
```

- [ ] **Step 2: Add `pub mod daemon;` to cli/src/serve/mod.rs**

Add at the top of `cli/src/serve/mod.rs`:

```rust
pub mod daemon;
```

- [ ] **Step 3: Compile check**

```bash
cd cli && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add cli/src/serve/daemon/mod.rs cli/src/serve/mod.rs
git commit -m "feat(cli): add daemon Manager trait and Meta"
```

---

## Task 3: serve/daemon/launchd.rs — macOS implementation

**Files:**
- Create: `cli/src/serve/daemon/launchd.rs`
- Modify: `cli/Cargo.toml` — add `libc = "0.2"`

- [ ] **Step 1: Add libc to Cargo.toml**

In `cli/Cargo.toml` under `[dependencies]`:

```toml
libc = "0.2"
```

- [ ] **Step 2: Write the failing tests first**

Create `cli/src/serve/daemon/launchd.rs` with tests at the bottom:

```rust
#![cfg(target_os = "macos")]

use anyhow::{Context, Result};
use std::process::Command;
use super::{Config, Manager, Status, SERVICE_LABEL};

pub struct LaunchdManager;

pub fn new_manager() -> Result<Box<dyn Manager>> {
    Ok(Box::new(LaunchdManager))
}

fn plist_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{}.plist", SERVICE_LABEL))
}

fn build_plist(cfg: &Config) -> String {
    format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{binary}</string>
        <string>serve</string>
        <string>--token</string>
        <string>{token}</string>
        <string>--port</string>
        <string>{port}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <true/>
    </dict>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{path}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{log}</string>
    <key>StandardErrorPath</key>
    <string>{log}</string>
</dict>
</plist>
"#,
        label  = SERVICE_LABEL,
        binary = cfg.binary_path,
        token  = cfg.token,
        port   = cfg.port,
        path   = cfg.env_path,
        log    = cfg.log_file,
    )
}

fn launchctl(args: &[&str]) -> Result<String> {
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .context("launchctl not found")?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()
        + &String::from_utf8_lossy(&out.stderr).trim().to_string())
}

fn domain() -> String {
    format!("gui/{}", unsafe { libc::getuid() })
}

fn target() -> String {
    format!("{}/{}", domain(), SERVICE_LABEL)
}

impl Manager for LaunchdManager {
    fn platform(&self) -> &'static str { "launchd" }

    fn install(&self, cfg: &Config) -> Result<()> {
        let plist = plist_path();
        std::fs::create_dir_all(plist.parent().unwrap())?;
        if let Some(log_dir) = std::path::Path::new(&cfg.log_file).parent() {
            std::fs::create_dir_all(log_dir)?;
        }
        let _ = launchctl(&["bootout", &target()]);
        std::fs::write(&plist, build_plist(cfg))?;
        let plist_str = plist.to_string_lossy().into_owned();
        launchctl(&["bootstrap", &domain(), &plist_str])
            .context("launchctl bootstrap failed")?;
        launchctl(&["kickstart", "-kp", &target()])
            .context("launchctl kickstart failed")?;
        Ok(())
    }

    fn uninstall(&self) -> Result<()> {
        let _ = launchctl(&["bootout", &target()]);
        let plist = plist_path();
        if plist.exists() { std::fs::remove_file(&plist)?; }
        Ok(())
    }

    fn start(&self) -> Result<()> {
        let plist_str = plist_path().to_string_lossy().into_owned();
        if launchctl(&["bootstrap", &domain(), &plist_str]).is_err() {
            launchctl(&["kickstart", "-kp", &target()])?;
        }
        Ok(())
    }

    fn stop(&self) -> Result<()> {
        launchctl(&["bootout", &target()])?;
        Ok(())
    }

    fn restart(&self) -> Result<()> {
        let _ = launchctl(&["bootout", &target()]);
        let plist_str = plist_path().to_string_lossy().into_owned();
        for i in 0..3 {
            if i > 0 { std::thread::sleep(std::time::Duration::from_millis(500)); }
            if launchctl(&["bootstrap", &domain(), &plist_str]).is_ok() { break; }
        }
        launchctl(&["kickstart", "-kp", &target()])?;
        Ok(())
    }

    fn status(&self) -> Result<Status> {
        let installed = plist_path().exists();
        if !installed {
            return Ok(Status { installed: false, running: false, pid: None, platform: "launchd" });
        }
        let out = launchctl(&["print", &target()]).unwrap_or_default();
        let mut pid = None;
        let mut running = false;
        for line in out.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("pid = ") {
                if let Ok(p) = rest.parse::<u32>() {
                    if p > 0 { pid = Some(p); running = true; }
                }
            }
            if t.contains("state = running") { running = true; }
        }
        Ok(Status { installed, running, pid, platform: "launchd" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build_plist embeds binary, token, port, and log path correctly.
    ///
    /// Data:
    ///   binary = "/usr/local/bin/msctl"
    ///   token  = "ms_v2_test"
    ///   port   = 9000
    ///   log    = "/tmp/msctl.log"
    ///
    /// Expected:
    ///   - plist contains the binary path
    ///   - plist contains the token
    ///   - plist contains port "9000"
    ///   - plist contains the log path
    ///   - plist does NOT contain "8765" (wrong default leaked in)
    #[test]
    fn test_build_plist_contains_correct_values() {
        let cfg = Config {
            binary_path: "/usr/local/bin/msctl".into(),
            token: "ms_v2_test".into(),
            port: 9000,
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin:/bin".into(),
        };
        let plist = build_plist(&cfg);
        assert!(plist.contains("/usr/local/bin/msctl"), "plist must contain binary path");
        assert!(plist.contains("ms_v2_test"), "plist must contain token");
        assert!(plist.contains("9000"), "plist must contain port 9000");
        assert!(plist.contains("/tmp/msctl.log"), "plist must contain log path");
        assert!(!plist.contains("8765"), "plist must not contain default port when overridden");
    }

    /// build_plist uses KeepAlive.SuccessfulExit = true so that
    /// `msctl daemon stop` does not cause launchd to auto-restart the service.
    ///
    /// Expected:
    ///   - plist contains "SuccessfulExit"
    #[test]
    fn test_build_plist_keepalive_successful_exit() {
        let cfg = Config {
            binary_path: "/bin/msctl".into(),
            token: "tok".into(),
            port: 8765,
            log_file: "/tmp/msctl.log".into(),
            env_path: "/usr/bin".into(),
        };
        let plist = build_plist(&cfg);
        assert!(plist.contains("SuccessfulExit"),
            "plist must use KeepAlive.SuccessfulExit so stop does not auto-restart");
    }
}
```

- [ ] **Step 3: Run tests**

```bash
cd cli && cargo test test_build_plist -- --nocapture
```

Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add cli/src/serve/daemon/launchd.rs cli/Cargo.toml
git commit -m "feat(cli): add launchd daemon manager"
```

---

## Task 4: commands/daemon.rs — CLI subcommand

**Files:**
- Create: `cli/src/commands/daemon.rs`
- Modify: `cli/src/commands/mod.rs`
- Modify: `cli/src/main.rs`

- [ ] **Step 1: Create cli/src/commands/daemon.rs**

```rust
use anyhow::Result;
use clap::Subcommand;
use crate::config::{load_config, save_config};
use crate::serve::daemon::{
    self, Config as DaemonConfig, new_manager, save_meta, load_meta,
    remove_meta, Meta, default_log_file, resolve_binary,
};
use crate::commands::serve::generate_token;

#[derive(Subcommand)]
pub enum DaemonCommands {
    /// Install and start msctl serve as a background service
    Install {
        /// Port to listen on (saved to config)
        #[arg(long)]
        port: Option<u16>,
        /// Overwrite existing installation
        #[arg(long)]
        force: bool,
    },
    /// Remove the background service
    Uninstall,
    /// Start the service
    Start,
    /// Stop the service
    Stop,
    /// Restart the service
    Restart,
    /// Show service status
    Status,
    /// View service logs
    Logs {
        /// Follow log output
        #[arg(short, long)]
        follow: bool,
        /// Number of lines to show
        #[arg(short, long, default_value = "100")]
        lines: usize,
    },
}

pub fn handle(cmd: DaemonCommands) -> Result<()> {
    match cmd {
        DaemonCommands::Install { port, force } => install(port, force),
        DaemonCommands::Uninstall => uninstall(),
        DaemonCommands::Start => start(),
        DaemonCommands::Stop => stop(),
        DaemonCommands::Restart => restart(),
        DaemonCommands::Status => status(),
        DaemonCommands::Logs { follow, lines } => logs(follow, lines),
    }
}

fn install(port_arg: Option<u16>, force: bool) -> Result<()> {
    let mgr = new_manager()?;
    let st = mgr.status()?;
    if st.installed && !force {
        anyhow::bail!("Service already installed. Use --force to reinstall.");
    }

    let mut cfg = load_config()?;
    if cfg.serve_token.is_empty() {
        cfg.serve_token = generate_token();
        println!("Generated token: {}", cfg.serve_token);
    }
    if let Some(p) = port_arg {
        cfg.serve_port = p;
    }
    save_config(&cfg)?;

    let binary = resolve_binary()?;
    let log_file = default_log_file();
    let env_path = std::env::var("PATH")
        .unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin".into());

    let daemon_cfg = DaemonConfig {
        binary_path: binary.clone(),
        token: cfg.serve_token.clone(),
        port: cfg.serve_port,
        log_file: log_file.clone(),
        env_path,
    };

    mgr.install(&daemon_cfg)?;

    save_meta(&Meta {
        log_file: log_file.clone(),
        binary_path: binary,
        port: cfg.serve_port,
        installed_at: chrono::Local::now().to_rfc3339(),
    })?;

    println!("msctl daemon installed and started.");
    println!();
    println!("  Platform: {}", mgr.platform());
    println!("  Token:    {}", cfg.serve_token);
    println!("  Port:     {}", cfg.serve_port);
    println!("  Log:      {}", log_file);
    println!();
    println!("Commands:");
    println!("  msctl daemon status    - Check status");
    println!("  msctl daemon logs -f   - Follow logs");
    println!("  msctl daemon stop      - Stop");
    println!("  msctl daemon uninstall - Remove");
    Ok(())
}

fn uninstall() -> Result<()> {
    let mgr = new_manager()?;
    mgr.uninstall()?;
    remove_meta();
    println!("msctl daemon uninstalled.");
    Ok(())
}

fn start() -> Result<()> {
    let mgr = new_manager()?;
    require_installed(&*mgr)?;
    mgr.start()?;
    println!("msctl daemon started.");
    Ok(())
}

fn stop() -> Result<()> {
    let mgr = new_manager()?;
    require_installed(&*mgr)?;
    mgr.stop()?;
    println!("msctl daemon stopped.");
    Ok(())
}

fn restart() -> Result<()> {
    let mgr = new_manager()?;
    require_installed(&*mgr)?;
    mgr.restart()?;
    println!("msctl daemon restarted.");
    Ok(())
}

fn status() -> Result<()> {
    let mgr = new_manager()?;
    let st = mgr.status()?;
    println!("msctl daemon status");
    println!();
    if !st.installed {
        println!("  Status:   Not installed");
        println!("  Run: msctl daemon install");
        return Ok(());
    }
    println!("  Status:   {}", if st.running { "Running" } else { "Stopped" });
    println!("  Platform: {}", st.platform);
    if let Some(pid) = st.pid {
        println!("  PID:      {}", pid);
    }
    if let Ok(meta) = load_meta() {
        println!("  Port:     {}", meta.port);
        println!("  Log:      {}", meta.log_file);
        println!("  Installed:{}", meta.installed_at);
    }
    Ok(())
}

fn logs(follow: bool, lines: usize) -> Result<()> {
    let log_file = load_meta()
        .map(|m| m.log_file)
        .unwrap_or_else(|_| default_log_file());

    if !std::path::Path::new(&log_file).exists() {
        anyhow::bail!("Log file not found: {}", log_file);
    }

    print_last_lines(&log_file, lines)?;
    if follow { follow_file(&log_file)?; }
    Ok(())
}

fn print_last_lines(path: &str, n: usize) -> Result<()> {
    let content = std::fs::read_to_string(path)?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(n);
    for line in &all[start..] { println!("{}", line); }
    Ok(())
}

fn follow_file(path: &str) -> Result<()> {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::End(0))?;
    let mut reader = BufReader::new(f);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => std::thread::sleep(std::time::Duration::from_millis(300)),
            Ok(_) => print!("{}", line),
            Err(e) => anyhow::bail!("Error reading log: {}", e),
        }
    }
}

fn require_installed(mgr: &dyn daemon::Manager) -> Result<()> {
    let st = mgr.status()?;
    if !st.installed {
        anyhow::bail!("Service is not installed. Run: msctl daemon install");
    }
    Ok(())
}
```

- [ ] **Step 2: Update cli/src/commands/mod.rs**

```rust
pub mod auth;
pub mod agent;
pub mod serve;
pub mod daemon;
```

- [ ] **Step 3: Update cli/src/main.rs**

```rust
use clap::{Parser, Subcommand};

mod config;
mod db;
mod commands;
mod serve;

#[derive(Parser)]
#[command(name = "msctl", version, about = "MultiSoul Agent CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Authentication commands
    Auth {
        #[command(subcommand)]
        subcommand: commands::auth::AuthCommands,
    },
    /// Agent management commands
    Agent {
        #[command(subcommand)]
        subcommand: commands::agent::AgentCommands,
    },
    /// Start the local serve server
    Serve(commands::serve::ServeArgs),
    /// Manage msctl as a background service
    Daemon {
        #[command(subcommand)]
        subcommand: commands::daemon::DaemonCommands,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Auth { subcommand } => commands::auth::handle(subcommand),
        Commands::Agent { subcommand } => commands::agent::handle(subcommand),
        Commands::Serve(args) => {
            tokio::runtime::Runtime::new()?.block_on(commands::serve::handle(args))
        }
        Commands::Daemon { subcommand } => commands::daemon::handle(subcommand),
    }
}
```

- [ ] **Step 4: Build**

```bash
cd cli && cargo build 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 5: Smoke test**

```bash
cd cli && cargo run -- daemon --help
```

Expected: shows install/uninstall/start/stop/restart/status/logs.

- [ ] **Step 6: Run all tests**

```bash
cd cli && cargo test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/daemon.rs cli/src/commands/mod.rs cli/src/main.rs
git commit -m "feat(cli): add msctl daemon subcommand"
```
