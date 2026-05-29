use crate::commands::serve::{advertised_base_url, generate_token, print_qr};
use crate::config::{load_config, save_config};
#[cfg(target_os = "macos")]
use crate::serve::daemon::Config as DaemonConfig;
use crate::serve::daemon::{
    self, default_log_file, ensure_running, load_meta, new_manager, remove_meta, resolve_binary,
    save_meta, Meta,
};
use anyhow::Result;
use clap::{ArgAction, Subcommand};
use std::net::SocketAddr;

#[derive(Subcommand)]
pub enum DaemonCommands {
    /// One command setup: save token and install/start daemon
    Quickstart {
        /// Bearer token to save before installing daemon
        #[arg(long, default_value = "test")]
        token: String,
        /// Port to listen on
        #[arg(long, default_value_t = 8765)]
        port: u16,
        /// Tailnet mode, true by default
        #[arg(long, default_value_t = true, action = ArgAction::Set)]
        tailnet: bool,
    },
    /// Install and start msctl serve as a background service
    Install {
        /// Port to listen on (saved to config)
        #[arg(long)]
        port: Option<u16>,
        /// Bind to 0.0.0.0 for Tailnet access
        #[arg(long)]
        tailnet: bool,
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

pub fn handle(cmd: DaemonCommands) -> Result<()> {
    match cmd {
        DaemonCommands::Quickstart {
            token,
            port,
            tailnet,
        } => quickstart(token, port, tailnet),
        DaemonCommands::Install {
            port,
            tailnet,
            force,
        } => install(port, tailnet, force),
        DaemonCommands::Uninstall => uninstall(),
        DaemonCommands::Start => start(),
        DaemonCommands::Stop => stop(),
        DaemonCommands::Restart => restart(),
        DaemonCommands::Status => status(),
    }
}

fn quickstart(token: String, port: u16, tailnet: bool) -> Result<()> {
    let mut cfg = load_config()?;
    cfg.serve_token = token;
    cfg.serve_port = port;
    save_config(&cfg)?;
    install(Some(port), tailnet, true)
}

fn install(port_arg: Option<u16>, tailnet: bool, force: bool) -> Result<()> {
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

    #[cfg(target_os = "macos")]
    {
        let env_path = std::env::var("PATH")
            .unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin".into());
        mgr.install(&DaemonConfig {
            binary_path: binary.clone(),
            token: cfg.serve_token.clone(),
            port: cfg.serve_port,
            tailnet,
            log_file: log_file.clone(),
            env_path,
        })?;
    }

    save_meta(&Meta {
        log_file: log_file.clone(),
        binary_path: binary.clone(),
        port: cfg.serve_port,
        tailnet,
        installed_at: chrono::Local::now().to_rfc3339(),
    })?;

    ensure_running(&*mgr)?;

    println!("msctl daemon installed and started.");
    println!();
    println!("  Platform: {}", mgr.platform());
    println!("  Token:    {}", cfg.serve_token);
    println!("  Port:     {}", cfg.serve_port);
    println!(
        "  Tailnet:  {}",
        if tailnet { "enabled" } else { "disabled" }
    );
    println!("  Log:      {}", log_file);
    println!("  Binary:   {}", binary);
    println!();
    print_pairing_info(&cfg.serve_token, cfg.serve_port, tailnet);
    println!();
    println!("Commands:");
    println!("  msctl daemon status    - Check status");
    println!("  msctl logs --source service -f - Follow service logs");
    println!("  msctl daemon stop      - Stop");
    println!("  msctl daemon uninstall - Remove");
    Ok(())
}

fn print_pairing_info(token: &str, port: u16, tailnet: bool) {
    let bind_addr: SocketAddr = if tailnet {
        format!("0.0.0.0:{}", port)
    } else {
        format!("127.0.0.1:{}", port)
    }
    .parse()
    .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], port)));
    let base_url = advertised_base_url(&bind_addr, port, tailnet, false);
    print_qr(token, &base_url);
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
        println!("  Run: msctl daemon install");
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
    if let Ok(meta) = load_meta() {
        println!("  Port:     {}", meta.port);
        println!("  Binary:   {}", meta.binary_path);
        if !std::path::Path::new(&meta.binary_path).is_file() {
            println!("  Warning:  Binary missing — run `msctl daemon install --force`");
        }
        println!(
            "  Tailnet:  {}",
            if meta.tailnet { "enabled" } else { "disabled" }
        );
        println!("  Log:      {}", meta.log_file);
        println!("  Installed:{}", meta.installed_at);
    }
    Ok(())
}

fn require_installed(mgr: &dyn daemon::Manager) -> Result<()> {
    let st = mgr.status()?;
    if !st.installed {
        anyhow::bail!("Service is not installed. Run: msctl daemon install");
    }
    Ok(())
}
