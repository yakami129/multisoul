# CLI Tracing + `msctl logs` 子命令设计

> 来源：[`docs/quality/SPEC-harness-roadmap.md`](../quality/SPEC-harness-roadmap.md) §2.1
> 本文通过采访模式定稿，用于指导实现。

## 1. 背景与目标

### 1.1 背景

- `msctl serve` 是后台常驻进程，Agent 的复杂行为（session_worker、ask_question 阻塞、推送重试）发生在异步任务里
- 当前诊断全靠 `eprintln!("[runtime] ...")` 等字符串输出到 stderr，使用 launchd/systemd 跑时没有地方留痕；用户报问题时无法让他拷贝完整日志
- Harness 第三支柱"反馈循环"要求 Agent 能自己复现 bug + 查日志，不依赖人工转述

### 1.2 目标

- 为 `msctl serve` 添加结构化日志，所有关键事件写入本地文件
- 加 `msctl logs` 子命令，提供 `tail / follow / since / conv / level / json / grep` 多维查询
- 为后续更多 Harness 工作（record/replay、doc-gardening 的崩溃 alert）提供统一观察层

### 1.3 非目标

- 跨机器日志收集（本地工具，非分布式）
- 远程日志采集器（Loki / ELK）对接 — 通过 NDJSON 文件，用户可自行接入
- Mobile 端日志（独立条目 §2.3）

## 2. 技术选型

| 维度 | 决定 | 备选被排除的原因 |
|------|------|------------------|
| 日志库 | `tracing` + `tracing-subscriber` + `tracing-appender` | `log+env_logger`：无 span 语义，conv_id 贯穿难；手写：要自管 rotation/filter |
| 输出格式 | NDJSON (JSON Lines) + subscriber `json()` layer | 纯文本：难机器解析；双轨：两倍消耗换少量便利 |
| 存储位置 | `~/.cache/msctl/serve.log.YYYY-MM-DD`（XDG cache） | `~/.config/msctl/logs/`：配置与运行时数据混合；`~/.local/state`：XDG state 较新标准，Linux 默认未创建，降低可发现性 |
| 轮转策略 | 按天（`tracing-appender::rolling::daily`），保留 7 天 | 按大小：冷启动后切片对齐排查不自然；不轮转：磁盘膨胀 |
| 级别控制 | 只暴露 `--log-level <info\|debug\|warn\|error>` flag | `RUST_LOG` env：对非 Rust 用户不直观 |
| 输出路径查询 | 固定到 cache dir（XDG），不接受 `--log-dir` flag | 增加配置面即增加测试面，本期先简化 |

## 3. 日志数据契约（NDJSON 字段）

每条日志是一个 JSON 对象。通用字段：

```json
{
  "timestamp": "2026-05-02T11:32:14.552Z",
  "level": "INFO",
  "target": "msctl::serve::runtime::claude",
  "message": "agent_spawn ok",
  "fields": {
    "conv_id": "cnv_abc123",
    "agent_id": "ag_xyz456",
    "pid": 84221
  },
  "span": {
    "name": "session_worker",
    "conv_id": "cnv_abc123"
  }
}
```

约定：

- `timestamp`：UTC RFC3339，毫秒精度
- `level`：TRACE / DEBUG / INFO / WARN / ERROR
- `target`：Rust 模块路径（tracing 默认）
- `message`：事件短名（snake_case，如 `agent_spawn`、`ws_connect`、`ask_question_pending`）
- `fields`：本次事件的结构化键值
- `span`：所在 span 的名字 + 透传字段（conv_id / request_id / agent_id）

### 3.1 必记事件

| event `message` | level | 必带字段 | 可选字段 |
|-----------------|-------|---------|---------|
| `http_request` | INFO | method, path, status, dur_ms, request_id | ip, user_agent |
| `http_error` | WARN/ERROR | method, path, status, dur_ms, request_id | error |
| `ws_connect` | INFO | conv_id, request_id | remote |
| `ws_disconnect` | INFO | conv_id, reason | dur_s |
| `ws_error` | WARN | conv_id, error | |
| `agent_spawn` | INFO | conv_id, agent_id, runtime, pid, cmd | resume_session_id |
| `agent_exit` | INFO/ERROR | conv_id, pid, exit_code | stderr_tail (前 500 字符) |
| `agent_respawn` | WARN | conv_id, attempt, reason | |
| `turn_start` | INFO | conv_id, user_text_len | |
| `turn_end` | INFO | conv_id, status, tool_calls, dur_ms | |
| `ask_question_pending` | INFO | conv_id, ask_id, options_count | |
| `ask_question_answered` | INFO | conv_id, ask_id, wait_ms | choice_id |
| `push_send` | INFO | token_hash, expo_id | |
| `push_failed` | WARN | token_hash, error_type | response_body_trunc |
| `db_slow_query` | WARN | query_kind, dur_ms | rows |

