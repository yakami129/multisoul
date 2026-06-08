# Workflow Watch 模式 SPEC

## 1. 背景与目标

MultiSoul Workflow 当前已经覆盖 daily / weekly 这类长期定时任务，也有模板库降低创建成本。但很多 agent 任务不是长期周期任务，而是“接下来一小段时间持续盯住同一个目标”：

- 修完 CI 后，每隔几分钟检查一次，直到 CI 变绿。
- 本地服务启动后，短时间观察端口、健康检查和日志是否稳定。
- 发布窗口内持续看 release log、错误和阻塞信号。
- PR 活跃 review 阶段，定期检查新评论、CI 和阻塞项。

这类任务的价值不是无限重复，而是短期看护：用户设定目标、间隔和停止条件后，agent 在有限时间内重复运行，达到结束条件后自动停止，并留下每轮运行记录。

本规格目标是在现有 Workflow 模块中新增 `watch` 模式，让用户能从手机端创建 30 / 60 / 120 分钟等短期看护 workflow，CLI 按 interval 运行，每轮创建 run history 和摘要，并在达到 `max_runs`、`expires_at` 或 `stop_condition` 后结束。

## 2. 范围

### 2.1 In Scope

- Workflow 增加 `mode` 字段，第一版支持：
  - `recurring`：现有 daily / weekly 长期定时任务。
  - `watch`：新增短期看护任务。
- Watch workflow 绑定一个已注册 agent，并保存固定 prompt。
- Watch 配置支持：
  - `interval_minutes`
  - `max_runs`
  - `expires_at`
  - `stop_condition`
- 手机端提供 5 / 10 / 15 / 30 分钟间隔预设，并允许自定义分钟数。
- 手机端提供 30 / 60 / 120 分钟 watch 模板入口。
- Watch 停止规则为“任一先到即停”：
  - 达到 `max_runs`
  - 当前时间达到或超过 `expires_at`
  - agent 根据 `stop_condition` 判断目标已满足
  - 用户手动 Stop Watch
- 每一轮实际运行都创建一条 `workflow_run`，复用现有 run history 展示。
- 每一轮运行都创建新的 conversation，不续接上一轮 conversation。
- 每一轮运行结果至少记录状态、开始时间、结束时间、关联 conversation、摘要和错误信息。
- Watch 结束后保留在 Workflow 列表中，状态显示为 `completed` 或 `stopped`，可查看历史，可重新启动。
- 手机端提供 `Stop Watch` 手动停止入口。
- 第一版内置 4 个 Watch 模板：
  - CI Watch
  - Local Health Watch
  - Release Window Watch
  - PR Review Watch
- 涉及 commit、push、release、删除、迁移等危险动作时，第一版采用 Prompt gate：模板 prompt 和 UI 文案明确要求 agent 必须先通过问答卡片询问用户。
- REST/WS 继续复用现有 Bearer auth，`GET /api/v1/healthz` 仍是唯一免认证例外。

### 2.2 Out of Scope

- 云端调度或中心后端。
- 多步骤 workflow 编排、任务图、条件分支或跨 agent 编排。
- 同一 watch workflow 并行运行多轮。
- 自动重试策略。
- Cron 表达式或复杂 interval 表达式。
- 用户自定义 watch 模板库。
- Runtime 级危险动作强制拦截。
- 自动审批、自动回答问答卡片或权限策略系统。
- 对 agent runtime sandbox 做改造。
- Watch run 复用同一个 conversation 的连续对话模式。

## 3. 用户与使用场景

### 3.1 典型用户

- 使用 MultiSoul 控制本机 Claude Code / Codex / Cursor CLI 的个人开发者。
- 希望在离开电脑后，让本机 agent 短时间盯住某个目标的用户。
- 需要在 CI、PR、发布、本地服务等窗口期持续获取状态的人。

### 3.2 关键使用场景

#### CI Watch

用户修完 CI 后启动 60 分钟 Watch，每 10 分钟运行一次。Agent 检查当前 PR / branch 的 CI 状态、失败日志和阻塞项。如果 CI 变绿，agent 在摘要中标记停止条件已满足，watch 自动结束。若需要 commit、push 或 merge，agent 必须先问用户。

#### Local Health Watch

用户启动本地服务后启动 30 分钟 Watch，每 5 分钟检查端口、healthz、daemon 状态和最近日志。Agent 每轮输出健康摘要。如果服务连续稳定或达到时间上限，watch 结束。第一版不要求自动重启服务。

