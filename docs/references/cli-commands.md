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
| `agent register` | `--name <NAME>` `--project <PATH>` `--runtime <RUNTIME>` `--mode <MODE>` | 注册新 agent 到本地 `serve.db` |
| `agent list` | — | 列出所有已注册 agent |
| `agent get` | `<ID>` | 查看指定 agent 详情 |
| `agent update` | `<ID>` `--name` `--project` `--runtime`（均可选） | 更新 agent 字段 |
| `agent delete` | `<ID>` | 删除 agent（交互确认） |
| `agent invoke` | `<ID>` `--message <MSG>` | 调用 agent（创建会话并发送消息） |

### `agent register` 参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name` | 必填 | Agent 名称（唯一） |
| `--project` | 必填 | 项目目录绝对路径 |
| `--runtime` | `claude-code` | 运行时：`claude-code` \| `codex` |
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
| `daemon logs` | `-f/--follow` `-n/--lines <N>`（默认 100） | 查看服务日志 |

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