### 3.2 脱敏规则（`redact` helpers）

| 字段类别 | 处理 |
|---------|------|
| `Bearer <token>` / `api_key` | `<redacted>` |
| `push_token` 字面量 | `<sha256-8>` 前 8 位哈希，便于跨事件关联但不可反查 |
| `user_text` / `message` 内容 | 前 200 字符；超出用 `…[+N chars]` 标注 |
| `tool_args` JSON | 结构保留；string value 超 100 字符截断 |
| `stderr` 尾巴（agent crash） | 前 500 字符 |

## 4. Span 结构

两层 span 策略，参考 OpenTelemetry 通用做法：

```
 ┌─ HTTP 请求进入 ─────────────────────────────────┐
 │   http_request span (request_id, method, path)  │
 │                                                  │
 │   [tracing::info! 跨多层 handler 自动继承]       │
 │                                                  │
 │   若 handler 触发 runtime → 通过 conv_id 字段桥接 │
 └──────────────────────────────────────────────────┘

 ┌─ session_worker spawn（一次会话持续存在）─────────┐
 │   session_worker span (conv_id, agent_id)        │
 │                                                  │
 │   所有 agent_spawn / turn_start/end /            │
 │   ask_question_pending 等事件自动带 conv_id      │
 └──────────────────────────────────────────────────┘
```

实现上：

- HTTP 用 `tower_http::trace::TraceLayer` + 自定义 span builder 注入 `request_id = uuid::v4()`
- `session_worker` 函数入口：`let _span = tracing::info_span!("session_worker", conv_id, agent_id).entered();`
- `info_span!` 会让函数体内所有 tracing 调用自动带上 span 字段

## 5. `msctl logs` CLI

```
msctl logs [options]

Options:
  --tail <N>           只看最后 N 条（默认 50）
  -f, --follow         实时 tail，类 tail -f；支持 rotation 切换
  --since <duration>   最近 N 分/时/天（5m / 2h / 1d）
  --conv <conv_id>     按 conversation 过滤
  --level <level>      最低级别（trace/debug/info/warn/error）
  --json               直接输出 NDJSON（方便 jq 管道）
  --grep <regex>       对 message 字段正则过滤
```

行为：

- **不带参数** → `--tail 50` + 渲染为彩色人类可读格式
- **人类可读格式**：`2026-05-02T11:32:14 INFO  [session_worker conv=cnv_ab12] agent_spawn pid=84221 runtime=claude`
  - 时间戳截断到秒
  - level 用 ANSI 色：ERROR 红 / WARN 黄 / INFO 绿 / DEBUG 灰
  - 当 stdout 非 tty 时自动关彩色（`is-terminal` crate 或 `std::io::IsTerminal`）
- **rotation handle**（`--follow`）：每隔 1s 检查当日文件是否变更；跨日切换时自动切文件句柄
- **性能**：NDJSON 按行 streaming 解析，不全部载入内存；`--grep` 在 `message` 字段上，不扫描 `fields` 内容

## 6. 初始化与生命周期

### 6.1 subscriber 初始化

在 `msctl serve handle()` 开头：

```rust
let guard = logging::init_subscriber(logging::Config {
    log_dir: msctl_cache_dir()?,  // ~/.cache/msctl
    level: args.log_level.unwrap_or(LevelFilter::INFO),
    mode: logging::Mode::File,    // 生产：只写文件
})?;
```

返回 `WorkerGuard` 必须持有到进程退出，否则 `tracing-appender` 的 non-blocking writer 丢数据。

### 6.2 测试模式

`logging::init_subscriber_for_test()`：输出到 stderr，`cargo test` 自动捕获，不落盘。`#[cfg(test)]` 门控。

### 6.3 msctl logs 模式

`msctl logs` 不初始化 subscriber；直接以 reader 身份打开日志文件。

### 6.4 banner 与命令行反馈

保留 `println!` 的场景：

