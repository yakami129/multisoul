# Workflow 模块 SPEC

## 1. 背景与目标

MultiSoul 当前已经能在手机端查看本机 agent、进入 conversation、回答问答卡片，并通过 Activity 看到运行状态。Workflow 模块要补上“到点自动让 agent 做事”的能力，让用户把重复性的本地 agent 任务交给 `msctl` 定时执行。

第一版目标不是做通用工作流编排平台，而是验证一个最小闭环：

```text
手机端创建 workflow -> 本机 daemon 按每日/每周规则触发 -> 自动创建新的 conversation 并发送固定 prompt -> Activity/推送回流最终结果
```

成功标准：用户能在手机端创建一个绑定已注册 agent 的定时 workflow，到了预定时间后，本机 CLI/daemon 自动运行 agent；关闭后不再触发，重新开启后继续按规则触发。

## 2. 范围

### 2.1 In Scope

- 新增 Workflow 模块，支持手机端创建、查看和编辑 workflow。
- 每个 workflow 绑定一个已注册 agent。
- 每个 workflow 保存一段固定 prompt，触发时将该 prompt 发送给绑定 agent。
- 第一版定时规则只支持每日/每周表单，不暴露原始 cron 表达式。
- 调度与执行由本机 `msctl daemon` / `msctl serve` 负责，移动端不承担定时器可靠性。
- 使用本机 daemon 所在系统时区计算每日/每周触发时间。
- 支持开启/关闭 workflow。
- 无运行中的 workflow 被关闭时，应立即停止后续调度。
- 如果 workflow 已有运行中的 run，关闭/编辑不强杀当前 agent；当前 run 可继续结束，变更只影响后续触发。
- 电脑离线或 daemon 未运行导致错过触发时间时，跳过错过的运行，不补跑。
- 上一次运行尚未结束时，如果下一次触发时间到达，应跳过新触发，并记录 skip 日志。
- 每次实际运行都必须创建一个新的 conversation，输出进入该次运行专属 conversation；不得续接或复用历史 conversation。
- Activity 能看到 workflow run 对应的执行状态。
- 运行完成和失败都向手机推送最终结果。
- Agent 运行中需要用户决策时，继续复用现有问答卡片并等待用户回答。
- 运行记录至少保存状态、开始时间、结束时间、关联 conversation、失败错误信息和 agent 最终摘要。
- REST/WS 继续复用现有 Bearer auth。

### 2.2 Out of Scope

- 云端调度或中心后端。
- 多步骤依赖编排。
- 同一 workflow 并行运行。
- 自动重试策略。
- Prompt 变量、模板引擎或参数化运行。
- 预设自动审批/自动回答策略。
- 手机端复杂 cron 编辑器。
- 多 agent 编排、fan-out/fan-in 或任务图。
- 对 agent runtime 权限模型做额外改造。

## 3. 用户与使用场景

### 3.1 典型用户

- 使用 MultiSoul 控制本机 Claude Code / Codex / Cursor CLI 的个人开发者。
- 有周期性本地 agent 任务的用户，例如每日整理项目状态、每周检查仓库、定时生成报告、定时跑维护任务。

### 3.2 关键使用场景

1. 用户在手机端打开 Workflow 模块。
2. 用户创建 workflow，选择一个已注册 agent。
3. 用户填写固定 prompt。
4. 用户选择每日或每周触发时间。
5. 本机 daemon 按本机时区计算下一次触发时间。
6. 到点后 CLI 自动创建一个新的 conversation，并把固定 prompt 作为该新对话的首条用户消息发送给 agent。
7. 用户在 Activity 看到运行状态；点入后可打开对应 conversation。
8. Agent 如需用户决策，通过问答卡片推送到手机并等待回答。
9. 运行完成或失败后，手机收到最终结果推送。
10. 用户可关闭 workflow；关闭后不再触发。重新开启后重新计算下一次运行时间。

## 4. 业务流程与信息架构

### 4.1 高层流程

```text
Create Workflow
  -> Enabled
  -> Due
  -> Create New Conversation
  -> Running Run
  -> Completed / Failed
  -> Next Run Scheduled

Enabled
  -> Disabled
  -> Enabled

Due
  -> Skipped Overlap
  -> Next Run Scheduled
```

### 4.2 Workflow 状态展示

