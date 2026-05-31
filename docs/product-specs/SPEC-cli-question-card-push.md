# CLI Question Card Push 统一实现 SPEC

## 1. 背景与目标

**背景**：
- 目前 Claude Code runtime 已支持通过 `AskUserQuestion` 工具推送问答卡片给 iOS
- Codex 和 Cursor runtime 尚不支持此功能
- 关键发现：Codex 和 Cursor 使用不同的事件协议，不支持 Claude Code 的 `control_request` 机制

**核心洞察**：
- 与其为每个 runtime 实现不同的拦截机制，不如让 runtime CLI **调用 `msctl` 命令**来推送卡片
- 这样所有 runtime 都能统一支持，逻辑集中在 `msctl` 中

**目标**：
- 创建 `msctl ask-question` 命令，支持推送问答卡片给 iOS
- 通过注入式 runtime 指南引导 CLI（Claude Code、Codex、Cursor）如何调用此命令
- 让所有 runtime 都能支持 `AskUserQuestion` 工具

## 2. 范围

### 2.1 In Scope
- 创建 `msctl ask-question` 命令（或类似名称）
- 命令支持推送问答卡片给 iOS，并立即返回 pending 状态
- 在注入式 runtime 指南中说明：调用 `msctl ask-question` 后，iOS answer 会自动注入为同一 conversation 的 user message
- 支持单选、多选、填空三种问题类型
- 确保 iOS 端能正确接收、展示、回答卡片
- 建立可扩展的交互工具框架

### 2.2 Out of Scope
- 修改 iOS 端的卡片 UI 组件（已存在）
- 修改 Claude Code runtime 的现有实现（已稳定）
- 支持其他交互工具（如 `AskFile`、`AskCode` 等）— 仅为未来扩展预留接口

## 3. 用户与使用场景

**典型用户**：
- Claude Code / Codex / Cursor 用户，在 MultiSoul 中运行 agent
- 需要在执行过程中向用户提问（选择方案、确认风险、输入参数等）

**关键使用场景**：
1. **方案选择**：Agent 提出多个方案，用户在 iOS 上选择一个
2. **风险确认**：Agent 提示风险操作，用户在 iOS 上确认
3. **参数输入**：Agent 需要用户输入某些参数（如文件路径、配置值等）
4. **多问题批量**：Agent 一次性提出多个问题，用户逐一回答

## 4. 业务流程与信息架构

### 4.1 高层流程

```
1. Agent 调用 AskUserQuestion 工具
   ↓
2. Runtime CLI 调用 msctl ask-question 命令
   - 参数：--ask-id, --questions, --conversation-id
   - 返回：立即返回 pending 状态
   ↓
3. msctl 将问题转换为 ask_question 消息，推送给 iOS
   ↓
4. iOS 展示卡片，用户选择/填写答案
   ↓
5. iOS 通过 WebSocket 发送 answer 消息回 msctl serve
   ↓
6. Runtime CLI 通过 HTTP API 接收答案，返回给 Agent
   ↓
7. Agent 继续执行
```

### 4.2 重要状态与状态流转

- **pending**：问题已推送，等待用户回答
- **answered**：用户已回答，MultiSoul 已将答案写回同一 conversation
- **cancelled**：用户取消回答，卡片关闭但不启动 runtime

### 4.3 主要模块与关系

