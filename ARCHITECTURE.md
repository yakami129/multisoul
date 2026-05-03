# MultiSoul — 系统架构总览

> 本文是仓库的 **architecture map** —— 用 ~300 行回答"系统由哪些部分组成、它们怎么交互"。
> 详细的产品规格见 [`docs/product-specs/SPEC.md`](docs/product-specs/SPEC.md)；
> 单 feature 的设计权衡见 [`docs/design-docs/`](docs/design-docs/)。

## 1. 组件拓扑

MultiSoul 是一个 **零中心后端** 的 monorepo，由两个组件组成：

```
┌─── 手机 App (React Native + Expo) ──────────────────────────────┐
│                                                                  │
│   AgentStore   ChatStore   InboxStore (本地 SQLite)              │
│        │           │              ▲                              │
│        │ HTTPS+WSS │ WebSocket    │ Expo Push                    │
│        ▼           ▼              │                              │
└────────┼───────────┼──────────────┼──────────────────────────────┘
         │           │              │
         │   Tailscale Funnel (公网 HTTPS / WSS) + Bearer token    │
         │           │              │
┌────────▼───────────▼──────────────┴──────────────────────────────┐
│                    msctl serve (本机进程)                         │
│   REST /api/v1/*   WebSocket /ws/conversations/{id}   Push out   │
│        │                       │                       │          │
│        ▼                       ▼                       ▼          │
│   SQLite (~/.config/msctl/serve.db)            exp.host POST     │
│   ├── agents                                                     │
│   ├── conversations / messages / tasks                           │
│   └── push_tokens                                                │
│        │                                                         │
│        ▼                                                         │
│   Runtime adapter ─→ Claude Code SDK / Codex CLI / 自定义脚本    │
└──────────────────────────────────────────────────────────────────┘
```

**关键属性：**

- 所有业务数据 100% 留在用户本机 SQLite
- 公网入口由 Tailscale Funnel 提供，不依赖 MultiSoul 自营服务器
- 推送走 Expo Push Service（CLI 直接 `POST exp.host`）
- 所有 HTTP/WS 请求强制 `Authorization: Bearer <token>`

## 2. 模块边界

### 2.1 `mobile/` — React Native + Expo

```
mobile/src/
├── api.ts            # Axios client，base URL = 当前选中端点
├── types.ts          # 跨模块的 TS 类型
├── store/            # Zustand：本地/认证状态
├── features/         # 按业务域划分
│   ├── agents/
│   ├── chat/
│   ├── inbox/
│   └── settings/
└── components/ui/    # 共享 UI 组件（PIP-BOY 风）

mobile/app/           # Expo Router 文件路由
├── (tabs)/           # Tab 导航：Agents / Chat / Inbox / Settings
└── agent/            # Agent 详情子路由
```

**状态分层：**

| 状态类型 | 工具 | 例子 |
|---------|------|------|
| 本地 / 认证 | Zustand | 当前选中端点、Token、UI 偏好 |
| 服务端 | React Query | Agent 列表、消息列表（30s polling） |
| 持久化（Inbox） | expo-sqlite | 推送过来的待办、复杂任务事件 |
| Token | AsyncStorage | 各端点的 Bearer Token |

**Feature 依赖边界：**

`mobile/src/features/{agents,chat,inbox,settings}/` 按业务域隔离。Feature 内部代码跨域依赖时，只能 import 对方公共入口（例如 `@/features/chat`），不能 import 对方深路径（例如 `@/features/chat/components/...` 或 `@/features/chat/services/...`）。该规则由 `mobile/eslint.config.mjs` 的 `no-restricted-imports` 在 `pnpm lint` / CI 中强制。

当前 feature 内部依赖图：

```
features/inbox ──> features/chat public API
```

其中 `mobile/src/features/chat/index.ts` 暴露 Inbox 复用的 `AskQuestionCard` 与 `MultiAskQuestionCard`。`mobile/app/`、`mobile/src/store/`、`mobile/src/hooks/` 等 feature 外层 orchestration 代码暂未纳入本条边界，后续可单独收紧。

详见 [`docs/design-docs/`](docs/design-docs/) 中各 feature 的设计文档。

### 2.2 `cli/` — Rust (`msctl`)

