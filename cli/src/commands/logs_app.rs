//! Structured app log reader for `msctl serve` tracing NDJSON.

use crate::logging;
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, IsTerminal, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::Duration;

pub struct AppLogOptions {
    pub tail: usize,
    pub follow: bool,
    pub since: Option<Duration>,
    pub conv: Option<String>,
    pub level: String,
    pub json: bool,
    pub grep: Option<String>,
    pub log_dir: Option<PathBuf>,
    pub prefix: bool,
    pub missing_ok: bool,
}

pub fn handle(opts: AppLogOptions) -> Result<()> {
    let log_dir = opts
        .log_dir
        .clone()
        .map(Ok)
        .unwrap_or_else(logging::default_log_dir)?;
    if !log_dir.exists() {
        if !opts.missing_ok {
            eprintln!(
                "no logs yet — run `msctl serve` first ({}).",
                log_dir.display()
            );
        }
        return Ok(());
    }

    let filter = Filter::from_options(&opts)?;
    let use_color = std::io::stdout().is_terminal();
    let renderer = Renderer {
        json: opts.json,
        color: use_color && !opts.json,
        prefix: opts.prefix && !opts.json,
    };

    let files = logging::list_log_files(&log_dir);
    if files.is_empty() {
        if !opts.missing_ok {
            eprintln!("no logs yet — run `msctl serve` first.");
        }
        return Ok(());
    }

    if opts.follow {
        follow_stream(&log_dir, &filter, &renderer)
    } else {
        batch_scan(&files, &filter, opts.tail, &renderer)
    }
}

pub fn formatted_tail_lines(
    log_dir: &std::path::Path,
    tail: usize,
    level: &str,
) -> Result<Vec<String>> {
    if !log_dir.exists() {
        return Ok(Vec::new());
    }
    let files = logging::list_log_files(log_dir);
    if files.is_empty() {
        return Ok(Vec::new());
    }
    let filter = Filter {
        since: None,
        conv: None,
        min_level: level_rank(level)?,
        grep: None,
    };
    let renderer = Renderer {
        json: false,
        color: false,
        prefix: false,
    };
    Ok(collect_tail_records(&files, &filter, tail)?
        .into_iter()
        .filter_map(|(line, rec)| renderer.render_to_string(&line, &rec).ok())
        .collect())
}

pub fn format_log_line_for_stream(line: &str, level: &str) -> Result<Option<String>> {
    let filter = Filter {
        since: None,
        conv: None,
        min_level: level_rank(level)?,
        grep: None,
    };
    let Some(rec) = LogRecord::from_line(line.trim_end()) else {
        return Ok(None);
    };
    if !filter.keeps(&rec) {
        return Ok(None);
    }
    let renderer = Renderer {
        json: false,
        color: false,
        prefix: false,
    };
    Ok(renderer.render_to_string(line, &rec).ok())
}

// ── filtering ──────────────────────────────────────────────────────────────

struct Filter {
    since: Option<DateTime<Utc>>,
    conv: Option<String>,
    min_level: u8,
    grep: Option<Regex>,
}

impl Filter {
    fn from_options(opts: &AppLogOptions) -> Result<Self> {
        let since = opts.since.map(|d| {
            let now = Utc::now();
            now - chrono::Duration::from_std(d).unwrap_or_default()
        });
        let min_level = level_rank(&opts.level)?;
        let grep = opts
            .grep
            .as_deref()
            .map(Regex::new)
            .transpose()
            .context("invalid --grep regex")?;
        Ok(Self {
            since,
            conv: opts.conv.clone(),
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
    prefix: bool,
}

impl Renderer {
    fn emit(&self, w: &mut impl Write, line: &str, rec: &LogRecord) -> std::io::Result<()> {
        if self.json {
            return writeln!(w, "{}", line.trim_end());
        }

        let ts = rec.timestamp.format("%Y-%m-%dT%H:%M:%S");
        let level = pad_level(&rec.level);
        let span_info = rec
            .conv_id()
            .map(|c| format!(" conv={c}"))
            .unwrap_or_default();
        let target_short = rec.target.rsplit("::").next().unwrap_or(&rec.target);
        let fields_extras = extra_fields(&rec.fields);
        let prefix = if self.prefix { "[app]     " } else { "" };
        if self.color {
            let (level_col, reset) = ansi_for_level(&rec.level);
            writeln!(
                w,
                "{prefix}{ts} {level_col}{level}{reset} [{target_short}{span_info}] {msg}{fields_extras}",
                msg = rec.message
            )
        } else {
            writeln!(
                w,
                "{prefix}{ts} {level} [{target_short}{span_info}] {msg}{fields_extras}",
                msg = rec.message
            )
        }
    }

    fn render_to_string(&self, line: &str, rec: &LogRecord) -> std::io::Result<String> {
        let mut out = Vec::new();
        self.emit(&mut out, line, rec)?;
        Ok(String::from_utf8_lossy(&out).trim_end().to_string())
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
    let kept = collect_tail_records(files, filter, tail)?;
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for (line, rec) in kept {
        renderer.emit(&mut out, &line, &rec).ok();
    }
    Ok(())
}

fn collect_tail_records(
    files: &[PathBuf],
    filter: &Filter,
    tail: usize,
) -> Result<Vec<(String, LogRecord)>> {
    if tail == 0 {
        return Ok(Vec::new());
    }
    let mut kept: VecDeque<(String, LogRecord)> = VecDeque::with_capacity(tail.max(16));

    for file in files.iter().rev() {
        let f = std::fs::File::open(file).with_context(|| format!("opening {}", file.display()))?;
        let reader = BufReader::new(f);
        let lines: Vec<String> = reader.lines().map_while(|line| line.ok()).collect();
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

    Ok(kept.into_iter().collect())
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

pub fn parse_duration(s: &str) -> std::result::Result<Duration, String> {
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
        assert_eq!(
            parse_duration("5m").unwrap(),
            Duration::from_secs(300),
            "5m should parse to 300 seconds"
        );
    }

    #[test]
    fn parse_duration_rejects_unknown_unit() {
        assert!(
            parse_duration("5x").is_err(),
            "unknown duration suffix should be rejected"
        );
    }

    #[test]
    fn record_extracts_conv_id_from_span() {
        let json = r#"{
            "timestamp": "2026-05-02T10:00:00Z",
            "level": "INFO",
            "target": "msctl::serve::runtime",
            "fields": { "message": "agent_spawn", "pid": 123 },
            "span": { "name": "session_worker", "conv_id": "cnv_abc" }
        }"#;
        let rec = LogRecord::from_line(json).unwrap();
        assert_eq!(
            rec.conv_id().as_deref(),
            Some("cnv_abc"),
            "span conv_id should be extracted for app filtering"
        );
    }

    #[test]
    fn level_rank_is_ordered() {
        assert!(
            level_rank("trace").unwrap() < level_rank("info").unwrap(),
            "trace should rank below info"
        );
        assert!(
            level_rank("warn").unwrap() < level_rank("error").unwrap(),
            "warn should rank below error"
        );
    }
}
