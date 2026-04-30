# MultiSoul — 个人 AI Agent 随身控制台 SPEC

## 1. 背景与目标

### 背景
开发者需要在「不在电脑前」的时候也能调度本地 AI Agent（Claude Code / Codex 等）继续工作，
并在关键决策点被及时提醒。
现有方案要么依赖中心化云后端（运营成本 + 数据出域），
要么需要用户运维一整套服务（门槛高）。

### 目标
- **零中心后端**：所有业务数据 100% 留在用户本机，不依赖 MultiSoul 自营服务器
- **手机随身遥控**：通过 Tailscale Funnel 把本机 `msctl serve` 暴露成 HTTPS 入口，
  手机 App 在外网即可发起对话、回应 ask Question、收到任务完成推送
- **三模块极简体验**：Agent / Chat / Inbox，Inbox 仅在「需要决策」或「复杂任务终态」时打扰用户

---

## 2. 范围

### 2.1 In Scope（MVP）
- **手机 App（mobile/）**
  - Agent 模块：管理多个 tunnel 端点，聚合查看每台机器上的 Agent 列表
  - Chat 模块：与已注册 Agent 对话，多 thread，渲染 user_text / agent_text / tool_call / tool_result / ask_question / task_status 六类消息
  - Inbox 模块：聚合 ask Question 待回应、复杂任务成功/失败三类事件
- **CLI（cli/`msctl`）**
  - 现有 `auth / agent` CRUD 命令
  - 新增 `msctl serve`：本地 SQLite + REST + WebSocket 服务
  - 新增 `msctl serve --funnel`：自动调用 Tailscale Funnel 暴露公网，并在终端打印连接串 + QR
- **推送**：CLI 通过 Expo Push Service 直接调 `https://exp.host/--/api/v2/push/send`，零自营推送服务

### 2.2 Out of Scope（V1 不做）
- 中心化云后端（删除原 `backend/` 目录）
- 多用户 / 团队协作 / 多租户
- Agent 市场 / 模板库 / 可视化工作流
- 任务中途打断（`POST /interrupt`）
- 实时日志流（log_line 消息类型）—— 仅展示工具调用摘要
- Inbox 在 CLI 端的镜像存储（接受推送丢失即条目丢失的风险）
- 手机端通过 Tailscale API 自动发现节点（MVP 仅手动添加）
- 跨端 read 状态同步（Inbox 仅手机本地）

---

## 3. 用户与使用场景

**目标用户**：个人开发者（早期自用，单人单 tailnet）

### 场景 A — 异步托管
桌面端用 `msctl agent invoke` 或在 App 上发起一个长任务，
切去做别的；任务出错或 Agent 在某步需要确认时，
手机推送弹出 → 点开 Inbox → 直接在卡片上选 yes/no 或补充文本 → 任务继续。

### 场景 B — 灵感落地
用户在外用手机打开 App → 选 `blog-fixer` Agent → 新开 thread →
发"加一个深色模式开关" → Agent 在本地执行，
手机看到 tool_call 流（"读 tailwind.config.ts"、"写 ThemeToggle.tsx"），
完成时推送通知。

### 场景 C — 多机协作
用户在台式机和笔记本各跑一个 `msctl serve`，
App 里加了两个 tunnel 端点 → Agent 列表合并展示，
Inbox 也聚合两台机器的事件、按时间排序。

---

## 4. 架构总览

