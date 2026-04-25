# IM 集成设计文档

**日期：** 2026-04-19  
**状态：** 已批准  
**范围：** multisoul mobile ↔ backend ↔ cc-connect 聊天功能接入

---

## 1. 背景

multisoul 是一个 AI Agent 管理平台。mobile 端目前只支持 Agent CRUD，无法与 Agent 直接对话。cc-connect 是本地 AI Agent 网关，支持多平台 WebSocket 接入。本期目标是打通 mobile → backend → cc-connect 的完整 IM 链路，让用户可以在 App 内与每个 Agent 进行持久化聊天。

---

## 2. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  mobile (React Native)                                      │
│  ChatScreen ──WS──▶ useChatSocket hook ──▶ /ws/chat        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Bearer API Key
                               │ ws://backend/ws/chat
┌──────────────────────────────▼──────────────────────────────┐
│  backend (Spring Boot)                                      │
│                                                             │
│  WsChatHandler          CcConnectClient                     │
│  (mobile 连接入口)  ◀──▶  (主动连接 cc-connect)             │
│       │                                                     │
│  ChatMessageRepository                                      │
│  (持久化 chat_messages)                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ shared secret token
                               │ ws://cc-connect/ws/platform
┌──────────────────────────────▼──────────────────────────────┐
│  cc-connect                                                 │
│  platform/multisoul ──▶ core/engine ──▶ agent/claudecode   │
└─────────────────────────────────────────────────────────────┘
```

**依赖方向：**
- cc-connect 主动 dial backend（backend 是"IM 服务端"）
- mobile 主动 dial backend（backend 是"WS 网关"）
- backend 不感知 cc-connect 内部实现

---

## 3. 新增组件

| 位置 | 组件 | 职责 |
|------|------|------|
| cc-connect | `platform/multisoul` | 实现 Platform + MessageUpdater，连接 backend WS |
| backend | `WsChatHandler` | 接受 mobile WS 连接，鉴权，路由消息 |
| backend | `CcConnectClient` | 维护到 cc-connect 的 WS 长连接，断线重连 |
| backend | `ChatMessage` entity + repo | 持久化消息记录 |
| mobile | `useChatSocket` | 管理 WS 连接、消息状态、重连逻辑 |
| mobile | `ChatScreen` | 聊天 UI，每个 Agent 一个入口 |

---

## 4. WebSocket 协议

### 4.1 mobile ↔ backend (`/ws/chat`)

鉴权：连接时 URL 带 `?token=<API_KEY>`

**mobile → backend（发消息）**
```json
{"type": "message", "payload": {"agent_id": "uuid", "text": "你好"}}
```

**backend → mobile（AI 流式回复 chunk）**
```json
{"type": "chunk", "payload": {"message_id": "uuid", "agent_id": "uuid", "text": "你", "done": false}}
{"type": "chunk", "payload": {"message_id": "uuid", "agent_id": "uuid", "text": "好啊", "done": true}}
```

**backend → mobile（连接后推送历史记录）**
```json
{"type": "history", "payload": {"agent_id": "uuid", "messages": [
  {"id": "uuid", "role": "user", "text": "...", "created_at": "ISO8601"},
  {"id": "uuid", "role": "assistant", "text": "...", "created_at": "ISO8601"}
]}}
```

**backend → mobile（错误）**
```json
{"type": "error", "payload": {"code": "AGENT_NOT_FOUND", "message": "..."}}
```

### 4.2 backend ↔ cc-connect (`/ws/platform`)

cc-connect 主动 dial，鉴权用 `?token=<PLATFORM_SECRET>`

**backend → cc-connect（转发用户消息）**
```json
{"type": "message", "payload": {
  "message_id": "uuid",
  "from_user_id": "user:{userId}",
  "session_key": "multisoul:{agentId}:{userId}",
  "text": "你好"
}}
```

**cc-connect → backend（AI 流式 chunk）**
```json
{"type": "chunk", "payload": {
  "message_id": "uuid",
  "session_key": "multisoul:{agentId}:{userId}",
  "text": "你好啊",
  "done": false
}}
{"type": "chunk", "payload": {
  "message_id": "uuid",
  "session_key": "multisoul:{agentId}:{userId}",
  "text": "",
  "done": true
}}
```

**流式拼接规则：** mobile 收到同一 `message_id` 的 chunk 时追加文本，`done: true` 时标记完成。backend 在 `done: true` 时将完整消息写入 DB。

---

## 5. 数据模型

### 5.1 `chat_messages` 表

```sql
CREATE TABLE chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        VARCHAR(16) NOT NULL,  -- 'user' | 'assistant'
    text        TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_session
    ON chat_messages (agent_id, user_id, created_at DESC);