#### Release Window Watch

发布窗口内，用户启动 120 分钟 Watch，每 10 或 15 分钟检查 release log、关键错误、构建状态和回滚信号。Agent 只能报告和建议；发布、回滚、上传、打 tag 等动作必须先问用户。

#### PR Review Watch

用户在活跃 review 阶段启动 Watch，每 10 分钟检查新评论、CI、review approval 和阻塞项。Agent 汇总新增事项和建议处理顺序。Push、merge、resolve conversation 等动作必须先问用户。

## 4. 产品模型

### 4.1 Workflow Mode

现有 Workflow 本体增加 `mode`：

```ts
type WorkflowMode = 'recurring' | 'watch';
```

`recurring` 保持现有 daily / weekly 行为。`watch` 使用 interval 与结束条件，不使用 `schedule_kind=daily|weekly` 的每日/每周表单。

### 4.2 Watch 配置字段

```ts
interface WatchWorkflowConfig {
  mode: 'watch';
  interval_minutes: number;
  max_runs: number | null;
  expires_at: number | null;
  stop_condition: string;
  watch_status: 'active' | 'completed' | 'stopped' | 'expired' | 'failed';
  run_count: number;
}
```

字段语义：

- `interval_minutes`：每轮之间的间隔，单位为分钟。
- `max_runs`：最多运行次数；为空表示只受 `expires_at` 和 `stop_condition` 限制。
- `expires_at`：watch 自动过期时间；为空表示只受 `max_runs` 和 `stop_condition` 限制。
- `stop_condition`：用户填写的结果型停止条件，例如“CI 变绿且没有 required check 失败”。
- `watch_status`：
  - `active`：正在看护，会继续调度。
  - `completed`：agent 判断 `stop_condition` 已满足，或达到 `max_runs` 后正常结束。
  - `expired`：达到 `expires_at` 后结束。
  - `stopped`：用户手动停止。
  - `failed`：watch 无法继续调度或配置失效。
- `run_count`：已实际启动的 run 数量，不包含 skipped overlap。

### 4.3 停止规则

每次 scheduler tick 或 run 完成后，都必须重新判断停止条件。第一版规则：

```text
如果用户手动 Stop Watch -> watch_status = stopped, enabled = false
否则如果 expires_at 已到 -> watch_status = expired, enabled = false
否则如果 run_count >= max_runs -> watch_status = completed, enabled = false
否则如果上一轮 run 标记 stop_condition satisfied -> watch_status = completed, enabled = false
否则计算下一次 next_run_at
```

多个条件同时满足时，优先级为：

1. 用户手动停止
2. `stop_condition` 满足
3. `expires_at` 到期
4. `max_runs` 达到

UI 可以展示最主要的结束原因，但 run history 保留每轮摘要，便于追溯。

### 4.4 Stop Condition

`stop_condition` 是独立字段，不混在 prompt 中。创建 watch 时，系统应把它注入每轮 prompt 的上下文，要求 agent 在每轮摘要中明确判断：

- `stop_condition_satisfied: true | false`
- 判断依据
- 如果未满足，下一轮重点看什么

第一版不要求 agent 输出严格 JSON，但 CLI 需要有可识别的结束信号。设计阶段可以选择以下实现之一：

- 在系统拼接 prompt 中要求 agent 用固定短句输出 `WATCH_STOP_CONDITION: satisfied`。
- 在 conversation final summary 中解析结构化字段。
- 在后续设计文档中定义更可靠的 run result metadata。

产品要求是：用户填写的 `stop_condition` 必须能驱动 watch 自动结束，而不只是展示文案。

## 5. 业务流程

### 5.0 与现有 Workflow 模块的关系

Watch 不是新的顶层模块，也不新增独立 tab。它是现有 Workflow 模块里的第二种运行模式：

```text
Workflow
  -> Recurring: daily / weekly 长期定时任务
  -> Watch: interval + stop conditions 短期看护任务
```

两种 mode 共享以下产品能力：

- 同一个 Workflow tab 入口。
- 同一个 agent 绑定模型。
- 同一个创建入口和模板选择器。
- 同一个 Workflow Detail 外壳。
- 同一套 run history 展示。
- 同一套 Activity / conversation 跳转。
- 同一套 Bearer auth 和本机 daemon 调度前提。

两种 mode 的区别主要体现在调度语义和结束语义：

