//! End-to-end smoke tests for `msctl logs` on a synthetic NDJSON log dir.
//!
//! These tests assert that the 4 acceptance scenarios in
//! docs/design-docs/2026-05-02-cli-tracing-design.md §8 can actually be
//! surfaced by the reader. We write fake log lines, invoke the compiled
//! binary, and grep the output.

use std::fs::{self, File};
use std::io::Write;
use std::process::Command;

/// Run `msctl logs <args...>` with a synthetic log dir placed under XDG cache.
///
/// We isolate by setting both `XDG_CACHE_HOME` (Linux) and `HOME` (for
/// `dirs::cache_dir()` resolution on macOS) to a tempdir.
fn run_logs(args: &[&str], lines: &[&str]) -> (String, String, bool) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let home = tmp.path();
    let log_dir_linux = home.join(".cache/msctl");
    let log_dir_mac = home.join("Library/Caches/msctl");
    fs::create_dir_all(&log_dir_linux).unwrap();
    fs::create_dir_all(&log_dir_mac).unwrap();

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    for dir in [&log_dir_linux, &log_dir_mac] {
        let path = dir.join(format!("serve.log.{today}"));
        let mut f = File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    }

    let bin = env!("CARGO_BIN_EXE_msctl");
    let output = Command::new(bin)
        .args(args)
        .env("HOME", home)
        .env("XDG_CACHE_HOME", home.join(".cache"))
        .output()
        .expect("run msctl logs");
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    (stdout, stderr, output.status.success())
}

fn ndjson(level: &str, message: &str, conv: Option<&str>, extra: &str) -> String {
    let timestamp = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    let span = conv
        .map(|c| format!(r#","span":{{"name":"session_worker","conv_id":"{c}"}}"#))
        .unwrap_or_default();
    format!(
        r#"{{"timestamp":"{ts}","level":"{lvl}","target":"msctl::serve::runtime","fields":{{"message":"{msg}"{extra}}}{span}}}"#,
        ts = timestamp,
        lvl = level,
        msg = message,
        extra = if extra.is_empty() {
            String::new()
        } else {
            format!(",{extra}")
        },
        span = span
    )
}

/// Scenario 1: ask_question stuck — `--conv <id>` should surface the pending event.
#[test]
fn scenario_ask_question_stuck() {
    let lines = [
        ndjson("INFO", "turn_start", Some("cnv_abc"), ""),
        ndjson(
            "INFO",
            "ask_question_pending",
            Some("cnv_abc"),
            r#""ask_id":"aq1","options_count":3"#,
        ),
    ];
    let lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let (stdout, _stderr, ok) = run_logs(&["logs", "--conv", "cnv_abc"], &lines);
    assert!(ok, "msctl logs exit ok");
    assert!(
        stdout.contains("ask_question_pending"),
        "stdout must show pending event, got:\n{stdout}"
    );
    assert!(
        stdout.contains("cnv_abc"),
        "stdout must show conv id, got:\n{stdout}"
    );
    // turn_end is NOT present → operator can see there's no matching answer.
    assert!(
        !stdout.contains("turn_end"),
        "synthetic data should not contain turn_end"
    );
}

/// Scenario 2: 401 debug — `--level warn+` should filter out info noise.
#[test]
fn scenario_401_filter_by_level() {
    let lines = [
        ndjson(
            "INFO",
            "http_request",
            None,
            r#""method":"GET","status":200"#,
        ),
        ndjson(
            "WARN",
            "http_error",
            None,
            r#""method":"GET","path":"/api/v1/healthz","status":401"#,
        ),
    ];
    let lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let (stdout, _stderr, ok) = run_logs(&["logs", "--level", "warn"], &lines);
    assert!(ok);
    assert!(
        stdout.contains("http_error"),
        "401 must be visible at warn+, got:\n{stdout}"
    );
    assert!(
        !stdout.contains("status=200"),
        "200 info must be filtered out, got:\n{stdout}"
    );
    assert!(
        stdout.contains("401"),
        "stdout must include status=401, got:\n{stdout}"
    );
}

/// Scenario 3: push failure — `--grep push_` should isolate push events.
#[test]
fn scenario_push_failed_grep() {
    let lines = [
        ndjson("INFO", "turn_start", Some("cnv_x"), ""),
        ndjson(
            "INFO",
            "push_send",
            None,
            r#""token_hash":"a4f3e2c1","expo_id":"AbC""#,
        ),
        ndjson(
            "WARN",
            "push_failed",
            None,
            r#""token_hash":"a4f3e2c1","error_type":"DeviceNotRegistered""#,
        ),
    ];
    let lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let (stdout, _stderr, ok) = run_logs(&["logs", "--grep", "push_"], &lines);
    assert!(ok);
    assert!(
        stdout.contains("DeviceNotRegistered"),
        "stdout must show Expo error, got:\n{stdout}"
    );
    assert!(
        !stdout.contains("turn_start"),
        "turn_start must be filtered out by --grep push_, got:\n{stdout}"
    );
}

/// Scenario 4: agent crash — `--since 10m` + `--grep agent_` surfaces exit + respawn.
#[test]
fn scenario_agent_crash_timeline() {
    let lines = [
        ndjson(
            "INFO",
            "agent_spawn",
            Some("cnv_abc"),
            r#""pid":84221,"runtime":"claude""#,
        ),
        ndjson(
            "ERROR",
            "agent_exit",
            Some("cnv_abc"),
            r#""pid":84221,"exit_code":137"#,
        ),
        ndjson(
            "WARN",
            "agent_respawn",
            Some("cnv_abc"),
            r#""attempt":1,"reason":"exit_code_137""#,
        ),
    ];
    let lines: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
    let (stdout, _stderr, ok) = run_logs(&["logs", "--since", "10m", "--grep", "agent_"], &lines);
    assert!(ok);
    for needle in ["agent_spawn", "agent_exit", "agent_respawn", "137"] {
        assert!(
            stdout.contains(needle),
            "stdout must contain {needle}, got:\n{stdout}"
        );
    }
}

/// JSON mode preserves NDJSON so that jq / other tools can parse.
#[test]
fn json_mode_emits_ndjson() {
    let line = ndjson("INFO", "agent_spawn", Some("cnv_j"), r#""pid":111"#);
    let (stdout, _stderr, ok) = run_logs(&["logs", "--json"], &[&line]);
    assert!(ok);
    let first = stdout.lines().next().unwrap_or("");
    let v: serde_json::Value = serde_json::from_str(first).expect("line should parse as JSON");
    assert_eq!(v["level"], "INFO");
    assert_eq!(v["fields"]["message"], "agent_spawn");
    assert_eq!(v["fields"]["pid"], 111);
}

/// Missing log dir → friendly exit, not panic.
#[test]
fn missing_log_dir_returns_ok() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = env!("CARGO_BIN_EXE_msctl");
    let output = Command::new(bin)
        .args(["logs"])
        .env("HOME", tmp.path())
        .env("XDG_CACHE_HOME", tmp.path().join("no-such-cache"))
        .output()
        .unwrap();
    assert!(output.status.success(), "exit must be ok");
}
