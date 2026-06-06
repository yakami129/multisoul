# `msctl` CLI 命令参考

Source of truth: `cli/src/main.rs`, `cli/src/commands/`

---

## 顶层命令

```
msctl <COMMAND>
```

| 命令 | 说明 |
|------|------|
| `auth` | 认证管理 |
| `agent` | Agent 注册与管理 |
| `serve` | 启动本地 HTTP/WS 服务器 |
| `ask-question` | Push a structured question card to mobile through `msctl serve` |
| `save-spec` | Save a repo `docs/product-specs/*.md` file as an immutable Spec artifact snapshot |
| `daemon` | 后台服务管理 |
| `logs` | 查看 app/service 日志 |

---

## `msctl auth`

Source: `cli/src/commands/auth.rs`

| 子命令 | 参数 | 说明 |
|--------|------|------|
| `auth login` | `--token <TOKEN>` | 保存 Bearer token 到本地配置（格式：`ms_v2_...`） |
| `auth status` | — | 显示当前已配置的 token（前 12 字符） |

---

## `msctl agent`

Source: `cli/src/commands/agent.rs`

| 子命令 | 参数 | 说明 |
|--------|------|------|
| `agent <runtime>` | `codex` \| `claude-code` \| `cursor-cli` \| `kodax` | 快速注册当前目录为 agent |
| `agent register` | `--name <NAME>` `--project <PATH>` `--runtime <RUNTIME>` `--mode <MODE>` | 注册新 agent 到本地 `serve.db` |
| `agent list` | — | 列出所有已注册 agent |
| `agent get` | `<ID>` | 查看指定 agent 详情 |
| `agent update` | `<ID>` `--name` `--project` `--runtime`（均可选） | 更新 agent 字段 |
| `agent delete` | `<ID>` | 删除 agent（交互确认） |
| `agent invoke` | `<ID>` `--message <MSG>` | 调用 agent（创建会话并发送消息） |

### `agent <runtime>` 快速注册示例

安装后的 CLI：

```bash
cd /path/to/project
msctl agent codex
msctl agent claude-code
msctl agent cursor-cli
msctl agent kodax
```

在 `cli/` 目录开发时：

```bash
cargo run -- agent codex
cargo run -- agent claude-code
cargo run -- agent cursor-cli
cargo run -- agent kodax
```

从源码注册其他项目目录时：

```bash
cd /path/to/project
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent codex
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent claude-code
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent cursor-cli
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent kodax
```

### `agent register` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name` | 必填 | Agent 名称（唯一） |
| `--project` | 必填 | 项目目录绝对路径 |
| `--runtime` | `claude-code` | 运行时：`claude-code` \| `codex` \| `cursor-cli` \| `kodax` |
| `--mode` | `full-auto` | 权限模式（仅 codex）：`suggest` \| `auto-edit` \| `full-auto` \| `yolo` |

---

## `msctl serve`

Source: `cli/src/commands/serve.rs`

直接启动本地 HTTP/WS 服务器（非后台）。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port <PORT>` | `8765` | 监听端口 |
| `--token <TOKEN>` | 自动生成 | Bearer token；省略时自动生成 `ms_v2_<random32>` |
| `--funnel` | false | 通过 Tailscale Funnel 暴露到公网 |
| `--tailnet` | false | 绑定 `0.0.0.0`（供 Tailnet 访问） |

首次使用公网 HTTPS/Funnel 前，需要先让 Tailscale 为本机打开 443 HTTPS 入口，并转发到 MultiSoul 默认端口：

```bash
tailscale funnel --https=443 8765
```

如果 Tailscale 要求浏览器授权，授权一次后按 `Ctrl-C` 停止该命令，再运行 `msctl serve --funnel`。

### `serve` 日志 WebSocket

手机端 Release logs 使用 `GET /ws/logs?token=<TOKEN>&tail=200&level=trace`。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `token` | 必填 | 与其他受保护 REST/WS 接口一致的 Bearer token query auth |
| `tail` | `200` | 连接后先推送最近 N 条日志，最大 1000 |
| `level` | `trace` | 最低日志级别：`trace` / `debug` / `info` / `warn` / `error` |

每个 WebSocket message 都是一行格式化文本，格式与 `msctl logs` 默认输出一致，包含 app 与 service 来源前缀，不是 JSON/NDJSON。

## `msctl ask-question`

Source: `cli/src/commands/ask_question.rs`

Pushes a structured question card to the paired MultiSoul mobile app through a running `msctl serve` process. The command only submits the question and returns `pending`; runtimes that need to block should call the answer API after this command returns.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--ask-id <ID>` | auto-generated UUID | Runtime tool call/question id; also used as the answer lookup key |
| `--questions <JSON>` | 必填 | Structured question array JSON, including question ids, text, options, and `multi_select` |
| `--conversation-id <ID>` | 必填 | Conversation that should receive the question card |
| `--output <text\|json>` | `json` | Output format; JSON includes the submitted `ask_id` and `pending` status |
| `--token <TOKEN>` | saved auth token | Bearer token for the running `msctl serve` process |
| `--port <PORT>` | saved config port, else `8765` | Local `msctl serve` port |
| `--host <HOST>` | `127.0.0.1` | Host for the local `msctl serve` process |

