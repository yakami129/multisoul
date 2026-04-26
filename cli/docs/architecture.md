# msctl CLI 架构文档

## 概览

`msctl` 是 MultiSoul 的本地 CLI 工具，用 Rust 编写。它有两个职责：

1. **管理本地 Agent 注册表**（`msctl agent` / `msctl auth`）
2. **运行本地 HTTP+WebSocket 服务器**（`msctl serve`），作为移动端 App 与 Claude Code 进程之间的桥梁

---

## 目录结构

```
cli/src/
├── main.rs              # 入口：clap 命令树，分发到各子命令
├── config.rs            # ~/.config/msctl/config.toml 读写
├── db.rs                # SQLite 初始化、schema、工具函数
├── commands/
│   ├── mod.rs
│   ├── auth.rs          # msctl auth login / status
│   ├── agent.rs         # msctl agent register/list/get/update/delete/invoke
│   └── serve.rs         # msctl serve（启动 HTTP 服务器）
└── serve/
    ├── mod.rs           # 路由注册、run_server
    ├── state.rs         # AppState（共享状态）
    ├── auth.rs          # Bearer Token 中间件
    ├── push.rs          # Expo Push Notification 发送
    ├── runtime.rs       # Claude Code 进程管理（session_worker）
    ├── interactive.rs   # 交互式工具抽象（AskUserQuestion）
    └── routes/
        ├── mod.rs
        ├── healthz.rs
        ├── agents.rs
        ├── conversations.rs
        ├── messages.rs
        ├── push_tokens.rs
        └── ws.rs        # WebSocket handler
```

---

## 命令树

```
msctl
├── auth
│   ├── login --token <ms_v2_...>   # 保存 token 到 config.toml
│   └── status                      # 显示当前 token
├── agent
│   ├── register --name --project --runtime
│   ├── list
│   ├── get <id>
│   ├── update <id> [--name] [--project] [--runtime]
│   ├── delete <id>
│   └── invoke <id> --message <text>
└── serve [--port 8765] [--token] [--funnel] [--tailnet]
```

---

## 模块关系图

```
┌─────────────────────────────────────────────────────────────┐
│                         main.rs                             │
│  Commands::Auth  ──►  commands/auth.rs  ──►  config.rs      │
│  Commands::Agent ──►  commands/agent.rs ──►  db.rs          │
│  Commands::Serve ──►  commands/serve.rs ──►  serve/         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       serve/ 子系统                          │
│                                                             │
│  serve/mod.rs                                               │
│    build_router() ──► 注册所有路由 + bearer_auth 中间件      │
│    run_server()   ──► 绑定端口，启动 axum                    │
│                                                             │
│  AppState (state.rs)                                        │
│    db:         Arc<Mutex<Connection>>  ← SQLite             │
│    token:      String                  ← Bearer Token       │
│    bus:        ConvBus                 ← 广播频道 map        │
│    sessions:   SessionMap              ← Claude 进程 map     │
│    answer_txs: AnswerMap               ← 交互式回答 map      │
└─────────────────────────────────────────────────────────────┘
```

---

## HTTP API 路由

```
GET  /api/v1/healthz                          # 健康检查（无需认证）
GET  /api/v1/agents                           # 列出所有 agent
GET  /api/v1/agents/:id                       # 获取单个 agent
GET  /api/v1/agents/:id/conversations         # 列出 agent 的对话
POST /api/v1/agents/:id/conversations         # 创建新对话
GET  /api/v1/conversations/:id/messages       # 获取消息列表（?since_seq=N）
POST /api/v1/conversations/:id/messages       # 发送消息（触发 Claude）
POST /api/v1/push-tokens                      # 注册 Expo Push Token
DEL  /api/v1/push-tokens/:id                  # 删除 Push Token
WS   /ws/conversations/:id                    # WebSocket 实时推送

所有路由均需 Authorization: Bearer <token>（或 ?token=<token>）
```

---

## 数据库 Schema

```
agents
  id           TEXT PK
  name         TEXT UNIQUE
  project_path TEXT          ← Claude Code 工作目录
  runtime      TEXT          ← 默认 "claude-code"
  created_at   INTEGER

conversations
  id                TEXT PK
  agent_id          TEXT → agents(id) CASCADE
  title             TEXT
  created_at        INTEGER
  last_message_at   INTEGER
  status            TEXT      ← idle | running | completed | failed
  claude_session_id TEXT      ← 用于 --resume 恢复会话

messages
  id              TEXT PK
  conversation_id TEXT → conversations(id) CASCADE
  role            TEXT      ← user_text | agent_text | tool_call |
  │                            tool_result | ask_question | task_status
  payload         TEXT (JSON)
  created_at      INTEGER
  seq             INTEGER

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

---

## 消息流：用户发消息到 Claude 响应

```
Mobile App
  │
  │  POST /api/v1/conversations/:id/messages { text }
  ▼
routes/messages.rs :: post_message()
  │  1. 写入 messages 表（role=user_text）
  │  2. 广播到 WS bus（移动端实时收到）
  │  3. 查询 agent.project_path
  │  4. 调用 runtime::send_to_session()
  ▼
runtime.rs :: send_to_session()
  │  若 session 已存在 → 发消息到 mpsc channel
  │  若 session 不存在 → 创建 channel，spawn_blocking(session_worker)
  ▼
