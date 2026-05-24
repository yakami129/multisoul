//! End-to-end smoke tests for `msctl logs` on a synthetic NDJSON log dir.
//!
//! These tests assert that the 4 acceptance scenarios in
//! docs/design-docs/2026-05-02-cli-tracing-design.md §8 can actually be
//! surfaced by the reader. We write fake log lines, invoke the compiled
//! binary, and grep the output.

use std::fs::{self, File};
use std::io::Write;
use std::process::Command;

fn run_logs(args: &[&str], lines: &[&str]) -> (String, String, bool) {
    run_logs_with_service(args, lines, &[])
}

/// Run `msctl logs <args...>` with synthetic app and service log files.
fn run_logs_with_service(
    args: &[&str],
    app_lines: &[&str],
    service_lines: &[&str],
) -> (String, String, bool) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let log_dir = tmp.path().join("logs");
    fs::create_dir_all(&log_dir).unwrap();

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let path = log_dir.join(format!("serve.log.{today}"));
    let mut f = File::create(&path).unwrap();
    for line in app_lines {
        writeln!(f, "{line}").unwrap();
    }

    let service_log = tmp.path().join("service.log");
    let mut service = File::create(&service_log).unwrap();
    for line in service_lines {
        writeln!(service, "{line}").unwrap();
    }

    let bin = env!("CARGO_BIN_EXE_msctl");
    let output = Command::new(bin)
        .args(args)
        .arg("--log-dir")
        .arg(&log_dir)
        .arg("--service-log-file")
        .arg(&service_log)
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

/// 默认 logs：同时展示 app 与 service，并用来源前缀区分
///
/// 数据构造（含关键数值的推导过程）：
///   app_lines     = 1 条 NDJSON（message = agent_spawn）
///   service_lines = 1 行原始文本（Listening on http://127.0.0.1:8765）
///   tail 默认值   = 50，足够包含两个 source 的全部数据
///
/// 执行过程：
///   1. 写入 synthetic app log 与 service log
///   2. 执行 `msctl logs`，不指定 `--source`
///   3. 默认 source=all，分别读取 app 与 service
///
/// 预期结果：
///   - 断言 A：app 行存在且带 `[app]` 前缀
///   - 断言 B：service 行存在且带 `[service]` 前缀
///   - 断言 C：未输出 JSON 原文，说明默认是人类可读 all 模式
#[test]
fn default_logs_reads_app_and_service_with_prefixes() {
    let line = ndjson("INFO", "agent_spawn", Some("cnv_all"), r#""pid":111"#);
    let (stdout, stderr, ok) =
        run_logs_with_service(&["logs"], &[&line], &["Listening on http://127.0.0.1:8765"]);
    assert!(ok, "default msctl logs should exit ok, stderr:\n{stderr}");
    assert!(
        stdout.contains("[app]") && stdout.contains("agent_spawn"),
        "default output must include prefixed app log, got:\n{stdout}"
    );
    assert!(
        stdout.contains("[service]") && stdout.contains("Listening on http://127.0.0.1:8765"),
        "default output must include prefixed service log, got:\n{stdout}"
    );
    assert!(
        !stdout.contains(r#""fields""#),
        "default all output should be human-readable, not raw NDJSON, got:\n{stdout}"
    );
}

/// service source：读取 daemon 原始日志，并按原始文本应用 grep
///
/// 数据构造（含关键数值的推导过程）：
///   service line 1 = "old boot noise"
///   service line 2 = "panic: missing PATH"
///   app_lines      = 1 条 push_send NDJSON，用于证明 source=service 不读 app
///   tail 参数      = 10，足够包含 service 两行；grep 后只剩 panic 行
///
/// 执行过程：
///   1. 写入 synthetic app log 与 service log
///   2. 执行 `msctl logs --source service --grep panic --tail 10`
///   3. service reader 对原始文本行执行 regex
///
/// 预期结果：
///   - 断言 A：panic 行存在
///   - 断言 B：非匹配 service 行不存在
///   - 断言 C：app 事件不存在
#[test]
fn service_source_reads_plain_text_and_applies_grep() {
    let app = ndjson("INFO", "push_send", None, r#""token_hash":"abcd1234""#);
    let (stdout, stderr, ok) = run_logs_with_service(
        &[
            "logs", "--source", "service", "--grep", "panic", "--tail", "10",
        ],
        &[&app],
        &["old boot noise", "panic: missing PATH"],
    );
    assert!(ok, "service source should exit ok, stderr:\n{stderr}");
    assert!(
        stdout.contains("panic: missing PATH"),
        "service source must show matching raw line, got:\n{stdout}"
    );
    assert!(
        !stdout.contains("old boot noise"),
        "service source must filter non-matching service line, got:\n{stdout}"
    );
    assert!(
        !stdout.contains("push_send"),
        "service source must not include app logs, got:\n{stdout}"
    );
}

/// JSON 模式：必须显式选择 app source，避免 all/service 混入非 JSON 文本
///
/// 数据构造（含关键数值的推导过程）：
///   app_lines     = 1 条可解析 NDJSON
///   service_lines = 1 行原始文本
///   source 默认值 = all
///
/// 执行过程：
///   1. 执行 `msctl logs --json`
///   2. CLI 发现 `--json` 与默认 source=all 冲突
///
/// 预期结果：
///   - 断言 A：命令失败
///   - 断言 B：stderr 提示 `--json` 只支持 `--source app`
///   - 断言 C：stdout 为空，避免输出半截可解析内容
#[test]
fn json_requires_explicit_app_source() {
    let app = ndjson("INFO", "agent_spawn", Some("cnv_j"), r#""pid":111"#);
    let (stdout, stderr, ok) =
        run_logs_with_service(&["logs", "--json"], &[&app], &["service text"]);
    assert!(
        !ok,
        "`msctl logs --json` should fail when source defaults to all"
    );
    assert!(
        stderr.contains("--json is only supported with --source app"),
        "stderr must explain json source requirement, got:\n{stderr}"
    );
    assert!(
        stdout.trim().is_empty(),
        "json validation failure should not emit stdout, got:\n{stdout}"
    );
}

/// daemon logs：旧入口被删除，不提供兼容 alias
///
/// 数据构造（含关键数值的推导过程）：
///   无需日志文件；只验证 CLI 子命令树
///
/// 执行过程：
///   1. 执行 `msctl daemon logs`
///   2. clap 在 daemon 子命令下找不到 `logs`
///
/// 预期结果：
///   - 断言 A：命令失败
///   - 断言 B：stderr 包含 unknown/unrecognized subcommand 语义
///   - 断言 C：stdout 为空
#[test]
fn daemon_logs_subcommand_is_removed() {
    let bin = env!("CARGO_BIN_EXE_msctl");
    let output = Command::new(bin).args(["daemon", "logs"]).output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    assert!(
        !output.status.success(),
        "`msctl daemon logs` should fail after removing the subcommand"
    );
    assert!(
        stderr.contains("unrecognized subcommand") || stderr.contains("unexpected argument"),
        "stderr should come from clap unknown command handling, got:\n{stderr}"
    );
    assert!(
        stdout.trim().is_empty(),
        "removed daemon logs command should not print stdout, got:\n{stdout}"
    );
}

/// JSON mode preserves NDJSON so that jq / other tools can parse.
#[test]
fn json_mode_emits_ndjson() {
    let line = ndjson("INFO", "agent_spawn", Some("cnv_j"), r#""pid":111"#);
    let (stdout, _stderr, ok) = run_logs(&["logs", "--source", "app", "--json"], &[&line]);
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
