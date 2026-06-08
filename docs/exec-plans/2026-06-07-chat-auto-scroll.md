# 实施计划：Chat 自动滚动修复

**日期**: 2026-06-07  
**对应规格**: `docs/product-specs/2026-06-07-SPEC-chat-auto-scroll.md`  
**实施会话**: `2ebf131f-338c-4d67-a5de-0e262f4385f3`

---

## 概述

修复 Chat 对话页面的自动滚动问题，确保：
1. 打开对话时定位到最后一条 AI message（而非中间某处）
2. 发送消息后立即滚到底部（无论当前位置）
3. 保持现有流式回复跟随逻辑（`isNearBottom`）

---

## 前置检查

- [x] 已读 `AGENTS.md`、`CLAUDE.md`、产品规格
- [x] 确认现有实现：`useChatDetailTranscriptScroll.ts` 已有 `scrollToLastAssistantOrEnd` 函数
- [x] 确认 `[id].tsx` 的 `onSend` 已调用 `forceScrollToEnd()`
- [x] 确认已有测试文件：`chatDetailAutoScroll.test.tsx`

---

## 实施任务

### Task 1: 代码审查与问题定位

**目标**: 确认当前代码是否已正确实现规格要求，识别潜在问题

**步骤**:
1. 审查 `useChatDetailTranscriptScroll.ts`:
   - 检查 `scrollToLastAssistantOrEnd` 实现（已存在，lines 76-98）
   - 检查初始定位逻辑（`useEffect` lines 103-119）
   - 确认 `pendingInitialBottomScrollRef` 标记使用是否正确
   - 确认重试机制（100ms/300ms）是否触发

2. 审查 `[id].tsx`:
   - 确认 `onSend` 函数（lines 186-193）调用顺序
   - 确认 `forceScrollToEnd` 在 `handleSend` 之前执行

3. 识别潜在问题:
   - 初始定位可能在 `focus_ask_id` 存在时被跳过（line 104 early return）
   - `handleContentSizeChange` 中的初始滚动可能与 `useEffect` 重试冲突（lines 162-168）

**验证**: 
- 无需编译，仅代码审查

---

### Task 2: 修复初始滚动逻辑（如需要）

**目标**: 确保打开对话时正确定位到最后一条 AI message

**文件**: `mobile/app/chat/useChatDetailTranscriptScroll.ts`

**改动**（如发现问题）:
1. 确保 `useEffect` 的初始定位逻辑在无 `focus_ask_id` 时总是执行
2. 确保 `handleContentSizeChange` 中的初始滚动逻辑（lines 162-168）与 `useEffect` 重试不冲突
3. 确认 `scrollToLastAssistantOrEnd` 的 try-catch 逻辑在 `scrollToIndex` 失败时正确降级到 `scrollToEnd`

**验证**:
```bash
cd mobile && pnpm typecheck
```

---

### Task 3: 确认发送滚底逻辑

**目标**: 确保 `onSend` 中 `forceScrollToEnd` 在 `handleSend` 之前执行

**文件**: `mobile/app/chat/[id].tsx`

**检查**:
1. `onSend` 函数（lines 186-193）调用顺序是否为：
   - `setInput('')` 清空输入
   - `forceScrollToEnd()` 滚到底部
   - `handleSend(text)` 发送消息

2. 确认 `forceScrollToEnd` 实现（`useChatDetailTranscriptScroll.ts` lines 196-199）:
   - 设置 `isNearBottomRef.current = true`
   - 调用 `scrollToEnd({ animated: true })`

**验证**:
```bash
cd mobile && pnpm typecheck
```

---

### Task 4: 扩展回归测试

**目标**: 添加测试覆盖打开时定位到最后一条 AI message 的场景

**文件**: `mobile/src/__tests__/chatDetailAutoScroll.test.tsx`