```
cli/src/
├── main.rs              # clap 命令树入口
├── config.rs            # ~/.config/msctl/config.toml 读写
├── db.rs                # SQLite 初始化、schema、工具函数
├── commands/
│   ├── auth.rs          # msctl auth login / status
│   ├── agent.rs         # msctl agent register/list/get/update/delete/invoke
│   └── serve.rs         # msctl serve 入口
└── serve/
    ├── mod.rs           # 路由注册、run_server
    ├── state.rs         # AppState（共享状态）
    ├── auth.rs          # Bearer Token 中间件
    ├── push.rs          # Expo Push 调用
    ├── runtime.rs       # Agent 进程管理（session_worker）
    ├── interactive.rs   # 交互式工具（AskUserQuestion）
    └── routes/
        ├── healthz.rs
        ├── agents.rs
        ├── conversations.rs
        ├── messages.rs
        ├── push_tokens.rs
        └── ws.rs        # WebSocket handler
```

**命令树：**

```
msctl
├── auth
│   ├── login --token <ms_v2_...>
│   └── status
├── agent
│   ├── register --name --project --runtime
│   ├── list / get / update / delete
│   └── invoke <id> --message <text>
└── serve [--port 8765] [--token] [--funnel] [--tailnet]
```

## 3. HTTP API

```
GET   /api/v1/healthz                          # 健康检查（无需认证）
GET   /api/v1/agents                           # 列出所有 agent
GET   /api/v1/agents/:id                       # 获取单个 agent
GET   /api/v1/agents/:id/conversations         # 列出 agent 的对话
POST  /api/v1/agents/:id/conversations         # 创建新对话
GET   /api/v1/conversations/:id/messages       # 获取消息（?since_seq=N 增量）
POST  /api/v1/conversations/:id/messages       # 发送消息（触发 Agent）
POST  /api/v1/push-tokens                      # 注册 Expo Push Token
DEL   /api/v1/push-tokens/:id                  # 删除 Push Token
WS    /ws/conversations/:id                    # WebSocket 实时推送
```

所有路由（除 `/healthz`）需 `Authorization: Bearer <token>` 或 `?token=<token>`。

## 4. 数据库 Schema

由 `cli/src/db.rs` 初始化，存储于 `~/.config/msctl/serve.db`。

```
agents
  id           TEXT PK
  name         TEXT UNIQUE
  project_path TEXT          ← Agent 工作目录
  runtime      TEXT          ← claude-code | codex | cursor-cli | …
  created_at   INTEGER

conversations
  id                TEXT PK
  agent_id          TEXT → agents(id) CASCADE
  title             TEXT
  status            TEXT      ← idle | running | completed | failed
  claude_session_id TEXT      ← Claude Code --resume
  codex_thread_id   TEXT      ← Codex thread id
  cursor_session_id TEXT      ← Cursor Agent CLI --resume
  created_at        INTEGER
  last_message_at   INTEGER

messages
  id              TEXT PK
  conversation_id TEXT → conversations(id) CASCADE
  role            TEXT      ← user_text | agent_text | tool_call |
                              tool_result | ask_question | task_status
  payload         TEXT (JSON)
  seq             INTEGER
  created_at      INTEGER

tasks
  id              TEXT PK
  conversation_id TEXT → conversations(id) CASCADE
  importance      TEXT
  status          TEXT
  started_at      INTEGER
  ended_at        INTEGER

push_tokens
  id              TEXT PK
  expo_push_token TEXT
  device_label    TEXT
  registered_at   INTEGER
```

## 5. 关键数据流

### 5.1 用户消息 → Agent 响应

```
Mobile App
  │  POST /api/v1/conversations/:id/messages { text }
  ▼
routes/messages.rs :: post_message()
  │  1. 写入 messages（role=user_text）
  │  2. 广播到 WS bus
  │  3. 调用 runtime::send_to_session()
  ▼
serve/runtime/* :: session_worker()  [blocking thread]
  │  spawn agent 进程（claude / codex / cursor `agent`）—— stream-json 或等价协议
  │  主循环：rx.recv() → process_turn()
  ▼
process_turn()
  │  写 user message → agent stdin
  │  读 stdout 事件：
  │    assistant.text       → 广播 agent_text
  │    assistant.tool_use   → 广播 tool_call
  │                           交互式工具 → 广播 ask_question + 阻塞
  │    user.tool_result     → 广播 tool_result
  │    result               → 更新 conversation.status + 广播 task_status
  ▼
Mobile App 实时收到（通过 WebSocket）
```

### 5.2 交互式工具流（AskUserQuestion）

```
Agent 调用 AskUserQuestion
  ▼
runtime 广播 ask_question 到 WS，阻塞等待 answer_rx.recv()
  ▼
Mobile App 用户选择
  │  WS 发回 { type: "answer", ask_id, choice_id / freeform }
  ▼
routes/ws.rs :: handle_client_message()
  │  state.send_answer(conv_id, answer)
  ▼
runtime 收到 answer
  │  format_tool_result() → 写入 agent stdin
  │  继续读 stdout
```