- `recurring` 是长期计划，用户开关的是“后续是否继续按 daily / weekly 触发”。
- `watch` 是一次短期看护，用户启动的是“从现在开始的一段观察窗口”，结束后保留历史但不继续调度。

因此 UI 不应把 Watch 做成独立产品区，也不应让用户误以为 Watch 是一个和 Workflow 并列的新系统。实现时应在现有 Workflow 信息架构上增加 mode 分支。

### 5.1 创建 Watch

```text
Workflow tab
  -> +
  -> 同一个 Workflow Template Picker
  -> 选择 Blank Workflow / Recurring Templates / Watch Templates
  -> 如果选择 Blank，在表单里选择 Recurring 或 Watch
  -> 如果选择 Watch Template，表单默认进入 Watch mode
  -> 选择 agent
  -> 填写名称、prompt、stop_condition
  -> 选择 interval
  -> 选择时长或 max_runs
  -> 保存
  -> CLI 返回 next_run_at
```

保存成功后，watch 默认 `enabled=true`、`watch_status=active`，并立即触发第一轮运行。第一轮完成后，如果 watch 未结束，再按 `interval_minutes` 计算下一轮。

示例：

```text
10:03 保存 CI Watch，interval = 10 minutes
10:03 立即运行第 1 轮
10:13 运行第 2 轮
10:23 运行第 3 轮
```

原因：Watch 的用户心理模型是“现在开始盯住”。如果第一轮等待一个完整 interval，用户在保存后的空窗期看不到 run history，容易误以为 Watch 没有启动。CI 尚未创建、服务尚未稳定等情况由第一轮摘要表达为 pending / not ready，然后下一轮继续观察。

### 5.2 每轮运行

```text
Scheduler tick
  -> 找到 active watch 且 next_run_at <= now
  -> 如果已有 running run，记录 skipped_overlap，计算下一次或结束
  -> 创建新 conversation
  -> 插入拼接后的 watch prompt
  -> dispatch 到绑定 agent
  -> run history 显示 running
  -> run 完成后写入摘要、错误、stop_condition 判断
  -> 判断是否结束
  -> 未结束则计算 next_run_at = now + interval_minutes
```

每轮 prompt 应至少包含：

- 原始 watch prompt。
- 用户填写的 `stop_condition`。
- 当前是第几轮、最多几轮。
- Watch 过期时间。
- 危险动作确认规则。
- 输出摘要要求。

### 5.3 手动 Stop Watch

用户可在 Workflow Detail 或列表快捷操作中点击 `Stop Watch`。

行为要求：

- 立即设置 `enabled=false`。
- 设置 `watch_status=stopped`。
- 清空或冻结 `next_run_at`，不再触发后续 run。
- 不强杀已经运行中的 agent run；当前 run 可以自然完成。
- 当前 run 完成后仍写入 run history，但不得重新开启 watch。

### 5.4 重新启动 Watch

已结束的 watch 保留在列表中，用户可以重新启动。

重新启动行为：

- 设置 `enabled=true`。
- 设置 `watch_status=active`。
- 重置或延续 `run_count` 的具体策略由设计阶段确定，但 UI 必须明确。
- 推荐第一版重新启动时创建一个新的 watch cycle，避免旧 run_count 影响新一轮看护。

如果使用 watch cycle，run history 应能区分不同启动周期；如果不做 cycle，重新启动必须把 `run_count` 清零，并在 detail 中说明历史仍保留。

## 6. 信息架构与 UI/UX

### 6.1 Workflow List

Workflow List 继续作为统一入口，不新增独立 Watch tab。

列表顶部需要提供轻量过滤，至少支持：

- `All`
- `Active`
- `Ended`

过滤语义：

- `All`：显示 recurring workflow、active watch 和 ended watch。
- `Active`：显示 enabled recurring workflow 和 `watch_status=active` 的 watch。
- `Ended`：显示 `watch_status=completed|expired|stopped|failed` 的 watch。

已结束 Watch 默认仍保留在列表中，但应能通过 `Active` 过滤收起。这样既保留历史可见性，又避免 active 工作流列表被短期任务长期污染。

列表中 watch item 需要展示：

- 名称。
- Mode 标签：`Watch`。
- 当前状态：`Active`、`Completed`、`Expired`、`Stopped`、`Failed`。
- 下一次运行时间，或结束原因。
- 间隔，例如 `Every 10 min`。
- 最近一次结果摘要。

