fn args_for(
    server: &mockito::ServerGuard,
    ask_id: Option<&str>,
    conversation_id: &str,
    output: OutputFormat,
) -> AskQuestionArgs {
    let address = server.socket_address();
    AskQuestionArgs {
        ask_id: ask_id.map(str::to_string),
        questions: r#"[{"id":"0","text":"Deploy?","options":[{"id":"0","label":"Yes"}]}]"#
            .to_string(),
        conversation_id: conversation_id.to_string(),
        output,
        token: Some("test-token".to_string()),
        port: Some(address.port()),
        host: address.ip().to_string(),
    }
}

/// Explicit `--token` values are trimmed before being sent as Bearer auth.
///
/// 数据构造（含关键数值的推导过程）：
///   token input      = "  test-token  "，前后各 2 个空格
///   expected header  = Bearer test-token，trim 后无空格
///
/// 执行过程（逐步说明系统如何处理）：
///   1. mockito 注册 POST /api/v1/ask-question，要求 Authorization: Bearer test-token
///   2. run(args) 使用带空格的 explicit token，不读取本地 config
///   3. run(args) resolve token 后发送 Bearer auth
///
/// 预期结果：
///   - 断言 A：run 成功，说明 trimmed token 通过 mock header 匹配
///   - 断言 B：mock 被命中，说明请求实际使用 trim 后 header
#[test]
fn run_trims_explicit_token_before_bearer_auth() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/api/v1/ask-question")
        .match_header("authorization", "Bearer test-token")
        .with_status(200)
        .with_body(r#"{"ask_id":"ask-token-trim","status":"pending"}"#)
        .create();
    let mut args = args_for(
        &server,
        Some("ask-token-trim"),
        "conv-token-trim",
        OutputFormat::Text,
    );
    args.token = Some("  test-token  ".to_string());

    let output = run(args).expect("trimmed explicit token should authenticate successfully");

    assert_eq!(
        output, "ask-token-trim pending",
        "trimmed token request should return text output from mock server"
    );
    mock.assert();
}

/// JSON output mode posts the authenticated ask payload and returns semantic server JSON.
///
/// 数据构造（含关键数值的推导过程）：
///   ask_id          = ask-http-json
///   conversation_id = conv-http-json
///   token           = test-token，避免触发真实 ms_v2_* token 检测
///
/// 执行过程（逐步说明系统如何处理）：
///   1. mockito 注册 POST /api/v1/ask-question，要求 Authorization: Bearer test-token
///   2. run(args) 使用 --token/--port/--host 直连 mock server，避免读取本地 config
///   3. server 返回带空格的 JSON，run(args) 输出 compact JSON string
///
/// 预期结果：
///   - 断言 A：ask_id/status 字段语义正确，说明不依赖 JSON object key order
///   - 断言 B：输出不含换行，说明 run 返回精确 output string
///   - 断言 C：mock 被命中，说明发送了符合路径、auth、body 的 HTTP 请求
#[test]
fn run_json_output_posts_authenticated_payload_and_returns_compact_json() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/api/v1/ask-question")
        .match_header("authorization", "Bearer test-token")
        .match_body(Matcher::Json(json!({
            "ask_id": "ask-http-json",
            "conversation_id": "conv-http-json",
            "questions": [{
                "id": "0",
                "text": "Deploy?",
                "options": [{"id": "0", "label": "Yes"}]
            }]
        })))
        .with_status(200)
        .with_body(r#"{ "status": "pending", "ask_id": "ask-http-json" }"#)
        .create();

    let output = run(args_for(
        &server,
        Some("ask-http-json"),
        "conv-http-json",
        OutputFormat::Json,
    ))
    .expect("json output run should succeed against mock server");
    let rendered: serde_json::Value =
        serde_json::from_str(&output).expect("json output should parse as JSON");

    assert_eq!(
        rendered["ask_id"], "ask-http-json",
        "json output should preserve ask_id regardless of object key order"
    );
    assert_eq!(
        rendered["status"], "pending",
        "json output should preserve status regardless of object key order"
    );
    assert!(
        !output.contains('\n'),
        "run should return one exact output string without embedded newlines"
    );
    mock.assert();
}

/// Text output mode posts the same ask payload but renders `ask_id status`.
///
/// 数据构造（含关键数值的推导过程）：
///   ask_id          = ask-http-text
///   conversation_id = conv-http-text
///   output mode     = text，期望从 server JSON 中提取 2 个字段
///
/// 执行过程（逐步说明系统如何处理）：
///   1. mockito 注册 POST /api/v1/ask-question 并校验 Bearer token
///   2. run(args) 发送 JSON body 到 mock server
///   3. server 返回 {"ask_id":"ask-http-text","status":"pending"}
///   4. run(args) 将 JSON response 渲染为 text 模式输出
///
/// 预期结果：
///   - 断言 A：输出等于 ask-http-text pending，说明 text 模式字段顺序稳定
///   - 断言 B：输出不以 "{" 开头，说明 text 模式没有泄漏 raw JSON
///   - 断言 C：mock 被命中，说明 text 模式也执行了 HTTP POST
#[test]
fn run_text_output_returns_ask_id_status() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/api/v1/ask-question")
        .match_header("authorization", "Bearer test-token")
        .match_body(Matcher::Json(json!({
            "ask_id": "ask-http-text",
            "conversation_id": "conv-http-text",
            "questions": [{
                "id": "0",
                "text": "Deploy?",
                "options": [{"id": "0", "label": "Yes"}]
            }]
        })))
        .with_status(200)
        .with_body(r#"{"ask_id":"ask-http-text","status":"pending"}"#)
        .create();

    let output = run(args_for(
        &server,
        Some("ask-http-text"),
        "conv-http-text",
        OutputFormat::Text,
    ))
    .expect("text output run should succeed against mock server");

    assert_eq!(
        output, "ask-http-text pending",
        "text output should render exactly `ask_id status`"
    );
    assert!(
        !output.starts_with('{'),
        "text output must not return raw JSON, got: {output}"
    );
    mock.assert();
}

