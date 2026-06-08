# SPEC: Chat 自动滚动修复

**日期**: 2026-06-07  
**状态**: 已实现（修订定位策略）  
**关联模块**: `mobile/app/chat/`  
**来源对话**: `5a82e5aa-f85b-49bd-95b8-fbb948765119`  
**平台**: iOS（主要复现平台）

---

## 0. 根因更正（重要）

初版规格要求"打开时 `scrollToIndex(最后一条 agent_text, viewPosition: 0)`"。该方案在**真实长会话里几乎必然失效**：

- FlatList 默认 `initialNumToRender = 10`，灌完数据时只渲染了顶部约 10 行；当最后一条 `agent_text` 的 index 落在未测量区时，`scrollToIndex` **不会同步抛错**，而是**异步**回调 `onScrollToIndexFailed`，`try/catch` 接不住。
- 旧 `handleContentSizeChange` 在调用 `scrollToIndex` **之前**就把 `pendingInitialBottomScrollRef` 置成 `false`；于是 `onScrollToIndexFailed` 兜底与 100/300ms 重试**全部被守卫拦截**，列表停在顶部/中间。
- 旧回归测试把 `scrollToIndex` mock 成 no-op，**永不触发** `onScrollToIndexFailed`，造成"假绿"。

**更正后的定位策略**：初始与发送后的定位一律使用 `scrollToEnd`（不依赖目标行测量，不会静默失败；idle/completed 会话里最后一条 AI 回复就是列表末项）。`pendingInitialBottomScrollRef` 保持为 true，直到用户拖动列表才释放，期间每次 `onContentSizeChange` 都重新贴底，覆盖"数据分多帧到达 / 行高延迟测量"的情况。

## 1. 背景与目标

### 背景

打开 Chat 对话时，列表停在**中间某处**，而不是最新一条 AI 消息的位置。用户从 Agent 列表、Activity/Inbox、推送通知等多种入口进入对话时都会复现。发送消息后，若之前翻阅过历史记录，刚发的 user 消息无法立即可见，需要手动下滑，影响使用体验。

### 目标

- **打开对话**：无论从何入口进入，页面最终定位到**最新一条 AI message**（`role=agent_text`）的位置，无跳动动画
- **发送消息**：点击发送通过校验后，**立即滚到底部**，让刚发的 user 消息和后续 AI 回复可见（不检查当前滚动位置，强制执行）
- **流式回复跟随**：保持现有 `isNearBottom` 逻辑（接近底部时自动跟随，上翻后停止跟随）

---

## 2. 范围

### 2.1 In Scope

- Agent 列表 → 对话、Activity/Inbox 继续对话、推送通知进入等**普通入口**（无 `focus_ask_id`）的初始滚动定位
- 发送消息通过校验后的**强制滚底**行为
- 打开时定位到**最后一条 `agent_text`**（找不到时降级 `scrollToEnd`）

### 2.2 Out of Scope

- `focus_ask_id` 定位逻辑（Inbox 跳转到特定问题卡片时不受影响）
- 历史翻页加载（`loadOlderMessages`）逻辑
- typing 指示器显示逻辑
- CLI / WebSocket 层改动
- Android 平台验证（本次以 iOS 为主）

---

## 3. 主要流程

### 3.1 打开对话

```
用户从 Agent 列表/Activity/Inbox/推送进入 ChatDetailScreen
        │
        ▼
本地缓存消息渲染（可能为空或不完整）
        │
        ▼
useChatDetailServerTranscript 异步加载服务端消息
        │
        ▼
transcriptDisplayItems 更新（可能多次）
        │
        ▼
scrollToEnd(animated: false) —— 贴到列表末项（最新一条 AI 回复）
        │
        ▼
pendingInitialBottomScrollRef 保持 true，期间每次 onContentSizeChange 重新贴底
        │
        ▼
用户拖动列表（onScrollBeginDrag）→ 释放 pending，交回 isNearBottom 跟随逻辑
```

**关键点**：
- 使用 `animated: false` 避免初始加载时的视觉跳动
- 用 `scrollToEnd` 而非 `scrollToIndex`：后者在目标行未测量时会异步失败（见 §0）
- `pending` 直到用户拖动才释放，覆盖异步分帧加载 / 行高延迟测量

### 3.2 发送消息

```
用户点击发送
        │
        ▼
校验（有文本/已上传图片 && endpoint 可用）
        │
        ▼
立即清空输入框
        │
        ▼
forceScrollToEnd() → scrollToEnd(animated: true)
        │
        ▼
调用 handleSend(text)
（不检查 isNearBottomRef，无论当前位置都执行）
```

**关键点**：
- 无论用户当前滚到哪（即使正在上翻历史），都**强制滚底**
- 使用 `animated: true` 给用户明确的视觉反馈
- 在调用 `handleSend` **之前**执行滚动，确保 user 消息渲染时已接近底部

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

**无需改动**，维持现有 `BOTTOM_STICKY_THRESHOLD` 判断。

---

## 4. 边界情况

