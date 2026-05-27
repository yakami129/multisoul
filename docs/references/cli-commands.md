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
| `agent <runtime>` | `codex` \| `claude-code` \| `cursor-cli` | 快速注册当前目录为 agent |
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
```

在 `cli/` 目录开发时：

```bash
cargo run -- agent codex
cargo run -- agent claude-code
cargo run -- agent cursor-cli
```

从源码注册其他项目目录时：

```bash
cd /path/to/project
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent codex
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent claude-code
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent cursor-cli
```

### `agent register` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name` | 必填 | Agent 名称（唯一） |
| `--project` | 必填 | 项目目录绝对路径 |
| `--runtime` | `claude-code` | 运行时：`claude-code` \| `codex` \| `cursor-cli` |
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
