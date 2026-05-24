# Runtime Model Switching SPEC

## 1. 背景与目标

MultiSoul 当前通过 CLI runtime 驱动本机 AI Agent：`claude-code`、`codex`、`cursor-cli`。用户希望在 iOS 的同一个 conversation 内切换模型，例如从默认模型切到更强或更快的模型，同时继续利用底层 CLI runtime 已保存的会话历史。

本功能目标是让用户在 Chat 页面内切换当前 conversation 使用的模型。MultiSoul 负责记录模型选择、校验状态、把模型参数传给 runtime；历史上下文继续由 Claude Code / Codex CLI / Cursor Agent 自身的 session/thread resume 机制承载。

## 2. 范围

### In Scope

- iOS Chat 页面内展示当前 conversation 的模型，并允许切换
- CLI serve 暴露 runtime 模型能力接口，mobile 不硬编码模型列表
- `conversations.model_id` 持久化当前 conversation 的模型选择
- `NULL` / `default` 表示使用底层 runtime 默认模型
- 只允许在非运行状态切换模型
- 模型切换成功后写入可见的 `system_event` 历史消息
- Claude Code / Codex CLI / Cursor Agent 后续 fresh/resume 调用都携带选定模型参数
- Runtime model provider 以可扩展注册表形式组织，便于后续新增 runtime 或动态模型查询能力

### Out of Scope

- Agent 默认模型设置
- 运行中强制切换模型或自动 abort 当前任务
- 手动重放 MultiSoul 消息历史、工具历史或图片历史
- 自定义 model id 输入
- 为每条 agent 回复单独展示 model badge
- 支持 plugin agent 的模型切换

## 3. 用户场景

**典型用户**：手机上正在跟某个本地 Agent 对话，发现当前模型不适合当前任务，希望下一轮开始换成另一个模型。

**核心流程**：
1. 用户进入某个 conversation
2. 用户打开模型选择器
3. App 从 CLI serve 获取该 agent runtime 的可用模型
4. 用户选择新模型
5. 后端校验 conversation 当前不在运行中
6. 后端更新 `conversations.model_id`，写入 `system_event:model_changed`
7. 下一条用户消息继续 resume 原 CLI session/thread，并携带新模型参数

## 4. 产品语义

### 4.1 切换范围

模型选择是 **conversation 级状态**，不是 agent 级默认值。

- 同一个 agent 的不同 conversation 可以使用不同模型
- 切换只影响当前 conversation
- 新 conversation 默认使用 runtime 默认模型，除非后续另行设计 agent 默认值

### 4.2 切换时机

只允许在以下状态切换：

- `idle`
- `completed`
- `failed`

以下状态禁止切换：

- `running`
- `awaiting_question`

禁止时 iOS 应禁用模型选择入口或展示明确提示：当前任务仍在运行，需要停止或等待完成后再切换。

### 4.3 上下文语义

MultiSoul 不做历史注入。

切换模型后，后续 runtime 调用仍使用当前 conversation 已保存的底层 session/thread id：

- Claude Code：`claude --resume <claude_session_id> --model <model_id>`
- Codex CLI：`codex exec resume <codex_thread_id> --model <model_id>`
- Cursor Agent：`agent --resume <cursor_session_id> --model <model_id>`

历史上下文由底层 CLI runtime 的 resume 机制负责。若某个 runtime 的 `resume + --model` 行为在实测中不可用，应作为 runtime bug 或兼容性问题处理，不在 v1 中通过 MultiSoul 手动回放历史兜底。

### 4.4 Default 模型

`model_id = NULL` 表示使用底层 runtime 默认模型。

API 可以把 Default 作为模型列表中的虚拟项返回给 iOS：

```json
{
  "id": "default",
  "label": "Default",
  "is_default": true,
  "source": "builtin"
}
```

iOS 向 PATCH API 提交 `null` 表示切回 Default。后端不得把 `"default"` 字符串写入 `conversations.model_id`。

## 5. API 设计

### 5.1 获取 runtime 模型列表

```
GET /api/v1/runtime-models?runtime=codex
Authorization: Bearer <token>
```

返回：

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
    "id": "gpt-5.3-codex",
    "label": "Codex 5.3",
    "is_default": false,
    "source": "dynamic",
    "available": true
  }
]
```

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 传给 runtime 的 model id；`default` 是 API 虚拟项 |
| `label` | string | iOS 展示名称 |
| `is_default` | boolean | 是否为 Default 虚拟项 |
| `source` | `dynamic` \| `builtin` | 来源：底层 CLI 动态查询或 CLI 内置兜底 |
| `available` | boolean | 当前是否可选；v1 返回项默认 `true` |

错误：

| 场景 | 状态码 |
|------|--------|
| 未认证 | 401 |
| runtime 未知或不支持模型能力 | 404 |
| provider 执行失败且无 fallback | 503 |

### 5.2 切换 conversation 模型

```
PATCH /api/v1/conversations/:id/model
Authorization: Bearer <token>
Content-Type: application/json

