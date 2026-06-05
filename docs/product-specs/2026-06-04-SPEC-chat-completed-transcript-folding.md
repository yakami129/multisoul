# Chat Completed Transcript Folding SPEC

## 1. 背景与目标

Chat Detail 目前会展示完整 agent 执行过程，包括工具调用、过程性回复、状态事件和问答卡片。长任务完成后，用户回看结果时需要先扫过大量过程信息，才能定位每轮输入对应的最终结论。

本规格定义 completed Chat 的按轮次折叠行为：每轮用户输入保留为可见起点，每轮 agent 过程折叠为至多一个 `Worked for <duration>` 入口，每轮最后一条助手文本保留为可见结果。目标是降低完成后阅读噪音，同时保持多轮对话结构、问答卡片上下文和分页滚动稳定性。

## 2. 范围

### In Scope

- Chat Detail 中 conversation 整体状态为 `completed` 的 transcript 默认按 `user_text` turn 折叠。
- 每轮 turn 默认展示：本轮 `user_text`、至多一个无边框 `Worked for <duration>` 行、本轮问答卡片、本轮最后一个 `agent_text`。
- 点击 worked 行后，在该行原位置内联展开本轮所有隐藏过程消息。
- 再次点击后收起。
- 问答卡片不吸附到底部；在 Chat Detail 中按本轮上下文原位展示。
- 每轮 worked 行汇总本轮所有隐藏过程消息。
- 分页加载 older messages 时保持当前可见消息锚点稳定，避免视口乱跳。

### Out of Scope

- 后端协议变更。
- 新增全量历史计数 API。
- 为了精确计数额外拉取完整历史。
- 持久化展开/收起状态。
- 改写消息存储结构。
- 改变 running、awaiting_question、failed 会话的默认 transcript 展示。
- 改变 Activity / Inbox 的问答索引逻辑。

## 3. 用户体验

当 conversation 整体状态仍在运行、等待用户回答或失败时，Chat Detail 保持现有完整过程展示，避免隐藏正在发生或需要排查的信息。运行中的对话不做“上一轮已完成”的局部折叠；只要 conversation status 不是 `completed`，整个 transcript 都按原始列表展示。

当会话状态为 `completed` 时，Chat Detail 按轮次展示。每轮以 `user_text` 开始，到下一条 `user_text` 之前结束。每轮默认结构为：

1. 本轮用户消息。
2. 一条无边框轻量元信息入口，例如 `Worked for 20s`，如果本轮有可隐藏过程消息。
3. 本轮问答卡片，按本轮内相对顺序展示，不移动到全局 transcript 底部。
4. 本轮最后一条助手消息。

折叠入口不使用卡片、描边容器或分组外框。它应像 transcript 中的轻量状态文字：小字号、低强调、可点击，右侧或文本后带展开/收起 chevron。

用户点击 `Worked for 20s` 后，本轮隐藏过程消息在该入口原位置展开。展开内容使用现有 Chat transcript 的原始 item 样式渲染：工具调用仍是工具调用行，过程回复仍是普通 assistant bubble，状态事件仍是现有状态行。展开区域不得添加额外外层边框或分组容器。

每轮只有一个 worked 行。为了满足这个约束，问答卡片不会把 worked 行切成多个段。`Worked for <duration>` 表示本轮 agent 做过的隐藏过程摘要，不承诺精确占据原时间线中的单一位置。

展开状态仅属于当前页面 UI 状态。离开页面后再次进入，completed 会话仍默认收起。

## 4. 折叠规则

仅当 conversation status 为 `completed` 时启用自动折叠。不得在 `running`、`awaiting_question`、`failed` 或 `idle` 状态下对历史 turn 局部生成 worked 行。

### 4.1 Turn 边界

- 每个 `user_text` 开始一个 turn。
- 该 turn 到下一条 `user_text` 之前结束。
- 本轮 final assistant 是下一条 `user_text` 之前最后一个 `agent_text`。
- 如果某段消息没有所属 `user_text`，按普通 transcript 消息展示，不强行折叠到相邻 turn。

### 4.2 每轮主视图

每轮主视图必须保留：

- 本轮 `user_text`。
- 本轮所有 `ask_question`，包括 answered 和 pending，均不吸底。
- 本轮最后一个 `agent_text`，如果存在。

每轮至多生成一个 worked 行。进入该 worked 行的隐藏过程消息包括：

- 本轮非 final 的 `agent_text`。
- `tool_call`。
- 可渲染的 `system_event`。
- `task_status`。
- 其他现有 transcript 中可渲染但不属于主视图保留项的消息。

`tool_result` 继续不作为独立 transcript 行展示；它仍由对应 `tool_call` 行内展示。展开 worked 行时，对应 `tool_call` 仍必须能拿到 matching `tool_result`。

如果本轮没有可隐藏过程消息，则不展示 worked 行。

## 5. 问答卡片规则

Chat Detail 不再调用“问答卡吸底”逻辑重排 `ask_question`。问答卡片必须留在所属 turn 内，不移动到整个 transcript 底部。

在 completed 会话中，answered 和 pending 问答卡都保持可见。pending 问答卡仍可操作；如果 conversation 状态仍是 `awaiting_question`，则整段 transcript 不启用 completed 折叠。

