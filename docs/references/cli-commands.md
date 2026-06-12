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
| `spec` | Spec / Idea artifact commands |
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
| `agent <runtime>` | `codex` \| `claude-code` \| `cursor-cli` \| `infcode` | 快速注册当前目录为 agent |
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
msctl agent infcode
```

在 `cli/` 目录开发时：

```bash
cargo run -- agent codex
cargo run -- agent claude-code
cargo run -- agent cursor-cli
cargo run -- agent infcode
```

从源码注册其他项目目录时：

```bash
cd /path/to/project
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent codex
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent claude-code
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent cursor-cli
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent infcode
```

### `agent register` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name` | 必填 | Agent 名称（唯一） |
| `--project` | 必填 | 项目目录绝对路径 |
| `--runtime` | `claude-code` | 运行时：`claude-code` \| `codex` \| `cursor-cli` \| `infcode` |
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

## `msctl spec`

Source: `cli/src/commands/spec.rs`, `cli/src/commands/spec_artifact.rs`, `cli/src/commands/spec_dispatch.rs`, `cli/src/commands/spec_idea.rs`

All `msctl spec` commands that call `msctl serve` accept the same connection flags.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--output <text\|json>` | `json` | Output format; JSON preserves the server response |
| `--token <TOKEN>` | saved auth token | Bearer token for the running `msctl serve` process |
| `--port <PORT>` | saved config port, else `8765` | Local `msctl serve` port |
| `--host <HOST>` | `127.0.0.1` | Host for the local `msctl serve` process |

| 子命令 | 说明 |
|--------|------|
| `spec list` | List saved SpecArtifact rows |
| `spec get` | Get one SpecArtifact detail |
| `spec save` | Save a repo `docs/product-specs/*.md` file as an immutable Spec artifact snapshot |
| `spec delete` | Delete a saved SpecArtifact |
| `spec implement` | Start an implementation conversation for a saved SpecArtifact |
| `spec mark-done` | Mark a SpecArtifact as implementation-complete |
| `spec dispatch` | Write a JSON spec body into an agent repo and dispatch implementation |
| `spec idea ...` | Manage Ideas to Specs source ideas |

### `msctl spec list`

```bash
msctl spec list --output json
```

```bash
msctl spec list --output text
```

### `msctl spec get`

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--spec-id <ID>` | 必填 | UUID of the SpecArtifact |

```bash
msctl spec get \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

```bash
msctl spec get \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output text
```

### `msctl spec save`

Reads a repo-relative product spec file through the provided conversation's target repo, saves an immutable artifact snapshot, and returns the saved spec/version ids.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--path <PATH>` | 必填 | Repo-relative path under `docs/product-specs/` |
| `--conversation-id <ID>` | 必填 | Interview conversation used to resolve the target repo and source Idea |

```bash
msctl spec save \
  --path docs/product-specs/2026-06-09-SPEC-example.md \
  --conversation-id "$CONV_ID" \
  --output json
```

```bash
msctl spec save \
  --path docs/product-specs/2026-06-09-SPEC-example.md \
  --conversation-id "$CONV_ID" \
  --output text
```

### `msctl spec delete`

Deletes a saved SpecArtifact. The command asks for confirmation unless `--yes` is passed.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--spec-id <ID>` | 必填 | UUID of the SpecArtifact |
| `--yes` | false | Skip interactive confirmation |

```bash
msctl spec delete \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda
```

```bash
msctl spec delete \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --yes \
  --output text
```

### `msctl spec implement`

Starts an implementation conversation for a saved SpecArtifact.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--spec-id <ID>` | 必填 | UUID of the SpecArtifact |

```bash
msctl spec implement \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

```bash
msctl spec implement \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output text
```

### `msctl spec mark-done`

Marks the given SpecArtifact as implementation-complete and broadcasts a `spec_changed` event.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--spec-id <ID>` | 必填 | UUID of the SpecArtifact |

```bash
msctl spec mark-done \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda
```

```bash
msctl spec mark-done \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

### `msctl spec dispatch`

Writes a product spec into the target agent repo and starts implementation. JSON body fields match `DispatchSpecBody`.

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--agent-id <ID>` | 必填 | Target agent id |
| `--json <JSON>` | 与 `--json-file` 二选一 | Inline JSON request body |
| `--json-file <PATH>` | 与 `--json` 二选一 | JSON request body file; `-` reads stdin |

```bash
msctl spec dispatch \
  --agent-id "$AGENT_ID" \
  --json-file /tmp/dispatch-spec.json \
  --output json
```

```bash
msctl spec dispatch \
  --agent-id "$AGENT_ID" \
  --json-file - \
  --output text < /tmp/dispatch-spec.json
```

`/tmp/dispatch-spec.json`:

```json
{
  "title": "Workflow watch mode",
  "slug": "workflow-watch-mode",
  "markdown": "# Workflow watch mode\n\n## Background\n..."
}
```

### `msctl spec idea`

| 子命令 | 说明 |
|--------|------|
| `spec idea list` | List source ideas |
| `spec idea create` | Create an idea from JSON body |
| `spec idea update` | Update an idea from JSON body |
| `spec idea archive` | Set idea status to `archived` |
| `spec idea restore` | Set idea status to `open` |
| `spec idea delete` | Delete an archived idea |
| `spec idea interview` | Start or reopen the interview conversation |

#### `msctl spec idea list`

```bash
msctl spec idea list --output json
```

```bash
msctl spec idea list --output text
```

#### `msctl spec idea create`

JSON body fields match `SpecIdeaMutation`.

```bash
msctl spec idea create \
  --json-file /tmp/spec-idea.json \
  --output json
```

```bash
msctl spec idea create \
  --json '{"title":"PR merge guardrail","target_agent_id":"agent_uuid","body":"Need merge policy automation."}' \
  --output json
```

```bash
msctl spec idea create \
  --json-file - \
  --output text < /tmp/spec-idea.json
```

`/tmp/spec-idea.json`:

```json
{
  "title": "PR merge guardrail",
  "target_agent_id": "agent_uuid",
  "body": "Need merge policy automation.",
  "notes": [
    { "body": "CI must pass before merge." }
  ],
  "attachments": [
    {
      "kind": "link",
      "title": "Merge policy",
      "uri": "docs/runbooks/github-pr-merge-policy.md"
    }
  ]
}
```

#### `msctl spec idea update`

```bash
msctl spec idea update \
  --idea-id "$IDEA_ID" \
  --json-file /tmp/spec-idea-update.json \
  --output json
```

```bash
msctl spec idea update \
  --idea-id "$IDEA_ID" \
  --json '{"status":"open","title":"PR merge guardrail v2"}' \
  --output text
```

#### `msctl spec idea archive`

```bash
msctl spec idea archive \
  --idea-id "$IDEA_ID" \
  --output text
```

#### `msctl spec idea restore`

```bash
msctl spec idea restore \
  --idea-id "$IDEA_ID" \
  --output text
```

#### `msctl spec idea delete`

Deletes an archived idea. The command asks for confirmation unless `--yes` is passed.

```bash
msctl spec idea delete \
  --idea-id "$IDEA_ID"
```

```bash
msctl spec idea delete \
  --idea-id "$IDEA_ID" \
  --yes \
  --output text
```

#### `msctl spec idea interview`

```bash
msctl spec idea interview \
  --idea-id "$IDEA_ID" \
  --output json
```

```bash
msctl spec idea interview \
  --idea-id "$IDEA_ID" \
  --output text
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
| `daemon quickstart` | `--relay` `--tailnet` `--funnel` `--port` `--relay-url` `--token` | 一键配置：默认 relay，保存 config + 安装并启动守护进程 |
| `daemon install` | 同上 + `--force` | 安装并启动后台服务 |
| `daemon uninstall` | — | 移除后台服务 |
| `daemon start` | — | 启动服务 |
| `daemon stop` | — | 停止服务 |
| `daemon restart` | — | 重启服务 |
| `daemon status` | — | 查看服务运行状态 |

### `daemon quickstart` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| （无 mode flag） | `relay` | `config.toml` 的 `serve_mode`，缺省为 relay |
| `--relay` | — | Cloudflare Tunnel relay（与 `--tailnet` / `--funnel` 互斥） |
| `--tailnet` | — | 绑定 `0.0.0.0`，Tailscale 内网 |
| `--funnel` | — | Tailscale Funnel HTTPS |
| `--port` | `8765` | 监听端口（写回 config） |
| `--relay-url` | Workers 默认 URL | relay 模式 KV 地址（写回 config） |
| `--token` | 自动生成 | Bearer token；省略则生成 `ms_v2_` + 32 位 hex |

`~/.config/msctl/config.toml` 可选字段：`serve_mode`（`relay` \| `tailnet` \| `funnel`）、`relay_url`、`serve_port`、`serve_token`。

relay 模式下 quickstart 安装后会等待 tunnel 注册（最多 20 分钟）再打印 QR。

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