`recurring` workflow 继续展示 Daily / Weekly 与下一次运行时间。

### 6.2 Workflow Detail

Watch detail 需要展示：

- 绑定 agent。
- Watch 状态。
- Interval。
- 运行进度，例如 `3 / 6 runs`。
- Expires at。
- Stop condition。
- Prompt 摘要。
- `Stop Watch` 或 `Restart Watch` 主操作。
- Run history。

Run history 每条至少展示：

- 运行状态。
- 第几轮。
- scheduled_for / started_at / ended_at。
- 摘要。
- 是否满足 stop condition。
- 失败错误。
- conversation 跳转。

### 6.3 创建与编辑表单

创建表单需要支持 mode 选择：

- `Recurring`
- `Watch`

Mode 选择只出现在表单内。创建入口不先强制用户选择 mode，而是延续现有模板选择流程：

```text
Workflow +
  -> Blank Workflow
  -> Recurring Templates
  -> Watch Templates
```

交互要求：

- `Blank Workflow` 位于第一屏，进入表单后用户选择 `Recurring` 或 `Watch`。
- Recurring 模板进入表单时默认 `mode=recurring`。
- Watch 模板进入表单时默认 `mode=watch`。
- Recurring templates 和 Watch templates 在同一个 picker 中分组展示，不新增独立 Watch 创建按钮。

当选择 Watch：

- 隐藏 Daily / Weekly 选择器。
- 展示 interval 选择器：5 / 10 / 15 / 30 / Custom。
- 展示 duration 快捷选项：30 / 60 / 120 分钟。
- 展示 `max_runs`。
- 展示 `stop_condition` 多行输入。
- 展示危险动作确认说明。

Custom interval 需要做输入校验：

- 必须为正整数分钟。
- 第一版建议下限 1 分钟。
- 第一版建议上限 240 分钟，避免误把 watch 当成长期调度。

### 6.4 Watch 模板选择

模板选择页在现有 Workflow Template Picker 中增加 Watch Templates 分组，不新增单独入口。

推荐分组顺序：

1. `Blank Workflow`
2. `Recurring Templates`
3. `Watch Templates`

Watch 模板卡片需要和 recurring 模板卡片明显区分：

- 显示 `Watch` mode 标签。
- 显示默认时长与 interval，例如 `60 min · every 10 min`。
- 显示危险动作确认边界，例如 `Ask before push/merge`。

四个内置 Watch 模板：

#### CI Watch

- 默认时长：60 分钟。
- 默认间隔：10 分钟。
- 默认 max_runs：6。
- 默认 stop_condition：CI 全部 required checks 通过，且没有新的失败日志。
- 边界：允许只读检查和低风险本地验证；commit、push、merge 必须先问用户。

#### Local Health Watch

- 默认时长：30 分钟。
- 默认间隔：5 分钟。
- 默认 max_runs：6。
- 默认 stop_condition：目标服务 health check 连续稳定，最近日志无新增关键错误。
- 边界：只读汇报；重启服务、改配置、清理数据必须先问用户。

#### Release Window Watch

- 默认时长：120 分钟。
- 默认间隔：10 分钟。
- 默认 max_runs：12。
- 默认 stop_condition：发布窗口结束，关键指标稳定，未发现新增阻塞错误。
- 边界：需要确认后行动；release、rollback、tag、上传构建、迁移必须先问用户。

#### PR Review Watch

- 默认时长：60 分钟。
- 默认间隔：10 分钟。
- 默认 max_runs：6。
- 默认 stop_condition：无未处理 review comment，required checks 通过，无 merge blocker。
- 边界：只读汇报；push、merge、resolve conversation、改 reviewer 状态必须先问用户。

### 6.5 视觉原则

- 遵守 `mobile/docs/design.md` 的现有 iOS 设计系统。
- 不做营销式 hero。
- Watch 是工具状态，不是装饰性卡片；信息层级应优先服务扫描和快速停止。
- `Stop Watch` 使用明确危险/中断语义，但避免和删除混淆。
- 已结束 watch 应显著区别于 active watch，避免用户误以为仍在看护。

## 7. 数据与接口

### 7.1 Workflow 实体扩展