Workflow 本身不需要展示复杂状态机。第一版只展示一个配置状态：

```text
enabled = true  -> 开启，scheduler 会按 next_run_at 触发
enabled = false -> 关闭，scheduler 不会触发
```

运行中的状态不属于 workflow 本体，而属于每一次 `workflow_run` 和它新建的 conversation。Activity 和运行历史负责展示 `running`、`completed`、`failed`、`skipped_overlap` 等运行结果。

### 4.3 触发流程

```text
1. Scheduler tick 扫描 enabled workflow
2. 判断 next_run_at <= now
3. 如果 workflow 未开启，跳过
4. 如果存在 running run，记录 skipped_overlap，计算下一次 next_run_at
5. 如果 daemon 曾离线导致时间已过，只执行当前 tick 应触发的一次判断，不补跑历史次数
6. 创建 workflow_run
7. 创建新的 conversation
8. 插入 user_text 固定 prompt 并 dispatch 到 runtime
9. 在新 conversation 内继续复用现有 message/task_status/ask_question 通路
10. run 结束后写入 completed/failed、ended_at、summary/error
11. 发送最终结果推送
12. 计算下一次 next_run_at
```

### 4.4 主要界面

#### Workflow List

- 展示 workflow 名称、绑定 agent、开启/关闭状态、下一次运行时间、最近一次结果。
- 提供开启/关闭入口。
- 列表应支持下拉刷新。
- Workflow 本体只展示 ON/OFF，不展示 `running`、`completed` 等 run 状态。

#### Workflow Create/Edit

- 选择已注册 agent。
- 填写 workflow 名称。
- 填写固定 prompt。
- 选择每日或每周。
- 每日：选择本机时区语义下的时间。
- 每周：选择星期几和时间。
- 保存后由 CLI 计算并返回下一次运行时间。

#### Workflow Detail

- 展示开启状态、下一次运行时间、绑定 agent、固定 prompt 摘要。
- 展示最近运行记录。
- 每条 run 至少可跳转对应 conversation。
- 失败 run 展示错误信息。

#### Activity 集成界面

- 不新增一套独立 Activity 视觉结构；必须复用当前 iOS Activity 的页面结构和交互模型。
- 保留当前 Activity 顶部标题、`All / Pending / Running / Done` 分段筛选、列表行、状态点、时间、状态文案、chevron 和下拉刷新。
- Workflow run 只作为 Activity 列表中的一种来源/上下文出现；点击后打开该 run 新建的 conversation。
- Activity 行可在副标题或元信息中体现 workflow 名称，但不得破坏当前 Activity 列表密度。

## 5. 数据模型与接口

### 5.1 Workflow 实体

```ts
type WorkflowScheduleKind = 'daily' | 'weekly';

interface Workflow {
  id: string;
  name: string;
  agent_id: string;
  prompt: string;
  enabled: boolean;
  schedule_kind: WorkflowScheduleKind;
  time_of_day: string;      // HH:mm, interpreted in daemon local timezone
  day_of_week?: number;     // 1-7 for weekly schedules
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}
```

### 5.2 Workflow Run 实体

```ts
type WorkflowRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped_overlap';

interface WorkflowRun {
  id: string;
  workflow_id: string;
  conversation_id: string | null; // actual runs create a new conversation; skipped runs may stay null
  status: WorkflowRunStatus;
  scheduled_for: number;
  started_at: number | null;
  ended_at: number | null;
  summary: string | null;
  error_message: string | null;
  created_at: number;
}
```

### 5.3 REST API

MVP 需要 CLI 提供以下能力，路径命名可在设计阶段细化：

- `GET /api/v1/workflows`：列出 workflow。
- `POST /api/v1/workflows`：创建 workflow。
- `GET /api/v1/workflows/:id`：读取 workflow 详情。
- `PATCH /api/v1/workflows/:id`：编辑名称、prompt、定时规则、绑定 agent。
- `POST /api/v1/workflows/:id/disable`：关闭 workflow。
- `POST /api/v1/workflows/:id/enable`：开启 workflow。
- `GET /api/v1/workflows/:id/runs`：读取运行历史。

所有接口必须复用现有 Bearer auth，且 `GET /api/v1/healthz` 仍是唯一免认证例外。

### 5.4 Activity 集成