Submit a question card and return immediately:

```bash
# omit --ask-id to auto-generate a UUID (logged to stderr)
msctl ask-question \
  --conversation-id "conv_456" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]' \
  --output json

# or pass an explicit runtime tool call id
msctl ask-question \
  --ask-id "call_123" \
  --conversation-id "conv_456" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]' \
  --output json
```

When the iOS user answers, `msctl serve` marks the card answered and injects a structured Markdown `user_text` message into the same conversation. There is no separate HTTP answer polling step.

---

## `msctl save-spec`

Source: `cli/src/commands/save_spec.rs`

Reads a repo-relative product spec file through the provided conversation's target repo, saves an immutable artifact snapshot, and returns the saved spec/version ids.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--path <PATH>` | 必填 | Repo-relative path under `docs/product-specs/`, e.g. `docs/product-specs/2026-06-06-SPEC-example.md` |
| `--conversation-id <ID>` | 必填 | Interview conversation used to resolve the target repo and source Idea |
| `--output <text\|json>` | `json` | Output format |
| `--token <TOKEN>` | saved auth token | Bearer token for the running `msctl serve` process |
| `--port <PORT>` | saved config port, else `8765` | Local `msctl serve` port |
| `--host <HOST>` | `127.0.0.1` | Host for the local `msctl serve` process |

Example:

```bash
msctl save-spec \
  --path docs/product-specs/2026-06-06-SPEC-example.md \
  --conversation-id "$CONV_ID" \
  --output json
```

Success response:

```json
{
  "spec_id": "spec_uuid",
  "version_id": "version_uuid",
  "repo_spec_path": "docs/product-specs/2026-06-06-SPEC-example.md",
  "revision": 1,
  "status": "saved"
}
```

---

## `msctl logs`

Source: `cli/src/commands/logs.rs`

统一查看本机日志。默认 `--source all`，同时读取结构化 app 日志与 daemon/launchd service 原始日志。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--source <all\|app\|service>` | `all` | 日志来源 |
| `--tail <N>` | `50` | 每个来源最多显示 N 条/行 |
| `-f/--follow` | false | 实时 follow |
| `--since <DURATION>` | — | app 日志时间过滤，如 `5m` / `2h` |
| `--conv <ID>` | — | app 日志会话过滤 |
| `--level <LEVEL>` | `trace` | app 日志最低级别 |
| `--grep <REGEX>` | — | app 匹配 `fields.message`；service 匹配原始行 |
| `--json` | false | 仅允许与 `--source app` 一起使用，输出 app NDJSON |

---

## `msctl daemon`

Source: `cli/src/commands/daemon.rs`

将 `msctl serve` 作为系统后台服务管理。

| 子命令 | 参数 | 说明 |
|--------|------|------|
| `daemon quickstart` | `--token` `--port` `--tailnet` | 一键配置：保存 token + 安装并启动守护进程 |
| `daemon install` | `--port` `--tailnet` `--force` | 安装并启动后台服务 |
| `daemon uninstall` | — | 移除后台服务 |
| `daemon start` | — | 启动服务 |
| `daemon stop` | — | 停止服务 |
| `daemon restart` | — | 重启服务 |
| `daemon status` | — | 查看服务运行状态 |

### `daemon quickstart` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--token` | `test` | 安装前保存的 Bearer token |
| `--port` | `8765` | 监听端口 |
| `--tailnet` | `true` | 是否绑定 `0.0.0.0` |

---

## npm 发布说明

`msctl` 通过 `@yakami129/msctl` 发布到 npm，包含各平台预编译二进制。

发布流程见 [`docs/runbooks/cli-release.md`](../runbooks/cli-release.md)。

安装：

```bash
npm install -g @yakami129/msctl
# 或
npx @yakami129/msctl --help
```
