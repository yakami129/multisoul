# Chat Completed Transcript Folding SPEC

## 1. 背景与目标

Chat Detail 目前会展示完整 agent 执行过程，包括工具调用、过程性回复、状态事件和问答卡片。长任务完成后，用户回看结果时需要先扫过大量过程信息，才能定位最终结论。

本规格定义完成态 Chat 的默认收纳行为：会话完成后保留最后用户消息和最后助手消息，其余已加载过程信息折叠到一条紧凑入口中。目标是降低完成后阅读噪音，同时保留展开查看过程的能力。

## 2. 范围

### In Scope

- Chat Detail 中 completed 会话的 transcript 默认折叠展示。
- 折叠入口显示为紧凑行，例如 `过程 12 条`。
- 点击折叠入口后，在原位置内联展开过程消息。
- 再次点击后收起。
- 已回答的问答卡片纳入过程折叠。
- 待回答的问答卡片保留在主视图。
- 计数只基于当前已加载消息窗口。

### Out of Scope

- 后端协议变更。
- 新增全量历史计数 API。
- 为了精确计数额外拉取完整历史。
- 持久化展开/收起状态。
- 改写消息存储结构。
- 改变 running、awaiting_question、failed 会话的默认 transcript 展示。
- 改变 Activity / Inbox 的问答索引逻辑。

## 3. 用户体验

当会话仍在运行、等待用户回答或失败时，Chat Detail 保持现有完整过程展示，避免隐藏正在发生或需要排查的信息。

当会话状态为 `completed` 时，Chat Detail 默认展示：

1. 最后一条用户消息。
2. 一条紧凑过程入口，显示当前已加载窗口内被折叠的过程数量。
3. 最后一条助手消息。
4. 尚未回答的问答卡片，如果当前已加载窗口内存在。

用户点击 `过程 N 条` 后，被折叠消息在该入口原位置展开。展开内容使用现有消息组件渲染，不引入新的过程详情页或 bottom sheet。

展开状态仅属于当前页面 UI 状态。离开页面后再次进入，completed 会话仍默认收起。

## 4. 折叠规则

仅当 conversation status 为 `completed` 时启用自动折叠。

主视图必须保留：

- 当前已加载窗口中最后一条 `user_text`。
- 当前已加载窗口中最后一条 `agent_text`。
- 未回答的 `ask_question`。

其余当前已加载且可渲染 transcript 消息进入过程折叠组，包括：

- 更早的 `user_text`。
- 更早的 `agent_text`。
- `tool_call`。
- 已回答的 `ask_question`。
- 可渲染的 `system_event`。
- 其他现有 transcript 中可渲染但不属于主视图保留项的消息。

`tool_result` 继续不作为独立 transcript 行展示；它仍由对应 `tool_call` 行内展示。

如果当前已加载窗口内没有可折叠过程消息，则不展示折叠入口。

## 5. 计数口径

`过程 N 条` 的 `N` 只统计当前已加载窗口中被折叠的消息数量。

如果用户向上滚动加载更多历史，新增进入窗口的消息可重新参与折叠计算。实现不需要为了让 `N` 表示全会话精确总数而额外请求历史。

这个口径优先保证 Chat Detail 打开速度和实现边界，不把折叠能力耦合到历史全量加载。

## 6. 技术实现约束

优先在前端渲染层实现：

- `mobile/src/features/chat/utils/chatRenderState.ts` 增加 completed transcript 分组纯函数。
- `mobile/app/chat/useChatDetailHistory.ts` 继续负责生成基础 `transcriptMessages`。
- `mobile/app/chat/ChatTranscriptList.tsx` 接收 conversation status，并渲染普通消息或折叠组。
- 新增折叠入口组件时遵守 `mobile/docs/design.md` 的颜色白名单和间距规则。

不得改动消息存储结构。不得通过隐藏消息来改变 `chatStore` 中的原始消息数组。

## 7. 验收标准

- [ ] completed 会话默认只展示最后用户消息、`过程 N 条`、最后助手消息，以及未回答问答卡片。
- [ ] running 会话不自动折叠，仍显示完整过程。
- [ ] awaiting_question 会话不自动折叠，待回答问答卡片保持可见可操作。
- [ ] failed 会话不自动折叠，错误排查过程保持可见。
- [ ] 已回答问答卡片在 completed 会话中进入过程折叠组。
- [ ] 未回答问答卡片在 completed 会话中保留在主视图。
- [ ] `过程 N 条` 的 N 只统计当前已加载窗口内被折叠的可渲染消息。
- [ ] 点击过程入口后，折叠消息在原位置内联展开。
- [ ] 再次点击过程入口后，折叠消息收起。
- [ ] 没有可折叠过程消息时，不显示过程入口。
- [ ] 原有 `tool_result` 行不单独占位，仍由对应 `tool_call` 行内展示。

## 8. 测试要求

至少覆盖：

- `chatRenderState` completed 分组纯函数：
  - completed 状态下保留最后用户消息和最后助手消息。
  - completed 状态下折叠更早消息、工具调用、已回答问答。
  - pending 问答卡片不被折叠。
  - running / awaiting_question / failed 状态返回原始可渲染 transcript。
- `ChatTranscriptList` 渲染行为：
  - 默认显示紧凑过程入口。
  - 点击入口内联展开。
  - 再次点击入口收起。
  - `tool_resultMessages` 仍能传入 `ToolCallRow`。

改动 mobile 后必须执行：

```bash
cd mobile && pnpm typecheck
```

相关测试按改动范围执行，例如 chat render state 和 transcript list 测试。
