//! `msctl logs` — query the local serve log.
//!
//! See docs/design-docs/2026-05-02-cli-tracing-design.md §5.

use crate::logging;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use clap::Args;
use regex::Regex;
use serde::Deserialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, IsTerminal, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Args, Debug, Default)]
pub struct LogsArgs {
    /// Show only the last N entries (default 50). Ignored with --follow.
    #[arg(long, default_value = "50")]
    pub tail: usize,

    /// Stream new log entries as they arrive (tail -f).
    #[arg(short = 'f', long)]
    pub follow: bool,

    /// Only entries newer than this duration (5m / 2h / 1d).
    #[arg(long, value_parser = parse_duration)]
    pub since: Option<Duration>,

    /// Filter by conversation id.
    #[arg(long = "conv")]
    pub conv: Option<String>,

    /// Minimum level: trace, debug, info, warn, error.
    #[arg(long, default_value = "trace")]
    pub level: String,

    /// Emit NDJSON (original format) instead of human-readable output.
    #[arg(long)]
    pub json: bool,

    /// Regex applied to the message field (case-sensitive).
    #[arg(long)]
    pub grep: Option<String>,
}

pub fn handle(args: LogsArgs) -> Result<()> {
    let log_dir = logging::default_log_dir()?;
    if !log_dir.exists() {
        eprintln!(
            "no logs yet — run `msctl serve` first ({}).",
            log_dir.display()
        );
        return Ok(());
    }

    let filter = Filter::from_args(&args)?;
    let use_color = std::io::stdout().is_terminal();
    let renderer = Renderer {
        json: args.json,
        color: use_color && !args.json,
    };

    let files = logging::list_log_files(&log_dir);
    if files.is_empty() {
        eprintln!("no logs yet — run `msctl serve` first.");
        return Ok(());
    }

    if args.follow {
        follow_stream(&log_dir, &filter, &renderer)
    } else {
        batch_scan(&files, &filter, args.tail, &renderer)
    }
}

// ── filtering ──────────────────────────────────────────────────────────────

struct Filter {
    since: Option<DateTime<Utc>>,
    conv: Option<String>,
    min_level: u8,
    grep: Option<Regex>,
}

impl Filter {
    fn from_args(args: &LogsArgs) -> Result<Self> {
        let since = args.since.map(|d| {
            let now = Utc::now();
            now - chrono::Duration::from_std(d).unwrap_or_default()
        });
        let min_level = level_rank(&args.level)?;
        let grep = args
            .grep
            .as_deref()
            .map(Regex::new)
            .transpose()
            .context("invalid --grep regex")?;
        Ok(Self {
            since,
            conv: args.conv.clone(),
            min_level,
            grep,
        })
    }

    fn keeps(&self, record: &LogRecord) -> bool {
        if level_rank(&record.level).unwrap_or(0) < self.min_level {
            return false;
        }
        if let Some(since) = self.since {
            if record.timestamp < since {
                return false;
            }
        }
        if let Some(want) = &self.conv {
            let got = record.conv_id();
            if got.as_deref() != Some(want.as_str()) {
                return false;
            }
        }
        if let Some(re) = &self.grep {
            if !re.is_match(&record.message) {
                return false;
            }
        }
        true
    }
}

fn level_rank(level: &str) -> Result<u8> {
    Ok(match level.to_ascii_uppercase().as_str() {
        "TRACE" => 0,
        "DEBUG" => 1,
        "INFO" => 2,
        "WARN" | "WARNING" => 3,
        "ERROR" => 4,
        other => anyhow::bail!("unknown log level: {other}"),
    })
}

// ── record parsing ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LogRecord {
    #[serde(default, rename = "timestamp")]
    timestamp: DateTime<Utc>,
    #[serde(default)]
    level: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    fields: serde_json::Value,
    #[serde(default)]
    span: Option<serde_json::Value>,
    // Helper: `message` is extracted from `fields.message`
    #[serde(skip)]
    message: String,
}

impl LogRecord {
    fn from_line(line: &str) -> Option<Self> {
        let mut rec: LogRecord = serde_json::from_str(line).ok()?;
        rec.message = rec
            .fields
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Some(rec)
    }