```ts
type WorkflowMode = 'recurring' | 'watch';
type WatchStatus = 'active' | 'completed' | 'stopped' | 'expired' | 'failed';

interface Workflow {
  id: string;
  name: string;
  agent_id: string;
  prompt: string;
  enabled: boolean;
  mode: WorkflowMode;

  schedule_kind: 'daily' | 'weekly' | null;
  time_of_day: string | null;
  day_of_week: number | null;

  interval_minutes: number | null;
  max_runs: number | null;
  expires_at: number | null;
  stop_condition: string | null;
  watch_status: WatchStatus | null;
  run_count: number;

  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}
```

兼容要求：

- 现有 workflow migration 后应默认为 `mode='recurring'`。
- 现有 daily / weekly 字段对 recurring 继续有效。
- Watch workflow 的 daily / weekly 字段应为 `null` 或被 API 忽略。

### 7.2 Workflow Run 扩展

```ts
interface WorkflowRun {
  id: string;
  workflow_id: string;
  conversation_id: string | null;
  status: 'running' | 'completed' | 'failed' | 'skipped_overlap';
  scheduled_for: number;
  started_at: number | null;
  ended_at: number | null;
  summary: string | null;
  error_message: string | null;
  run_number: number | null;
  stop_condition_satisfied: boolean | null;
  stop_condition_reason: string | null;
  created_at: number;
}
```

Recurring workflow 可以不填 `run_number` 和 stop condition 字段。

### 7.3 REST API

现有 Workflow API 继续保留。写接口需要支持 mode 分支：

- `GET /api/v1/workflows`
- `POST /api/v1/workflows`
- `GET /api/v1/workflows/:id`
- `PATCH /api/v1/workflows/:id`
- `POST /api/v1/workflows/:id/enable`
- `POST /api/v1/workflows/:id/disable`
- `GET /api/v1/workflows/:id/runs`
- `DELETE /api/v1/workflows/:id`

新增或扩展：

- `POST /api/v1/workflows/:id/stop-watch`
  - 仅 watch workflow 可用。
  - 设置 `enabled=false`、`watch_status=stopped`。
- `POST /api/v1/workflows/:id/restart-watch`
  - 仅已结束 watch workflow 可用。
  - 重新进入 `active` 状态并计算下一次运行。

也可以在设计阶段决定复用 `enable/disable`，但产品语义上必须区分：

- Disable recurring workflow：关闭长期定时。
- Stop watch workflow：结束本次短期看护。
- Restart watch workflow：开始新一轮短期看护。

### 7.4 Auth

所有新增或扩展接口必须复用现有 Bearer auth。不得新增免认证接口。`GET /api/v1/healthz` 仍是唯一例外。

## 8. 调度与运行要求

### 8.1 Scheduler

Scheduler 需要同时处理 recurring 和 watch：

```text
recurring:
  next_run_at = next daily/weekly occurrence

watch:
  next_run_at = now + interval_minutes
  stop when any ending condition is reached
```

Watch missed tick 行为：

- daemon 离线或电脑睡眠导致错过多个 interval 时，不补跑历史轮次。
- daemon 恢复后只运行当前应触发的一轮，然后按当前时间计算下一次。

Overlap 行为：

- 如果上一轮仍在 running，下一轮到点时不创建新 conversation。
- 记录 `skipped_overlap` run 或等效日志。
- `skipped_overlap` 不计入 `run_count`，除非设计阶段明确选择计入；产品默认不计入。

### 8.2 Conversation

每一轮 Watch run 必须创建新的 conversation，标题建议包含 workflow 名称和轮次，例如：

```text
Watch: CI Watch #3
```

不得把多轮 watch 续接到同一个 conversation。原因：

- 每轮 run history 与 conversation 一一对应，便于排障。
- 避免长上下文污染下一轮判断。
- 复用现有 Activity/conversation 路由。

### 8.3 Run Summary

每轮完成后，run history 摘要需要让用户不用点进 conversation 也能判断状态：

- 本轮检查了什么。
- 发现了什么变化。
- 是否满足 stop condition。
- 是否需要用户决策。
- 下一轮如果继续，应关注什么。

失败 run 必须写入 `error_message`。

## 9. 危险动作确认规则

第一版采用 Prompt gate，不做 runtime 强制拦截。

模板 prompt、watch prompt 拼接上下文、UI 说明都必须明确：

```text
Before commit, push, merge, release, rollback, delete, migration, tag creation,
dependency upgrade, production-impacting command, or remote state change,
ask the user first through AskUserQuestion / msctl ask-question.
```

产品边界：

- 这是 agent 行为约束，不是系统级权限拦截。
- UI 不得暗示 MultiSoul 已经强制阻止危险命令。
- 如果后续实现 runtime gate，需要单独规格或设计文档。

