# KodaX Runtime Integration SPEC

## 1. 背景与目标

MultiSoul 当前支持本地 CLI runtime：`claude-code`、`codex`、`cursor-cli`。用户已经在本机安装并验证了 KodaX / InfCodeX，期望把 KodaX 作为新的本地 Agent runtime 接入 MultiSoul，使手机端可以像遥控 Codex、Cursor 一样遥控 KodaX。

本功能目标：

- 新增 `kodax` runtime 类型
- 通过本机 `kodax` CLI 执行任务
- 在 iOS Chat 中展示 KodaX 输出、思考、工具调用、工具结果和任务状态
- 复用现有 conversation、model switching、abort、图片提示、question card 等 MultiSoul 能力
- 保持零中心后端：KodaX 仍运行在用户本机，数据不经过 MultiSoul 自营服务

## 2. 范围

### In Scope

- `msctl agent register --runtime kodax` 注册 KodaX runtime agent
- `msctl agent kodax` 快速注册当前目录
- iOS Agents / Chat 页面能展示并进入 `kodax` agent
- 用户发送消息后，`msctl serve` 调用本机 `kodax` CLI
- KodaX session 与 MultiSoul `conversation_id` 一对一映射
- KodaX stdout 优先按 JSONL 事件解析，失败或不可用时退回纯文本
- KodaX JSONL 事件映射到 MultiSoul message roles：
  - `text.delta` → `agent_text`
  - `thinking.delta` / `thinking.end` → `agent_text`
  - `tool.start` → `tool_call`
  - `tool.result` → `tool_result`
  - `run.result` / `complete` → `task_status`
- `conversation.model_id` 复用现有模型切换能力，KodaX 使用 `provider:model` 编码
- `GET /api/v1/runtime-models?runtime=kodax` 返回内置常用 `provider:model` 列表和 Default
- 带图片消息通过本地图片路径提示注入 prompt
- Abort conversation 时 kill 当前 KodaX 子进程并标记任务中止
- KodaX binary 默认使用 `kodax`，允许通过 `KODAX_BIN` 覆盖
- 结构化决策继续复用现有 `msctl ask-question` 指南：KodaX 通过命令推送 question card，iOS answer 注入为同一 conversation 的 `user_text`

### Out of Scope

- 把 KodaX 作为 Node/TypeScript library 嵌入 Rust CLI
- V1 实现 KodaX 子进程预热
- V1 动态读取 `~/.kodax/config.json` 生成模型列表
- V1 新增 agent 级 provider/model 配置字段
- V1 手动回放 MultiSoul 历史消息给 KodaX
- V1 为 KodaX 内部 ask-user-question 工具建立 runtime-owned blocking answer channel
- 修改 KodaX 源码或依赖 KodaX 私有 API

## 3. 用户场景

### 场景 1：注册 KodaX agent

用户在项目目录中执行：

```bash
msctl agent kodax
```

MultiSoul 注册一个 runtime 为 `kodax` 的 agent，并向项目注入现有 MultiSoul runtime 指南。iOS 在 Agents 列表中展示该 agent。

### 场景 2：从手机发起 KodaX 任务

用户在 iOS Chat 中发送任务。`msctl serve` 创建或复用当前 conversation 对应的 KodaX session，并启动：

```bash
kodax --mode json --session <conversation_id> --agent-mode ama "<prompt>"
```

若 conversation 选择了具体模型，例如 `openai:gpt-5.4`，则调用时携带：

```bash
-m openai --model gpt-5.4
```

### 场景 3：查看工具调用和结果

KodaX 执行工具时，iOS Chat 中出现工具调用和工具结果事件。用户能看到 KodaX 正在读写文件、执行 shell 或完成其他工具动作。

### 场景 4：切换 KodaX provider/model

用户在 Chat 模型选择器中选择 `openai:gpt-5.4`、`zhipu-coding:<model>` 等 KodaX 模型项。下一条消息开始使用新 provider/model。Default 表示完全交给 KodaX 自身默认配置。

### 场景 5：用户中止任务

用户在 iOS 中 abort 正在运行的 KodaX conversation。`msctl serve` kill 当前 KodaX 子进程，并将 conversation 置为非运行状态，避免后台任务继续修改项目。

## 4. 产品语义

### 4.1 Runtime 名称

新增 runtime id：