{ "model_id": "gpt-5.3-codex" }
```

切回 Default：

```json
{ "model_id": null }
```

成功返回更新后的 conversation：

```json
{
  "id": "conv_123",
  "agent_id": "agent_123",
  "title": "Fix build",
  "created_at": 1760000000000,
  "last_message_at": 1760000001000,
  "status": "completed",
  "model_id": "gpt-5.3-codex",
  "first_user_message": "Why is CI failing?",
  "last_ai_reply": "The failure is caused by..."
}
```

错误：

| 场景 | 状态码 |
|------|--------|
| conversation 不存在 | 404 |
| conversation 状态为 `running` 或 `awaiting_question` | 409 |
| model 不在该 runtime 的 capability 列表中 | 400 |
| provider 无法确认模型列表 | 503 |

### 5.3 Conversation 返回体

所有返回 conversation 的接口增加：

```json
{
  "model_id": null
}
```

影响接口：

- `GET /api/v1/agents/:id/conversations`
- `POST /api/v1/agents/:id/conversations`
- `PATCH /api/v1/conversations/:id/model`

## 6. 数据模型

### 6.1 SQLite migration

`conversations` 新增字段：

```sql
ALTER TABLE conversations ADD COLUMN model_id TEXT;
```

约束：

- `NULL` 表示 runtime 默认模型
- 不使用 DB CHECK 约束枚举模型，因为模型列表会随 CLI/runtime 演进
- 校验放在 PATCH API 的 provider capability 结果上

### 6.2 Message role

新增 message role：

```ts
type MessageRole = ... | 'system_event';
```

模型切换事件 payload：

```json
{
  "event": "model_changed",
  "from_model_id": null,
  "to_model_id": "gpt-5.3-codex",
  "from_label": "Default",
  "to_label": "Codex 5.3"
}
```

插入规则：

- PATCH 成功后插入一条 `system_event`
- `seq = MAX(seq)+1`
- `created_at = now_ms()`
- 同步更新 `conversations.last_message_at`
- 通过当前 conversation WebSocket 广播给已打开的 Chat 页面

## 7. Runtime Model Provider

### 7.1 Provider 注册表

CLI 内部新增 provider 注册表：

```rust
trait RuntimeModelProvider {
    fn runtime(&self) -> &'static str;
    fn list_models(&self) -> Result<Vec<ModelCapability>>;
    fn validate_model(&self, model_id: Option<&str>) -> Result<()>;
}
```

`ModelCapability`：

```rust
struct ModelCapability {
    id: String,
    label: String,
    is_default: bool,
    source: ModelSource,
    available: bool,
}
```

provider 规则：

- 每个 provider 必须返回 Default 虚拟项
- 动态查询优先，失败时返回内置 fallback
- fallback 列表应集中在 provider 模块内，不散落在 route 或 mobile 中
- 新 runtime 接入时新增 provider 并注册，不改变 mobile API

### 7.2 Runtime v1 能力

| runtime | 模型参数 | 动态查询 | v1 行为 |
|---------|----------|----------|---------|
| `claude-code` | `--model <model>` | 暂无稳定 list 命令 | 内置 fallback |
| `codex` | `--model <model>` / `-m` | 暂无稳定 list 命令 | 内置 fallback |
| `cursor-cli` | `--model <model>` | `agent models` | 动态优先，失败 fallback |

## 8. Runtime 行为

### 8.1 Dispatch

`post_message` 查询 agent/runtime/mode 时，同时读取 conversation 的 `model_id`。

`runtime::DispatchMessage` 或 runtime dispatch 参数新增 `model_id: Option<&str>`。

### 8.2 Claude Code

当前 Claude runtime 是每 conversation 一个长驻 process。支持模型切换需要：

- worker 启动时接收当前 `model_id`
- `spawn_claude(project_path, session_id, model_id)` 在 `model_id != None` 时追加 `--model <model_id>`
- 如果已有 worker 仍在等待下一条消息，下一条消息到达前应能感知 DB 中最新 `model_id`
- 当模型发生变化且当前 child process 已存在时，worker 应终止旧 child，并用同一个 `claude_session_id` + 新 `model_id` 重启

### 8.3 Codex CLI

Codex 每 turn 使用 `codex exec` / `codex exec resume`。

要求：

- `build_codex_args(..., model_id)` 在 `model_id != None` 时追加 `--model <model_id>`
- fresh 和 resume 都必须传模型
- pre-warmed resume process 必须与当前 `model_id` 绑定
- 如果用户切换模型，下一条消息不得复用旧模型的 pre-warmed process

### 8.4 Cursor Agent

Cursor 当前通过 `CURSOR_AGENT_MODEL` 环境变量传模型。v1 后改为 conversation 级参数：

- `spawn_agent(..., model_id)` 在 `model_id != None` 时追加 `--model <model_id>`
- `CURSOR_AGENT_MODEL` 不再作为 conversation model 的权威来源
- 如需保留环境变量，可仅作为 CLI fallback/default 行为，不覆盖 `conversations.model_id`

## 9. iOS 交互

### 9.1 Chat 页面入口

Chat 页面展示当前模型：

- `Default`
- 或 provider 返回的 `label`

模型选择器放在 Chat 页面 header 或现有顶部控制区中，属于当前 conversation 状态。

### 9.2 禁用态

当 conversation 状态为 `running` 或 `awaiting_question`：

- 模型选择入口禁用
- 用户点击时提示：任务运行中，完成或停止后可切换模型

### 9.3 首次提示

用户第一次切换模型时，iOS 弹出一次确认：

- 告知：聊天记录保留，底层 CLI 将通过 resume 继续使用历史
- 告知：切换从下一条消息开始生效
- 确认后写入本地设置，不再重复提示

此状态只存在 mobile 本地，不需要后端字段。

### 9.4 历史展示

`system_event:model_changed` 渲染为轻量历史分隔行，例如：

```
Model changed: Default -> Codex 5.3
```

它不应计入 `last_ai_reply`。

## 10. 边界情况

| 场景 | 行为 |
|------|------|
| 切换到当前模型 | 返回 200，可不插入重复 `system_event` |
| 切回 Default | `model_id` 写入 `NULL`，后续 runtime 不传 `--model` |
| 模型列表动态查询失败但有 fallback | 返回 fallback，`source=builtin` |
| Cursor 未登录导致 `agent models` 失败 | 使用 fallback；若 fallback 也不可用则 503 |
| PATCH 后 WebSocket 页面已打开 | 立即收到 `system_event` |
| PATCH 后下一条消息发送很快 | runtime 必须读取或接收最新 `model_id`，不得使用旧 pre-warm |
| 旧 mobile 不认识 `system_event` | 不应崩溃；可忽略未知 role |

## 11. 非功能性需求

- Mobile 不硬编码模型列表
- Runtime provider 查询失败不能导致 Chat 页面整体不可用
- PATCH 操作应是轻量 DB 更新，不启动 runtime 子进程
- 不引入中心化后端或云端模型目录
- 不读取或修改用户 `~/.config/msctl/*` 之外的 runtime 私有历史内容

## 12. 验收标准

- [ ] CLI 返回 `claude-code`、`codex`、`cursor-cli` 的模型能力列表，且包含 Default
- [ ] iOS Chat 页面展示当前 conversation 模型
- [ ] 非运行状态下，用户可以切换模型
- [ ] `running` / `awaiting_question` 状态下，模型切换被禁用或后端返回 409
- [ ] PATCH 成功后 `conversations.model_id` 更新
- [ ] PATCH 成功后插入并广播 `system_event:model_changed`
- [ ] 切回 Default 后 `conversations.model_id IS NULL`
- [ ] Claude fresh/resume 调用在有模型时包含 `--model <model_id>`
- [ ] Codex fresh/resume 调用在有模型时包含 `--model <model_id>`
- [ ] Codex 模型切换后不会复用旧模型 pre-warmed process
- [ ] Cursor 调用在有模型时包含 `--model <model_id>`，不再依赖 `CURSOR_AGENT_MODEL` 作为 conversation 级选择
- [ ] 新模型下的下一条消息继续使用对应 runtime 的 session/thread resume 机制
- [ ] `system_event` 不污染 last AI reply 预览

## 13. 实测要求

实现完成后必须在本机对三个 runtime 做最小实测：

| runtime | 实测 |
|---------|------|
| Claude Code | 先发一轮获取 `claude_session_id`，切模型后确认下一轮命令使用 `--resume <id> --model <model_id>` |
| Codex CLI | 先发一轮获取 `codex_thread_id`，切模型后确认下一轮 `codex exec resume` 使用同一 thread id 和新 `--model` |
| Cursor Agent | 先发一轮获取 `cursor_session_id`，切模型后确认下一轮 `agent --resume <id> --model <model_id>` |

若任一 runtime 的 resume+model 行为与预期不一致，不得静默降级为手动历史注入；应在实现 PR 中记录兼容性结论，并为该 runtime 禁用模型切换或调整 provider capability。