| 场景 | 预期行为 |
|------|----------|
| 打开时无任何消息 | 不触发滚动，等待消息加载后再定位 |
| 打开时只有 User 消息、无 AI 消息 | `scrollToEnd(animated: false)` 贴底 |
| 打开时有多条 AI message | `scrollToEnd` 贴到列表末项，即最新一条 AI 回复 |
| 服务端消息异步加载（延迟 300ms+） | 监听 `transcriptDisplayItems` 变化，多次尝试定位直到完成标记置 true |
| 发送时 Agent 正在流式回复 | 强制滚底，流式跟随继续接管后续滚动 |
| `focus_ask_id` 存在（Inbox 跳转） | 优先执行 focus 定位，跳过初始滚底逻辑（现有行为不变） |
| 消息列表极短（全部可见） | 行为正确，无视觉差异 |
| 用户上翻历史时新 AI token 到达 | 不自动打断；只有 `isNearBottom` 时才跟随 |
| 从中间某处发送消息 | 立即滚底，不保持当前阅读位置 |

---

## 5. UI/UX 要求

| 场景 | 动画 | 定位目标 |
|------|------|----------|
| 打开对话（普通入口） | `animated: false` | 列表底部（`scrollToEnd`，即最新一条 AI 回复） |
| 发送消息通过校验 | `animated: true` | 列表底部（`scrollToEnd`，并重置 pending 让回复跟随贴底） |
| 流式回复跟随 | `animated: false/true` | 列表底部（pending 期间贴底；用户拖动后由 isNearBottom 接管） |

---

## 6. 技术实现概览

### 改动文件

- `mobile/app/chat/useChatDetailTranscriptScroll.ts`
- `mobile/app/chat/[id].tsx`（`onSend` 调用顺序确认）

### 实现要点

1. **打开定位**（`useChatDetailTranscriptScroll`）
   - `scrollToBottom(animated)` 仅 `listRef.current?.scrollToEnd({ animated })`，**不**用 `scrollToIndex`
   - `useEffect([transcriptItems])` 在 pending 且未被用户接管时，`requestAnimationFrame` + 100ms/300ms 三次 `scrollToBottom(false)`，应对异步分帧 / 布局延迟
   - `handleContentSizeChange`：pending 且有数据且用户未拖动 → `scrollToBottom(false)` 并 `return`；**不**在此提前清 pending
   - `handleTranscriptScrollBeginDrag`：用户拖动时置 `hasUserScrolledHistoryRef = true` 且 `pendingInitialBottomScrollRef = false`，交回 isNearBottom 跟随
   - `handleScrollToIndexFailed`（非 focus 分支）：pending 时降级 `scrollToEnd(false)`，不再翻转 pending

2. **发送定位**（`[id].tsx` 的 `onSend` 顺序不变：`forceScrollToEnd()` 在 `handleSend(text)` 之前）
   - `handleSend` 不做本地乐观插入，user 消息经 WebSocket 回灌；`forceScrollToEnd` 重置 pending，使随后到达的消息与回复继续贴底
     ```ts
     const forceScrollToEnd = useCallback(() => {
       isNearBottomRef.current = true;
       hasUserScrolledHistoryRef.current = false;
       pendingInitialBottomScrollRef.current = true;
       listRef.current?.scrollToEnd({ animated: true });
     }, [listRef, hasUserScrolledHistoryRef]);
     ```

3. **流式跟随**
   - pending 期间由打开定位的贴底逻辑接管；用户拖动后由既有 `isNearBottomRef` 判断接管

---

## 7. 验收标准

- [ ] **AC-1**：从 Agent 列表进入有历史消息的对话，页面自动定位到最新一条 AI message，无跳动动画
- [ ] **AC-2**：从 Activity/Inbox 继续对话，页面定位到最新 AI message
- [ ] **AC-3**：从推送通知进入对话，页面定位到最新 AI message
- [ ] **AC-4**：打开对话后，服务端消息异步加载完成（延迟 300ms+），页面重新定位到（新的）最新 AI message
- [ ] **AC-5**：用户上翻历史记录，然后点击发送；页面立即以动画跳回底部，刚发的 user 消息可见
- [ ] **AC-6**：Agent 流式回复时，若用户未上翻（接近底部），页面持续跟随；若用户上翻则停止跟随
- [ ] **AC-7**：从 Inbox 携带 `focus_ask_id` 跳转时，定位到对应问题卡片，不受上述逻辑影响
- [x] **AC-8**：只有 User 消息、无 AI message 的对话，打开后 `scrollToEnd` 贴到列表底部（回归测试覆盖）
- [x] **AC-9**：`pnpm typecheck` 通过，`pnpm exec jest --watchAll=false` 546 passed（含新增的 long-list / 异步分帧 / 假绿防护回归测试）；iOS 真机场景待人工确认

---

## 8. 风险与权衡

| 风险 | 应对 |
|------|------|
| FlatList `scrollToIndex` 可能在布局未完成时抛异常 | 使用 try-catch 包裹，失败时降级 `scrollToEnd`；保留重试机制 |
| 服务端消息异步加载，多次定位可能导致闪烁 | 统一使用 `animated: false`，重试间隔控制在 100/300ms 内 |
| 发送强制滚底可能打断用户阅读历史 | **已确认：用户期望立即看到刚发的消息**，不保持阅读位置 |