runtime.rs :: session_worker()  [blocking thread]
  │  1. 创建 answer_rx channel（用于交互式工具）
  │  2. 加载 claude_session_id（用于 --resume）
  │  3. spawn claude --output-format stream-json ...
  │  4. 读取 system 事件，捕获 session_id
  │  └─ 主循环：
  │       rx.recv() → 等待下一条用户消息
  │       process_turn() → 写入 claude stdin，读取 stdout
  ▼
process_turn()
  │  写 user message → claude stdin
  │  读 stdout 事件循环：
  │    system        → 忽略
  │    control_request → 自动 allow，回写 control_response
  │    assistant     → 解析 content：
  │      text        → 写 DB + 广播 agent_text
  │      tool_use    → 普通工具：广播 tool_call
  │                    交互式工具（AskUserQuestion）：
  │                      广播 ask_question
  │                      阻塞等待 answer_rx.recv()
  │                      写 tool_result → claude stdin
  │    user          → 广播 tool_result
  │    result        → 更新 conversation.status
  │                    广播 task_status
  │                    return Ok(())  ← 本轮结束
  ▼
broadcast()
  │  序列化为 WsEnvelope { type, seq, role, payload, created_at }
  │  发送到 ConvBus（broadcast::Sender）
  ▼
routes/ws.rs :: handle_socket()
  │  订阅 ConvBus → 转发给 WebSocket 客户端
  ▼
Mobile App 实时收到消息
```

---

## 交互式工具流（AskUserQuestion）

```
Claude Code 调用 AskUserQuestion
  │
  ▼
runtime.rs :: handle_assistant_event()
  │  检测到 interactive tool → build_ask_payload()
  │  广播 ask_question 消息到 WS
  │  返回 pending = [(call_id, tool_name, args)]
  ▼
process_turn() 阻塞在 answer_rx.recv()
  │
  │  Mobile App 用户选择答案
  │  WS 收到 { type: "answer", ask_id, choice_id / choice_ids / freeform }
  ▼
routes/ws.rs :: handle_client_message()
  │  构造 AnswerPayload
  │  state.send_answer(conv_id, answer)
  ▼
AppState::send_answer()
  │  通过 answer_txs map 找到对应 channel
  │  try_send(answer)
  ▼
process_turn() 收到 answer
  │  interactive::format_tool_result() → 格式化为文本
  │  write_tool_result() → 写入 claude stdin
  │  继续读取 stdout
```

---

## AppState 并发模型

```
AppState（Clone，Arc 包装，多线程共享）
│
├── db: Arc<Mutex<Connection>>
│     每次操作短暂加锁，用完立即释放
│     注意：runtime.rs 中 drop(db) 显式释放锁后再广播
│
├── bus: Arc<Mutex<HashMap<conv_id → broadcast::Sender<String>>>>
│     WS handler 订阅，runtime 发布
│     每个 conversation 独立频道，容量 64
│
├── sessions: Arc<Mutex<HashMap<conv_id → mpsc::Sender<String>>>>
│     HTTP handler 发消息给 session_worker
│     channel 断开时自动重建 worker
│
└── answer_txs: Arc<Mutex<HashMap<conv_id → SyncSender<AnswerPayload>>>>
      WS handler 发答案给 session_worker
      容量 1（每次只有一个待回答的问题）
```

---

## 本地文件路径

```
~/.config/msctl/
├── config.toml    # serve_token（由 msctl auth login 写入）
└── serve.db       # SQLite 数据库（由 msctl serve 创建）
```

---

## Tailscale 集成

`msctl serve` 支持两种网络暴露模式：

```
--tailnet   绑定 0.0.0.0，通过 Tailscale IP/DNS 访问（局域网）
--funnel    调用 tailscale funnel <port>，通过公网 HTTPS 访问

URL 解析优先级：
  1. Tailscale DNS 名（alan-mac.tailnet-xxx.ts.net）
  2. Tailscale IP（100.x.x.x）
  3. 回退到 127.0.0.1:<port>

启动时打印 QR 码，格式：
  multisoul://pair?url=<base_url>&token=<token>
```

---

## 错误恢复

```
session_worker 的容错机制：

process_turn 失败（管道断开、EOF）
  │
  ├── 最多重试 3 次
  │     每次：kill 旧进程 → spawn_claude() → read_system_event()
  │
  └── 3 次均失败 → mark_failed()
        UPDATE conversations SET status = 'failed'
        广播 task_status { status: "failed" }

Claude 进程启动参数：
  claude
    --output-format stream-json
    --input-format  stream-json
    --permission-prompt-tool stdio
    --dangerously-skip-permissions
    --verbose
    [--resume <session_id>]   ← 重启后恢复会话
```

---

## 依赖关系

```
Cargo.toml 主要依赖：

clap 4        命令行解析
axum 0.7      HTTP + WebSocket 服务器
tokio 1       异步运行时（仅 serve 子命令使用）
rusqlite 0.31 SQLite（bundled，无需系统库）
reqwest 0.11  Expo Push API（blocking）
serde/json    序列化
qrcode 0.14   配对 QR 码生成
rand 0.8      Token 生成
dirs 5        跨平台配置目录
```