Activity / Inbox 仍可以通过 `focus_ask_id` 跳入 Chat Detail。若目标问答卡在当前已加载窗口中，滚动定位必须指向展示后的实际行。

## 6. 时长口径

折叠入口文案使用 `Worked for <duration>`，例如 `Worked for 20s`、`Worked for 2m 10s`。

时长只基于本轮 worked 行内隐藏过程消息的 `created_at` 推导。`created_at` 来自服务端毫秒级时间戳，计算时应先把毫秒差值转换为秒。使用隐藏消息的最早和最晚 `created_at` 差值；当差值不可用或小于 1 秒时，显示 `Worked for 1s`。

如果用户向上滚动加载更多历史，新增进入窗口的消息可重新参与所属 turn 的折叠和时长计算。实现不需要为了让时长表示全会话精确运行时间而额外请求历史。

## 7. 分页与滚动稳定性

滚动加载 older messages 时，Chat Detail 必须优先保持当前可见消息锚点稳定。

- prepend older messages 前后，不得因为 completed 折叠重组导致视口跳到底部或跳到错误 turn。
- 展示层可以按 loaded window 重新构建 turns，但滚动逻辑必须以稳定 message seq 或 display item key 锚定当前可见内容。
- 问答卡不再吸底，以避免加载历史时额外重排。
- 不为了稳定折叠而请求 completed 会话全量历史。

## 8. 技术实现约束

优先在前端渲染层实现：

- `mobile/src/features/chat/utils/chatRenderState.ts` 负责 completed turn 分组纯函数。
- `mobile/app/chat/useChatDetailHistory.ts` 继续负责生成基础 `transcriptMessages`，但 Chat Detail 不再对 ask cards 做 bottom placement。
- `mobile/app/chat/ChatTranscriptList.tsx` 接收 conversation status，并渲染普通消息或 turn-based display items。
- `mobile/app/chat/useChatDetailTranscriptScroll.ts` 负责 focus ask 和分页锚点稳定。
- 折叠入口不得使用边框、卡片背景或外层分组容器；展开后复用原有 `MessageBubble` / `ToolCallRow` 等 transcript item 渲染。

不得改动消息存储结构。不得通过隐藏消息来改变 `chatStore` 中的原始消息数组。

## 9. 验收标准

- [ ] completed 会话按每轮 `user_text` 分组展示，不再把所有历史折叠进一个全局 worked 行。
- [ ] 每轮默认展示本轮 user、至多一个 `Worked for <duration>`、本轮问答卡片、本轮 final assistant。
- [ ] 每轮 worked 行最多一个，即使本轮中间有问答卡片。
- [ ] worked 行汇总本轮所有隐藏过程消息。
- [ ] running 会话不自动折叠，即使其中已有上一轮 user/assistant 交互，也仍显示完整过程。
- [ ] awaiting_question 会话不自动折叠，待回答问答卡片保持可见可操作。
- [ ] failed 会话不自动折叠，错误排查过程保持可见。
- [ ] 问答卡片在 Chat Detail 中不吸底，answered 和 pending 均按 turn 上下文可见。
- [ ] `focus_ask_id` 能滚动到展示后的实际问答卡片行。
- [ ] `Worked for <duration>` 的时长只基于本轮 hidden process messages 的 `created_at` 推导。
- [ ] 折叠入口无边框、无卡片背景、无外层分组容器。
- [ ] 点击 worked 入口后，本轮隐藏消息在原位置内联展开。
- [ ] 展开后的过程消息保留原 Chat transcript item 样式，不被新的边框容器包裹。
- [ ] 再次点击 worked 入口后，本轮隐藏消息收起。
- [ ] 没有可隐藏过程消息的 turn 不显示 worked 行。
- [ ] 原有 `tool_result` 行不单独占位，仍由对应 `tool_call` 行内展示。
- [ ] 向上滚动加载 older messages 时，当前可见内容不乱跳。

## 10. 测试要求

至少覆盖：

- `chatRenderState` completed 分组纯函数：
  - completed 状态下按多个 user turns 生成多个 turn display items。
  - 每轮保留本轮 user 和本轮 final assistant。
  - 每轮只生成一个 worked 行，且汇总本轮所有 hidden process messages。
  - answered / pending 问答卡都保持 visible message item。
  - running / awaiting_question / failed / idle 状态返回原始可渲染 transcript，不对历史 turn 局部生成 worked 行。
  - `Worked for <duration>` 基于本轮 hidden process messages 的 `created_at` 生成。
- `useChatDetailHistory` / Chat Detail：
  - Chat Detail 不再调用 ask bottom placement。
  - `focus_ask_id` 使用展示后的 item order。
- `ChatTranscriptList` 渲染行为：
  - 默认显示无边框 worked 入口。
  - 点击入口内联展开。
  - 再次点击入口收起。
  - `tool_resultMessages` 仍能传入 `ToolCallRow`。
  - older loading / prepend 场景保持可见锚点稳定。

改动 mobile 后必须执行：

```bash
cd mobile && pnpm typecheck
```

相关测试按改动范围执行，例如 chat render state、transcript list、chat detail route 和 question placement 测试。
