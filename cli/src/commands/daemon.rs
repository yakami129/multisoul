use crate::commands::serve::{advertised_base_url, generate_token, is_valid_relay_token, print_qr};
use crate::config::{load_config, save_config, Config, ServeMode};
#[cfg(target_os = "macos")]
use crate::serve::daemon::Config as DaemonConfig;
use crate::serve::daemon::{
    self, default_log_file, ensure_running, load_meta_with_legacy, new_manager, remove_meta,
    resolve_binary, resolve_serve_mode, save_meta, Meta,
};
use crate::serve::relay::{
    poll_reachable_tunnel_url, service_log_byte_len, QUICKSTART_TUNNEL_POLL_TIMEOUT,
};
use anyhow::{Context, Result};
use clap::Subcommand;
use std::net::SocketAddr;

#[derive(Subcommand)]
pub enum DaemonCommands {
    /// One command setup: save config and install/start daemon (default: relay mode)
    Quickstart {
        /// Cloudflare Tunnel relay mode (default when no mode flag is passed)
        #[arg(long, conflicts_with_all = ["tailnet", "funnel"])]
        relay: bool,
        /// Bind to 0.0.0.0 for Tailscale tailnet access
        #[arg(long, conflicts_with_all = ["relay", "funnel"])]
        tailnet: bool,
        /// Expose via Tailscale Funnel (HTTPS)
        #[arg(long, conflicts_with_all = ["relay", "tailnet"])]
        funnel: bool,
        /// Port to listen on (saved to config)
        #[arg(long)]
        port: Option<u16>,
        /// Cloudflare Workers KV URL for relay mode (saved to config)
        #[arg(long)]
        relay_url: Option<String>,
        /// Bearer token (auto-generated when omitted)
        #[arg(long)]
        token: Option<String>,
    },
    /// Install and start msctl serve as a background service
    Install {
        #[arg(long, conflicts_with_all = ["tailnet", "funnel"])]
        relay: bool,
        #[arg(long, conflicts_with_all = ["relay", "funnel"])]
        tailnet: bool,
        #[arg(long, conflicts_with_all = ["relay", "tailnet"])]
        funnel: bool,
        #[arg(long)]
        port: Option<u16>,
        #[arg(long)]
        relay_url: Option<String>,
        #[arg(long)]
        token: Option<String>,
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
}

struct ModeFlags {
    relay: bool,
    tailnet: bool,
    funnel: bool,
}

pub fn handle(cmd: DaemonCommands) -> Result<()> {
    match cmd {
        DaemonCommands::Quickstart {
            relay,
            tailnet,
            funnel,
            port,
            relay_url,
            token,
        } => quickstart(
            ModeFlags {
                relay,
                tailnet,
                funnel,
            },
            port,
            relay_url,
            token,
        ),
        DaemonCommands::Install {
            relay,
            tailnet,
            funnel,
            port,
            relay_url,
            token,
            force,
        } => {
            let cfg = apply_daemon_config(
                ModeFlags {
                    relay,
                    tailnet,
                    funnel,
                },
                port,
                relay_url,
                token,
                false,
            )?;
            install(&cfg, force, true)
        }
        DaemonCommands::Uninstall => uninstall(),
        DaemonCommands::Start => start(),
        DaemonCommands::Stop => stop(),
        DaemonCommands::Restart => restart(),
        DaemonCommands::Status => status(),
    }
}

fn quickstart(
    flags: ModeFlags,
    port: Option<u16>,
    relay_url: Option<String>,
    token: Option<String>,
) -> Result<()> {
    if load_meta_with_legacy().is_ok_and(|(_, legacy)| legacy) {
        let mut cfg = load_config()?;
        cfg.serve_mode = ServeMode::Relay;
        save_config(&cfg)?;
    }
    let cfg = apply_daemon_config(flags, port, relay_url, token, true)?;
    install(&cfg, true, true)
}

fn resolve_mode_from_flags(flags: &ModeFlags, cfg: &Config) -> ServeMode {
    if flags.relay {
        ServeMode::Relay
    } else if flags.tailnet {
        ServeMode::Tailnet
    } else if flags.funnel {
        ServeMode::Funnel
    } else {
        cfg.serve_mode
    }
}

fn apply_daemon_config(
    flags: ModeFlags,
    port: Option<u16>,
    relay_url: Option<String>,
    token: Option<String>,
    persist: bool,
) -> Result<Config> {
    let mut cfg = load_config()?;
    cfg.serve_mode = resolve_mode_from_flags(&flags, &cfg);
    if let Some(p) = port {
        cfg.serve_port = p;
    }
    if let Some(url) = relay_url {
        cfg.relay_url = url;
    }
    let explicit_token = token.is_some();
    if let Some(t) = token {
        cfg.serve_token = t;
    }
    if cfg.serve_token.is_empty() {
        cfg.serve_token = generate_token();
        println!("Generated token: {}", cfg.serve_token);
    } else if cfg.serve_mode == ServeMode::Relay
        && !explicit_token
        && !is_valid_relay_token(&cfg.serve_token)
    {
        let previous = cfg.serve_token.clone();
        cfg.serve_token = generate_token();
        println!(
            "Replacing token {previous:?} (invalid for relay); new token: {}",
            cfg.serve_token
        );
    }
    if persist {
        save_config(&cfg)?;
    }
    Ok(cfg)
}

fn install(cfg: &Config, force: bool, print_pairing: bool) -> Result<()> {
    let mgr = new_manager()?;
    let st = mgr.status()?;
    if st.installed && !force {
        anyhow::bail!("Service already installed. Use --force to reinstall.");
    }

    save_config(cfg)?;

    let binary = resolve_binary()?;
    let log_file = default_log_file();
    let log_offset_before_install = service_log_byte_len(&log_file);
    let mode = cfg.serve_mode;

    #[cfg(target_os = "macos")]
    {
        let env_path = std::env::var("PATH")
            .unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin".into());
        mgr.install(&DaemonConfig {
            binary_path: binary.clone(),
            token: cfg.serve_token.clone(),
            port: cfg.serve_port,
            serve_mode: mode,
            relay_url: cfg.relay_url.clone(),
            log_file: log_file.clone(),
            env_path,
            proxy_env: daemon::capture_proxy_env(),
        })?;
    }

    save_meta(&Meta {
        log_file: log_file.clone(),
        binary_path: binary.clone(),
        port: cfg.serve_port,
        serve_mode: mode,
        relay_url: cfg.relay_url.clone(),
        tailnet: mode == ServeMode::Tailnet,
        installed_at: chrono::Local::now().to_rfc3339(),
    })?;

    ensure_running(&*mgr)?;

    println!("msctl daemon installed and started.");
    println!();
    println!("  Platform: {}", mgr.platform());
    println!("  Mode:     {}", mode);
    println!("  Token:    {}", token_prefix(&cfg.serve_token));
    println!("  Port:     {}", cfg.serve_port);
    if mode == ServeMode::Relay {
        println!("  Relay:    {}", cfg.relay_url);
    }
    println!("  Log:      {}", log_file);
    println!("  Binary:   {}", binary);
    println!();

    if print_pairing {
        print_post_install_pairing(cfg, &log_file, log_offset_before_install)?;
    }

    println!();
    println!("Commands:");
    println!("  msctl daemon status    - Check status");
    println!("  msctl logs --source service -f - Follow service logs");
    println!("  msctl daemon stop      - Stop");
    println!("  msctl daemon uninstall - Remove");
    Ok(())
}

fn print_post_install_pairing(cfg: &Config, log_file: &str, log_offset_since: u64) -> Result<()> {
    match cfg.serve_mode {
        ServeMode::Relay => {
            println!("Waiting for Cloudflare Tunnel (up to 20 min)...");
            let rt = tokio::runtime::Runtime::new().context("failed to start async runtime")?;
            match rt.block_on(poll_reachable_tunnel_url(
                &cfg.relay_url,
                &cfg.serve_token,
                log_file,
                log_offset_since,
                QUICKSTART_TUNNEL_POLL_TIMEOUT,
            )) {
                Ok(tunnel_url) => print_qr(&cfg.serve_token, &tunnel_url),
                Err(e) => eprintln!(
                    "[warn] Tunnel URL unavailable: {e}. Service is running; check `msctl logs --source service -f` for the pairing QR."
                ),
            }
        }
        ServeMode::Tailnet | ServeMode::Funnel => {
            print_pairing_info(&cfg.serve_token, cfg.serve_port, cfg.serve_mode);
        }
    }
    Ok(())
}

fn print_pairing_info(token: &str, port: u16, mode: ServeMode) {
    let (bind_addr, prefer_tailscale, funnel) = match mode {
        ServeMode::Tailnet => (
            format!("0.0.0.0:{}", port)
                .parse()
                .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], port))),
            true,
            false,
        ),
        ServeMode::Funnel => (SocketAddr::from(([127, 0, 0, 1], port)), true, true),
        ServeMode::Relay => unreachable!("relay pairing uses KV poll"),
    };
    let base_url = advertised_base_url(&bind_addr, port, prefer_tailscale, funnel);
    print_qr(token, &base_url);
}

