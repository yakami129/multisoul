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

/// Return the same human-readable lines used by `msctl logs --source all`.
///
/// This is used by the mobile release logs websocket so the app and CLI do not
/// drift into two different all-log formats.
pub fn formatted_tail_lines(
    log_dir: &std::path::Path,
    tail: usize,
    level: &str,
) -> Result<Vec<String>> {
    formatted_tail_lines_with_service(log_dir, None, tail, level)
}

pub fn formatted_tail_lines_with_service(
    log_dir: &std::path::Path,
    service_log_file: Option<PathBuf>,
    tail: usize,
    level: &str,
) -> Result<Vec<String>> {
    let mut lines = logs_app::formatted_tail_lines(log_dir, tail, level)?
        .into_iter()
        .map(|line| format!("[app]     {line}"))
        .collect::<Vec<_>>();
    lines.extend(logs_service::formatted_tail_lines(service_log_file, tail)?);
    Ok(lines)
}

/// Format one newly-appended app NDJSON log line as human-readable text.
pub fn format_log_line_for_stream(line: &str, level: &str) -> Result<Option<String>> {
    Ok(logs_app::format_log_line_for_stream(line, level)?
        .map(|rendered| format!("[app]     {rendered}")))
}

pub fn format_service_log_line_for_stream(line: &str) -> Option<String> {
    logs_service::format_log_line_for_stream(line)
}

pub fn service_log_path() -> PathBuf {
    logs_service::service_log_path(None)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Release logs 聚合：tail 同时返回 app 与 service 日志
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   app_lines     = 1 条 NDJSON（message = agent_spawn）
    ///   service_lines = 1 行原始文本（launchd stderr）
    ///   tail          = 10，足够覆盖 app 1 条 + service 1 行
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 写入 synthetic `serve.log.<today>` 到临时 app log dir
    ///   2. 写入 synthetic service log 到临时文件
    ///   3. 调用 `formatted_tail_lines_with_service(..., tail=10, level=trace)`
    ///
    /// 预期结果：
    ///   - 断言 A：返回 `[app]` agent_spawn，说明 Release logs 包含结构化 app 日志
    ///   - 断言 B：返回 `[service]` launchd stderr，说明 Release logs 包含 daemon/service 原始日志
    ///   - 断言 C：不返回裸 JSON，说明手机端仍收到人类可读文本
    #[test]
    fn release_tail_lines_include_app_and_service_logs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let log_dir = tmp.path().join("logs");
        std::fs::create_dir_all(&log_dir).expect("create app log dir");
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        let app_log = log_dir.join(format!("serve.log.{today}"));
        std::fs::write(
            &app_log,
            r#"{"timestamp":"2026-05-24T10:00:00Z","level":"INFO","target":"msctl::serve::runtime","fields":{"message":"agent_spawn","pid":123},"span":{"name":"session_worker","conv_id":"cnv_abc"}}"#,
        )
        .expect("write app log");

        let service_log = tmp.path().join("service.log");
        let mut service_file = std::fs::File::create(&service_log).expect("create service log");
        writeln!(service_file, "launchd stderr: PATH missing").expect("write service log");

        let lines = formatted_tail_lines_with_service(&log_dir, Some(service_log), 10, "trace")
            .expect("format release logs");

        assert!(
            lines
                .iter()
                .any(|line| line.starts_with("[app]") && line.contains("agent_spawn")),
            "release logs must include prefixed app log line, got: {lines:?}"
        );
        assert!(
            lines.iter().any(|line| line.starts_with("[service]")
                && line.contains("launchd stderr: PATH missing")),
            "release logs must include prefixed service log line, got: {lines:?}"
        );
        assert!(
            !lines.iter().any(|line| line.trim_start().starts_with('{')),
            "release logs must be human-readable text instead of raw JSON, got: {lines:?}"
        );
    }
}