```
┌─────────────────────── 手机 App（React Native + Expo）─────────────────────┐
│                                                                            │
│   AgentStore        ChatStore         InboxStore（本地 SQLite）            │
│        │                │                  ▲                               │
│        │ HTTPS+WSS      │ WebSocket        │ Expo Push                     │
│        ▼                ▼                  │                               │
└────────┼────────────────┼──────────────────┼───────────────────────────────┘
         │                │                  │
         │   Tailscale Funnel(公网 HTTPS / WSS)+ Bearer token                │
         │                │                  │                               │
┌────────▼────────────────▼──────────────────┴───────────────────────────────┐
│                       msctl serve(本机进程)                                 │
│  REST /api/v1/*    WebSocket /ws/conversations/{id}    Push outbound        │
│        │                          │                          │              │
│        ▼                          ▼                          ▼              │
│  SQLite (~/.config/msctl/serve.db)                   exp.host POST          │
│  ├── agents                                                                 │
│  ├── conversations / threads / messages                                     │
│  ├── tasks(含 importance, status)                                           │
│  └── push_tokens(注册的 Expo Push Token)                                    │
│        │                                                                    │
│        ▼                                                                    │
│  Runtime adapter ─→ Claude Code SDK / Codex CLI / 自定义脚本                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 关键设计决策一览

| #    | 决策                       | 选择                                     |
| ---- | -------------------------- | ---------------------------------------- |
| D-1  | 是否保留中心后端           | 否，删除 `backend/`                      |
| D-2  | tunnel 方案                | 仅 Tailscale Funnel（MVP）               |
| D-3  | 数据归属                   | 100% 本地 SQLite                         |
| D-4  | CLI 离线时手机表现         | App 显示本地缓存历史 + Inbox（只读）     |
| D-5  | 实时协议                   | WebSocket（双向）                        |
| D-6  | 推送                       | Expo Push Service（CLI 直接调用）        |
| D-7  | 认证                       | Bearer token（强制，所有请求）           |
| D-8  | 一个用户多台机器           | App 多 tunnel 端点 + 聚合视图            |
| D-9  | Registry 分层              | CLI 权威源 + App 聚合/缓存               |
| D-10 | Agent 注册入口             | 仅 CLI（`msctl agent register`）         |
| D-11 | 对话模型                   | 一个 Agent 多 thread                     |
| D-12 | ask Question 形态          | 选项 + "其他"自由文本                    |
| D-13 | ask Question 阻塞          | 完全阻塞等待回答                         |
| D-14 | 中途打断                   | MVP 不支持                               |
| D-15 | 复杂任务定义               | Agent 自声明（task_status.importance）   |
| D-16 | Inbox 存储                 | 仅 App 本地 SQLite（接受推送丢失风险）   |
| D-17 | UI 设计体系                | 沿用 PIP-BOY/Vault-Tec 绿色终端风        |

---

## 5. 数据模型

### 5.1 CLI 端（`~/.config/msctl/serve.db` SQLite）

#### `agents`
| 字段          | 类型              | 说明                                |
| ------------- | ----------------- | ----------------------------------- |
| id            | TEXT (uuid)       | 主键                                |
| name          | TEXT              | 唯一名                              |
| project_path  | TEXT              | 工作目录绝对路径                    |
| runtime       | TEXT              | `claude-code` / `codex` / `custom`  |
| created_at    | INTEGER (unix ms) |                                     |

#### `conversations`
| 字段             | 类型    | 说明                                                                     |
| ---------------- | ------- | ------------------------------------------------------------------------ |
| id               | TEXT    | 主键                                                                     |
| agent_id         | TEXT FK |                                                                          |
| title            | TEXT    | 由首条 user_text 生成或用户重命名                                        |
| created_at       | INTEGER |                                                                          |
| last_message_at  | INTEGER |                                                                          |
| status           | TEXT    | `idle` / `running` / `awaiting_question` / `completed` / `failed`        |

#### `messages`
| 字段             | 类型        | 说明                                  |
| ---------------- | ----------- | ------------------------------------- |
| id               | TEXT        | 主键                                  |
| conversation_id  | TEXT FK     |                                       |
| role             | TEXT        | 见 §6.2 消息类型枚举                  |
| payload          | TEXT (JSON) | 见 §6.2 各类型 schema                 |
| created_at       | INTEGER     |                                       |
| seq              | INTEGER     | 在该 conversation 内的单调序号        |

#### `tasks`
| 字段              | 类型    | 说明                                                       |
| ----------------- | ------- | ---------------------------------------------------------- |
| id                | TEXT    | 主键                                                       |
| conversation_id   | TEXT FK | 所属对话                                                   |
| importance        | TEXT    | `normal` / `complex`（决定是否进 Inbox + 推送）            |
| status            | TEXT    | `running` / `completed` / `failed`                         |
| started_at        | INTEGER |                                                            |
| ended_at          | INTEGER |                                                            |

#### `push_tokens`
| 字段             | 类型    | 说明                       |
| ---------------- | ------- | -------------------------- |
| id               | TEXT    | 主键                       |
| expo_push_token  | TEXT    | `ExponentPushToken[xxx]`   |
| device_label     | TEXT    | 用户可读名                 |
| registered_at    | INTEGER |                            |

### 5.2 App 端（Expo SQLite，`multisoul.db`）

#### `endpoints`
| 字段          | 类型    | 说明                                                              |
| ------------- | ------- | ----------------------------------------------------------------- |
| id            | TEXT    | 主键（uuid）                                                      |
| label         | TEXT    | 用户给端点起的名                                                  |
| base_url      | TEXT    | `https://xxx.ts.net` 或 `https://xxx.tail-scale.ts.net`           |
| token         | TEXT    | Bearer token（明文存 Keychain，不入 SQLite）                      |
| last_seen_at  | INTEGER | 最近一次成功 ping                                                 |