```
┌─────────────────────────────────────────────────────────┐
│ Runtime CLI (claude-code / codex / cursor)              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Agent 调用 AskUserQuestion 工具                  │  │
│  │ ↓                                                │  │
│  │ Runtime 捕获工具调用                             │  │
│  │ ↓                                                │  │
│  │ 调用: msctl ask-question --ask-id <id> ...      │  │
│  │ ↓                                                │  │
│  │ 立即返回 pending 状态                            │  │
│  │ ↓                                                │  │
│  │ 等待 MultiSoul 将 iOS answer 注入为 user message │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↕ 命令行调用 + HTTP
│  ┌──────────────────────────────────────────────────┐  │
│  │ msctl ask-question 命令                          │  │
│  │ - 解析问题参数                                   │  │
│  │ - 调用 msctl serve HTTP API 推送卡片             │  │
│  │ - 立即返回 pending 状态                          │  │
│  └──────────────────────────────────────────────────┘  │
│                          ↕ HTTP
│  ┌──────────────────────────────────────────────────┐  │
│  │ msctl serve (HTTP API)                           │  │
│  │ - POST /api/v1/ask-question: 接收并推送卡片      │  │
│  │ - 接收 iOS answer 并渲染为 Markdown user_text    │  │
│  │ - 复用现有 user message dispatch 触发 runtime    │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↕ WebSocket
┌─────────────────────────────────────────────────────────┐
│ iOS (mobile)                                            │
│ - 接收 ask_question 消息                               │
│ - 展示 AskQuestionCard / MultiAskQuestionCard           │
│ - 用户交互                                              │
│ - 发送 answer 消息                                      │
└─────────────────────────────────────────────────────────┘
```

## 5. 数据模型与接口

### 5.1 msctl ask-question 命令

**命令格式**：

```bash
msctl ask-question \
  --ask-id <tool_call_id> \
  --questions '[
    {
      "id": "0",
      "text": "选择一个方案",
      "options": [
        {"id": "0", "label": "方案 A"},
        {"id": "1", "label": "方案 B"}
      ],
      "multi_select": false
    }
  ]' \
  --conversation-id <conv_id> \
  --output json
```

**参数说明**：
- `--ask-id <id>`：工具调用 ID（必需）
- `--questions <json>`：问题定义 JSON 字符串（必需）
- `--conversation-id <id>`：对话 ID（必需）
- `--output json|text`：输出格式，默认 json（可选）

**返回格式**（JSON，立即返回）：
```json
{
  "ask_id": "tool_call_id",
  "status": "pending"
}
```

**错误返回**：
```json
{
  "ask_id": "tool_call_id",
  "status": "error",
  "error": "invalid questions format"
}
```

### 5.2 HTTP API 端点：推送卡片

**POST /api/v1/ask-question**

请求：
```json
{
  "ask_id": "tool_call_id",
  "questions": [
    {
      "id": "0",
      "text": "选择一个方案",
      "options": [
        {"id": "0", "label": "方案 A"},
        {"id": "1", "label": "方案 B"}
      ],
      "multi_select": false
    }
  ],
  "conversation_id": "conv_456"
}
```

返回：
```json
{
  "ask_id": "tool_call_id",
  "status": "pending"
}
```

### 5.3 iOS answer → user message

`msctl ask-question` 创建的卡片带有：

```json
{
  "response_mode": "user_message"
}
```

iOS 仍通过 WebSocket 发送 `type=answer`。当后端发现该 ask 不属于正在等待的 runtime `AskUserQuestion`，且 `response_mode == "user_message"` 时，会将答案渲染为结构化 Markdown，写入同一 conversation 的 `user_text`，并触发现有 runtime dispatch。

示例注入文本：

```markdown
用户已回答问题卡片：

1. 选择方案
   - 选择：方案 A
   - 输入：补充说明
```

### 5.4 ask_question 消息（msctl serve → iOS）

```json
{
  "ask_id": "tool_call_id",
  "questions": [
    {
      "id": "0",
      "text": "选择一个方案",
      "options": [
        { "id": "0", "label": "方案 A" },
        { "id": "1", "label": "方案 B" }
      ],
      "multi_select": false
    }
  ],
  "allow_freeform": false
}
```

### 5.5 answer 消息（iOS → msctl serve）

```json
{
  "ask_id": "tool_call_id",
  "choice_id": "0",
  "choice_ids": { "0": "0", "1": "1" },
  "freeform": "用户输入的文本"
}
```