```text
kodax
```

该 runtime 与 `claude-code`、`codex`、`cursor-cli` 同级。

### 4.2 Session 映射

MultiSoul `conversation_id` 一对一映射 KodaX session id。

规则：

- 新 conversation 第一次消息使用 `--session <conversation_id>`
- 后续同一 conversation 继续使用同一个 `--session <conversation_id>`
- MultiSoul 不额外维护 `kodax_session_id` 数据库字段
- 若 KodaX session 文件丢失，底层 KodaX 按自身行为处理；MultiSoul 不在 V1 手动重建历史

### 4.3 输出解析

KodaX runtime 优先使用 `--mode json`。

预期 JSONL 事件包括：

```text
session.start
iteration.start
iteration.end
text.delta
thinking.delta
thinking.end
tool.start
tool.input.delta
tool.result
stream.end
complete
run.result
error
```

MultiSoul 对可识别事件落库并广播。不可识别事件记录 debug log，不阻断任务。

如果 stdout 行不是 JSON，或 KodaX 因版本不支持 `--mode json` 输出纯文本，MultiSoul 将非空文本合并为 `agent_text`。纯文本 fallback 不保证工具事件可见。

### 4.4 Provider / Model 编码

KodaX 使用 `conversation.model_id` 表达 provider 和 model：

```text
provider:model
```

示例：

```text
openai:gpt-5.4
anthropic:claude-sonnet-4-6
zhipu-coding:glm-5
minimax-coding:MiniMax-M2.7
```

规则：

- `model_id = NULL` 表示 Default，不传 `-m` 和 `--model`
- `model_id = provider:model` 时，传 `-m <provider> --model <model>`
- provider 为空或 model 为空视为非法 model id
- `default` 字符串仍是 API 虚拟项，不写入 `conversations.model_id`

### 4.5 KodaX Mode 映射

MultiSoul 现有 agent mode 值为：

```text
suggest | auto-edit | full-auto | yolo
```

KodaX 当前非交互 JSON CLI 主要支持：

```text
--reasoning off|auto|quick|balanced|deep
--agent-mode ama|sa
```

V1 规则：

- 不把 MultiSoul `mode` 映射为 KodaX 权限语义
- 不传 `--reasoning`，使用 KodaX 默认 `auto`
- 固定传 `--agent-mode ama`
- `-y/--auto` 在 KodaX 非 REPL CLI 中为 no-op，V1 不依赖它

### 4.6 图片消息

当用户消息包含 `file_id` 时，KodaX runtime 不传原生图片 content block。MultiSoul 在 prompt 前注入本地文件路径提示：

```text
[Attached image: <absolute_path> - use your file reading tool to view it]

<user_text>
```

该策略与 Cursor runtime 的路径提示语义保持一致。

### 4.7 Ask Question

KodaX runtime 不在 V1 建立专用 blocking answer channel。

结构化决策继续走现有统一方案：

1. MultiSoul 注入 runtime 指南，要求 Agent 使用 `msctl ask-question`
2. KodaX 调用 `msctl ask-question --conversation-id <id> --questions ...`
3. iOS 展示 question card
4. 用户回答后，MultiSoul 将答案注入为同一 conversation 的 Markdown `user_text`
5. KodaX 下一轮按普通用户消息继续

## 5. API 与 UI 影响

### 5.1 Agent 注册

现有命令新增 `kodax`：

```bash
msctl agent kodax
msctl agent register --name work-kodax --project /path/to/project --runtime kodax
```

无效 runtime 提示中的合法列表应包含：

```text
claude-code, codex, cursor-cli, kodax
```

### 5.2 Runtime Models

请求：

```http
GET /api/v1/runtime-models?runtime=kodax
```

返回包含 Default 和内置常用 `provider:model` 项。

示例：

```json
[
  {
    "id": "default",
    "label": "Default",
    "is_default": true,
    "source": "builtin",
    "available": true
  },
  {
    "id": "openai:gpt-5.4",
    "label": "OpenAI / GPT-5.4",
    "is_default": false,
    "source": "builtin",
    "available": true
  }
]
```

V1 列表应至少覆盖 KodaX 当前支持的 native provider families：

- `anthropic`
- `openai`
- `deepseek`
- `kimi`
- `kimi-code`
- `qwen`
- `zhipu`
- `zhipu-coding`
- `minimax-coding`

