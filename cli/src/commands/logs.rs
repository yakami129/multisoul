//! `msctl logs` — unified app/service log reader.
//!
//! See docs/product-specs/SPEC-unified-cli-logs.md.

use crate::commands::{logs_app, logs_service};
use anyhow::Result;
use clap::{Args, ValueEnum};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum LogSource {
    All,
    App,
    Service,
}

#[derive(Args, Debug)]
pub struct LogsArgs {
    /// Log source to read: all, app, or service.
    #[arg(long, value_enum, default_value_t = LogSource::All)]
    pub source: LogSource,

    /// Show only the last N entries per source (default 50).
    #[arg(long, default_value = "50")]
    pub tail: usize,

    /// Stream new log entries as they arrive (tail -f).
    #[arg(short = 'f', long)]
    pub follow: bool,

    /// Only app entries newer than this duration (5m / 2h / 1d).
    #[arg(long, value_parser = logs_app::parse_duration)]
    pub since: Option<Duration>,

    /// Filter app entries by conversation id.
    #[arg(long = "conv")]
    pub conv: Option<String>,

    /// Minimum app level: trace, debug, info, warn, error.
    #[arg(long, default_value = "trace")]
    pub level: String,

    /// Emit app NDJSON instead of human-readable output.
    #[arg(long)]
    pub json: bool,

    /// Regex applied to app message or service raw line.
    #[arg(long)]
    pub grep: Option<String>,

    /// Override app log directory. Hidden for tests and diagnostics.
    #[arg(long, hide = true)]
    pub log_dir: Option<PathBuf>,

    /// Override service log file. Hidden for tests and diagnostics.
    #[arg(long, hide = true)]
    pub service_log_file: Option<PathBuf>,
}

pub fn handle(args: LogsArgs) -> Result<()> {
    if args.json && args.source != LogSource::App {
        anyhow::bail!("--json is only supported with --source app");
    }

    match args.source {
        LogSource::App => logs_app::handle(app_options(&args, false, false)),
        LogSource::Service => logs_service::handle(service_options(&args, false, false)),
        LogSource::All => handle_all(args),
    }
}

fn handle_all(args: LogsArgs) -> Result<()> {
    let app = app_options(&args, true, true);
    let service = service_options(&args, true, true);

    if args.follow {
        let app_thread = std::thread::spawn(move || logs_app::handle(app));
        logs_service::handle(service)?;
        app_thread
            .join()
            .map_err(|_| anyhow::anyhow!("app log follower panicked"))?
    } else {
        logs_app::handle(app)?;
        logs_service::handle(service)
    }
}

fn app_options(args: &LogsArgs, prefix: bool, missing_ok: bool) -> logs_app::AppLogOptions {
    logs_app::AppLogOptions {
        tail: args.tail,
        follow: args.follow,
        since: args.since,
        conv: args.conv.clone(),
        level: args.level.clone(),
        json: args.json,
        grep: args.grep.clone(),
        log_dir: args.log_dir.clone(),
        prefix,
        missing_ok,
    }
}

fn service_options(
    args: &LogsArgs,
    prefix: bool,
    missing_ok: bool,
) -> logs_service::ServiceLogOptions {
    logs_service::ServiceLogOptions {
        tail: args.tail,
        follow: args.follow,
        grep: args.grep.clone(),
        log_file: args.service_log_file.clone(),
        prefix,
        missing_ok,
    }
}
