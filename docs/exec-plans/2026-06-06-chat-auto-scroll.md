# Exec Plan: Chat 自动滚动优化

**日期**: 2026-06-06  
**Spec**: `docs/product-specs/2026-06-06-SPEC-chat-auto-scroll.md`  
**关联分支**: `feat/chat-auto-scroll`

---

## 问题分析

当前 `useChatDetailTranscriptScroll.ts` 的初始定位逻辑统一使用 `scrollToEnd`，不区分是否存在 AI 消息；`useChatDetailAgentTurn.ts` 的发送滚动在 `postMessage` 异步返回后才触发，若用户在请求进行中触屏，可能错过跳底效果。

角色名称映射：Spec 中的 `role=assistant` 在代码中为 `WsMessage.role === 'agent_text'`。

---

## 改动文件

| 文件 | 改动类型 |
|------|---------|
| `mobile/app/chat/useChatDetailTranscriptScroll.ts` | 主要逻辑改动 |
| `mobile/app/chat/[id].tsx` | 调用侧：onSend 加 forceScrollToEnd |
| `mobile/app/chat/useChatDetailAgentTurn.ts` | 删除冗余 setTimeout scroll |

---

## 任务列表

### Task 1: `useChatDetailTranscriptScroll.ts` — 添加 `scrollToLastAssistantOrEnd`

**目标**：打开对话时定位到最后一条 `agent_text` 消息。

实现：
```ts
const scrollToLastAssistantOrEnd = useCallback(
  (items: ChatTranscriptDisplayItem[], animated: boolean) => {
    if (!listRef.current || items.length === 0) return;
    let lastIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === 'message' && item.message.role === 'agent_text') {
        lastIndex = i;
        break;
      }
    }
    if (lastIndex >= 0) {
      try {
        listRef.current.scrollToIndex({ index: lastIndex, animated, viewPosition: 0 });
      } catch {
        listRef.current.scrollToEnd({ animated });
      }
    } else {
      listRef.current.scrollToEnd({ animated });
    }
  },
  [listRef],
);
```

替换位置：
1. `useEffect`（初始滚动，lines 83–85）中的 `listRef.current?.scrollToEnd({ animated: false })` → `scrollToLastAssistantOrEnd(transcriptItems, false)`
2. `handleContentSizeChange`（lines 142–144）中的 `listRef.current?.scrollToEnd({ animated: false })` → `scrollToLastAssistantOrEnd(transcriptItems, false)`

### Task 2: `useChatDetailTranscriptScroll.ts` — 更新 `handleScrollToIndexFailed`

当前 `handleScrollToIndexFailed` 只处理 `focus_ask_id` 失败案例；新增 `scrollToIndex`（初始 AI 消息定位）失败时需降级到 `scrollToEnd`。

新增分支（在函数开头，focus_ask_id 早返回之前）：
```ts
if (!focus_ask_id) {
  if (pendingInitialBottomScrollRef.current) {
    listRef.current?.scrollToEnd({ animated: false });
  }
  return;
}
```

### Task 3: `useChatDetailTranscriptScroll.ts` — 添加 `forceScrollToEnd` 并暴露

```ts
const forceScrollToEnd = useCallback(() => {
  isNearBottomRef.current = true;
  listRef.current?.scrollToEnd({ animated: true });
}, [listRef]);
```

在 return 对象中加入 `forceScrollToEnd`。

### Task 4: `[id].tsx` — onSend 调用 `forceScrollToEnd`

1. 从 `useChatDetailTranscriptScroll` 解构 `forceScrollToEnd`
2. 在 `onSend()` 中 `setInput('')` 之后、`void handleSend(text)` 之前调用：
   ```ts
   forceScrollToEnd();
   ```

### Task 5: `useChatDetailAgentTurn.ts` — 移除冗余 setTimeout

删除 `handleSend` 中 postMessage 成功后的：
```ts
setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
```

该逻辑已由 Task 3/4 的 `forceScrollToEnd` 在发送时同步替代，`isNearBottomRef` 被置为 true 后流式跟随会接管后续滚动。

---

## 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| focus_ask_id 跳转 | `pendingInitialBottomScrollRef` 初始为 false，不触发新逻辑（AC-5 不受影响） |
| 打开时无 agent_text 消息 | 降级到 scrollToEnd（Task 1 fallback） |
| scrollToIndex 触发 onScrollToIndexFailed | Task 2 新分支降级到 scrollToEnd |
| 发送时 Agent 正在流式回复 | forceScrollToEnd 将 isNearBottomRef 置 true，流式跟随接管（AC-4） |

---

## 验证步骤

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

验收标准（来自 Spec §7）：AC-1 ~ AC-6 全部通过。

---

## Commit 策略

所有 Task 验证通过后，**一次 commit**。提交后将 SHA 写入 `docs/exec-plans/index.json`。