`gemini-cli` / `codex-cli` 是 KodaX 的 lossy CLI bridge provider，V1 不放入内置常用模型列表；用户仍可通过 Default 走 KodaX 自身配置。

### 5.3 Messages

KodaX runtime 复用现有 message roles：

| KodaX 事件 | MultiSoul role | 说明 |
|------------|----------------|------|
| `text.delta` | `agent_text` | 文本增量可合并后落库 |
| `thinking.delta` / `thinking.end` | `agent_text` | V1 作为普通可见文本处理 |
| `tool.start` | `tool_call` | `tool` 为工具名，`args` 为 JSON input |
| `tool.input.delta` | debug only | V1 不单独落库；`tool.start.input` 是权威 args |
| `tool.result` | `tool_result` | `summary` 为结果内容 |
| `complete` / `run.result` success=true | `task_status` | `completed` |
| `run.result` success=false / `error` | `task_status` | `failed` |
| child killed by abort | `task_status` | `aborted` |

## 6. 验收标准

- [ ] `msctl agent kodax` 成功注册当前目录，数据库 `agents.runtime = 'kodax'`
- [ ] `msctl agent register --runtime kodax` 成功注册
- [ ] `msctl agent list` 和 iOS Agents 列表能展示 KodaX agent
- [ ] `POST /api/v1/conversations/:id/messages` 能触发 KodaX 子进程
- [ ] KodaX 子进程默认调用 `kodax`，设置 `KODAX_BIN=/path/to/kodax` 后使用覆盖路径
- [ ] KodaX 调用包含 `--mode json --session <conversation_id> --agent-mode ama`
- [ ] `model_id = NULL` 时不传 `-m` 和 `--model`
- [ ] `model_id = openai:gpt-5.4` 时传 `-m openai --model gpt-5.4`
- [ ] JSONL `text.delta` 能在 iOS Chat 显示为 agent 文本
- [ ] JSONL `tool.start` 能在 iOS Chat 显示为工具调用
- [ ] JSONL `tool.result` 能在 iOS Chat 显示为工具结果
- [ ] JSONL `run.result success=true` 能生成 completed task status
- [ ] JSONL error 或进程失败能生成 failed task status
- [ ] 非 JSON stdout fallback 能显示为 agent 文本
- [ ] 带图片消息会在 prompt 中包含本地图片绝对路径提示
- [ ] Abort 能 kill 当前 KodaX 子进程，并使 conversation 退出 running 状态
- [ ] `GET /api/v1/runtime-models?runtime=kodax` 返回 Default 和内置 KodaX 模型项
- [ ] PATCH conversation model 接受合法 KodaX `provider:model`，拒绝非法值
- [ ] KodaX runtime 可通过 `msctl ask-question` 推送 question card，iOS answer 注入后继续对话

## 7. 兼容性与风险

### 7.1 KodaX 版本风险

KodaX `--mode json` 是当前版本可用的脚本接口。若用户安装旧版 KodaX，不支持该参数，MultiSoul 应记录错误并尽量 fallback 到纯文本模式，或给出明确失败信息。

### 7.2 Provider 凭证风险

KodaX provider API key 由 KodaX 自身读取环境变量或 `~/.kodax/config.json`。MultiSoul 不保存、展示或校验第三方 provider token。

### 7.3 Tool Event 语义风险

不同 KodaX provider 或未来版本可能改变工具事件内容。V1 只要求稳定展示 `tool.start` 和 `tool.result` 的基础字段；未知字段不影响任务完成。

### 7.4 Session 语义风险

MultiSoul 使用 `conversation_id` 作为 KodaX session id，但不控制 KodaX session 存储实现。若 KodaX session 被用户删除，MultiSoul 不做历史回放兜底。

## 8. Review 关注点

请重点 review：

- `provider:model` 是否足够表达 KodaX 模型选择，是否需要 provider-only 项
- `thinking.*` 作为 `agent_text` 是否可接受，还是应该后续新增专门 role
- V1 不做预热是否满足手机端响应体验
- 纯文本 fallback 是否应该在 UI 上提示“工具事件不可见”
- KodaX Ask Question 是否只走 `msctl ask-question` 注入路径，是否需要后续专门解析 KodaX 内部 ask-user-question 工具