#### `agents_cache`
快照式缓存 CLI 上的 `agents` 表，键 `(endpoint_id, agent_id)`。

#### `messages_cache`
按 conversation 缓存最近 N 条（默认 200），用于离线只读。

#### `inbox`
| 字段            | 类型        | 说明                                                            |
| --------------- | ----------- | --------------------------------------------------------------- |
| id              | TEXT        | 主键，与推送 payload 中 `inbox_id` 一致                         |
| endpoint_id     | TEXT        | 来源端点                                                        |
| agent_id        | TEXT        |                                                                 |
| conversation_id | TEXT        |                                                                 |
| kind            | TEXT        | `pending_question` / `complex_done` / `complex_failed`          |
| title           | TEXT        | 推送标题                                                        |
| body            | TEXT        | 推送正文                                                        |
| payload         | TEXT (JSON) | 详细数据（如 ask_question 选项）                                |
| received_at     | INTEGER     |                                                                 |
| read_at         | INTEGER NULL |                                                                |

---

## 6. 接口与协议

所有请求/连接强制带 `Authorization: Bearer <token>`，否则 `401 Unauthorized`。
Token 在 `msctl serve` 首次启动时随机生成，与 Funnel URL 一起拼成连接串供配对。

### 6.1 REST API

#### Agent 管理
- `GET  /api/v1/agents` — 列出本机所有 Agent
- `GET  /api/v1/agents/{id}` — 详情
- （注册仅 CLI 本地命令，无 REST 端点）

#### Conversation / Message
- `GET  /api/v1/agents/{agentId}/conversations` — 列出某 Agent 下所有 thread
- `POST /api/v1/agents/{agentId}/conversations` — 新建 thread
- `GET  /api/v1/conversations/{id}/messages?since_seq=N` — 拉取增量消息
- `POST /api/v1/conversations/{id}/messages` — 用户发消息（仅 user_text 由 REST 提交，其他类型只通过 WS 推送）

#### Push Token
- `POST /api/v1/push-tokens` — App 注册 Expo Push Token
- `DELETE /api/v1/push-tokens/{id}` — 注销

#### 健康检查
- `GET /api/v1/healthz` — 返回 `{ "ok": true, "version": "0.1.0" }`，**不需要鉴权**

#### 错误格式
```json
{ "error": "human readable", "code": "MACHINE_CODE" }
```

### 6.2 WebSocket：`/ws/conversations/{id}`

**升级请求**：URL query `?token=<bearer>` 或 `Sec-WebSocket-Protocol: bearer.<token>`（避免反向代理 strip Authorization）。