- `commands/serve.rs`：Bearer token、QR 码、"Or paste: ..."、Tailscale funnel 状态
- `commands/auth.rs` / `commands/agent.rs` / `commands/daemon.rs`：用户命令的回显结果
- `serve/mod.rs::run_server` 的 `Listening on http://...`（开机必见，不适合藏日志文件）

**替换 `println!` / `eprintln!` 的场景**（全部在 `cli/src/serve/**/*.rs`）：

- `serve/runtime/claude.rs`（24 处）
- `serve/runtime/codex.rs`（19 处）
- `serve/push.rs`（7 处）
- `serve/state.rs`（3 处）
- `serve/routes/ws.rs`（1 处）

## 7. 边界与错误

| 场景 | 行为 |
|------|------|
| 日志目录创建失败 | 继续运行，subscriber 退化为 stderr；打印一次 WARN 到 stderr |
| 磁盘满 | `tracing-appender` 丢弃写入；不影响主流程 |
| `msctl logs` 时日志文件不存在（serve 从未启动过） | 打印 `no logs yet — run 'msctl serve' to generate` 并 exit 0 |
| `--follow` 时跨日轮转 | 每 1s 轮询文件名；切换时无缝继续 |
| `--grep` 正则错误 | 打印 regex 错误 + exit 2 |
| 多个 `msctl serve` 并行（不同端口） | 共享同一日志文件；通过 pid 字段区分 |

## 8. 验收标准（端到端）

四个故事必须全部可以在 5 秒内通过 `msctl logs` 定位问题：

### 8.1 Agent 在 ask_question 卡住

用户：复现 — 发消息触发 AskQuestion，不回答。

```
$ msctl logs --conv cnv_abc --level warn+
(无输出 — 期望)

$ msctl logs --conv cnv_abc --tail 10
2026-05-02T11:30:22 INFO  ask_question_pending ask_id=aq1 options_count=3
```

看到 `ask_question_pending` 且之后无 `ask_question_answered` → 立即知道卡在等答案。

### 8.2 手机 App 401

```
$ msctl logs --level warn+ --tail 10
2026-05-02T11:31:05 WARN  http_error method=GET path=/api/v1/healthz status=401 ip=100.64.1.2
```

看到 401 路径 + 来源 IP，立即知道是 token 错误或未带。

### 8.3 推送未送达

```
$ msctl logs --grep 'push_' --tail 20
2026-05-02T11:32:14 INFO  push_send   token_hash=a4f3e2c1 expo_id=AbC
2026-05-02T11:32:15 WARN  push_failed token_hash=a4f3e2c1 error_type=DeviceNotRegistered
```

直接看到 Expo 回的 `DeviceNotRegistered`。

### 8.4 Agent 进程崩溃

```
$ msctl logs --since 10m --grep 'agent_' --tail 20
2026-05-02T11:33:01 INFO  agent_spawn   conv_id=cnv_abc pid=84221 runtime=claude
2026-05-02T11:33:45 ERROR agent_exit    conv_id=cnv_abc pid=84221 exit_code=137 stderr_tail="..."
2026-05-02T11:33:46 WARN  agent_respawn conv_id=cnv_abc attempt=1 reason=exit_code_137
```

exit_code + stderr 尾巴 + 重试次数齐全。

## 9. 依赖

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json", "fmt"] }
tracing-appender = "0.2"
```

## 10. 实现拆分

**commit A**（本 SPEC 的实现）：

1. Cargo.toml 加依赖
2. `cli/src/logging.rs` — init/redact/span 工具
3. `cli/src/commands/logs.rs` — logs 子命令
4. `cli/src/main.rs` — Commands::Logs 分支 + serve 时 init subscriber
5. `cli/src/serve/**/*.rs` — 替换 `eprintln!` 为 `tracing::{info,warn,error}!` + 关键函数加 `#[instrument]` 或 span
6. `cli/tests/logs_smoke.rs` — 至少 2 个冒烟测试
7. `docs/runbooks/debugging.md` — 4 故事的逐条命令
8. AGENTS.md §4 地图里补一行指向 debugging.md

## 11. 不做的事（保留未来）

- `--log-dir` 自定义路径（固定到 XDG cache，简化测试面）
- `RUST_LOG` env 读取（只用 flag）
- 跨进程/远端日志聚合
- OpenTelemetry OTLP 导出（NDJSON 已经提供了最重要的机器可读性，OTLP 留给有真实分布式需求再做）
- 日志级别运行时动态调整（重启 serve 才能切级别）
