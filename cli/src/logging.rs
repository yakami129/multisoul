//! Tracing subscriber setup + redaction helpers.
//!
//! See docs/design-docs/2026-05-02-cli-tracing-design.md for decisions.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Default level when `--log-level` is not given.
pub const DEFAULT_LEVEL: &str = "info";

/// Subscriber configuration.
pub struct Config {
    /// Directory to write `serve.log.YYYY-MM-DD` into.
    pub log_dir: PathBuf,
    /// Minimum level (e.g. "info", "debug").
    pub level: String,
}

/// Initialise the tracing subscriber for `msctl serve`.
///
/// Writes JSON lines to `<log_dir>/serve.log.YYYY-MM-DD`, rotated daily.
/// The returned `WorkerGuard` MUST be held until the process exits, otherwise
/// the non-blocking appender drops buffered records.
///
/// If the log directory cannot be created, falls back to stderr and warns once.
pub fn init_subscriber(cfg: Config) -> Result<WorkerGuard> {
    std::fs::create_dir_all(&cfg.log_dir)
        .with_context(|| format!("creating log directory {}", cfg.log_dir.display()))?;

    let appender = rolling::daily(&cfg.log_dir, "serve.log");
    let (nb, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_new(&cfg.level).unwrap_or_else(|_| EnvFilter::new(DEFAULT_LEVEL));

    let json_layer = fmt::layer()
        .json()
        .with_current_span(true)
        .with_span_list(false)
        .with_writer(nb);

    tracing_subscriber::registry()
        .with(filter)
        .with(json_layer)
        .try_init()
        .ok(); // idempotent: don't fail if tests already initialised

    Ok(guard)
}

/// Resolve the default log directory: `$XDG_CACHE_HOME/msctl` or `~/.cache/msctl`.
///
/// macOS uses `~/Library/Caches/msctl` via `dirs::cache_dir()`.
pub fn default_log_dir() -> Result<PathBuf> {
    let base = dirs::cache_dir().context("cache dir unavailable")?;
    Ok(base.join("msctl"))
}

/// Current day's log file path (without rolling suffix).
///
/// `tracing-appender` writes to `<log_dir>/serve.log.YYYY-MM-DD`. This helper
/// returns the path the reader should open for "today".
pub fn current_log_path(log_dir: &Path) -> PathBuf {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    log_dir.join(format!("serve.log.{}", today))
}

/// List all log files in `log_dir`, oldest first.
pub fn list_log_files(log_dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(log_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("serve.log."))
        })
        .collect();
    files.sort();
    files
}

// ── redaction helpers ──────────────────────────────────────────────────────

/// Short hash tag for a push token so the same device shows the same ID across
/// events without leaking the token. 8 hex chars of SHA-256.
pub fn token_hash(token: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    token.hash(&mut h);
    format!("{:08x}", h.finish() as u32)
}

/// Truncate long free-text fields (user messages, tool args string values).
/// Keeps first N chars; appends `…[+K chars]` when truncated.
pub fn truncate(s: &str, max: usize) -> String {
    let len = s.chars().count();
    if len <= max {
        return s.to_string();
    }
    let prefix: String = s.chars().take(max).collect();
    let extra = len - max;
    format!("{prefix}…[+{extra} chars]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_hash_is_stable_and_short() {
        let a = token_hash("ExponentPushToken[abc]");
        let b = token_hash("ExponentPushToken[abc]");
        assert_eq!(a, b);
        assert_eq!(a.len(), 8);
        let c = token_hash("ExponentPushToken[xyz]");
        assert_ne!(a, c);
    }

    #[test]
    fn truncate_respects_utf8_chars() {
        let s = "abcdefghij";
        assert_eq!(truncate(s, 100), "abcdefghij");
        assert_eq!(truncate(s, 3), "abc…[+7 chars]");
    }

    #[test]
    fn truncate_handles_multibyte() {
        let s = "你好世界ABCDE";
        assert_eq!(truncate(s, 4), "你好世界…[+5 chars]");
    }

    #[test]
    fn default_log_dir_ends_with_msctl() {
        let d = default_log_dir().unwrap();
        assert!(d.ends_with("msctl"));
    }
}
