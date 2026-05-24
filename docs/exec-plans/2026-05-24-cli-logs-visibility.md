# CLI Logs Visibility Implementation Plan

## 1. 目标

按 [`docs/product-specs/SPEC-cli-logs-visibility.md`](../product-specs/SPEC-cli-logs-visibility.md) 收敛 `msctl logs` 默认可见性：

- `http_request` 成功响应继续保持 DEBUG，避免默认 `msctl logs -f` 被轮询刷屏。
- `http_error` 的人类格式显示 HTTP method + path，便于直接判断 401/5xx 来自哪个接口。
- `msctl serve` 启动时写入脱敏的 `serve_startup` app 事件，包含 bind address、pair URL host、token 前 12 字符前缀。
- runbook 与新默认可见性对齐。

## 2. 约束

- 写代码前先补失败测试。
- 不改 `~/.config/msctl/*` 用户本地数据；测试只用 synthetic log line 和纯函数。
- `cli/src/**` 单文件不超过 500 行；`logs_app.rs` 已接近上限，新增测试放入已存在的外置测试模块。
- 不使用 `#[allow(...)]` 压制诊断。
- 改 CLI Rust 后运行 `cd cli && cargo test` 和 `cd cli && cargo build`。

## 3. 实施步骤

### Step 1: 测试先行

- 编译启用 `cli/src/commands/logs_tests.rs` 外置测试模块。
- 新增 `http_error` 人类格式测试：
  - 构造 span 内含 `method=GET`、`path=/api/v1/agents` 的 WARN NDJSON。
  - 断言输出包含 `http_error GET /api/v1/agents status=401`。
  - 断言输出不退化为缺少 method/path 的旧格式。
- 新增 `serve_startup` 脱敏 helper 测试：
  - 断言 token prefix 正好为前 12 字符 + `...`。
  - 断言 prefix 不等于完整 token、不包含 token 尾部。
  - 断言 pair URL host 能从 URL 中解析出来。

### Step 2: 实现人类格式

- 在 `cli/src/commands/logs_app.rs` 渲染 extras 前，从 `span` 读取 `method` 与 `path`。
- 仅对 `message == "http_error"` 前置输出 `METHOD PATH`；`--json` 原始 NDJSON 不变。
- 保持现有 fields extras 输出顺序和 conv_id 显示逻辑。

### Step 3: 实现 serve_startup

- 在 `cli/src/commands/serve.rs` 增加小型脱敏/解析 helper：
  - `token_prefix(token)` 返回前 12 字符 + `...`。
  - `pair_url_host(base_url)` 返回 pair URL host；解析失败时回退为 base URL 字符串。
- 在 `base_url` 计算后、打印完整 token 到 service stdout 前，写 `tracing::info!`：
  - `bind_addr`
  - `pair_url_host`
  - `token_prefix`
  - message `serve_startup`
- 不把完整 token 写入 app 日志。

### Step 4: 文档与索引

- 将 `SPEC-cli-logs-visibility.md` 加入 `docs/product-specs/index.json`。
- 将本计划加入 `docs/exec-plans/index.json`。
- 更新 `docs/runbooks/debugging.md`：
  - 常用参数补 `--source app --level debug --conv <id>`。
  - 401 示例改为人类格式中的 `GET /path`。
  - Agent 崩溃场景改为 service stderr 事实，不再暗示本次不做的 `agent_exit`。

### Step 5: 验证

- `python3 scripts/check-docs-indices.py`
- `cd cli && cargo test`
- `cd cli && cargo build`

## 4. 验收映射

| SPEC 验收 | 验证方式 |
|-----------|----------|
| 默认 info 下无成功 `http_request`，错误可见 | 既有 `http_trace` 单元测试 |
| `http_error` 人类行含 `GET /path` | 新增 `logs_tests` 单元测试 |
| `serve_startup` 有脱敏 token prefix，无完整 token | 新增 `serve.rs` 单元测试 |
| Claude/plugin stderr 仅 service | runbook 更新，代码不改 stderr inherit |
| `--json` NDJSON 兼容 | 渲染改动只走人类格式分支 |
