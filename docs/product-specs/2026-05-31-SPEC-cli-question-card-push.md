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
- 通过 `AGENTS.md` 引导 runtime CLI（Claude Code、Codex、Cursor）如何调用此命令
- 让所有 runtime 都能支持 `AskUserQuestion` 工具

## 2. 范围

### 2.1 In Scope
- 创建 `msctl ask-question` 命令（或类似名称）
- 命令支持推送问答卡片给 iOS、等待用户回答、返回结果
- 在 `AGENTS.md` 中添加 runtime 集成指南
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
- **answered**：用户已回答，msctl 已返回答案给 Runtime CLI
- **timeout**：用户未在规定时间内回答（可选）
- **cancelled**：用户取消回答（可选）

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
│  │ 调用: HTTP GET /api/v1/answer/{ask_id}          │  │
│  │ ↓                                                │  │
│  │ 阻塞等待答案                                      │  │
│  │ ↓                                                │  │
│  │ 将答案返回给 Agent                               │  │
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
│  │ - GET /api/v1/answer/{ask_id}: 等待答案          │  │
│  │ - 接收 answer 消息，通过 answer_txs 发送         │  │
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

### 5.3 HTTP API 端点：等待答案

**GET /api/v1/answer/{ask_id}?conversation_id={conv_id}**

返回（阻塞直到有答案）：
```json
{
  "ask_id": "tool_call_id",
  "status": "answered",
  "answers": {
    "0": "方案 A"
  }
}
```

或（多问题）：
```json
{
  "ask_id": "tool_call_id",
  "status": "answered",
  "answers": {
    "0": "是",
    "1": "否",
    "2": "staging"
  }
}
```

**错误返回**：
```json
{
  "ask_id": "tool_call_id",
  "status": "error",
  "error": "timeout"
}
```

或：
```json
{
  "ask_id": "tool_call_id",
  "status": "cancelled",
  "error": "user cancelled"
}
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
3. 创建 HTTP API 端点：`GET /api/v1/answer/{ask_id}`
   - 阻塞等待答案（利用现有 `answer_txs` 机制）
   - 返回答案给 Runtime CLI
4. 在 `AGENTS.md` 中添加 runtime 集成指南
5. Runtime CLI 按照指南调用 `msctl ask-question` 命令和 HTTP API

### 6.2 关键技术决策

| 决策 | 理由 |
|------|------|
| msctl ask-question 仅推送，不等待 | 简化命令逻辑，Runtime CLI 自己管理等待 |
| 通过 HTTP API 等待答案 | 复用现有 `answer_txs` 架构，简单可靠 |
| 复用 `interactive.rs` 中的通用逻辑 | 避免代码重复，便于维护 |
| 在 `AGENTS.md` 中提供集成指南 | 让 runtime CLI 开发者清楚如何集成 |

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
- `msctl ask-question` 命令输出 JSON 格式的答案
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
- **等待时间**：HTTP API `GET /api/v1/answer/{ask_id}` 默认超时为 600 秒（10 分钟）
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
| 用户长时间不回答 | 设置超时机制，超时后自动取消或重试 |
| iOS 端网络不稳定 | 实现重连机制，确保 answer 消息最终能送达 |

### 10.2 已做的 trade-off

| Trade-off | 理由 |
|-----------|------|
| 命令行调用 vs 直接 HTTP | 命令行更简单，易于 runtime CLI 集成 |
| 同步等待 vs 异步处理 | 同步等待更简单，与 runtime CLI 的执行模型一致 |
| 统一格式 vs 分化实现 | 统一格式便于维护和扩展 |

### 10.3 仍未决策的问题

- [ ] 是否允许用户重新回答？
- [ ] 是否需要实现问题的持久化和重放机制？
- [ ] HTTP API `GET /api/v1/answer/{ask_id}` 的超时时间是否可配置？

## 11. 验收标准与示例

### 11.1 验收 Checklist

- [ ] `msctl ask-question` 命令能正确推送问题给 iOS（立即返回 pending）
- [ ] HTTP API `POST /api/v1/ask-question` 能正确推送问题给 iOS
- [ ] HTTP API `GET /api/v1/answer/{ask_id}` 能正确等待并返回答案
- [ ] iOS 端能正确接收、展示、回答卡片
- [ ] Claude Code runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] Codex runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] Cursor runtime 能通过调用 `msctl ask-question` 支持 AskUserQuestion
- [ ] 日志中记录所有 ask_question 和 answer 事件
- [ ] 单选、多选、填空三种问题类型都能正常工作
- [ ] 超时、取消等边界情况都能正确处理
- [ ] 代码通过 `cargo test` 和 `cargo clippy`
- [ ] AGENTS.md 中有清晰的 runtime 集成指南

### 11.2 代表性用例

**用例 1：Claude Code 调用 msctl（JSON 字符串）**
```bash
# 步骤 1：推送卡片
msctl ask-question \
  --ask-id "call_123" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_123","status":"pending"}

# 步骤 2：等待答案
curl -X GET "http://localhost:8765/api/v1/answer/call_123?conversation_id=conv_456" \
  -H "Authorization: Bearer <token>"

# 返回（阻塞直到有答案）
{"ask_id":"call_123","status":"answered","answers":{"0":"A"}}
```

**用例 2：Codex 调用 msctl**
```bash
# 步骤 1：推送卡片
msctl ask-question \
  --ask-id "call_789" \
  --questions '[
    {
      "id": "0",
      "text": "选择部署环境",
      "options": [
        {"id": "0", "label": "staging"},
        {"id": "1", "label": "production"}
      ],
      "multi_select": false
    }
  ]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_789","status":"pending"}

# 步骤 2：等待答案
curl -X GET "http://localhost:8765/api/v1/answer/call_789?conversation_id=conv_456" \
  -H "Authorization: Bearer <token>"

