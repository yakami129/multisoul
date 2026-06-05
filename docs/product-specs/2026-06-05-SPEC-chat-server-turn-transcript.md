# Chat Server Turn Transcript SPEC

## 1. 背景与目标

当前 Chat Detail 的 `Worked for <duration>` 行由 mobile 端基于已加载 raw messages 窗口派生。这个实现满足了 completed 会话的基础折叠阅读，但它把折叠正确性绑定到了“当前窗口是否包含完整 turn”。

在长历史对话中，Chat Detail 采用滑动分页加载。若首屏或 older page 切在一个 turn 中间，mobile 可能无法生成 worked row，或在后续加载更多 raw messages 后重算 worked row 的分组、时长和 key。结果是历史打开时看不到摘要、上滑后列表跳动、`focus_ask_id` 定位被 display item 重排影响，以及 REST 历史加载和 WebSocket 补漏之间出现重复或覆盖风险。

本规格将历史 transcript 的权威从 mobile 可见窗口迁移到服务端 turn summary。历史视图默认按 turn 分页，服务端返回可直接渲染的摘要 display 数据；worked row 的真实过程消息按用户点击懒加载。用户不点击 worked row 时，mobile 不加载该 turn 的 hidden messages。

## 2. 与既有规格的关系

本规格是 [`2026-06-04-SPEC-chat-completed-transcript-folding.md`](2026-06-04-SPEC-chat-completed-transcript-folding.md) 的下一阶段演进。

旧规格仍描述 completed transcript 的视觉规则：每轮保留 user、worked row、ask cards、final assistant，并支持点击 worked row 内联展开。旧规格中“后端协议变更”“为了精确折叠额外拉取完整历史”为 Out of Scope 的约束，被本规格明确替换：历史摘要必须由服务端提供，mobile 不再用可见 raw message window 作为 worked row 的权威来源。

## 3. 范围

### In Scope

- 服务端新增按 turn 分页的 transcript summary API。
- 服务端以每条 `user_text` 作为 turn 起点。
- 历史 turn 由服务端返回摘要 display items，包含稳定 turn id、worked metadata、ask cards、final assistant。
- 当前正在执行的最新 turn 保持 raw messages 展示。
- 点击 worked row 时，只懒加载该 turn 的 hidden messages 并在原位置内联展开。
- 用户不点击 worked row 时，不加载 hidden messages。
- `focus_ask_id` 能定位到服务端摘要中的 ask row；若目标 ask 不在当前页，服务端支持 around ask 的 turn summary 查询。
- 保留现有 raw `/api/v1/conversations/:id/messages` API，用于实时流、catch-up、兼容和 worked 展开详情。

### Out of Scope

- 删除 raw messages API。
- 为每个历史 turn 预加载 hidden messages。
- 持久化 mobile 的 worked row 展开状态。
- 改变 `messages` 表的 raw event 存储语义。
- 改变 AskUserQuestion / `msctl ask-question` 的回答协议。
- 改变 Activity / Inbox 的权威查询规则。

## 4. 用户体验

### 4.1 Completed 历史会话

打开 completed 历史对话时，mobile 首屏请求服务端 turn summaries，而不是请求最近 raw messages 后本地猜测 worked row。

示例显示：

```text
user: 修一下登录 bug
Worked for 42s
assistant: 已修复

user: 再补测试
Worked for 1m 10s
ask: 是否也要覆盖失败路径？
assistant: 已补测试
```

`Worked for 42s` 默认只是一条摘要行，包含 duration、hidden count、hidden seq range 等 metadata，不包含工具调用、过程性 assistant 文本或 terminal status 的完整 payload。

### 4.2 点击 worked row

当用户点击某个 worked row，mobile 只请求该 turn 的 hidden messages：

```text
GET /api/v1/conversations/:id/turns/:turn_id/hidden-messages
```

返回后在 worked row 下方内联展开：

```text
user: 修一下登录 bug
Worked for 42s
  tool: read file
  tool: edit file
  status: completed
assistant: 已修复
```

再次点击后收起。已加载的 hidden messages 可在当前页面内缓存，避免重复请求；离开页面后无需持久化展开状态。

### 4.3 Running / Awaiting Question / Failed 会话

采用“历史 turn 摘要 + 当前 turn raw”的混合视图。

如果一个会话当前正在运行，服务端返回：

- 已结束历史 turns 的 summary display items。
- 最新当前 turn 的 raw messages。

示例：

```text
user: 修一下登录 bug
Worked for 42s
assistant: 已修复

user: 再补测试
tool: cargo test
assistant: 我看到失败在 parser case...
```

这样历史阅读保持简洁，当前 agent 行为仍透明，不把正在发生的工具调用藏进临时 worked row。

## 5. Turn 语义