## 10. 通知与 Activity

- 每轮 Watch run 作为现有 Activity item 的一种来源出现。
- Activity 点击后打开该轮 conversation。
- Watch 结束时发送最终通知，说明结束原因：
  - Stop condition met
  - Max runs reached
  - Expired
  - Stopped by user
  - Failed
- 如果某轮 agent 需要用户决策，继续复用现有问答卡片。
- 问答卡片未回答时，对应 conversation 进入现有 awaiting question 流程。

## 11. 验收标准

### 11.1 创建与配置

- [ ] 用户可以从现有 Workflow tab 的 `+` 进入同一个 Template Picker。
- [ ] Template Picker 同时展示 `Blank Workflow`、Recurring templates 和 Watch templates 分组。
- [ ] 用户可以从 Blank Workflow 表单选择 Watch 模式。
- [ ] 用户选择 Watch template 后，表单默认进入 Watch 模式。
- [ ] 用户可以从模板创建 30 / 60 / 120 分钟的 watch workflow。
- [ ] 用户可以选择 5 / 10 / 15 / 30 分钟间隔。
- [ ] 用户可以输入自定义 interval minutes，非法值不能保存。
- [ ] 用户可以填写 `stop_condition`，且该字段独立保存。
- [ ] 保存 watch 后，列表显示 `Watch` mode、状态、间隔和下一次运行时间。
- [ ] Workflow List 提供 `All`、`Active`、`Ended` 过滤。
- [ ] 已结束 Watch 保留在列表中，并可通过 `Active` 过滤收起。

### 11.2 调度与停止

- [ ] Watch 保存后立即创建第一轮 run。
- [ ] 第一轮完成且 watch 未结束后，再按 interval 创建后续 run。
- [ ] 每轮 run 创建新的 conversation。
- [ ] 每轮 run history 记录摘要、状态、时间和 conversation 链接。
- [ ] 达到 `max_runs` 后自动停止。
- [ ] 达到 `expires_at` 后自动停止。
- [ ] Agent 判断 `stop_condition` 满足后自动停止。
- [ ] 多个停止条件任一先到即停。
- [ ] daemon 离线错过 interval 时不补跑历史轮次。
- [ ] 上一轮仍在 running 时，下一轮不会并行启动。

### 11.3 手动停止与重启

- [ ] 用户可以在 Watch detail 点击 `Stop Watch`。
- [ ] Stop Watch 后不再触发后续运行。
- [ ] Stop Watch 不强杀当前 running run。
- [ ] Watch 结束后仍保留在列表中。
- [ ] 已结束 Watch 可查看 run history。
- [ ] 已结束 Watch 可重新启动。

### 11.4 安全边界

- [ ] 四个内置 Watch 模板都包含危险动作确认规则。
- [ ] Watch prompt 拼接上下文包含危险动作确认规则。
- [ ] UI 明确表达危险动作需要先问用户。
- [ ] UI 不宣称第一版有 runtime 级强制拦截。

### 11.5 模板

- [ ] CI Watch 模板可创建 watch workflow。
- [ ] Local Health Watch 模板可创建 watch workflow。
- [ ] Release Window Watch 模板可创建 watch workflow。
- [ ] PR Review Watch 模板可创建 watch workflow。
- [ ] 模板只是预填，用户保存前可以修改 agent、prompt、interval、duration、max_runs 和 stop_condition。

## 12. 迁移与兼容

- 现有 workflow 数据迁移后必须继续可读、可编辑、可运行。
- 现有 workflow 默认 `mode='recurring'`。
- 现有 mobile 客户端如果尚未升级，不应因为新增字段导致列表读取失败。
- DB schema 改动必须走 migration，不允许运行时 `CREATE TABLE`。
- API 设计应保持向后兼容，新增 watch 字段对 recurring workflow 可为空。

## 13. 后续演进

- Runtime gate：在 CLI/runtime 层强制拦截危险动作并等待用户批准。
- Watch cycle：为每次 restart 创建独立 cycle，便于区分多次看护历史。
- 结构化 run result：让 agent 以稳定 JSON 或 metadata 写入 stop condition 判断。
- Watch dashboard：按时间线展示每轮信号变化。
- 自定义模板库。
- 连续稳定 N 轮后自动结束的高级停止条件。
- Webhook / GitHub / CI provider 事件触发，而不是固定 interval。