### 5.3 推送

`task_status` 进入 `completed | failed` 终态时，`runtime.rs` 调用 `push.rs::send_to_all_tokens()`，遍历 `push_tokens` 表 POST 到 `https://exp.host/--/api/v2/push/send`。

## 6. 并发模型（`AppState`）

```
AppState（Clone，Arc 包装，多线程共享）
│
├── db: Arc<Mutex<Connection>>
│     每次操作短暂加锁，runtime 中显式 drop(db) 后再广播
│
├── bus: Arc<Mutex<HashMap<conv_id → broadcast::Sender<String>>>>
│     WS handler 订阅，runtime 发布；每个 conversation 独立频道
│
├── sessions: Arc<Mutex<HashMap<conv_id → mpsc::Sender<String>>>>
│     HTTP handler 发消息给 session_worker
│
└── answer_txs: Arc<Mutex<HashMap<conv_id → SyncSender<AnswerPayload>>>>
      WS handler 发答案给 session_worker（容量 1）
```

## 7. 网络暴露：Tailscale 集成

```
--tailnet   绑定 0.0.0.0，通过 Tailscale IP/DNS 访问（局域网）
--funnel    调用 tailscale funnel <port>，通过公网 HTTPS 访问

URL 解析优先级：
  1. Tailscale DNS 名（alan-mac.tailnet-xxx.ts.net）
  2. Tailscale IP（100.x.x.x）
  3. 回退到 127.0.0.1:<port>

启动打印 QR 码：multisoul://pair?url=<base_url>&token=<token>
```

## 8. 错误恢复

```
session_worker 容错：
  process_turn 失败（管道断开 / EOF）
    ├─ 最多重试 3 次：kill 旧进程 → 重新 spawn → resume
    └─ 3 次均失败 → mark_failed
         UPDATE conversations SET status = 'failed'
         广播 task_status { status: "failed" }
         触发推送

Agent 进程启动参数（claude-code）：
  claude
    --output-format stream-json
    --input-format  stream-json
    --permission-prompt-tool stdio
    --dangerously-skip-permissions
    --verbose
    [--resume <session_id>]
```

## 9. 关键设计决策（摘自 [`docs/product-specs/SPEC.md`](docs/product-specs/SPEC.md)）

| # | 决策 | 选择 |
|---|------|------|
| D-1 | 是否保留中心后端 | 否 |
| D-2 | Tunnel 方案 | 仅 Tailscale Funnel（MVP） |
| D-3 | 数据归属 | 100% 本地 SQLite |
| D-5 | 实时协议 | WebSocket 双向 |
| D-6 | 推送 | Expo Push Service（直调） |
| D-7 | 认证 | Bearer token，强制所有请求 |
| D-11 | 对话模型 | 一个 Agent 多 thread |
| D-13 | AskQuestion 阻塞 | 完全阻塞等待回答 |
| D-14 | 中途打断 | MVP 不支持 |
| D-17 | UI 设计体系 | PIP-BOY / Vault-Tec 绿色终端 |

完整决策表见 SPEC §4.1。

## 10. 依赖

```
CLI (Cargo.toml):
  clap 4         命令行解析
  axum 0.7       HTTP + WebSocket
  tokio 1        异步运行时（仅 serve）
  rusqlite 0.31  SQLite (bundled)
  reqwest 0.11   Expo Push (blocking)
  serde / json   序列化
  qrcode 0.14    配对 QR 码
  rand 0.8       Token 生成
  dirs 5         跨平台配置目录

Mobile (package.json):
  expo SDK 55
  react-native
  expo-router       文件路由
  expo-sqlite       Inbox 持久化
  expo-notifications推送注册
  zustand           本地状态
  @tanstack/react-query  服务端状态
  nativewind        Tailwind for RN
  axios             HTTP client
```

## 11. 本地文件路径

```
~/.config/msctl/
├── config.toml    # serve_token（msctl auth login 写入）
└── serve.db       # SQLite 主库（msctl serve 创建）
```

## 12. 延伸阅读

- 产品规格全文：[`docs/product-specs/SPEC.md`](docs/product-specs/SPEC.md)
- 单 feature 设计：[`docs/design-docs/`](docs/design-docs/)
- 历史执行计划：[`docs/exec-plans/`](docs/exec-plans/)
- UI 设计系统：[`mobile/docs/design.md`](mobile/docs/design.md)
- iOS 发布流程：[`mobile/docs/ios-publish.md`](mobile/docs/ios-publish.md)