### 5.1 Turn 边界

- 每条 `user_text` 开始一个 turn。
- 该 turn 结束于下一条 `user_text` 之前。
- 没有所属 `user_text` 的前导消息按 prelude raw items 返回，不强行折叠进相邻 turn。
- `turn_id` 使用稳定、可由 DB 推导的标识，推荐 `turn-{user_seq}`。

### 5.2 历史 Turn Summary

每个已结束 turn 的 summary 至少包含：

- 本轮 `user_text`。
- `worked_summary`，仅当本轮有 hidden messages 时出现。
- 本轮所有 `ask_question`，包括 answered 和 pending。
- 本轮最后一个 `agent_text`，如果存在。

Hidden messages 包括：

- 非 final 的 `agent_text`。
- `tool_call`。
- 可渲染的 `system_event`。
- `task_status`。
- 其他现有 transcript 中可渲染但不属于 summary 主视图保留项的消息。

`tool_result` 不作为独立 summary row 展示。展开 hidden messages 时，mobile 仍必须能把 matching `tool_result` 挂回对应 `tool_call`。

### 5.3 当前 Turn Raw

当前 turn 是会话中最后一条 `user_text` 开始、且会话仍处于 `running`、`awaiting_question` 或 `failed` 状态时的最新 turn。

当前 turn 不生成 worked summary。它按 raw messages 展示，原因是：

- 运行中过程应对用户透明。
- pending ask 必须保持可见可操作。
- failed 状态需要完整过程辅助排查。

## 6. API 形态

### 6.1 Turn Summary Page

新增：

```http
GET /api/v1/conversations/:id/transcript-turns?limit=20&before_turn=:turn_id
GET /api/v1/conversations/:id/transcript-turns?limit=20&around_ask_id=:ask_id
```

返回示意：

```json
{
  "conversation_id": "conv-1",
  "status": "running",
  "items": [
    {
      "kind": "turn_summary",
      "turn_id": "turn-10",
      "start_seq": 10,
      "end_seq": 19,
      "user": { "type": "message", "seq": 10, "role": "user_text", "payload": { "text": "修 bug" }, "created_at": 1000 },
      "worked": {
        "id": "worked-turn-10",
        "label": "Worked for 42s",
        "duration_ms": 42000,
        "hidden_count": 4,
        "first_hidden_seq": 11,
        "last_hidden_seq": 18
      },
      "asks": [],
      "final_agent": { "type": "message", "seq": 19, "role": "agent_text", "payload": { "text": "已修复" }, "created_at": 43000 }
    },
    {
      "kind": "current_turn_raw",
      "turn_id": "turn-20",
      "start_seq": 20,
      "messages": [
        { "type": "message", "seq": 20, "role": "user_text", "payload": { "text": "补测试" }, "created_at": 50000 },
        { "type": "message", "seq": 21, "role": "tool_call", "payload": { "tool": "Bash", "args": "cargo test", "call_id": "call-1" }, "created_at": 51000 }
      ]
    }
  ],
  "page_info": {
    "oldest_turn_id": "turn-10",
    "has_older": true
  }
}
```

要求：

- `items` 按 transcript 时间升序返回。
- `limit` 以 turn 为单位，不以 raw messages 或 display rows 为单位。
- `before_turn` 加载更早 turns。
- `around_ask_id` 返回包含目标 ask 的 bounded turn page。
- 服务端必须用完整 DB 历史计算 summary，不受 mobile 已加载窗口影响。

### 6.2 Hidden Messages

新增：

```http
GET /api/v1/conversations/:id/turns/:turn_id/hidden-messages
```

返回：

```json
{
  "conversation_id": "conv-1",
  "turn_id": "turn-10",
  "messages": [
    { "type": "message", "seq": 11, "role": "tool_call", "payload": { "tool": "Read", "args": "...", "call_id": "call-1" }, "created_at": 1100 },
    { "type": "message", "seq": 12, "role": "tool_result", "payload": { "call_id": "call-1", "ok": true, "summary": "..." }, "created_at": 1200 },
    { "type": "message", "seq": 18, "role": "task_status", "payload": { "status": "completed", "summary": "" }, "created_at": 43000 }
  ]
}
```

要求：

- 返回该 turn 的 hidden messages 以及渲染 hidden tool calls 所需的 matching `tool_result`。
- 不返回本轮 user、visible ask、visible final agent，除非后续实现需要 full turn debug 模式。
- 返回顺序按 `seq` 升序。
- 仍携带 ask answered 字段，规则与 raw messages API 一致。

## 7. Mobile 行为

### 7.1 数据源分层

Mobile Chat Detail 需要区分两类数据：

- Transcript summary state：历史主列表的 turn summaries 和 current raw turn。
- Raw message state：WebSocket 实时流、catch-up 和 worked row 展开详情。

