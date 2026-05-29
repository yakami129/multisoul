# MultiSoul Architecture

MultiSoul 是一个零中心后端的个人 AI Agent 控制台。手机 App 连接用户电脑上的 `msctl serve`，通过 REST 拉取状态，通过 WebSocket 接收实时消息，并把用户回复写回本机 Agent 会话。

## 1. 系统拓扑

```
┌───────────────────────────────┐
│ Mobile App                    │
│ React Native + Expo           │
│ Agents / Chat / Inbox / Settings
└───────────────┬───────────────┘
                │ HTTPS / WSS
                │ Authorization: Bearer <token>
                ▼
┌───────────────────────────────┐
│ msctl serve                   │
│ Rust + axum                   │
│ REST / WebSocket / Push       │
└───────┬───────────┬───────────┘
        │           │
        ▼           ▼
┌──────────────┐  ┌──────────────────────────────┐
│ SQLite       │  │ Runtime adapters             │
│ serve.db     │  │ claude-code / codex / cursor │
└──────────────┘  └──────────────────────────────┘
        │
        ▼
Expo Push Service (task completion notifications)
```

公网连接不经过 MultiSoul 自营服务。用户可以选择：

- 本机：`msctl serve`
- Tailnet：`msctl serve --tailnet`
- 公网 HTTPS：`msctl serve --funnel`，依赖 Tailscale Funnel
- 自动隧道：`msctl serve --relay`，依赖 Cloudflare Tunnel + Workers KV（见 §1.1）

### 1.1 Cloudflare Tunnel Relay（Auto Tunnel 模式）

用户可以通过 `msctl serve --relay` 启用自动隧道发现：

```
┌──────────────────────────────────────────────────────────────┐
│ msctl serve --relay                                          │
├──────────────────────────────────────────────────────────────┤
│ 1. 自动下载 cloudflared 二进制                               │
│    → ~/.config/msctl/cloudflared                             │
│                                                               │
│ 2. 启动 Cloudflare Tunnel                                    │
│    → cloudflared tunnel --url http://localhost:8080          │
│    → 获得临时公网 URL: https://abc-def-ghi.trycloudflare.com │
│                                                               │
│ 3. 每 30 秒上报到 Cloudflare Workers KV                      │
│    → POST https://worker.example.com/tunnel/<token>          │
│    → Body: { status: "active", tunnel_url: "..." }           │
│                                                               │
│ 4. 心跳循环（5 分钟超时）                                    │
│    → 无心跳则 KV 条目自动过期                                │
└──────────────────────────────────────────────────────────────┘
```

移动端在 Settings 中选择 "Auto Tunnel" 模式，输入 Bearer token，应用每 10 秒轮询一次 Workers 端点，直到获得隧道 URL。详见 `docs/design-docs/2026-05-29-cloudflare-tunnel-relay-design.md`。

## 2. 代码结构

### `cli/`

Rust CLI，二进制名 `msctl`。

```
cli/src/
├── main.rs
├── config.rs              # ~/.config/msctl/config.toml
├── db.rs                  # SQLite schema and migrations
├── commands/
│   ├── auth.rs
│   ├── agent.rs
│   ├── daemon.rs
│   ├── logs.rs
│   └── serve.rs           # --relay flag parsing
└── serve/
    ├── mod.rs             # axum routes
    ├── auth.rs            # Bearer auth
    ├── state.rs           # shared AppState
    ├── push.rs            # Expo Push
    ├── tunnel.rs          # Cloudflare Tunnel launch & KV reporting
    ├── cloudflared.rs     # cloudflared binary download & caching
    ├── routes/
    └── runtime/           # Claude Code / Codex / Cursor adapters
```

主要职责：

- 管理本地 Agent 注册表
- 提供 REST 和 WebSocket API
- 把用户消息转发给 Agent runtime
- 把 Agent 输出转换成统一消息类型
- 发送任务完成/失败推送

### `mobile/`

Expo SDK 55 React Native App。

