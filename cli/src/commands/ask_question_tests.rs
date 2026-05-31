use super::*;
use mockito::Matcher;
use serde_json::json;

/// `--questions` rejects object JSON because the command contract requires an array.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = {"id":"0"}，顶层类型为 object
///   expected length = 0，因为 object 不能被当作 questions array
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 解析 JSON 后检查顶层类型
///   3. 顶层不是 array，返回错误并停止 HTTP 调用前流程
///
/// 预期结果：
///   - 断言 A：返回 Err，说明 object JSON 被拒绝
///   - 断言 B：错误包含 questions，说明用户能定位到参数名
///   - 断言 C：错误包含 array，说明用户知道必须传数组
#[test]
fn parse_questions_rejects_non_array_json() {
    let err = parse_questions(r#"{"id":"0"}"#)
        .expect_err("object JSON should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("questions"),
        "error should mention the --questions argument, got: {message}"
    );
    assert!(
        message.contains("array"),
        "error should explain that --questions must be an array, got: {message}"
    );
}

/// `--questions` accepts a normal options question and preserves option labels exactly.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = one question array
///   questions len   = 1，因为数组里只有一个 question object
///   option label    = "B"，用于确认嵌套 option 未被改写
///   fake id "9"     = 0 occurrences，输入中没有该值，parser 不应补造
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 解析 JSON 并确认顶层是非空 array
///   3. parser 校验 id/text/options/options[].id/options[].label 形状
///   4. parser 原样返回数组元素给 HTTP request body
///
/// 预期结果：
///   - 断言 A：len == 1，说明只保留输入中的一个 question
///   - 断言 B：options[1].label == B，说明 option label 被保留
///   - 断言 C：question.id != 9，说明 parser 没有生成假 id
#[test]
fn parse_questions_accepts_non_empty_array() {
    let questions = parse_questions(
        r#"[{"id":"0","text":"Pick one","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}]}]"#,
    )
    .expect("valid non-empty questions array should be accepted");

    assert_eq!(
        questions.len(),
        1,
        "parser should preserve the single input question without adding entries"
    );
    assert_eq!(
        questions[0]["options"][1]["label"], "B",
        "parser should preserve option label B exactly"
    );
    assert_ne!(
        questions[0]["id"], "9",
        "parser must not synthesize a fake question id 9"
    );
}

/// `--questions` accepts a freeform/text-style question with an empty options array.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = one question object with id/text/options
///   options len     = 0，因为 fill-in use cases do not require predefined options
///   questions len   = 1，满足最小 question 数量
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 确认 question 是 object 且 id/text 为非空 string
///   3. parser 确认 options 是 array
///   4. parser 允许 options len == 0 并返回原始 question
///
/// 预期结果：
///   - 断言 A：question 被接受，说明 empty options 支持 freeform/text-style 问题
///   - 断言 B：options len == 0，说明 parser 没有补造默认选项
#[test]
fn parse_questions_accepts_empty_options_array_for_freeform_question() {
    let questions = parse_questions(r#"[{"id":"0","text":"Why?","options":[]}]"#)
        .expect("question with valid id/text and empty options array should be accepted");

    assert_eq!(
        questions.len(),
        1,
        "parser should preserve the single freeform-style question"
    );
    assert_eq!(
        questions[0]["options"].as_array().map(Vec::len),
        Some(0),
        "parser should preserve empty options array without adding defaults"
    );
}

/// `--questions` rejects an empty array because no card can be rendered from it.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = []，顶层类型为 array
///   questions len   = 0，低于最小可提交数量 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions("[]")
///   2. parser 解析 JSON 并确认顶层是 array
///   3. parser 检查 len == 0，返回错误并停止 HTTP 调用前流程
///
/// 预期结果：
///   - 断言 A：返回 Err，说明空数组被拒绝
///   - 断言 B：错误包含 non-empty，说明用户知道至少需要一个问题
#[test]
fn parse_questions_rejects_empty_array() {
    let err = parse_questions("[]")
        .expect_err("empty questions array should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("non-empty"),
        "error should explain that --questions must be non-empty, got: {message}"
    );
}

/// `--questions` rejects null entries because every item must be a renderable question object.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = [null]，顶层 array len = 1
///   question[0]     = null，缺少 object shape
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions("[null]")
///   2. parser 确认顶层是非空 array
///   3. parser 检查第 0 个 question 类型，发现不是 object
///
/// 预期结果：
///   - 断言 A：返回 Err，说明 null question 被拒绝
///   - 断言 B：错误包含 question object，说明用户知道 array item 必须是对象
#[test]
fn parse_questions_rejects_null_question_object() {
    let err = parse_questions("[null]")
        .expect_err("null question should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("question object"),
        "error should mention question object, got: {message}"
    );
}

/// `--questions` rejects questions missing non-empty text.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = [{"id":"0","options":[]}]
///   id              = "0"，满足 id requirement
///   text            = missing，无法渲染 question prompt
///   options len     = 0，本身允许，因此失败应来自 text
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 确认 question 是 object 且 id 有效
///   3. parser 检查 text 字段，发现缺失
///
/// 预期结果：
///   - 断言 A：返回 Err，说明缺少 text 的 question 被拒绝
///   - 断言 B：错误包含 text，说明用户能定位缺失字段
#[test]
fn parse_questions_rejects_missing_text() {
    let err = parse_questions(r#"[{"id":"0","options":[]}]"#)
        .expect_err("question missing text should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("text"),
        "error should mention missing/invalid text, got: {message}"
    );
}

/// `--questions` rejects malformed options because mobile expects an array field.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = [{"id":"0","text":"Pick","options":{}}]
///   id/text         = valid non-empty strings
///   options         = object，类型不满足 options array contract
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 确认 question 是 object 且 id/text 有效
///   3. parser 检查 options 类型，发现不是 array
///
/// 预期结果：
///   - 断言 A：返回 Err，说明 malformed options 被拒绝
///   - 断言 B：错误包含 options，说明用户能定位字段
#[test]
fn parse_questions_rejects_malformed_options() {
    let err = parse_questions(r#"[{"id":"0","text":"Pick","options":{}}]"#)
        .expect_err("question options object should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("options"),
        "error should mention options, got: {message}"
    );
}

/// `--questions` rejects options with missing or empty labels.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = one question with one option
///   option.id       = "0"，满足 id requirement
///   option.label    = ""，低于最小非空 string 长度 1
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 校验 question id/text/options
///   3. parser 校验 option[0].label，发现为空 string
///
/// 预期结果：
///   - 断言 A：返回 Err，说明空 label 被拒绝
///   - 断言 B：错误包含 label，说明用户能定位 option label 字段
#[test]
fn parse_questions_rejects_option_missing_or_empty_label() {
    let err = parse_questions(r#"[{"id":"0","text":"Pick","options":[{"id":"0","label":""}]}]"#)
        .expect_err("option with empty label should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("label"),
        "error should mention option label, got: {message}"
    );
}

/// `--questions` rejects non-boolean multi_select values.
///
/// 数据构造（含关键数值的推导过程）：
///   raw JSON        = one valid options question
///   multi_select    = "false"，string 类型，不是 boolean false
///   options len     = 1，确保失败来自 multi_select 类型
///
/// 执行过程（逐步说明系统如何处理）：
///   1. 调用 parse_questions(raw)
///   2. parser 校验 question id/text/options/option fields
///   3. parser 发现 multi_select 存在但类型为 string
///
/// 预期结果：
///   - 断言 A：返回 Err，说明 string multi_select 被拒绝
///   - 断言 B：错误包含 boolean，说明用户知道该字段必须是 boolean
#[test]
fn parse_questions_rejects_string_multi_select() {
    let err = parse_questions(
        r#"[{"id":"0","text":"Pick","multi_select":"false","options":[{"id":"0","label":"A"}]}]"#,
    )
    .expect_err("string multi_select should be rejected before HTTP is attempted");
    let message = err.to_string();

    assert!(
        message.contains("boolean"),
        "error should mention boolean multi_select requirement, got: {message}"
    );
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
        "ask-token-trim",
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
///   - 断言 B：输出不含换行，说明 run 返回精确输出字符串
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
        "ask-http-json",
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
        "ask-http-text",
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
        "ask-http-conflict",
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

fn args_for(
    server: &mockito::ServerGuard,
    ask_id: &str,
    conversation_id: &str,
    output: OutputFormat,
) -> AskQuestionArgs {
    let address = server.socket_address();
    AskQuestionArgs {
        ask_id: ask_id.to_string(),
        questions: r#"[{"id":"0","text":"Deploy?","options":[{"id":"0","label":"Yes"}]}]"#
            .to_string(),
        conversation_id: conversation_id.to_string(),
        output,
        token: Some("test-token".to_string()),
        port: Some(address.port()),
        host: address.ip().to_string(),
    }
}
