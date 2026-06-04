# Chat Completed Transcript Folding SPEC

## 1. 背景与目标

Chat Detail 目前会展示完整 agent 执行过程，包括工具调用、过程性回复、状态事件和问答卡片。长任务完成后，用户回看结果时需要先扫过大量过程信息，才能定位最终结论。

本规格定义完成态 Chat 的默认收纳行为：会话完成后保留最后用户消息和最后助手消息，其余已加载过程信息折叠到一条紧凑入口中。目标是降低完成后阅读噪音，同时保留展开查看过程的能力。

## 2. 范围

### In Scope

- Chat Detail 中 completed 会话的 transcript 默认折叠展示。
- 折叠入口显示为无边框的轻量元信息行，例如 `Worked for 20s`。
- 点击折叠入口后，在原位置内联展开过程消息。
- 再次点击后收起。
- 已回答的问答卡片纳入过程折叠。
- 待回答的问答卡片保留在主视图。
- 折叠入口时长只基于当前已加载消息窗口可推导出的运行时长。

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
2. 一条无边框的轻量元信息入口，例如 `Worked for 20s`。
3. 最后一条助手消息。
4. 尚未回答的问答卡片，如果当前已加载窗口内存在。

折叠入口不使用卡片、描边容器或分组外框。它应像 transcript 中的轻量状态文字：小字号、低强调、可点击，右侧或文本后带展开/收起 chevron。

用户点击 `Worked for 20s` 后，被折叠消息在该入口原位置展开。展开内容使用现有 Chat transcript 的原始 item 样式渲染：工具调用仍是工具调用行，过程回复仍是普通 assistant bubble，已回答问答仍是原来的问答卡片展示。展开区域不得添加额外外层边框或分组容器。

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

## 5. 时长口径

折叠入口文案使用 `Worked for <duration>`，例如 `Worked for 20s`、`Worked for 2m 10s`。

时长只基于当前已加载窗口中可折叠过程消息的 `created_at` 推导。`created_at` 来自服务端毫秒级时间戳，计算时应先把毫秒差值转换为秒。建议使用被折叠消息的最早和最晚 `created_at` 差值；当差值不可用或小于 1 秒时，显示 `Worked for <1s` 或 `Worked for 1s`，以实现时更符合现有格式化工具为准。

如果用户向上滚动加载更多历史，新增进入窗口的消息可重新参与折叠和时长计算。实现不需要为了让时长表示全会话精确运行时间而额外请求历史。

这个口径优先保证 Chat Detail 打开速度和实现边界，不把折叠能力耦合到历史全量加载。

## 6. 技术实现约束

优先在前端渲染层实现：

- `mobile/src/features/chat/utils/chatRenderState.ts` 增加 completed transcript 分组纯函数。
- `mobile/app/chat/useChatDetailHistory.ts` 继续负责生成基础 `transcriptMessages`。
- `mobile/app/chat/ChatTranscriptList.tsx` 接收 conversation status，并渲染普通消息或折叠组。
- 新增折叠入口组件时遵守 `mobile/docs/design.md` 的颜色白名单和间距规则。
- 折叠入口不得使用边框、卡片背景或外层分组容器；展开后复用原有 `MessageBubble` / `ToolCallRow` 等 transcript item 渲染。

不得改动消息存储结构。不得通过隐藏消息来改变 `chatStore` 中的原始消息数组。

## 7. 验收标准

- [ ] completed 会话默认只展示最后用户消息、`Worked for <duration>`、最后助手消息，以及未回答问答卡片。
- [ ] running 会话不自动折叠，仍显示完整过程。
- [ ] awaiting_question 会话不自动折叠，待回答问答卡片保持可见可操作。
- [ ] failed 会话不自动折叠，错误排查过程保持可见。
- [ ] 已回答问答卡片在 completed 会话中进入过程折叠组。
- [ ] 未回答问答卡片在 completed 会话中保留在主视图。
- [ ] `Worked for <duration>` 的时长只基于当前已加载窗口内被折叠消息的 `created_at` 推导。
- [ ] 折叠入口无边框、无卡片背景、无外层分组容器。
- [ ] 点击过程入口后，折叠消息在原位置内联展开。
- [ ] 展开后的过程消息保留原 Chat transcript item 样式，不被新的边框容器包裹。
- [ ] 再次点击过程入口后，折叠消息收起。
- [ ] 没有可折叠过程消息时，不显示过程入口。
- [ ] 原有 `tool_result` 行不单独占位，仍由对应 `tool_call` 行内展示。

## 8. 测试要求

至少覆盖：

- `chatRenderState` completed 分组纯函数：
  - completed 状态下保留最后用户消息和最后助手消息。
  - completed 状态下折叠更早消息、工具调用、已回答问答。
  - pending 问答卡片不被折叠。
  - `Worked for <duration>` 基于折叠消息 `created_at` 生成。
  - running / awaiting_question / failed 状态返回原始可渲染 transcript。
- `ChatTranscriptList` 渲染行为：
  - 默认显示无边框 `Worked for <duration>` 入口。
  - 点击入口内联展开。
  - 再次点击入口收起。
  - `tool_resultMessages` 仍能传入 `ToolCallRow`。

改动 mobile 后必须执行：

```bash
cd mobile && pnpm typecheck
```

相关测试按改动范围执行，例如 chat render state 和 transcript list 测试。