```
mobile/
├── app/                   # expo-router routes
└── src/
    ├── api/               # endpoint clients
    ├── components/ui/     # shared UI
    ├── db/                # local SQLite helpers
    ├── features/
    │   ├── agents/
    │   ├── chat/
    │   ├── inbox/
    │   └── settings/
    │       ├── components/SettingsForm.tsx    # Auto/Custom mode toggle
    │       └── services/
    │           ├── settingsService.ts         # Settings persistence
    │           └── tunnelService.ts           # Tunnel polling logic
    ├── hooks/
    ├── services/
    └── store/             # Zustand stores
```

主要职责：

- 管理多个 `msctl serve` 端点
- 展示 Agent、Conversation 和 Message
- 通过 WebSocket 接收实时事件
- 在 Inbox 中汇总 ask question 和任务通知
- 注册 Expo Push Token

## 3. API

除健康检查外，所有请求都需要 Bearer token。WebSocket 也使用同一 token。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/healthz` | 健康检查 |
| GET | `/api/v1/agents` | Agent 列表 |
| GET | `/api/v1/agents/:id` | Agent 详情 |
| GET | `/api/v1/agents/:id/conversations` | 对话列表 |
| POST | `/api/v1/agents/:id/conversations` | 创建对话 |
| DELETE | `/api/v1/conversations/:id` | 删除对话 |
| POST | `/api/v1/conversations/:id/abort` | 中止运行中的对话 |
| GET | `/api/v1/conversations/:id/messages` | 消息列表，支持增量拉取 |
| POST | `/api/v1/conversations/:id/messages` | 发送用户消息 |
| POST | `/api/v1/push-tokens` | 注册 Expo Push Token |
| DELETE | `/api/v1/push-tokens/:id` | 删除 Expo Push Token |
| POST | `/api/v1/uploads` | 上传图片 |
| WS | `/ws/conversations/:id` | 实时消息流 |

## 4. 数据模型

SQLite 位于 `~/.config/msctl/serve.db`，由 `cli/src/db.rs` 管理。

核心表：

- `agents`: name、project path、runtime、mode
- `conversations`: agent 归属、标题、状态、runtime session id
- `messages`: role、payload JSON、sequence、created_at
- `tasks`: conversation 的长任务状态
- `push_tokens`: 手机设备的 Expo Push Token

上传文件位于 `~/.config/msctl/uploads/`。

## 5. 消息模型

`messages.role` 使用统一事件类型，移动端按 role 渲染：

- `user_text`: 用户消息
- `agent_text`: Agent 文本
- `tool_call`: 工具调用
- `tool_result`: 工具结果
- `ask_question`: 需要用户选择或输入的决策卡片
- `task_status`: running、completed、failed 等状态

payload 存为 JSON，具体字段由对应 role 决定。

## 6. 核心流程

### 用户发送消息

```
Mobile
  POST /api/v1/conversations/:id/messages
    ↓
msctl 写入 user_text
    ↓
runtime adapter 启动或复用 Agent 会话
    ↓
Agent stdout stream
    ↓
msctl 写入 agent_text/tool_call/tool_result/task_status
    ↓
WebSocket 广播给 Mobile
```

### Agent 请求用户决策

```
Agent tool call: AskUserQuestion
    ↓
msctl 写入 ask_question 并阻塞当前 turn
    ↓
Mobile 显示选择卡片
    ↓
用户回复通过 WebSocket 返回
    ↓
msctl 写入 tool result，Agent 继续执行
```

### 任务完成推送

```
task_status = completed / failed
    ↓
msctl 查询 push_tokens
    ↓
POST https://exp.host/--/api/v2/push/send
    ↓
Mobile 收到通知并写入 Inbox
```

## 7. 认证与数据边界

- `GET /api/v1/healthz` 无需认证
- 其他 REST/WS 请求必须携带 Bearer token
- token 由 `msctl serve` 生成或通过 `--token` 指定
- MultiSoul 不保存云端副本；业务数据留在用户本机
- Expo Push 只用于通知投递，不作为业务数据源

## 8. 技术栈

- CLI：Rust、axum、tokio、rusqlite、clap
- Mobile：React Native、Expo、expo-router、Zustand、React Query、expo-sqlite、NativeWind
- 协议：REST JSON + WebSocket
- 公网：Tailscale Funnel