Workflow run 的实际执行仍落到该 run 新建的 conversation 和 task status。Activity 第一版不需要新增独立 section，但需要能从运行中的 conversation 或完成/失败 conversation 看到该 workflow run 的状态。

建议 Activity item 在 payload 或扩展字段中携带：

- `workflow_id`
- `workflow_run_id`
- `workflow_name`

如果 Activity 第一版不显示 workflow 名称，也必须保证 Workflow Detail 能通过 run 的 `conversation_id` 跳转到该 run 新建的 conversation。

## 6. 技术实现概览

### 6.1 CLI / Daemon

- 在本机 SQLite schema 中新增 `workflows` 和 `workflow_runs`。
- `msctl serve` 或 daemon 内部启动 scheduler loop。
- Scheduler 只在本机运行，使用 daemon 进程本地时区。
- Scheduler tick 应幂等，避免同一 due workflow 被重复触发。
- 触发 workflow 时复用现有“新建 conversation”和 message dispatch 能力，但每个实际 run 必须创建新的 conversation。
- 运行完成/失败状态复用 runtime 已有 `task_status`、conversation status 和 push 能力，同时回写 `workflow_runs`。
- 重叠触发时不创建 conversation，新增一条 `skipped_overlap` run 或日志记录。
- 错过的历史触发不补跑，只按最新 `next_run_at` 重新计算下一次。

### 6.2 Mobile

- 新增 Workflow 模块入口。
- 手机端通过 REST 创建、编辑、开启和关闭 workflow。
- 手机端展示 `next_run_at` 时应明确这是由本机 daemon 计算的时间。
- Workflow List 和 Detail 的执行状态从 workflow/runs API 与现有 Activity/conversation 链接共同呈现。
- 创建/编辑表单只暴露每日/每周，不暴露 cron。

### 6.3 问答卡片

Agent 运行期间如果需要用户审批或选择，继续走现有 AskQuestion 卡片。Workflow 不新增自动审批策略。卡片未回答时，对应 conversation 进入 `awaiting_question`，Activity 显示需要用户处理。

## 7. UI/UX 需求

- Workflow List 应优先展示“是否启用”和“下一次运行时间”，而不是技术细节。
- 开启/关闭必须是列表内可快速操作的主路径。
- 创建/编辑表单避免要求用户理解 cron。
- 固定 prompt 可以多行输入，但第一版不提供变量插入、模板预览或密钥字段。
- 运行历史只展示足够排障的信息：状态、时间、摘要、失败原因、conversation 跳转。
- 最终结果推送点击后应能打开该 run 新建的 conversation 或 workflow run 详情。

### 7.1 视觉原则

Workflow 模块应采用 Apple 式的克制信息层级：少装饰、强可读、明确主次、直接操作。实现时应遵守 `mobile/docs/design.md` 的现有 MultiSoul iOS 设计系统，而不是引入新的独立视觉语言。

- 背景、表面、强调色沿用现有 iOS 色板：`#0D0D0D` 页面背景、`#1A1A1A` 组件表面、`#FF6B35` 仅用于主行动、启用态、未读/待处理等行动信号。
- 不使用蓝紫霓虹、复杂渐变、大面积插画、营销式 hero、厚重边框或过度装饰。
- 页面优先使用 iOS 原生语义：大标题、分组列表、清晰表单行、开关、时间选择器、分段控制、底部确认按钮。
- Workflow List 使用可扫描的行/分组列表，而不是堆叠的大卡片墙；关键信息顺序为名称、绑定 agent、下一次运行、最近结果、ON/OFF。
- Create/Edit 使用表单分组：基础信息、执行目标、固定 prompt、定时规则；每日/每周切换使用分段控制。
- Detail 以配置摘要和最近运行记录为主，不把高层流程图放进产品界面。
- Activity 必须与当前 iOS Activity 模块保持一致，只扩展数据含义，不重做 Activity 信息架构。

### 7.2 原型参考

当前视觉方向参考文件：

- `docs/prototypes/workflow-module-prototype-apple-style.png`
- `docs/prototypes/workflow-module-prototype-apple-style.svg`

原型只表达布局和交互方向；最终实现以 `mobile/docs/design.md` 和现有 iOS 组件为准。

## 8. 状态、错误与边界情况

