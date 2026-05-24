# CLI Logs 可见性 SPEC

> 来源：2026-05-24 采访模式定稿。与 [`SPEC-unified-cli-logs.md`](SPEC-unified-cli-logs.md)（命令入口、source 语义）互补；本文只定义**默认该看到什么**、**写哪条流**、**人类格式怎么渲染**。

## 1. 背景与目标

### 1.1 背景

`msctl logs` 已有 app（结构化 tracing）与 service（daemon stdout/stderr）双来源，但：

- 成功 HTTP 轮询曾刷屏（已通过 `http_request` → DEBUG 缓解）。
- 部分关键信息只在 service 或 DEBUG 层，用户不清楚默认 `-f` 该期待什么。
- 人类可读格式对 HTTP 错误缺少 `method`/`path`（它们在 span 里）。

### 1.2 目标

明确 **默认 `msctl logs` / `msctl logs -f`（`--source all`）** 下，三类核心排障场景应可见的事件与格式：

1. **Agent 卡住 / 无响应**
2. **手机连不上（认证、WS、HTTP）**
3. **推送 / 通知问题**

### 1.3 非目标（本次不做）

- `db_slow_query` 慢查询监控
- 独立 `ws_error` 事件（`ws_connect` / `ws_disconnect` + answer 丢弃事件已够）
- 远程日志采集 / 集中式日志平台
- 修改手机 Release logs WebSocket 协议（仍复用 CLI 人类格式）

---

## 2. 用户场景与命令默认值

| 场景 | 典型命令 | 期望 |
|------|----------|------|
| 日常 follow | `msctl logs -f` | `--source all`，app + service 同时 follow |
| Agent 排障 | `msctl logs --source app --conv <id> --tail 30` | 生命周期 + 问答 + turn |
| 连接问题 | `msctl logs --source app --level warn --tail 30` | HTTP 4xx/5xx 带 method+path |
| 推送 | `msctl logs --grep push_ --since 30m` | push_send / push_failed |
| Agent stderr | `msctl logs --source service --tail 50` | Claude/plugin 继承 stderr |
| Agent stdout 细节 | `msctl logs --source app --level debug --conv <id>` | claude_stdout_line 等 |

**刻意保持：** follow 时 service 仍 **tail 50 行历史**（含 QR/token 回放）。用户接受此 trade-off，换取 restart 后仍能看到最近 service 输出。

---

## 3. 可见性矩阵

### 3.1 默认 INFO — 必须在 app 日志可见

以下事件在 `msctl serve` 默认 `--log-level info` 下**必须落盘**，且 `msctl logs --source app` 默认可见（`--level` 默认 trace 即全部显示）。

#### Agent 生命周期

| message | 级别 | 必带字段 / 说明 |
|---------|------|-----------------|
| `session_worker_started` | INFO | conv_id（span） |
| `agent_spawn` | INFO | pid, resume, conv_id |
| `turn_start` | INFO | user_text_len, user_text_preview（截断 200） |
| `turn_end` / `turn_aborted` | INFO | conv_id |
| `turn_error` / `turn_failed` / `turn_failed_after_retries` | WARN/ERROR | error 文本 |
| `agent_respawn` / `agent_stale_session_*` | WARN | attempt, reason |
| `agent_spawn_failed` | ERROR | error |
| `task_status` | INFO | status, conv_id |

#### WebSocket 与问答

| message | 级别 |
|---------|------|
| `ws_connect` / `ws_disconnect` | INFO |
| `ask_question_pending` / `ask_question_answered` | INFO |
| `ask_question_ignored_mismatched_answer` | WARN |
| `answer_routed` | INFO |
| `answer_dropped_*` / `answer_no_channel` / `answer_send_failed` | WARN |

#### 推送、上传、Abort

| message | 级别 |
|---------|------|
| `push_send` / `push_failed` | INFO / WARN |
| `push_db_error` / `push_build_failed` | ERROR |
| `upload_rejected_*` / `upload_write_failed` | WARN |
| `multisoul::abort`（target） | INFO / WARN |

#### HTTP（仅错误）

| message | 级别 | 说明 |
|---------|------|------|
| `http_error` | WARN | 4xx / 5xx |
| `http_request` | **DEBUG** | 成功响应**不写**默认 app 日志 |

#### 启动元信息（app）

| message | 级别 | 字段 |
|---------|------|------|
| `serve_listening` | INFO | addr（已有） |
| `serve_startup` | INFO | **新增**：`bind_addr`, `pair_url_host`, `token_prefix`（前 12 字符 + `...`），与 `msctl auth` 脱敏一致 |

