# 调试 Runbook

> 诊断 `msctl serve` 运行问题的第一工具是 `msctl logs`。
> 设计背景见 [`../design-docs/2026-05-02-cli-tracing-design.md`](../design-docs/2026-05-02-cli-tracing-design.md)。

## 前提

- app 日志位于 `~/.cache/msctl/serve.log.YYYY-MM-DD`（macOS 实为 `~/Library/Caches/msctl/`）
- service 日志位于 daemon/launchd 配置的 stdout/stderr 文件（默认 `~/.config/msctl/msctl.log`）
- `msctl logs` 默认读取 app + service；用 `--source app` 或 `--source service` 可只看单一来源
- app 日志格式为 NDJSON；`msctl logs --source app --json` 可输出原始 NDJSON 给 `jq`

## 常用参数速查

```bash
msctl logs                          # 默认 source=all，每个来源最后 50 条/行
msctl logs --source app             # 只看结构化 app 日志
msctl logs --source service         # 只看 daemon/launchd 原始日志
msctl logs --tail 200               # 每个来源最后 200 条/行
msctl logs -f                       # 同时实时流 app + service
msctl logs --since 5m               # app 最近 5 分钟
msctl logs --since 2h               # app 最近 2 小时
msctl logs --conv cnv_abc           # app 按会话过滤
msctl logs --level warn             # app 只看 WARN/ERROR
msctl logs --grep 'push_'           # app 匹配 message；service 匹配原始行
msctl logs --source app --json | jq . # app NDJSON 管道给 jq
msctl logs --source app --level debug --conv cnv_abc # 看 Agent stdout 原始行等 DEBUG 细节
```

## 手机端 Release logs

Settings → `DIAGNOSTICS` → `Release logs` 会通过受 Bearer 保护的
`/ws/logs?token=<TOKEN>&tail=200&level=trace` 连接到选中的 endpoint。

- WebSocket 帧是 **格式化文本行**，与 `msctl logs` 默认输出一致；不会给手机端推 NDJSON/JSON envelope。
- 打开弹窗后先发送最近 `tail` 条日志，再实时追加新日志。
- 弹窗会把这些 `msctl` 文本行和 iOS 本机 diagnostics 文本合并显示；`Clear iOS` 只清本机 diagnostics，不删除 `msctl` 日志文件。

## 场景 1：Agent 在 `ask_question` 后卡住

**症状**：手机上看不到 Agent 新输出，也没显示 AskUserQuestion 卡片。

**定位**：

```bash
# 1. 取 conv_id（从 App 或者 msctl agent get <id> 里看到最近的对话）
msctl logs --conv <conv_id> --tail 20
```

找 `ask_question_pending` — 若有，且后面没有 `ask_question_answered`，则 Agent 正在等用户回答但 WS 链路断了。

```bash
# 2. 确认 WS 连接状态
msctl logs --grep 'ws_' --conv <conv_id> --tail 10
```

找 `ws_disconnect`（很可能已出现），以及之后没有新的 `ws_connect` — 说明手机端断开后没重连。让用户重启 App 或检查网络。

## 场景 2：手机 App 连不上（401 / 超时）

**症状**：App "add endpoint" 一直转，或点进去提示认证失败。

**定位**：

```bash
msctl logs --level warn --tail 30
```

- 看到 `http_error GET /api/v1/agents status=401` → token 不对。对照 `msctl serve` 启动时打印的 Bearer token 修正 App 端。
- 没有任何 `http_request` 记录 → 请求根本没到 `msctl serve`。检查：
  - Tailscale funnel 是否起来：`tailscale funnel status`
  - 端口是否被系统防火墙拦
  - 本机 `curl -v http://127.0.0.1:<port>/api/v1/healthz` 能不能通

## 场景 3：推送发了但手机没收到

**症状**：任务完成但手机没弹出通知。

**定位**：

```bash
msctl logs --grep 'push_' --since 30m
```

可能的情形：

| 日志行 | 含义 | 处理 |
|--------|------|------|
| `push_send token_hash=xxxx` | 发送到 Expo 成功 | 检查 App 端是否 opt-in 推送、系统通知权限是否开 |
| `push_failed error_type=DeviceNotRegistered` | Expo 说该 token 已失效 | App 重新登录后会重新注册 token；旧 token 应清理 |
| `push_failed error_type=InvalidCredentials` | Expo 账户或 APNs 证书问题 | 需要运维介入 |
| 无任何 `push_` | 未触发发送 | 看 `task_status` 是否进入 `completed/failed` 终态；只有终态才发推 |

```bash
msctl logs --grep 'task_status' --conv <conv_id>
```

## 场景 4：Agent 进程崩溃 / stderr 异常

**症状**：对话停在某步，之后新消息也没响应。

**定位**：

```bash
msctl logs --source app --since 10m --grep 'agent_' --conv <conv_id>
msctl logs --source service --tail 80
```

关键事件：

| message | 字段 | 说明 |
|---------|------|------|
| `agent_spawn` | pid, runtime, resume | 进程启动 |
| `agent_respawn` | attempt, reason | 自动重试（最多 3 次） |
| `turn_failed_after_retries` | — | 3 次重试都失败，会话标记为 `failed` |

Claude 子进程和 Plugin agent 的 stderr 继承到 service 日志，不写入 app NDJSON。若 app 侧只看到 `agent_spawn` 后无 `turn_end` / `turn_error`，继续看 `--source service` 中的 CLI stderr、PATH、崩溃输出。

## 进阶：和 `jq` 组合

```bash
# 过去 1 小时所有 error
msctl logs --source app --since 1h --level error --json | jq '.fields.message'

# 某 conv 的所有 span 名
msctl logs --source app --conv cnv_abc --json | jq '.span.name' | sort -u

# 统计每种事件发生次数
msctl logs --source app --tail 1000 --json | jq -r '.fields.message' | sort | uniq -c | sort -rn
```

## 日志本身出了问题

- 看不到任何 app 输出：检查 `~/.cache/msctl/` 是否存在；`ls -la` 看文件大小
- 看不到任何 service 输出：检查 `msctl daemon status` 里的 Log 路径是否存在
- `msctl serve` 没写盘：临时把日志级别调高验证，`msctl --log-level debug serve`
- 磁盘满：`tracing-appender` 会静默丢弃，不影响服务；清掉旧文件 `rm ~/.cache/msctl/serve.log.*`（7 天自动轮转保留，手动清也安全）

## 新增日志打点

当发现一类问题 `msctl logs` 不够用 →

1. 确定要加的事件 name（snake_case，例如 `ws_reconnect`）
2. 在对应 `cli/src/serve/...` 用 `tracing::info!(conv_id = %c, field = v, "event_name")`
3. 在 [`design-docs/2026-05-02-cli-tracing-design.md`](../design-docs/2026-05-02-cli-tracing-design.md) §3.1 表里补一行
4. 必要时在本 runbook 加场景