**新增测试**:
1. **测试名**: `scrolls to last agent_text message when opening a conversation`
   - **场景**: 对话中有多条 user 和 agent 消息
   - **Mock 数据**: 
     ```ts
     [
       userText(1, 'first'),
       agentText(2, 'response 1'),
       userText(3, 'second'),
       agentText(4, 'response 2'),
       userText(5, 'third'),
       agentText(6, 'final AI response'),
     ]
     ```
   - **验证**: 
     - `scrollToIndex` 被调用一次
     - `index` 参数为 5（最后一条 `agent_text` 的索引）
     - `animated` 为 `false`
     - `viewPosition` 为 `0`

2. **测试名**: `retries initial scroll if FlatList layout is delayed`
   - **场景**: 模拟异步加载延迟
   - **实现**: 
     - 首次 `onContentSizeChange` 时 FlatList 数据为空
     - 延迟 150ms 后更新数据
     - 再次触发 `onContentSizeChange`
   - **验证**: 
     - `scrollToIndex` 或 `scrollToEnd` 在重试后被调用
     - `pendingInitialBottomScrollRef` 被标记为 `false`

3. **测试名**: `respects focus_ask_id and skips initial bottom scroll`
   - **场景**: 从 Inbox 携带 `focus_ask_id` 进入
   - **Mock 参数**: `focus_ask_id: 'ask-123'`
   - **验证**: 
     - 初始 `scrollToLastAssistantOrEnd` 不被调用（被 `focus_ask_id` 逻辑拦截）
     - `scrollToFocusedAsk` 被调用

**辅助函数**（添加到文件顶部）:
```ts
function agentText(seq: number, text: string): WsMessage {
  return {
    type: 'message',
    seq,
    role: 'agent_text',
    payload: { text },
    created_at: seq,
  };
}
```

**验证**:
```bash
cd mobile && pnpm test chatDetailAutoScroll --watchAll=false
```

---

### Task 5: 全量验证

**目标**: 确保所有改动通过类型检查和测试

**验证命令**:
```bash
cd mobile
pnpm typecheck
pnpm test -- --watchAll=false
```

**预期结果**:
- 类型检查无错误
- 所有现有测试通过
- 新增测试通过

---

## 风险与应对

| 风险 | 应对 |
|------|------|
| `scrollToIndex` 在布局未完成时抛异常 | 已有 try-catch 逻辑，失败时降级 `scrollToEnd` |
| 服务端消息异步加载导致多次定位 | 使用 `animated: false` + `pendingInitialBottomScrollRef` 标记避免重复 |
| 发送强制滚底可能打断用户阅读 | 规格已确认：用户期望立即看到刚发的消息 |
| 现有测试覆盖不足 | Task 4 补充回归测试 |

---

## 验收标准（引用规格 §7）

- [ ] **AC-1**: 从 Agent 列表进入有历史消息的对话，页面定位到最新 AI message
- [ ] **AC-2**: 从 Activity/Inbox 继续对话，页面定位到最新 AI message
- [ ] **AC-3**: 从推送通知进入对话，页面定位到最新 AI message
- [ ] **AC-4**: 异步加载延迟后，页面重新定位到新的最新 AI message
- [ ] **AC-5**: 用户上翻历史后发送消息，页面立即跳回底部
- [ ] **AC-6**: Agent 流式回复时，接近底部则跟随，上翻则停止
- [ ] **AC-7**: `focus_ask_id` 存在时，定位到对应问题卡片
- [ ] **AC-8**: 无 AI message 的对话，降级滚到列表底部
- [ ] **AC-9**: iOS 平台所有验证通过，`pnpm typecheck` + `pnpm test` 通过

---

## 完成标准

1. 所有任务完成
2. `pnpm typecheck` 通过
3. `pnpm test -- --watchAll=false` 通过
4. 所有验收标准（AC-1 至 AC-9）通过
5. 一次 `git commit` 提交所有改动
6. 更新 `docs/exec-plans/index.json` 的 `lastCompletedCommit`