**心跳**：客户端每 30s 发 `{"type":"ping"}`，服务端回 `{"type":"pong"}`；60s 无 pong 视为断线。

**消息封包**（双向 JSON）：

```ts
type Envelope =
  | { type: "ping" } | { type: "pong" }
  | { type: "message"; seq: number; role: Role; payload: any; created_at: number }
  | { type: "answer";  ask_id: string; choice_id?: string; freeform?: string }   // 客户端 → 服务端，回应 ask_question
```

**Role 枚举（payload schema）**：

| role           | payload 示例                                                                                                                                                  | 说明                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `user_text`    | `{ "text": "加一个深色模式" }`                                                                                                                                |                                                                            |
| `agent_text`   | `{ "text": "好的，先看一下..." }`                                                                                                                             |                                                                            |
| `tool_call`    | `{ "tool": "Bash", "args": "ls -la", "call_id": "abc" }`                                                                                                      | UI 默认折叠                                                                |
| `tool_result`  | `{ "call_id": "abc", "ok": true, "summary": "..." }`                                                                                                          | UI 默认折叠                                                                |
| `ask_question` | `{ "ask_id": "q1", "prompt": "要不要替换现有的 ThemeProvider?", "options": [{"id":"y","label":"替换"},{"id":"n","label":"保留"}], "allow_freeform": true }`   | **阻塞**任务直至 `answer` 抵达                                             |
| `task_status`  | `{ "task_id": "t1", "status": "completed", "importance": "complex", "summary": "✅ 已加深色模式" }`                                                            | importance=complex 时 → Inbox + Push                                       |

### 6.3 推送 payload（CLI → Expo → 手机）

```json
{
  "to": "ExponentPushToken[xxx]",
  "title": "🟢 blog-fixer 完成任务",
  "body": "已加深色模式，3 个文件改动",
  "data": {
    "kind": "complex_done",
    "endpoint_id": "ep-1",
    "agent_id": "ag-1",
    "conversation_id": "cv-1",
    "inbox_id": "ib-1",
    "deep_link": "multisoul://inbox/ib-1"
  },
  "priority": "high",
  "channelId": "multisoul-default"
}
```

App 收到后**立即写入本地 `inbox` 表**（不依赖 CLI 返查），然后通过 deep link 跳转。

### 6.4 配对流程（首次添加端点）

```bash
$ msctl serve --funnel
✓ Tailscale Funnel 已开启
✓ 监听: https://alans-mac.tailnet-ab12.ts.net (公网 HTTPS)
✓ Bearer token: ms_v2_4f9c2a8b1d3e6f0a...

  扫描下面二维码添加到 MultiSoul App：
  ┌────────────────────────────┐
  │ ▓▓ ▓ ▓▓▓▓▓ ▓▓▓ ▓▓ ▓▓▓ ▓▓ │
  │ ▓ ▓▓ ▓▓ ▓ ▓▓▓▓ ▓ ▓▓ ▓▓▓ │
  │  ...                       │
  └────────────────────────────┘

  或粘贴连接串：
  multisoul://pair?url=https://alans-mac.tailnet-ab12.ts.net&token=ms_v2_...
```

App 端：**Settings → Endpoints → ➕ → 扫码 / 粘贴 → 自动调 `GET /healthz` 验活 → 保存**。

---

## 7. CLI 命令设计

### 7.1 现有命令（保留，token 配置改为本地 serve.db）
```bash
msctl auth login --token <bearer>     # 改为本地配置(不再调云后端)
msctl auth status
msctl agent register --name foo --project ~/code/foo --runtime claude-code
msctl agent list
msctl agent get <id>
msctl agent update <id> [--name ...]
msctl agent delete <id>
msctl agent invoke <id> --message "..."   # 等价于建一个 thread + 发一条 user_text
```