    fn conv_id(&self) -> Option<String> {
        // Prefer span field, fall back to top-level field (ad-hoc events).
        if let Some(span) = &self.span {
            if let Some(c) = span.get("conv_id").and_then(|v| v.as_str()) {
                return Some(c.to_string());
            }
        }
        self.fields
            .get("conv_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}

// ── rendering ──────────────────────────────────────────────────────────────

struct Renderer {
    json: bool,
    color: bool,
}

impl Renderer {
    fn emit(&self, w: &mut impl Write, line: &str, rec: &LogRecord) -> std::io::Result<()> {
        if self.json {
            writeln!(w, "{}", line.trim_end())
        } else {
            let ts = rec.timestamp.format("%Y-%m-%dT%H:%M:%S");
            let level = pad_level(&rec.level);
            let span_info = rec
                .conv_id()
                .map(|c| format!(" conv={c}"))
                .unwrap_or_default();
            let target_short = rec.target.rsplit("::").next().unwrap_or(&rec.target);
            let fields_extras = extra_fields(&rec.fields);
            if self.color {
                let (level_col, reset) = ansi_for_level(&rec.level);
                writeln!(
                    w,
                    "{ts} {level_col}{level}{reset} [{target_short}{span_info}] {msg}{fields_extras}",
                    msg = rec.message
                )
            } else {
                writeln!(
                    w,
                    "{ts} {level} [{target_short}{span_info}] {msg}{fields_extras}",
                    msg = rec.message
                )
            }
        }
    }
}

fn pad_level(level: &str) -> String {
    let up = level.to_ascii_uppercase();
    format!("{:<5}", up)
}

fn ansi_for_level(level: &str) -> (&'static str, &'static str) {
    match level.to_ascii_uppercase().as_str() {
        "ERROR" => ("\x1b[31m", "\x1b[0m"),
        "WARN" | "WARNING" => ("\x1b[33m", "\x1b[0m"),
        "INFO" => ("\x1b[32m", "\x1b[0m"),
        "DEBUG" => ("\x1b[90m", "\x1b[0m"),
        _ => ("", ""),
    }
}

fn extra_fields(fields: &serde_json::Value) -> String {
    let Some(obj) = fields.as_object() else {
        return String::new();
    };
    let mut parts: Vec<String> = Vec::new();
    for (k, v) in obj {
        if k == "message" {
            continue;
        }
        let rendered = match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        parts.push(format!("{k}={rendered}"));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" {}", parts.join(" "))
    }
}

// ── batch scan (default mode) ──────────────────────────────────────────────

fn batch_scan(files: &[PathBuf], filter: &Filter, tail: usize, renderer: &Renderer) -> Result<()> {
    // Gather matching records (raw line + parsed) from newest file backwards
    // until we have enough to satisfy --tail after filtering.
    let mut kept: VecDeque<(String, LogRecord)> = VecDeque::with_capacity(tail.max(16));

    for file in files.iter().rev() {
        let f = std::fs::File::open(file).with_context(|| format!("opening {}", file.display()))?;
        let reader = BufReader::new(f);
        let lines: Vec<String> = reader.lines().map_while(Result::ok).collect();
        // walk the current file newest to oldest
        for line in lines.iter().rev() {
            let Some(rec) = LogRecord::from_line(line) else {
                continue;
            };
            if !filter.keeps(&rec) {
                continue;
            }
            kept.push_front((line.clone(), rec));
            if kept.len() >= tail {
                break;
            }
        }
        if kept.len() >= tail {
            break;
        }
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for (line, rec) in kept {
        renderer.emit(&mut out, &line, &rec).ok();
    }
    Ok(())
}

// ── follow mode ────────────────────────────────────────────────────────────

fn follow_stream(log_dir: &std::path::Path, filter: &Filter, renderer: &Renderer) -> Result<()> {
    let mut path = logging::current_log_path(log_dir);
    let mut file = open_or_wait(&path)?;
    file.seek(SeekFrom::End(0)).ok();
    let mut reader = BufReader::new(file);
    let stdout = std::io::stdout();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                // EOF — check for daily rotation (new file appeared).
                let latest = logging::current_log_path(log_dir);
                if latest != path && latest.exists() {
                    path = latest;
                    reader = BufReader::new(open_or_wait(&path)?);
                    continue;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            Ok(_) => {
                if let Some(rec) = LogRecord::from_line(line.trim_end()) {
                    if filter.keeps(&rec) {
                        let mut out = stdout.lock();
                        renderer.emit(&mut out, &line, &rec).ok();
                    }
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(500)),
        }
    }
}

fn open_or_wait(path: &std::path::Path) -> Result<std::fs::File> {
    for _ in 0..20 {
        if let Ok(f) = std::fs::File::open(path) {
            return Ok(f);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    anyhow::bail!("log file not found: {}", path.display())
}

// ── duration parsing ───────────────────────────────────────────────────────

fn parse_duration(s: &str) -> std::result::Result<Duration, String> {
    if s.is_empty() {
        return Err("empty duration".to_string());
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: u64 = num_str
        .parse()
        .map_err(|_| format!("invalid duration number: {num_str}"))?;
    let secs = match unit {
        "s" => num,
        "m" => num * 60,
        "h" => num * 3600,
        "d" => num * 86400,
        other => return Err(format!("unknown duration unit '{other}' (use s/m/h/d)")),
    };
    Ok(Duration::from_secs(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_duration_minutes() {
        assert_eq!(parse_duration("5m").unwrap(), Duration::from_secs(300));
    }

    #[test]
    fn parse_duration_hours() {
        assert_eq!(parse_duration("2h").unwrap(), Duration::from_secs(7200));
    }

    #[test]
    fn parse_duration_days() {
        assert_eq!(parse_duration("1d").unwrap(), Duration::from_secs(86400));
    }

    #[test]
    fn parse_duration_rejects_unknown_unit() {
        assert!(parse_duration("5x").is_err());
    }

    #[test]
    fn level_rank_is_ordered() {
        assert!(level_rank("trace").unwrap() < level_rank("info").unwrap());
        assert!(level_rank("info").unwrap() < level_rank("warn").unwrap());
        assert!(level_rank("warn").unwrap() < level_rank("error").unwrap());
    }

    fn sample_record() -> LogRecord {
        let json = r#"{
            "timestamp": "2026-05-02T10:00:00Z",
            "level": "INFO",
            "target": "msctl::serve::runtime",
            "fields": { "message": "agent_spawn", "pid": 123 },
            "span": { "name": "session_worker", "conv_id": "cnv_abc" }
        }"#;
        LogRecord::from_line(json).unwrap()
    }

    #[test]
    fn record_extracts_conv_id_from_span() {
        let rec = sample_record();
        assert_eq!(rec.conv_id().as_deref(), Some("cnv_abc"));
    }

    #[test]
    fn filter_rejects_below_min_level() {
        let rec = sample_record();
        let f = Filter {
            since: None,
            conv: None,
            min_level: level_rank("warn").unwrap(),
            grep: None,
        };
        assert!(!f.keeps(&rec));
    }

    #[test]
    fn filter_accepts_matching_conv() {
        let rec = sample_record();
        let f = Filter {
            since: None,
            conv: Some("cnv_abc".to_string()),
            min_level: 0,
            grep: None,
        };
        assert!(f.keeps(&rec));
    }

    #[test]
    fn filter_rejects_other_conv() {
        let rec = sample_record();
        let f = Filter {
            since: None,
            conv: Some("cnv_other".to_string()),
            min_level: 0,
            grep: None,
        };
        assert!(!f.keeps(&rec));
    }

    #[test]
    fn filter_applies_grep_to_message() {
        let rec = sample_record();
        let f = Filter {
            since: None,
            conv: None,
            min_level: 0,
            grep: Some(Regex::new("spawn").unwrap()),
        };
        assert!(f.keeps(&rec));
        let f2 = Filter {
            since: None,
            conv: None,
            min_level: 0,
            grep: Some(Regex::new("nonexistent").unwrap()),
        };
        assert!(!f2.keeps(&rec));
    }
}