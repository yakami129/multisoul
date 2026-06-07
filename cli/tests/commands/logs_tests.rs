use super::*;

/// Duration 解析：分钟单位应换算为秒
///
/// 数据构造（含关键数值的推导过程）：
///   input = "5m"
///   5 minutes * 60 seconds = 300 seconds
///
/// 执行过程（逐步说明系统如何处理）：
///   1. parse_duration 读取末尾单位 m
///   2. 将数值 5 按分钟换算为 Duration::from_secs(300)
///
/// 预期结果：
///   - 断言 A：结果等于 300 秒
#[test]
fn parse_duration_minutes() {
    assert_eq!(
        parse_duration("5m").unwrap(),
        Duration::from_secs(300),
        "5m should parse to exactly 300 seconds"
    );
}

/// Duration 解析：小时单位应换算为秒
///
/// 数据构造（含关键数值的推导过程）：
///   input = "2h"
///   2 hours * 60 minutes * 60 seconds = 7200 seconds
///
/// 执行过程（逐步说明系统如何处理）：
///   1. parse_duration 读取末尾单位 h
///   2. 将数值 2 按小时换算为 Duration::from_secs(7200)
///
/// 预期结果：
///   - 断言 A：结果等于 7200 秒
#[test]
fn parse_duration_hours() {
    assert_eq!(
        parse_duration("2h").unwrap(),
        Duration::from_secs(7200),
        "2h should parse to exactly 7200 seconds"
    );
}

/// Duration 解析：天单位应换算为秒
///
/// 数据构造（含关键数值的推导过程）：
///   input = "1d"
///   1 day * 24 hours * 60 minutes * 60 seconds = 86400 seconds
///
/// 执行过程（逐步说明系统如何处理）：
///   1. parse_duration 读取末尾单位 d
///   2. 将数值 1 按天换算为 Duration::from_secs(86400)
///
/// 预期结果：
///   - 断言 A：结果等于 86400 秒
#[test]
fn parse_duration_days() {
    assert_eq!(
        parse_duration("1d").unwrap(),
        Duration::from_secs(86400),
        "1d should parse to exactly 86400 seconds"
    );
}

/// Duration 解析：未知单位必须拒绝
///
/// 数据构造（含关键数值的推导过程）：
///   input = "5x"
///   x 不在 s/m/h/d 白名单中
///
/// 执行过程（逐步说明系统如何处理）：
///   1. parse_duration 读取末尾单位 x
///   2. 单位匹配失败，返回 Err
///
/// 预期结果：
///   - 断言 A：解析失败，避免静默接受错误参数
#[test]
fn parse_duration_rejects_unknown_unit() {
    assert!(
        parse_duration("5x").is_err(),
        "unknown duration unit should be rejected"
    );
}