历史主列表不再从 `messages[conv_id]` 的可见窗口派生 worked row。`messages[conv_id]` 仍可作为实时和兼容缓存，但不能作为 completed 历史摘要的权威来源。

### 7.2 FlatList Key

服务端 summary row 必须提供稳定 key：

- user row：`message-${seq}`。
- worked row：`worked-${turn_id}`。
- ask row：`message-${seq}`。
- final assistant row：`message-${seq}`。
- current raw messages：继续用 `message-${seq}`。

worked row key 不得使用 hidden seq range，例如 `worked-${firstHiddenSeq}-${lastHiddenSeq}`，因为 lazy loading 或 older pagination 不应改变 worked row identity。

### 7.3 上滑加载

上滑加载 older history 时，mobile 调用 turn summary page：

```text
GET /transcript-turns?before_turn=<oldestLoadedTurnId>&limit=...
```

prepend 后必须用稳定 display key 恢复当前可见锚点，不得跳到底部或跳到错误 turn。

### 7.4 WebSocket 合并

WebSocket 继续传 raw messages。对于当前 turn：

- raw WS message 直接追加到 current raw turn。
- 收到 terminal `task_status` 后，mobile 可以触发 summary refresh，或等待下一次进入页面时由 server summary 统一呈现。
- 同一 `seq` 的 raw message 必须去重。

对于历史 summary 中已经存在的 seq，WS catch-up 不应把同一消息重复渲染为 raw row。

## 8. 服务端实现约束

- 不新增运行时 `CREATE TABLE`。如需持久化 turn metadata，必须走 migration。
- 第一版可以不落 turn 表，直接基于 `messages(conversation_id, seq)` 查询并按 `user_text` 动态派生 turn summaries。
- Summary API 必须使用 Bearer auth，与现有 REST 规则一致。
- 现有 raw messages API 行为保持兼容。
- around ask 查询必须通过服务端 DB 查找 ask 所属 turn，而不是要求 mobile 先加载 raw window。

## 9. 验收标准

- [ ] completed 历史对话首屏只加载 turn summary page，也能显示 worked row。
- [ ] 用户不点击 worked row 时，不请求 hidden messages API。
- [ ] 点击某个 worked row 时，只请求该 turn 的 hidden messages，并在原位置内联展开。
- [ ] 收起再展开同一 worked row 时，当前页面可复用已加载 hidden messages，不强制重复请求。
- [ ] 上滑加载 older history 以 turn 为单位分页，不以 raw message count 为单位。
- [ ] worked row 的 id、时长和 hidden count 由服务端完整 turn 计算，不随 mobile 已加载窗口变化。
- [ ] running / awaiting_question / failed 会话使用“历史 turn 摘要 + 当前 turn raw”混合视图。
- [ ] 当前 turn raw 过程中的 tool call、agent progress、ask card 和 failed status 不被折叠。
- [ ] `focus_ask_id` 在 ask 不在当前页时，使用 `around_ask_id` summary query 定位到对应 turn。
- [ ] `focus_ask_id` 定位到实际展示 ask row，不被 worked row 展开状态或 older pagination 影响。
- [ ] REST summary load、hidden lazy load、WS raw events 三者不会造成重复 row、乱序 row 或历史摘要被 raw catch-up 覆盖。
- [ ] `tool_result` 不作为摘要独立 row 展示，但展开 worked row 后 matching tool result 能展示在对应 tool call 中。
- [ ] raw `/messages` API 的现有测试继续通过。

## 10. 测试要求

CLI 至少覆盖：

- Turn summary API 按 `user_text` 切 turn。
- Summary page 以 turn 为单位分页。
- Summary worked metadata 使用完整 turn hidden messages 计算。
- Running conversation 返回历史 summary + current raw turn。
- `around_ask_id` 返回包含目标 ask 的 turn page。
- Hidden messages API 只返回目标 turn 的 hidden messages 和 matching `tool_result`。

Mobile 至少覆盖：

- Chat Detail 首屏渲染服务端 turn summaries，不依赖 raw messages 窗口生成 worked row。
- worked row 点击后 lazy load hidden messages。
- 未点击 worked row 时不调用 hidden messages endpoint。
- older turn summary prepend 后锚点稳定。
- current raw turn 接收 WS message 后继续按 raw 展示。
- terminal status 后 summary refresh 或下次进入页面能转为服务端 summary。
- `focus_ask_id` 对 summary ask row 和 current raw ask row 都能定位。

改动后验证：

```bash
cd cli && cargo test
cd mobile && pnpm typecheck
```

若只修改其中一个包，可按实际改动缩小验证范围，但协议同时改动时必须同时验证 CLI 和 mobile。
