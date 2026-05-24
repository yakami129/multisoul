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

#[test]
fn formatted_tail_lines_returns_human_readable_text_not_json() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let log_dir = tmp.path().join("logs");
    std::fs::create_dir_all(&log_dir).expect("create log dir");
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let log_path = log_dir.join(format!("serve.log.{today}"));
    std::fs::write(
        &log_path,
        r#"{"timestamp":"2026-05-24T10:00:00Z","level":"INFO","target":"msctl::serve::runtime","fields":{"message":"agent_spawn","pid":123},"span":{"name":"session_worker","conv_id":"cnv_abc"}}"#,
    )
    .expect("write synthetic log");

    let lines = formatted_tail_lines(&log_dir, 10, "trace").expect("format tail lines");
    let rendered = lines
        .first()
        .expect("one formatted log line should be returned");

    assert!(
        rendered.contains("2026-05-24T10:00:00"),
        "formatted log line should include a human-readable timestamp, got: {rendered}"
    );
    assert!(
        rendered.contains("INFO"),
        "formatted log line should include the log level, got: {rendered}"
    );
    assert!(
        rendered.contains("[runtime conv=cnv_abc] agent_spawn pid=123"),
        "formatted log line should include target, conversation id, message, and fields, got: {rendered}"
    );
    assert!(
        !rendered.trim_start().starts_with('{'),
        "release log websocket must send formatted text, not raw JSON: {rendered}"
    );
}

#[test]
fn format_log_line_for_stream_filters_below_level() {
    let info = r#"{"timestamp":"2026-05-24T10:00:00Z","level":"INFO","target":"msctl::serve","fields":{"message":"http_request","status":200}}"#;
    let warn = r#"{"timestamp":"2026-05-24T10:00:01Z","level":"WARN","target":"msctl::serve","fields":{"message":"http_error","status":401}}"#;

    let skipped = format_log_line_for_stream(info, "warn").expect("valid level");
    let rendered = format_log_line_for_stream(warn, "warn").expect("valid level");

    assert!(
        skipped.is_none(),
        "info log must be filtered out when websocket level is warn"
    );
    assert!(
        rendered
            .as_deref()
            .is_some_and(|line| line.contains("WARN") && line.contains("http_error")),
        "warn log should be rendered as formatted text, got: {rendered:?}"
    );
}