- **Daemon 离线**：错过的运行跳过，不补跑；恢复后计算下一次未来触发时间。
- **重叠触发**：如果同一 workflow 已有 running run，跳过新触发并记录 `skipped_overlap`。
- **关闭**：无 active run 时立即停止后续调度；有 active run 时不强杀 agent，关闭只阻止后续触发。
- **编辑定时规则**：保存后重新计算下一次运行时间；不影响已经创建的 running run。
- **Agent 删除或不可用**：workflow 不应触发成功；run 进入 failed，记录错误并推送失败结果。
- **Prompt 为空**：创建/保存失败。
- **无 push token**：运行结果仍应落库；推送失败不得影响 run 状态。
- **问答卡片未回答**：conversation 保持等待状态；workflow run 不应被误判为 completed。
- **服务重启**：scheduler 应能从 SQLite 恢复 workflow 状态和下一次运行时间。

## 9. 非功能性需求

- **可靠性**：本机 daemon 重启后可恢复调度状态。
- **安全**：复用现有 Bearer auth；不新增云端服务；不新增密钥字段。
- **可观测性**：运行、失败、跳过重叠触发、推送失败都应有日志。
- **性能**：MVP 面向个人使用，调度规模按几十个 workflow 设计即可。
- **数据边界**：workflow、run、prompt 和 conversation 数据都保存在用户本机 SQLite。

## 10. 风险、权衡与未决问题

### 10.1 已确认权衡

- 选择本机 daemon 调度，牺牲跨设备/云端可靠性，换取零中心后端和本地数据边界。
- 选择每日/每周表单，牺牲 cron 灵活性，换取手机端易用性。
- 错过运行不补跑，避免电脑恢复后批量启动 agent。
- 重叠触发跳过，避免同一 workflow 并行执行造成状态混乱。
- 固定 prompt 而非模板变量，降低 MVP 数据模型和 UI 复杂度。

### 10.2 未决问题

- Workflow 是否需要独立底部 Tab，还是作为 Agents/Activity 的二级入口。
- 运行中用户关闭 workflow 时，是否需要 UI 文案明确“当前运行会继续，后续运行已关闭”。
- 最终结果推送文案是否使用 workflow 名称优先，还是 agent 名称优先。

## 11. 验收标准与示例

### 11.1 核心验收

- 用户能在手机端创建 workflow，选择已注册 agent，填写固定 prompt，选择每日或每周时间。
- 创建成功后，列表显示 workflow、开启状态和下一次运行时间。
- 到点后，本机 CLI/daemon 自动创建一个新的 conversation，并把固定 prompt 作为首条用户消息发送给绑定 agent。
- Agent 输出进入该次 run 新建的 conversation，用户可从 Activity 或 Workflow Detail 打开查看。
- 运行完成后，workflow run 保存 `completed`、开始/结束时间、conversation、最终摘要，并推送完成结果。
- 运行失败后，workflow run 保存 `failed`、开始/结束时间、conversation、错误信息，并推送失败结果。
- 用户关闭 workflow 后，后续到点不触发 agent。
- 用户重新开启 workflow 后，系统重新计算下一次运行时间，并在到点后继续触发。
- Workflow UI 只把 workflow 本体展示为 ON/OFF；运行状态只出现在 Activity、conversation 或运行历史中。
- Workflow 与 Activity 的界面符合现有 MultiSoul iOS 设计系统和 Apple 式信息层级，不引入新的 Activity 视觉结构。

### 11.2 边界验收

- 当 workflow 正在运行且下一次触发到达时，不创建新的 conversation；记录一次 `skipped_overlap`，并保留原 run。
- 当 daemon 离线错过触发时间后，恢复时不补跑历史任务，只计算下一次未来触发时间。
- 当 agent 在运行中发出问答卡片时，手机端收到卡片，Activity 显示需要处理；回答后 agent 继续运行。
- 当绑定 agent 不存在或不可用时，run 标记 failed，错误信息可见，并推送失败结果。
- 所有 workflow API 在缺少或错误 Bearer token 时拒绝访问。

### 11.3 不通过标准

- 手机端创建后必须依赖手机常驻后台才能触发。
- 同一 workflow 在一次运行未结束时又并行启动第二个 run。
- daemon 重启后丢失 workflow 或下一次运行时间。
- 错过触发后批量补跑多个历史 run。
- 完成/失败结果只出现在推送中但没有落库。