fn token_prefix(token: &str) -> String {
    if token.len() <= 12 {
        token.to_string()
    } else {
        format!("{}…", &token[..12])
    }
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
    ensure_running(&*mgr)?;
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
    ensure_running(&*mgr)?;
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
        println!("  Run: msctl daemon quickstart");
        return Ok(());
    }
    println!(
        "  Status:   {}",
        if st.running { "Running" } else { "Stopped" }
    );
    println!("  Platform: {}", st.platform);
    if let Some(pid) = st.pid {
        println!("  PID:      {}", pid);
    }
    if let Ok((meta, legacy)) = load_meta_with_legacy() {
        let mode = resolve_serve_mode(&meta, legacy);
        println!("  Mode:     {}", mode);
        println!("  Port:     {}", meta.port);
        println!("  Binary:   {}", meta.binary_path);
        if !std::path::Path::new(&meta.binary_path).is_file() {
            println!("  Warning:  Binary missing — run `msctl daemon install --force`");
        }
        if mode == ServeMode::Relay {
            println!("  Relay:    {}", meta.relay_url);
        }
        if let Ok(cfg) = load_config() {
            if !cfg.serve_token.is_empty() {
                println!("  Token:    {}", token_prefix(&cfg.serve_token));
            }
        }
        println!("  Log:      {}", meta.log_file);
        println!("  Installed:{}", meta.installed_at);
    }
    Ok(())
}