/// 日志级别排序：trace < info < warn < error
///
/// 数据构造（含关键数值的推导过程）：
///   trace = 0, debug = 1, info = 2, warn = 3, error = 4（level_rank 内部序）
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 分别解析 trace/info/warn/error
///   2. 比较关键相邻级别，确认过滤阈值单调递增
///
/// 预期结果：
///   - 断言 A：trace 低于 info
///   - 断言 B：info 低于 warn
///   - 断言 C：warn 低于 error
#[test]
fn level_rank_is_ordered() {
    assert!(
        level_rank("trace").unwrap() < level_rank("info").unwrap(),
        "trace should rank below info for min-level filtering"
    );
    assert!(
        level_rank("info").unwrap() < level_rank("warn").unwrap(),
        "info should rank below warn for min-level filtering"
    );
    assert!(
        level_rank("warn").unwrap() < level_rank("error").unwrap(),
        "warn should rank below error for min-level filtering"
    );
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

/// LogRecord 会从 span 中提取 conv_id
///
/// 数据构造（含关键数值的推导过程）：
///   sample_record.span.conv_id = "cnv_abc"
///   sample_record.fields 不含 conv_id，确保来源是 span
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 解析 sample_record synthetic NDJSON
///   2. 调用 conv_id()
///
/// 预期结果：
///   - 断言 A：返回 cnv_abc
#[test]
fn record_extracts_conv_id_from_span() {
    let rec = sample_record();
    assert_eq!(
        rec.conv_id().as_deref(),
        Some("cnv_abc"),
        "conv_id should be extracted from span when fields lacks conv_id"
    );
}

/// 级别过滤：低于阈值的记录必须被丢弃
///
/// 数据构造（含关键数值的推导过程）：
///   record.level = INFO
///   filter.min_level = WARN
///   INFO(2) < WARN(3)，因此不保留
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造 INFO sample_record
///   2. 用 WARN 阈值调用 keeps()
///
/// 预期结果：
///   - 断言 A：keeps 返回 false
#[test]
fn filter_rejects_below_min_level() {
    let rec = sample_record();
    let f = Filter {
        since: None,
        conv: None,
        min_level: level_rank("warn").unwrap(),
        grep: None,
    };
    assert!(
        !f.keeps(&rec),
        "INFO record should be rejected when min level is WARN"
    );
}

/// 会话过滤：匹配 conv_id 的记录必须保留
///
/// 数据构造（含关键数值的推导过程）：
///   record.conv_id = "cnv_abc"
///   filter.conv    = "cnv_abc"
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造带 cnv_abc span 的 sample_record
///   2. 用相同 conv_id 调用 keeps()
///
/// 预期结果：
///   - 断言 A：keeps 返回 true
#[test]
fn filter_accepts_matching_conv() {
    let rec = sample_record();
    let f = Filter {
        since: None,
        conv: Some("cnv_abc".to_string()),
        min_level: 0,
        grep: None,
    };
    assert!(f.keeps(&rec), "record with matching conv_id should be kept");
}

/// 会话过滤：不匹配 conv_id 的记录必须丢弃
///
/// 数据构造（含关键数值的推导过程）：
///   record.conv_id = "cnv_abc"
///   filter.conv    = "cnv_other"
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 构造带 cnv_abc span 的 sample_record
///   2. 用 cnv_other 调用 keeps()
///
/// 预期结果：
///   - 断言 A：keeps 返回 false
#[test]
fn filter_rejects_other_conv() {
    let rec = sample_record();
    let f = Filter {
        since: None,
        conv: Some("cnv_other".to_string()),
        min_level: 0,
        grep: None,
    };
    assert!(
        !f.keeps(&rec),
        "record with different conv_id should be rejected"
    );
}

/// grep 过滤：只匹配 message 字段
///
/// 数据构造（含关键数值的推导过程）：
///   record.message = "agent_spawn"
///   positive grep  = "spawn"
///   negative grep  = "nonexistent"
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 用 spawn 正则调用 keeps()
///   2. 用 nonexistent 正则调用 keeps()
///
/// 预期结果：
///   - 断言 A：spawn 命中并保留
///   - 断言 B：nonexistent 未命中并丢弃
#[test]
fn filter_applies_grep_to_message() {
    let rec = sample_record();
    let f = Filter {
        since: None,
        conv: None,
        min_level: 0,
        grep: Some(Regex::new("spawn").unwrap()),
    };
    assert!(
        f.keeps(&rec),
        "grep pattern matching message agent_spawn should keep record"
    );
    let f2 = Filter {
        since: None,
        conv: None,
        min_level: 0,
        grep: Some(Regex::new("nonexistent").unwrap()),
    };
    assert!(
        !f2.keeps(&rec),
        "grep pattern absent from message agent_spawn should reject record"
    );
}

/// Release logs tail：app NDJSON 应转换成人类可读文本
///
/// 数据构造（含关键数值的推导过程）：
///   log_lines = 1 条 INFO agent_spawn synthetic NDJSON
///   tail      = 10，10 > 1，因此应该返回这 1 条
///   level     = trace，trace 低于 INFO，因此不过滤该记录
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 在临时 log_dir 写入当天 serve.log
///   2. 调用 formatted_tail_lines(log_dir, 10, "trace")
///   3. 渲染器输出人类格式而不是 JSON
///
/// 预期结果：
///   - 断言 A：包含秒级时间戳
///   - 断言 B：包含 INFO 级别
///   - 断言 C：包含 target、conv_id、message、fields
///   - 断言 D：不以 `{` 开头
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

/// Release logs stream：低于 websocket level 的行应被过滤
///
/// 数据构造（含关键数值的推导过程）：
///   info.level = INFO
///   warn.level = WARN
///   filter     = warn，INFO(2) < WARN(3)，WARN(3) >= WARN(3)
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 用 warn 阈值格式化 INFO http_request
///   2. 用 warn 阈值格式化 WARN http_error
///
/// 预期结果：
///   - 断言 A：INFO 行返回 None
///   - 断言 B：WARN 行返回格式化文本
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

/// HTTP 错误人类格式：span 中的 method/path 必须显示在 message 后面
///
/// 数据构造（含关键数值的推导过程）：
///   timestamp = 2026-05-24T10:00:01Z（固定时间，便于断言渲染前缀）
///   level     = WARN（401 认证失败默认应在 info serve 日志中可见）
///   span      = { method: "GET", path: "/api/v1/agents" }（http_trace span 字段）
///   fields    = { message: "http_error", status: 401, dur_ms: 0 }
///
/// 执行过程（逐步说明系统如何处理）：
///   1. LogRecord::from_line 解析 synthetic NDJSON
///   2. Renderer 走人类格式分支，不走 --json 原样输出
///   3. 渲染器从 span 读取 method/path，并把它们放在 status/dur_ms 前面
///
/// 预期结果：
///   - 断言 A：输出包含 `http_error GET /api/v1/agents status=401`
///   - 断言 B：输出不再是旧的 `http_error status=401` 紧邻格式
///   - 断言 C：输出不是 JSON，说明只改变人类可读格式而非 NDJSON envelope
#[test]
fn http_error_human_format_includes_method_and_path_from_span() {
    let line = r#"{"timestamp":"2026-05-24T10:00:01Z","level":"WARN","target":"msctl::serve::http_trace","fields":{"message":"http_error","status":401,"dur_ms":0},"span":{"name":"http_request","request_id":"req_1","method":"GET","path":"/api/v1/agents"}}"#;
    let rec = LogRecord::from_line(line).expect("synthetic http_error log should parse");
    let renderer = Renderer {
        json: false,
        color: false,
        prefix: false,
    };

    let rendered = renderer
        .render_to_string(line, &rec)
        .expect("http_error should render as human-readable text");

    assert!(
        rendered.contains("http_error GET /api/v1/agents status=401"),
        "http_error line should show method/path before fields, got: {rendered}"
    );
    assert!(
        !rendered.contains("http_error status=401"),
        "old http_error format without method/path should not remain, got: {rendered}"
    );
    assert!(
        !rendered.trim_start().starts_with('{'),
        "human-readable http_error output must not become raw JSON, got: {rendered}"
    );
}