/// Non-2xx HTTP responses surface both the HTTP status and server body.
///
/// 数据构造（含关键数值的推导过程）：
///   server status   = 409 Conflict，代表 ask_id 已经 pending
///   server body     = {"error":"ask_already_pending"}，用于定位服务端拒绝原因
///
/// 执行过程（逐步说明系统如何处理）：
///   1. mockito 注册 POST /api/v1/ask-question 并返回 409
///   2. run(args) 发送 authenticated POST
///   3. run(args) 读取 response body
///   4. run(args) 返回 anyhow error，包含 HTTP status 和原始 body
///
/// 预期结果：
///   - 断言 A：返回 Err，说明 non-2xx 不会被当作成功输出
///   - 断言 B：错误包含 409 Conflict，说明调用方能看到 HTTP status
///   - 断言 C：错误包含 ask_already_pending，说明服务端 body 未丢失
///   - 断言 D：mock 被命中，说明错误来自 HTTP 响应而不是本地校验
#[test]
fn run_non_success_response_returns_status_and_body_error() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/api/v1/ask-question")
        .match_header("authorization", "Bearer test-token")
        .match_body(Matcher::Json(json!({
            "ask_id": "ask-http-conflict",
            "conversation_id": "conv-http-conflict",
            "questions": [{
                "id": "0",
                "text": "Deploy?",
                "options": [{"id": "0", "label": "Yes"}]
            }]
        })))
        .with_status(409)
        .with_body(r#"{"error":"ask_already_pending"}"#)
        .create();

    let err = run(args_for(
        &server,
        Some("ask-http-conflict"),
        "conv-http-conflict",
        OutputFormat::Json,
    ))
    .expect_err("non-2xx response should return an anyhow error");
    let message = err.to_string();

    assert!(
        message.contains("409 Conflict"),
        "error should include the HTTP status, got: {message}"
    );
    assert!(
        message.contains("ask_already_pending"),
        "error should include the server response body, got: {message}"
    );
    mock.assert();
}

/// When `--ask-id` is omitted, the CLI generates a UUID and posts it to serve.
///
/// 数据构造（含关键数值的推导过程）：
///   ask_id input      = None，触发 CLI 侧 UUID 生成
///   conversation_id   = conv-auto-id
///
/// 执行过程（逐步说明系统如何处理）：
///   1. resolve_ask_id(None) 生成 UUID v4
///   2. run(args) POST 到 mock server，body 含生成的 ask_id
///   3. server 返回 pending JSON，run 输出 compact JSON
///
/// 预期结果：
///   - 断言 A：输出 ask_id 为合法 UUID
///   - 断言 B：status == pending
///   - 断言 C：mock 被命中，说明 HTTP 请求已发出
#[test]
fn run_without_ask_id_generates_uuid_and_posts_it() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/api/v1/ask-question")
        .match_header("authorization", "Bearer test-token")
        .match_body(Matcher::Regex(
            r#""ask_id":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}""#
                .to_string(),
        ))
        .with_status(200)
        .with_body(r#"{"status":"pending","ask_id":"ask-auto-id"}"#)
        .create();

    let output = run(args_for(
        &server,
        None,
        "conv-auto-id",
        OutputFormat::Json,
    ))
    .expect("run without ask_id should succeed against mock server");
    let rendered: serde_json::Value =
        serde_json::from_str(&output).expect("json output should parse as JSON");

    assert_eq!(
        rendered["status"], "pending",
        "auto-generated ask_id request should return pending status"
    );
    assert_eq!(
        rendered["ask_id"], "ask-auto-id",
        "json output should preserve server ask_id from response body"
    );
    mock.assert();
}

/// resolve_ask_id preserves explicit non-empty ids and trims whitespace.
#[test]
fn resolve_ask_id_uses_explicit_non_empty_value() {
    assert_eq!(
        resolve_ask_id(Some("  call-1  ".to_string())),
        "call-1",
        "explicit ask_id should be trimmed and preserved"
    );
}

/// resolve_ask_id generates a UUID when the flag is omitted.
#[test]
fn resolve_ask_id_generates_uuid_when_missing() {
    let id = resolve_ask_id(None);
    assert!(
        Uuid::parse_str(&id).is_ok(),
        "missing ask_id should generate a UUID v4, got: {id}"
    );
}

/// resolve_ask_id generates a UUID when the flag is blank.
#[test]
fn resolve_ask_id_generates_uuid_when_empty() {
    let id = resolve_ask_id(Some("   ".to_string()));
    assert!(
        Uuid::parse_str(&id).is_ok(),
        "blank ask_id should generate a UUID v4, got: {id}"
    );
}