`println!` 的 QR 码、完整 token 仍只进 **service** 日志；app 不写完整 token。

---

### 3.2 仅 DEBUG — 默认 app 日志不可见

需要 `msctl --log-level debug serve` 写盘，或 `msctl logs --source app --level debug` 阅读：

| 类别 | 代表 message |
|------|----------------|
| 成功 HTTP | `http_request` |
| 消息队列 | `runtime_message_queued` |
| WS 广播 | `broadcast` |
| Agent stdout 原始行 | `claude_stdout_line`, `codex_stdout_line`, `cursor_stdout_line` |
| Claude system | `agent_system_line`, `agent_session_captured` |
| Codex 预热 / 参数 | `codex_spawn_args`, `codex_pre_warm_*` |
| Plugin 非 JSON stdout | `stdout: ...` |

**决策：** 不以 INFO 提升 stdout；排障时用 `--level debug`。

---

### 3.3 仅 service — 不进 app 日志

| 内容 | 原因 |
|------|------|
| QR 码、完整 Bearer token、`Or paste: ...` | `commands/serve.rs` 的 `println!` |
| `Listening on http://...`（println 副本） | service stdout；app 侧用 `serve_listening` |
| Tailscale funnel 警告 | `eprintln!` |
| **Claude 子进程 stderr** | `Stdio::inherit()` |
| **Plugin agent stderr** | `Stdio::inherit()` |

**决策：** stderr **不**改 pipe、**不**新增 `agent_exit` app 事件；查崩溃用 `msctl logs --source service`。

Codex/Cursor stderr 已在失败时拼入 `turn_error` 字符串（WARN/ERROR app 事件），无需额外事件。

---

## 4. 人类可读格式

### 4.1 HTTP 错误必须显示 method + path

现状：`http_error` 的 `method`/`path` 在 JSON `span` 中，人类格式只显示 `status`/`dur_ms`。

**要求：** 渲染 `http_error` 时从 span 读取并输出，例如：

```text
[app] 2026-05-24T12:00:01 WARN [http_trace] http_error GET /api/v1/agents status=401 dur_ms=0
```

`--json` 输出保持原始 NDJSON，不改动 envelope。

### 4.2 其他格式

- 继续显示 span/fields 中的 `conv_id`（现状）。
- `target` 短名（`rsplit("::")`）保持现状。

---

## 5. 实现清单

| # | 改动 | 文件 |
|---|------|------|
| 1 | 成功 `http_request` 保持 DEBUG | `cli/src/serve/mod.rs`（已完成） |
| 2 | `http_error` 人类格式 + method/path | `cli/src/commands/logs_app.rs` |
| 3 | 新增 `serve_startup` tracing 事件（token 前 12 字符、bind、pair host） | `cli/src/commands/serve.rs` |
| 4 | 本文档 + runbook 交叉引用 | `docs/runbooks/debugging.md` §常用参数 |

**明确不改：**

- service follow 仍 tail 50
- Claude/plugin stderr 仍 inherit
- 不实现 `agent_exit` / `db_slow_query` / `ws_error`

---

## 6. 验收标准

- [ ] 默认 info 下 app 日志无 `http_request`（200），有 `http_error`（401）且人类行含 `GET /path`。
- [ ] `msctl logs -f` 在 Agent 发消息时可见 `turn_start` / `agent_spawn` / `ask_question_pending`（无需 `--level debug`）。
- [ ] `msctl logs --grep push_` 可见 `push_send` / `push_failed`。
- [ ] serve 启动后 app 日志有 `serve_startup`，`token_prefix` 为 12 字符前缀，**无**完整 token。
- [ ] Claude stderr 仅出现在 `--source service`；`--source app` 无 stderr 原文。
- [ ] `msctl logs --source app --level debug --conv <id>` 可见 `claude_stdout_line`。
- [ ] `--json` 输出与改前 NDJSON 兼容（仅多 `serve_startup` 事件类型）。

---

## 7. 已确认决策摘要

| 话题 | 决策 |
|------|------|
| 核心场景 | Agent 排障、连接、推送 |
| 默认 source | `all`，双 follow |
| HTTP 成功 | DEBUG，默认不可见 |
| HTTP 错误 | WARN + 人类格式带 method/path |
| Agent stdout | DEBUG |
| Agent stderr | 仅 service |
| 启动 token | app 写前 12 字符前缀 |
| service QR tail | 保持 tail 50 |
| 规格落盘 | 本文档 |