# 返回
{"ask_id":"call_789","status":"answered","answers":{"0":"staging"}}
```

**用例 3：多问题场景**
```bash
# 步骤 1：推送卡片
msctl ask-question \
  --ask-id "call_multi" \
  --questions '[
    {"id":"0","text":"删除文件?","options":[{"id":"0","label":"是"},{"id":"1","label":"否"}],"multi_select":false},
    {"id":"1","text":"上传云端?","options":[{"id":"0","label":"是"},{"id":"1","label":"否"}],"multi_select":false},
    {"id":"2","text":"输入备注","options":[],"multi_select":false}
  ]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_multi","status":"pending"}

# 步骤 2：等待答案
curl -X GET "http://localhost:8765/api/v1/answer/call_multi?conversation_id=conv_456" \
  -H "Authorization: Bearer <token>"

# 返回
{"ask_id":"call_multi","status":"answered","answers":{"0":"是","1":"否","2":"备注内容"}}
```

**用例 4：超时场景**
```bash
# 步骤 1：推送卡片
msctl ask-question \
  --ask-id "call_timeout" \
  --questions '[...]' \
  --conversation-id "conv_456" \
  --output json

# 返回（立即）
{"ask_id":"call_timeout","status":"pending"}

# 步骤 2：等待答案（30 秒后超时）
curl -X GET "http://localhost:8765/api/v1/answer/call_timeout?conversation_id=conv_456&timeout=30" \
  -H "Authorization: Bearer <token>"

# 返回（超时）
{"ask_id":"call_timeout","status":"error","error":"timeout"}
```

**用例 5：用户取消**
```bash
# 用户在 iOS 上点击「取消」

# 步骤 2：等待答案
curl -X GET "http://localhost:8765/api/v1/answer/call_cancel?conversation_id=conv_456" \
  -H "Authorization: Bearer <token>"

# 返回
{"ask_id":"call_cancel","status":"cancelled","error":"user cancelled"}
```

### 11.3 测试覆盖

- 单元测试：`msctl ask-question` 命令的参数解析和验证
- 单元测试：HTTP API 端点的请求验证和响应格式
- 集成测试：`msctl ask-question` 命令与 `msctl serve` 的交互
- 集成测试：HTTP API `GET /api/v1/answer/{ask_id}` 与 `answer_txs` 的交互
- 端到端测试：从 Runtime CLI 调用到 iOS 回答的完整流程
- 各 runtime 集成测试：Claude Code、Codex、Cursor 分别调用 `msctl ask-question` 和 HTTP API

---

## 附录 A：AGENTS.md 集成指南

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
  --timeout 600 \
  --output json
```

将返回的 JSON 答案转换为 tool_result，继续执行。

#### Cursor
同 Codex。在处理 tool_use 事件时，检测 `AskUserQuestion` 工具调用，调用 `msctl ask-question` 命令。

### 集成步骤

1. **检测工具调用**：在 runtime 的事件处理中，检测 `tool_name == "AskUserQuestion"`
2. **构建命令**：将工具参数转换为 `msctl ask-question` 命令参数
3. **执行命令**：调用 `msctl ask-question` 命令，等待返回
4. **处理结果**：将返回的答案转换为 tool_result，继续执行
5. **错误处理**：如果命令失败（超时、取消等），返回相应的错误信息给 Agent

### 示例代码（伪代码）

```python
def handle_tool_use(tool_name, tool_input, tool_call_id):
    if tool_name == "AskUserQuestion":
        # 步骤 1：调用 msctl ask-question 推送卡片
        questions_json = json.dumps(tool_input.get("questions", []))
        cmd = [
            "msctl", "ask-question",
            "--ask-id", tool_call_id,
            "--questions", questions_json,
            "--conversation-id", conversation_id,
            "--output", "json"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode != 0:
            return {
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "is_error": True,
                "content": f"Failed to push question: {result.stderr}"
            }
        
        push_result = json.loads(result.stdout)
        if push_result["status"] != "pending":
            return {
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "is_error": True,
                "content": f"Failed to push question: {push_result.get('error', 'Unknown error')}"
            }
        
        # 步骤 2：通过 HTTP API 等待答案
        try:
            response = requests.get(
                f"http://localhost:8765/api/v1/answer/{tool_call_id}",
                params={"conversation_id": conversation_id},
                headers={"Authorization": f"Bearer {token}"},
                timeout=600
            )
            response.raise_for_status()
            answer_data = response.json()
            
            if answer_data["status"] == "answered":
                # 返回答案给 Agent
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "content": json.dumps(answer_data["answers"])
                }
            else:
                # 处理错误或取消
                return {
                    "type": "tool_result",
                    "tool_use_id": tool_call_id,
                    "is_error": True,
                    "content": answer_data.get("error", "Unknown error")
                }
        except requests.exceptions.Timeout:
            return {
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "is_error": True,
                "content": "Timeout waiting for user answer"
            }
        except Exception as e:
            return {
                "type": "tool_result",
                "tool_use_id": tool_call_id,
                "is_error": True,
                "content": f"Failed to get answer: {str(e)}"
            }
    else:
        # 处理其他工具
        pass
```

---

## 附录 B：参考资源

- **现有实现**：`cli/src/serve/interactive.rs`、`cli/src/serve/runtime/claude/stream.rs`
- **iOS 端**：`mobile/src/features/chat/components/AskQuestionCard.tsx`、`MultiAskQuestionCard.tsx`
- **消息格式**：`mobile/src/types.ts` 中的 `AskQuestionPayload`
- **msctl 命令参考**：`cli/src/commands/` 中的其他命令实现
- **AGENTS.md**：`AGENTS.md` 中的 Runtime 集成指南章节