```

- 历史记录默认返回最近 50 条，按 `created_at ASC` 排列
- 流式消息在 `done: true` 时才写入，中间 chunk 不落库

### 5.2 内存状态（不持久化）

```
mobileConnections: Map<userId, WebSocketSession>
  — 每个在线用户的 mobile WS 连接（同一用户重复连接踢掉旧连接）

pendingChunks: Map<messageId, StringBuilder>
  — 正在流式接收的消息缓冲，done=true 时写 DB 并清除
```

### 5.3 SessionKey 格式

```
multisoul:{agentId}:{userId}
```

每个用户×Agent 对话上下文独立，cc-connect engine 按 SessionKey 路由 AI 会话。

---

## 6. 错误处理与重连

### mobile 端

- 断线后指数退避重连（1s → 2s → 4s，最大 30s）
- 重连成功后自动重新拉取历史
- UI 状态：连接中 / 已连接 / 重连中（顶部 banner 提示）

### backend

- 同一 userId 重复连接时踢掉旧连接
- `CcConnectClient` 断线后指数退避重连，重连期间返回 `SERVICE_UNAVAILABLE`
- 心跳：每 30s 发 `{"type": "ping"}`，40s 无响应则主动断线重连

### cc-connect

- 标准 `connectLoop` 重连
- `MessageUpdater` 发送失败时 fallback 到普通 `Reply`

### 边界情况

| 场景 | 处理 |
|------|------|
| AI 响应超时（>60s） | backend 发 `error: TIMEOUT`，不写 DB |
| agent_id 不属于当前用户 | 返回 `error: AGENT_NOT_FOUND`，断开连接 |
| 消息文本为空 | mobile 端拦截，不发送 |
| cc-connect 未启动 | `CcConnectClient` 后台重试，不阻塞 backend 启动 |

---

## 7. 验收标准

### 功能验收

| # | 场景 | 预期结果 |
|---|------|---------|
| F-1 | mobile 打开 Agent 详情页，进入聊天 | WS 连接建立，历史消息加载（最近 50 条） |
| F-2 | 发送一条消息 | 消息立即显示在 UI，AI 回复流式逐字出现 |
| F-3 | 流式回复完成 | `done: true` 后消息写入 DB，刷新 App 后历史可见 |
| F-4 | 关闭 App 重新打开 | 历史记录完整恢复 |
| F-5 | 网络断开后恢复 | mobile 自动重连，无需手动操作 |
| F-6 | cc-connect 未运行时发消息 | UI 显示"服务不可用"错误提示 |
| F-7 | 用 agent A 和 agent B 分别对话 | 两个会话上下文完全独立，互不干扰 |

### 技术验收

| # | 项目 | 标准 |
|---|------|------|
| T-1 | cc-connect 单元测试 | `platform/multisoul` 通过收发消息、流式 chunk、去重三个测试 |
| T-2 | backend 集成测试 | `WsChatHandler` 测试：鉴权拒绝、消息转发、历史查询 |
| T-3 | 消息持久化 | `done: true` 后 DB 有记录，中间 chunk 不落库 |
| T-4 | 会话隔离 | 同一用户两个 Agent 的 `session_key` 不同，AI 上下文独立 |
| T-5 | 重连不丢消息 | mobile 断线重连后历史完整，无重复消息 |

---

## 8. 不在本期范围

- 群聊 / 多用户同一 Agent
- 消息已读状态
- 图片/文件消息
- App 后台推送通知