### 7.2 新增 `msctl serve`
```bash
msctl serve                              # 监听 127.0.0.1:8765(仅本机)
msctl serve --tailnet                    # 监听 tailnet 接口(仅 tailnet 内可达)
msctl serve --funnel                     # 自动调 `tailscale funnel` 开 443 公网(推荐)
msctl serve --token <bearer>             # 指定 token(默认随机生成并打印)
msctl serve --port 8765
```

### 7.3 移除的命令
- `msctl daemon start/stop/status` —— 旧版 daemon 概念被 `msctl serve` 取代

---

## 8. 手机端页面与导航

底部三 tab：**Agents · Chat · Inbox**

### 8.1 Agents tab
- 顶部：当前所有 endpoint 的健康指示灯（绿/灰/红）
- 列表项：Agent 卡片（名称、项目路径短显示、所属机器 label、当前 thread 数）
- 点击 → 进入该 Agent 的 thread 列表 → 选 thread 进 Chat 详情
- ➕ 浮动按钮：跳到 Settings → Endpoints

### 8.2 Chat tab
- 显示最近活跃的 thread 列表（跨 endpoint 合并）
- 点击 → 全屏 Chat 详情：
  - 滚动消息流，按 §6.2 schema 渲染各类型
  - tool_call / tool_result 默认折叠成一行 `[Bash] ls -la → ok`
  - `ask_question` 渲染为**实心绿色卡片**：选项按钮 + 折叠的"其他"文本框 + 提交
  - `task_status.completed/failed` 渲染为分隔横线 + 终态徽章
  - 底部输入框：仅在 status=`idle` 时可用；任务进行中输入框置灰提示「Agent 正在执行…」

### 8.3 Inbox tab
- 列表按 `received_at` 倒序，未读项左边 2px 绿色色条
- 三种 kind 不同图标：
  - `pending_question` ⊕（卡片可在列表上**直接展开 + 回答**）
  - `complex_done` ✓
  - `complex_failed` ✗
- 仅一个动作：回答 ask_question；其他类型点击跳转到对应 Chat thread
- 无 archive/snooze/批量已读（MVP 砍掉）

### 8.4 Settings
- Endpoints 管理（增删、重命名）
- Push Token 注册状态（异常时手动重注册按钮）
- 设计 token 沿用 `mobile/docs/design.md` PIP-BOY 体系（无变化）

---

## 9. 状态、错误与边界情况

| 场景                                                       | 行为                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 端点 health check 连续 3 次失败（30s 间隔）                | endpoint 标记 offline，列表灰显，Chat tab 输入框禁用并显示「[ENDPOINT_NAME] 当前不可达」                              |
| Funnel URL 变化（重启 tailscaled）                         | 端点失联 → 用户重新扫码替换，旧条目可"更新连接串"                                                                     |
| WebSocket 断线                                             | 客户端指数退避重连（1s, 2s, 4s, ..., 上限 30s）；重连后用 `messages?since_seq=N` 拉缺失消息                           |
| Expo Push 失败                                             | CLI 仅记录 warning 日志（不重试），Inbox 在 App 端永久缺失该条（**已知风险，MVP 接受**）                              |
| ask_question 提交后 30 分钟仍未走完任务                    | UI 显示「Agent 仍在处理…」无超时强中止                                                                                |
| 用户在多台手机登录                                         | 每个设备独立 Expo Push Token，独立 Inbox 副本，互不同步                                                               |
| token 泄露                                                 | 只能撤销整个 endpoint，重启 `msctl serve` 重新生成 token                                                              |
| 任务执行触发 destructive 操作（rm -rf, git push -f）       | MVP 不做白名单/确认，由用户自己控制 Agent runtime 权限                                                                |

---

## 10. 非功能性需求

| 维度        | 目标                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| 并发        | 单用户、单 tailnet；无并发承诺                                                                |
| 推送时延    | Agent 标记 task_status=complex 后，手机 ≤30s 收到推送（前提：Expo 正常）                      |
| WS 消息时延 | 局域网 < 100ms，跨地域 funnel < 800ms                                                         |
| 安全        | 强制 Bearer token；HTTPS/WSS（Tailscale Funnel 自带 cert）；无明文回退                        |
| 可维护      | SQLite 单文件，便于备份；schema 变更走轻量 migration（rusqlite + 顺序 SQL）                   |
| 可扩展      | App 多 endpoint 设计天然支持后续把"自营/朋友共享 endpoint"接进来                              |