## 6. 技术实现概览

### 6.1 整体架构

**现状**：
- Claude Code runtime 在 `stream.rs` 中有完整实现
- `interactive.rs` 提供了通用的 `InteractiveTool` trait 和 `AskUserQuestion` impl
- `state.rs` 中的 `answer_txs` 和 `AnswerChannel` 已经实现了 per-conversation 的答案通道
- Codex 和 Cursor runtime 不支持 `control_request` 协议

**新方案实现步骤**：
1. 创建 `msctl ask-question` 命令（新增 CLI 子命令）
   - 仅负责推送卡片，立即返回 pending 状态
2. 创建 HTTP API 端点：`POST /api/v1/ask-question`
   - 接收推送请求，调用 `interactive::build_ask_payload()` 构建消息
   - 推送卡片给 iOS
3. 扩展 WebSocket answer 处理
   - runtime-owned ask 继续走 `answer_txs`
   - `response_mode=user_message` 的 ask 渲染为 Markdown `user_text`
   - 取消仅标记 answered，不注入 user message
4. 在注入式 runtime 指南中添加 runtime 集成说明
5. Runtime CLI 按照指南调用 `msctl ask-question` 命令

### 6.2 关键技术决策

| 决策 | 理由 |
|------|------|
| msctl ask-question 仅推送，不等待 | 保持命令快速返回，答案由 MultiSoul 注入同一 conversation |
| iOS answer 转 user message | 对 Codex/Cursor 等 runtime 最自然，不需要额外 long-poll 协议 |
| 复用 `interactive.rs` 中的通用逻辑 | 避免代码重复，便于维护 |
| 在注入式 runtime 指南中提供集成说明 | 让 runtime CLI 开发者清楚如何集成 |

### 6.3 重要的约束与假设

- **假设 1**：Runtime CLI 都支持调用外部命令和 HTTP 请求（已验证）
- **假设 2**：`msctl serve` 已在本地运行（用户需要启动）
- **假设 3**：Runtime CLI 能访问 `msctl` 命令（需要在 PATH 中）
- **约束 1**：不修改 Claude Code runtime 的现有实现（已稳定）
- **约束 2**：所有 runtime 必须使用相同的 `ask_question` 消息格式
- **约束 3**：`msctl ask-question` 命令必须立即返回（不阻塞）

## 7. UI/UX 需求

**iOS 端**（已实现，无需修改）：
- 展示 `AskQuestionCard`（单问题）或 `MultiAskQuestionCard`（多问题）
- 支持单选、多选、填空三种交互
- 用户点击「确认」或「取消」后，发送 `answer` 消息

**CLI 端**：
- `msctl ask-question` 命令输出 JSON 或 text 格式的 pending 状态；答案由 HTTP answer API 返回
- 支持 `--output json` / `--output text` 两种输出格式
- 日志中记录 ask_question 和 answer 事件（便于调试）

## 8. 状态、错误与边界情况

### 8.1 常见错误场景

| 场景 | 处理方式 |
|------|---------|
| msctl serve 未运行 | 命令返回错误，提示用户启动 serve |
| 用户未及时回答 | 超时后返回错误或默认值 |
| 用户取消回答 | 返回 `status: "cancelled"` |
| 网络中断 | 重试机制或超时 |
| 问题格式错误 | 验证问题格式，返回错误 |

### 8.2 灰色状态

- **部分回答**：用户只回答了部分问题（多问题场景）— 需要明确是否允许
- **重复回答**：用户回答后又改主意 — 需要明确是否允许重新回答

### 8.3 极端情况

- **超大问题集**：100+ 个问题 — 需要测试 iOS 端的性能
- **超长选项文本**：单个选项 > 1000 字符 — 需要测试 iOS 端的布局
- **长时间等待**：用户长时间不回答 — 需要超时机制

## 9. 非功能性需求

### 9.1 性能与容量

