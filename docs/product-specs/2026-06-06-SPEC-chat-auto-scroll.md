# SPEC: Chat 自动滚动优化

**日期**: 2026-06-06  
**状态**: 待实现  
**关联模块**: `mobile/app/chat/`

---

## 1. 背景与目标

### 背景

打开 Chat 对话界面时，列表不会自动定位到最新的 AI 消息；用户发送消息后，若之前翻阅过历史记录，界面也不会拉回底部。这两个问题共同导致用户需要手动下拉才能看到最新内容，影响使用体验。

### 目标

- **打开对话**：无论消息是从本地缓存还是服务端异步加载，页面最终均定位到最后一条 `role=assistant` 消息
- **发送消息**：点击发送后，无论当前滚动位置在哪里，强制跳到列表底部
- **流式回复跟随**：Agent 打字期间，维持现有的 `isNearBottom` 跟随策略（用户上翻时自动停止跟随）

---

## 2. 非目标

- 不改动 `focus_ask_id` 定位逻辑（Inbox 跳转到特定问题卡片）
- 不改动历史翻页加载（`loadOlderMessages`）逻辑
- 不改动 typing 指示器的显示逻辑
- 不涉及 CLI / WebSocket 层

---

## 3. 主要流程

### 3.1 打开对话

```
用户导航到 ChatDetailScreen
        │
        ▼
本地缓存消息渲染（可能为空）
        │
        ▼
useChatDetailServerTranscript 异步加载服务端消息
        │
        ▼
transcriptDisplayItems 更新（可能多次）
        │
        ▼
找到最后一条 role=assistant 的消息索引
  ├── 找到 → scrollToIndex(index, animated: false, viewPosition: 0)
  └── 未找到 → scrollToEnd(animated: false)
        │
        ▼
标记初始定位完成（避免重复触发）
```

### 3.2 发送消息

```
用户点击发送
        │
        ▼
onSend() 调用 handleSend(text)
        │
        ▼
消息加入列表，transcriptDisplayItems 更新
        │
        ▼
强制 scrollToEnd(animated: true)
（不检查 isNearBottomRef）
```

### 3.3 流式回复跟随（保持现有逻辑）

```
Agent 推送新 token
        │
        ▼
handleContentSizeChange 触发
        │
        ▼
isNearBottomRef.current === true？
  ├── 是 → scrollToEnd(animated: true)
  └── 否 → 不滚动（用户在翻历史，不打断）
```

---

## 4. 边界情况

| 场景 | 预期行为 |
|------|----------|
| 打开时无任何消息 | 不触发滚动，等待消息加载后再定位 |
| 打开时只有 User 消息、无 AI 消息 | 降级到 `scrollToEnd` |
| 服务端消息在 300ms 后才返回 | 监听 `transcriptDisplayItems` 变化，每次更新都重新检查并定位（直到初始定位完成标记置 true） |
| 发送消息时 Agent 正在流式回复 | 强制滚底，流式跟随继续接管后续滚动 |
| `focus_ask_id` 存在（从 Inbox 跳转） | 优先执行 focus 定位，跳过初始滚底逻辑（现有行为不变） |
| 消息列表极短（全部可见） | 无视觉差异，行为正确 |

---

## 5. UI/UX 要求

| 场景 | 动画 |
|------|------|
| 打开对话 → 定位到最后 AI 消息 | `animated: false`（避免初始加载时的跳动） |
| 发送消息 → 滚到底部 | `animated: true`（给用户视觉反馈） |
| 流式跟随 | `animated: true`（现有，不变） |

---

## 6. 实现提示（供开发参考）

- 改动集中在 `mobile/app/chat/useChatDetailTranscriptScroll.ts`
- 打开定位：在 `transcriptItems` 变化的 `useEffect` 中，找最后一条 `item.kind === 'message' && item.message.role === 'assistant'` 的 index，用 `scrollToIndex` 替换 `scrollToEnd`；`pendingInitialBottomScrollRef` 逻辑保留作完成标记
- 发送定位：在 `[id].tsx` 的 `onSend()` 中（或 `useChatDetailAgentTurn` 的 `handleSend` 回调里），调用完消息入列后立即执行 `listRef.current?.scrollToEnd({ animated: true })`
- 流式跟随：`handleContentSizeChange` 里的 `isNearBottomRef` 判断维持现状，无需改动

---

## 7. 验收标准

- [ ] **AC-1**：打开一个有历史消息的对话，页面自动定位到最后一条 AI 消息，无跳动动画
- [ ] **AC-2**：打开对话后，服务端消息异步加载完成，页面重新定位到（新的）最后 AI 消息
- [ ] **AC-3**：用户翻阅历史记录（上滑），然后点击发送，页面立即以动画跳回底部
- [ ] **AC-4**：Agent 流式回复时，若用户未上翻，页面持续跟随新内容；若用户上翻则停止跟随
- [ ] **AC-5**：从 Inbox 携带 `focus_ask_id` 跳转时，定位到对应问题卡片，不受上述逻辑影响
- [ ] **AC-6**：`pnpm typecheck` 通过，`pnpm test -- --watchAll=false` 无新增失败