---

## 11. 风险、权衡与未决

### 已知风险
| 风险                                            | 应对                                                          |
| ----------------------------------------------- | ------------------------------------------------------------- |
| 推送丢失 = Inbox 永久缺失                       | MVP 接受；V2 加 CLI 端 inbox 镜像 + App 启动增量拉取          |
| Funnel URL 暴露 → 拿到 token 即拿到执行权限     | token 强制；后续可加 CIDR 白名单或可选 mTLS                   |
| Agent 写危险命令                                | MVP 不限；后续做工具白名单 + 危险指令二次确认                 |
| Tailscale 服务故障                              | Funnel 是托管服务，故障期不可用；属于产品依赖                 |

### 已做的权衡
- **零中心后端 vs Inbox 高可达** → 选零后端，接受推送丢失
- **Tailscale only vs 多 tunnel 兼容** → MVP 仅 Tailscale，文档/QR/healthz 都简化
- **WebSocket vs 轮询** → WS（与 cc-connect 现有协议契合，未来可复用其 Platform plugin）
- **Inbox 在 App 本地 vs CLI 镜像** → App 本地，简化 MVP

### 未决问题
- V2 是否接入 cc-connect 作为 runtime adapter 之一（目前 `cli/cc-connect/` 已存在）
- 是否做 task_status 的多种 importance 等级（目前仅 normal/complex 二值）
- iOS 后台限制下，长时间未打开 App 时本地 Inbox 是否会被系统压缩

---

## 12. 验收标准（MVP Demo 目标）

### 必须通过
- [ ] **AC-1 启动**：`msctl serve --funnel` 成功启动，输出 Tailscale Funnel 公网 URL + token + QR
- [ ] **AC-2 健康检查**：`GET /api/v1/healthz` 返回 200，无 token 也可达
- [ ] **AC-3 鉴权**：缺失/错误 Bearer token 时所有业务接口返回 401
- [ ] **AC-4 配对**：App 扫描 QR / 粘贴连接串后，能在 Endpoints 列表看到新端点 + 健康灯转绿
- [ ] **AC-5 Agent 列表**：CLI 上 `msctl agent register` 创建的 Agent 在 App 内 ≤5s 显示
- [ ] **AC-6 多机聚合**：同时加入 2 台机器的 endpoint，App Agent 列表合并显示，Inbox 时间线合并
- [ ] **AC-7 对话**：App 内对 Agent 发送一条消息，能看到 user_text → tool_call/tool_result（折叠态）→ agent_text 流
- [ ] **AC-8 ask Question**：Agent 触发 ask_question，App 渲染卡片，选项 + 自由文本提交后任务继续
- [ ] **AC-9 推送**：标记 importance=complex 的任务完成 / 失败时，手机 ≤30s 收到推送
- [ ] **AC-10 Inbox 写入**：推送抵达后，App 本地 Inbox 表立即出现新记录，可 deep link 跳转
- [ ] **AC-11 离线只读**：拔掉 CLI 网络，App 仍能滚动查看缓存历史与 Inbox（输入框禁用）
- [ ] **AC-12 测试覆盖**：CLI 端关键路径（WS 心跳、ask_question 阻塞、Expo POST、Bearer 校验）有集成测试

### 目录结构（最终）
```
multisoul/
├── mobile/             # React Native + Expo(保留)
├── cli/                # Rust msctl(保留 + 新增 serve 子命令)
│   └── cc-connect/     # 暂保留作为 V2 runtime 候选
└── docs/
    └── SPEC.md
# backend/ ← 删除
# docker-compose.yml ← 删除(不再需要 PostgreSQL)
```
