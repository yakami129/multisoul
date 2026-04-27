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