fn require_installed(mgr: &dyn daemon::Manager) -> Result<()> {
    let st = mgr.status()?;
    if !st.installed {
        anyhow::bail!("Service is not installed. Run: msctl daemon quickstart");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serve::daemon::{meta_json_has_serve_mode, Meta};

    #[test]
    fn resolve_mode_from_flags_defaults_to_config() {
        let cfg = Config {
            serve_mode: ServeMode::Relay,
            ..Default::default()
        };
        let flags = ModeFlags {
            relay: false,
            tailnet: false,
            funnel: false,
        };
        assert_eq!(resolve_mode_from_flags(&flags, &cfg), ServeMode::Relay);
    }

    #[test]
    fn resolve_mode_from_flags_honors_tailnet_flag() {
        let cfg = Config {
            serve_mode: ServeMode::Relay,
            ..Default::default()
        };
        let flags = ModeFlags {
            relay: false,
            tailnet: true,
            funnel: false,
        };
        assert_eq!(resolve_mode_from_flags(&flags, &cfg), ServeMode::Tailnet);
    }

    #[test]
    fn legacy_meta_json_without_serve_mode_is_detected() {
        let raw = r#"{"log_file":"/tmp/l","binary_path":"/bin/msctl","port":8765,"tailnet":true,"installed_at":"t"}"#;
        assert!(!meta_json_has_serve_mode(raw));
        let meta: Meta = serde_json::from_str(raw).unwrap();
        assert_eq!(resolve_serve_mode(&meta, true), ServeMode::Tailnet);
    }

    #[test]
    fn generated_token_matches_relay_contract() {
        let token = generate_token();
        let re = regex::Regex::new(r"^ms_v2_[a-f0-9]{32}$").unwrap();
        assert!(
            re.is_match(&token),
            "token must match relay contract, got: {token}"
        );
    }
}
