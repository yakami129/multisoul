# AskQuestion Card 双向同步修复设计

**日期：** 2026-04-27  
**状态：** 待实施  
**范围：** mobile/

---

## 问题描述

AskQuestion 卡片在 Chat 和 Inbox 两侧状态不同步：

- 在 Chat 里回答后，Inbox 仍显示该 pending_question 条目
- 在 Inbox 里回答后，Chat 里的问答卡片仍显示为可操作状态

**根本原因：**

1. `inboxStore` 没有 `removeItem` 方法，回答后只做 `markRead`，item 永久留在 SQLite 和内存中
2. Chat 端 `sendAnswer` / `sendAnswerMulti` 发完后，不通知 `inboxStore`
3. Inbox 端回答后，不通知 `chatStore` 更新消息状态
4. `WsMessage` / `chatStore` 没有"已回答"字段，无法让 AskQuestionCard 渲染已回答状态

---

## 修复方案：客户端直接联动（乐观更新）

答题后立即在客户端同步两侧状态，不依赖后端 ACK。

---

## 架构变更

### 1. `inboxStore` — 新增 `removeItem`

**文件：** `mobile/src/store/inboxStore.ts`

新增方法：

```typescript
removeItem: (id: string) => Promise<void>
```

实现：
- 调用 `deleteInboxItem(id)` 从 SQLite 中 DELETE
- 从内存 `items[]` 中 filter 掉该 id

**文件：** `mobile/src/features/inbox/services/inboxService.ts`  
新增函数：

```typescript
export async function deleteInboxItem(id: string): Promise<void>
// DELETE FROM inbox WHERE id = ?
```

---

### 2. `chatStore` — 新增 `answered` 字段与 `markAnswered`

**文件：** `mobile/src/types.ts`

`WsMessage` 新增可选字段：

```typescript
export interface WsMessage {
  // ...existing fields...
  answered?: boolean;   // 仅客户端使用，不来自服务端
}
```

**文件：** `mobile/src/store/chatStore.ts`

新增方法：

```typescript
markAnswered: (conv_id: string, ask_id: string) => void
```

实现：
- 找到 `messages[conv_id]` 中 `payload.ask_id === ask_id` 且 `role === 'ask_question'` 的消息
- 设置 `msg.answered = true`

---

### 3. `AskQuestionCard` / `MultiAskQuestionCard` — 支持外部 answered 状态

**文件：** `mobile/src/features/chat/components/AskQuestionCard.tsx`  
**文件：** `mobile/src/features/chat/components/MultiAskQuestionCard.tsx`

Props 新增：

```typescript
answered?: boolean;  // 外部传入已回答状态
```

行为：
- 若 `answered === true`，组件初始化时 `answered` 内部状态设为 `true`，直接渲染"已回答"样式，禁用交互

---

### 4. `MessageBubble` — 透传 answered 状态

**文件：** `mobile/src/features/chat/components/MessageBubble.tsx`

读取 `msg.answered`，透传给 `AskQuestionCard` / `MultiAskQuestionCard`：

```typescript
<AskQuestionCard
  answered={msg.answered}
  // ...existing props
/>
```

---

### 5. Chat 端回答后清理 Inbox

**文件：** `mobile/src/hooks/useWebSocket.ts`

`sendAnswer` / `sendAnswerMulti` 发送后立即调用：

```typescript
inboxStore.removeItem(ask_id)
```

---

### 6. Inbox 端回答后清理 + 更新 Chat

**文件：** `mobile/app/(tabs)/inbox.tsx`

`handleAnswer` / `handleAnswerMulti` 中，`sendConversationAnswer` 成功后：

1. 调用 `inboxStore.removeItem(ask_id)` （替换原来的 `markRead`）
2. 调用 `chatStore.markAnswered(item.conversation_id, ask_id)`

---

## 数据流（修复后）

```
CHAT 端回答：
  用户确认 → sendAnswer(ask_id, choice_id)
    → WebSocket 发送 answer
    → inboxStore.removeItem(ask_id)   ← 新增
    → Inbox 条目消失 ✓

INBOX 端回答：
  用户确认 → sendConversationAnswer(...)
    → WebSocket 临时连接发送 answer
    → inboxStore.removeItem(ask_id)   ← 替换 markRead
    → chatStore.markAnswered(conv_id, ask_id)  ← 新增
    → Chat 里卡片变为已回答状态 ✓
    → Inbox 条目消失 ✓
```

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/types.ts` | 修改 | WsMessage 加 `answered?: boolean` |
| `src/store/inboxStore.ts` | 修改 | 新增 `removeItem` 方法 |
| `src/features/inbox/services/inboxService.ts` | 修改 | 新增 `deleteInboxItem` 函数 |
| `src/store/chatStore.ts` | 修改 | 新增 `markAnswered` 方法 |
| `src/features/chat/components/AskQuestionCard.tsx` | 修改 | 新增 `answered` prop |
| `src/features/chat/components/MultiAskQuestionCard.tsx` | 修改 | 新增 `answered` prop |
| `src/features/chat/components/MessageBubble.tsx` | 修改 | 透传 `msg.answered` |
| `src/hooks/useWebSocket.ts` | 修改 | 答题后调 `inboxStore.removeItem` |
| `app/(tabs)/inbox.tsx` | 修改 | 答题后调 `removeItem` + `markAnswered` |

---

## 不在此次范围内

- 后端 ACK 机制（方案 B，留后续）
- 失败回滚逻辑（方案 C，留后续）
- `complex_done` / `complex_failed` 类型的同步（独立问题）