- **问题数量**：支持 1-50 个问题（超过 50 个建议分批）
- **选项数量**：支持 1-20 个选项（超过 20 个建议分组）
- **响应时间**：iOS 端收到 ask_question 后，应在 100ms 内展示卡片
- **命令行响应**：`msctl ask-question` 命令应在 1 秒内返回 pending 状态

### 9.2 安全/权限

- **认证**：`msctl ask-question` 命令需要访问本地 `msctl serve` 服务
- **授权**：只有对应 conversation 的 iOS 端才能发送 answer 消息
- **数据隐私**：问题和答案存储在本地 SQLite，不上传到云端

### 9.3 可扩展性

- **新增交互工具**：通过实现 `InteractiveTool` trait 即可扩展
- **新增 runtime**：只需在 runtime CLI 中调用 `msctl ask-question` 命令

## 10. 风险、权衡与未决问题

### 10.1 已知风险

| 风险 | 应对思路 |
|------|---------|
| Runtime CLI 无法调用 `msctl` 命令 | 需要确保 `msctl` 在 PATH 中；或提供替代的 HTTP 调用方式 |
| `msctl serve` 未运行 | 命令返回清晰的错误提示 |
| 用户长时间不回答 | 卡片保持 pending，用户可稍后在 iOS 处理 |
| iOS 端网络不稳定 | 实现重连机制，确保 answer 消息最终能送达 |

### 10.2 已做的 trade-off

| Trade-off | 理由 |
|-----------|------|
| 命令行调用 vs 直接 HTTP | 命令行更简单，易于 runtime CLI 集成 |
| 同步等待 vs 异步注入 | 异步注入复用现有 user message 流程，避免额外 HTTP answer 协议 |
| 统一格式 vs 分化实现 | 统一格式便于维护和扩展 |

### 10.3 仍未决策的问题

- [ ] 是否允许用户重新回答？
- [ ] 是否需要实现问题的持久化和重放机制？
- [ ] 是否需要在 iOS 上展示长期未回答卡片的过期提示？

## 11. 验收标准与示例

### 11.1 验收 Checklist

- [ ] `msctl ask-question` 命令能正确推送问题给 iOS（立即返回 pending）
- [ ] HTTP API `POST /api/v1/ask-question` 能正确推送问题给 iOS
- [ ] iOS answer 能转换为 Markdown `user_text` 并触发 runtime
- [ ] iOS 端能正确接收、展示、回答卡片
- [ ] Claude Code runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] Codex runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] Cursor runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] 日志中记录所有 ask_question 和 answer 事件
- [ ] 单选、多选、填空三种问题类型都能正常工作
- [ ] 取消等边界情况都能正确处理
- [ ] 代码通过 `cargo test` 和 `cargo clippy`
- [ ] 注入式 runtime 指南中有清晰的两步集成说明

### 11.2 代表性用例

**用例 1：推送单选卡片并注入 user message**
```bash
msctl ask-question \
  --ask-id "call_123" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"方案 A"},{"id":"1","label":"方案 B"}],"multi_select":false}]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_123","status":"pending"}
```

iOS 用户选择“方案 A”后，MultiSoul 写入同一 conversation：

```markdown
用户已回答问题卡片：

1. 选择方案
   - 选择：方案 A
```

**用例 2：多选 + 自定义输入**
```bash
msctl ask-question \
  --ask-id "call_multi" \
  --questions '[{"id":"0","text":"选择要执行的步骤","options":[{"id":"a","label":"Alpha"},{"id":"b","label":"Beta"}],"multi_select":true}]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_multi","status":"pending"}
```

iOS 用户选择 Alpha 并输入补充内容后，MultiSoul 注入：

```markdown
用户已回答问题卡片：

1. 选择要执行的步骤
   - 选择：Alpha
   - 输入：补充内容
```

**用例 3：用户取消**

用户在 iOS 上点击取消/关闭时，MultiSoul 只标记卡片 answered 并清除 pending 状态，不写入 `user_text`，也不启动 runtime。

### 11.3 测试覆盖

- 单元测试：`msctl ask-question` 命令的参数解析和验证
- 单元测试：HTTP API 端点的请求验证和响应格式
- 集成测试：`msctl ask-question` 命令与 `msctl serve` 的交互
- 集成测试：iOS answer 被渲染为 Markdown `user_text` 并进入 runtime queue
- 集成测试：runtime-owned AskUserQuestion 仍优先走 `answer_txs`
- 各 runtime 集成测试：Claude Code、Codex、Cursor 分别通过同一 conversation 收到注入的 user message

---

## 附录 A：Runtime 集成指南

### Runtime 集成指南

当 Agent 调用 `AskUserQuestion` 工具时，Runtime CLI 应该调用 `msctl ask-question` 命令来推送卡片给 iOS。

#### Claude Code
已支持（通过 `control_request` 拦截）。无需额外集成。

#### Codex
在处理 tool_use 事件时，检测 `AskUserQuestion` 工具调用，调用 `msctl ask-question` 命令：

```bash
msctl ask-question \
  --ask-id <tool_call_id> \
  --questions '<json_string>' \
  --conversation-id <conv_id> \
  --output json
```

命令返回 `pending` 后无需再轮询。iOS 用户提交答案时，MultiSoul 会把答案注入为同一 conversation 的 Markdown user message，Codex runtime 按普通用户消息继续执行。

#### Cursor
同 Codex。在处理 tool_use 事件时，检测 `AskUserQuestion` 工具调用，调用 `msctl ask-question` 命令。

### 集成步骤

1. **检测工具调用**：在 runtime 的事件处理中，检测 `tool_name == "AskUserQuestion"`
2. **构建命令**：将工具参数转换为 `msctl ask-question` 命令参数
3. **执行命令**：调用 `msctl ask-question` 命令，确认返回 `pending`
4. **继续 conversation**：等待 MultiSoul 在 iOS 提交后注入下一条 user message
5. **错误处理**：如果推送失败，返回相应的错误信息给 Agent

### 示例代码（伪代码）

```python
def handle_tool_use(tool_name, tool_input, tool_call_id):
    if tool_name != "AskUserQuestion":
        return handle_other_tool(tool_name, tool_input, tool_call_id)

    questions_json = json.dumps(tool_input.get("questions", []))
    result = subprocess.run([
        "msctl", "ask-question",
        "--ask-id", tool_call_id,
        "--questions", questions_json,
        "--conversation-id", conversation_id,
        "--output", "json",
    ], capture_output=True, text=True)

    if result.returncode != 0:
        return {
            "type": "tool_result",
            "tool_use_id": tool_call_id,
            "is_error": True,
            "content": f"Failed to push question: {result.stderr}",
        }

    push_result = json.loads(result.stdout)
    if push_result["status"] != "pending":
        return {
            "type": "tool_result",
            "tool_use_id": tool_call_id,
            "is_error": True,
            "content": f"Failed to push question: {push_result.get('error', 'Unknown error')}",
        }

    return {
        "type": "tool_result",
        "tool_use_id": tool_call_id,
        "content": "Question card sent. MultiSoul will continue this conversation when the user answers on iOS.",
    }
```

---

## 附录 B：参考资源

- **现有实现**：`cli/src/serve/interactive.rs`、`cli/src/serve/runtime/claude/stream.rs`
- **iOS 端**：`mobile/src/features/chat/components/AskQuestionCard.tsx`、`MultiAskQuestionCard.tsx`
- **消息格式**：`mobile/src/types.ts` 中的 `AskQuestionPayload`
- **msctl 命令参考**：`cli/src/commands/` 中的其他命令实现
- **Runtime 指南**：`docs/references/msctl-inject.md` 与 `cli/src/templates/commands.md` 中的 Agent quick reference
