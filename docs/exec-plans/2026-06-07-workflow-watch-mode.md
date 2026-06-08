# Workflow Watch 模式实施计划

SPEC: [`docs/product-specs/2026-06-07-SPEC-workflow-watch-mode.md`](../product-specs/2026-06-07-SPEC-workflow-watch-mode.md)

---

## 概述

在现有 Workflow 模块（Recurring daily/weekly）基础上增加 Watch 模式。Watch 是短期看护任务：保存后立即触发第一轮，按 interval 重复，任意停止条件先到即止。不新增独立 tab，共享 Workflow List / Detail / run history 展示。

涉及文件：
- **CLI**: `cli/src/db.rs`、`cli/src/serve/workflows.rs`、`cli/src/serve/routes/workflows.rs`
- **Mobile**: `mobile/src/features/workflows/types.ts`、`templates.ts`、`services/workflowService.ts`、`components/WorkflowListScreen.tsx`、`components/WorkflowFormScreen.tsx`、`components/WorkflowTemplatePickerScreen.tsx`

---

## Phase 0：DB Schema Migration（CLI）

### Task 0.1 — workflows 表扩列

在 `cli/src/db.rs` 的 `init()` 函数的 `execute_batch` 尾部追加迁移语句（使用 `let _ = conn.execute_batch(...)` 容错模式，与现有迁移风格一致）：

```sql
-- Watch mode columns on workflows
ALTER TABLE workflows ADD COLUMN mode TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE workflows ADD COLUMN interval_minutes INTEGER;
ALTER TABLE workflows ADD COLUMN max_runs INTEGER;
ALTER TABLE workflows ADD COLUMN expires_at INTEGER;
ALTER TABLE workflows ADD COLUMN stop_condition TEXT;
ALTER TABLE workflows ADD COLUMN watch_status TEXT;
ALTER TABLE workflows ADD COLUMN run_count INTEGER NOT NULL DEFAULT 0;
```

设计约定：
- `mode = 'recurring'` 对应现有 daily/weekly；`mode = 'watch'` 对应本次新增。
- Watch workflow 的 `schedule_kind` 存 `'none'`，`time_of_day` 存 `'00:00'`（SQLite NOT NULL 约束保留，dummy 值，scheduler 通过 `mode` 分支绕过）。
- `watch_status` 取值：`active | completed | stopped | expired | failed`；recurring workflow 该列为 NULL。
- `run_count` 为已实际启动 run 的数量，`skipped_overlap` 不计。

### Task 0.2 — workflow_runs 表扩列

```sql
ALTER TABLE workflow_runs ADD COLUMN run_number INTEGER;
ALTER TABLE workflow_runs ADD COLUMN stop_condition_satisfied INTEGER;  -- 0/1/NULL
ALTER TABLE workflow_runs ADD COLUMN stop_condition_reason TEXT;
```

验证：`cd cli && cargo build`（确认 schema 迁移不 panic）。

---

## Phase 1：CLI — Watch 调度器核心

**文件：`cli/src/serve/workflows.rs`**

### Task 1.1 — 扩展 DueWorkflow 结构体

向 `DueWorkflow` struct 添加：

```rust
pub struct DueWorkflow {
    // ... 现有字段 ...
    pub workflow_mode: String,        // 'recurring' | 'watch'
    pub interval_minutes: Option<i64>,
    pub max_runs: Option<i64>,
    pub expires_at: Option<i64>,
    pub stop_condition: Option<String>,
    pub run_count: i64,
}
```

### Task 1.2 — 更新 load_due_workflows 查询

在 `load_due_workflows` 的 SQL 和 `query_map` 中增加新列读取：

```sql
SELECT w.id, w.name, w.agent_id, w.prompt, w.schedule_kind, w.time_of_day,
       w.day_of_week, w.next_run_at, a.project_path, a.runtime, a.mode,
       w.mode as workflow_mode,
       w.interval_minutes, w.max_runs, w.expires_at, w.stop_condition, w.run_count
FROM workflows w
JOIN agents a ON a.id = w.agent_id
WHERE w.enabled = 1 AND w.next_run_at IS NOT NULL AND w.next_run_at <= ?1
ORDER BY w.next_run_at ASC
```

注意：`a.mode` 是 agent 的 runtime mode，`w.mode` 是 workflow 的 mode，在 `row.get` 时需要对应正确列索引。

### Task 1.3 — process_due_workflow 分支

在 `process_due_workflow` 最开始根据 `workflow.workflow_mode` 分支：

```rust
if workflow.workflow_mode == "watch" {
    process_due_watch(state, workflow, now, dispatch_runtime)
} else {
    process_due_recurring(state, workflow, now, dispatch_runtime)
}
```

将现有 `process_due_workflow` 逻辑提取为 `process_due_recurring`，保持接口不变。

### Task 1.4 — process_due_watch 实现

新增 `process_due_watch` 函数，逻辑：

1. **Overlap 检测**：与 recurring 相同，查询是否有 `status='running'` 的 run。若有，插入 `skipped_overlap`，更新 `next_run_at = now + interval_minutes * 60_000`，返回。

2. **创建 conversation**：title = `"Watch: {name} #{run_count + 1}"`。

3. **拼接 watch prompt**（见 Task 1.5）。

4. **创建 run**：插入 `workflow_runs` 时设 `run_number = run_count + 1`，`status = 'running'`。

5. **更新 workflow**：`run_count += 1`，`next_run_at = NULL`（等 run 完成后再计算），`updated_at = now`。

6. **dispatch runtime**（复用现有 runtime dispatch 逻辑）。

### Task 1.5 — assemble_watch_prompt 函数

新增纯函数，组装每轮注入给 agent 的完整 prompt：

```text
{user_prompt}

--- Watch Context ---
Run: {run_number} of {max_runs_str}
Watch expires at: {expires_at_str} (local time)
Stop condition: {stop_condition}

After completing your checks, include in your response:
WATCH_STOP_CONDITION: satisfied   <- if stop condition is fully met
WATCH_STOP_CONDITION: not_satisfied  <- otherwise

Behavior boundary:
Before commit, push, merge, release, rollback, delete, migration, tag creation,
dependency upgrade, production-impacting command, or remote state change,
ask the user first through AskUserQuestion / msctl ask-question.
```

`max_runs_str` 示例：若 `max_runs = Some(6)` 则为 "6"，若为 None 则为 "∞"。

### Task 1.6 — finalize_watch_run：运行完成后的停止判断

在 `finalize_workflow_run_for_conversation` 之后（或在此函数内部扩展），对 watch workflow 增加步骤：

1. 解析 summary 中是否含 `WATCH_STOP_CONDITION: satisfied`，更新 `stop_condition_satisfied` 和 `stop_condition_reason`。

2. 调用 `evaluate_watch_stop`（见 Task 1.7）。

3. 若未停止：`next_run_at = ended_at + interval_minutes * 60_000`。

由于 `finalize_workflow_run_for_conversation` 当前只通过 `conversation_id` 查 run，需要在完成后再查询对应 workflow 是否为 watch 模式，并执行停止判断。

建议在 `finalize_workflow_run_for_conversation` 后，在调用方（conversation 完成事件处理处）新增 `post_run_watch_check(db, conversation_id, now)` 辅助函数。

### Task 1.7 — evaluate_watch_stop 函数

按优先级评估停止条件（任一满足即停）：

```rust
fn evaluate_watch_stop(
    db: &Connection,
    workflow_id: &str,
    now: i64,
    stop_condition_satisfied: bool,
) -> Result<Option<&'static str>, String>
// 返回 Some("stopped") | Some("completed") | Some("expired") | None
```

逻辑：

1. 若 `watch_status = 'stopped'`（用户已手动停止）→ 已停，不重复处理。
2. 若 `expires_at` 已到 → `watch_status = 'expired'`，`enabled = false`，发终止推送。
3. 若 `stop_condition_satisfied` → `watch_status = 'completed'`，`enabled = false`，发终止推送。
4. 若 `run_count >= max_runs`（非 NULL）→ `watch_status = 'completed'`，`enabled = false`，发终止推送。
5. 否则 → 不停止，计算下一次 `next_run_at`。

Watch 结束推送通知（复用现有 Expo push，消息体含结束原因）。

### Task 1.8 — Watch 首轮立即触发

Watch 创建时（`POST /api/v1/workflows`）：若 `mode = 'watch'`，直接将 `next_run_at = now`（即刻）。这样 scheduler 下次 tick 就会立即触发第一轮，无需单独触发机制。

验证：`cd cli && cargo test`

---

## Phase 2：CLI — REST API 扩展

**文件：`cli/src/serve/routes/workflows.rs`**

### Task 2.1 — 更新 CreateWorkflowRequest

添加 watch 相关可选字段：

```rust
pub struct CreateWorkflowRequest {
    pub name: String,
    pub agent_id: String,
    pub prompt: String,
    // recurring fields (optional when mode = 'watch')
    pub schedule_kind: Option<String>,
    pub time_of_day: Option<String>,
    pub day_of_week: Option<i64>,
    // common
    pub mode: Option<String>,           // 'recurring' | 'watch', default 'recurring'
    // watch-only
    pub interval_minutes: Option<i64>,
    pub max_runs: Option<i64>,
    pub expires_at: Option<i64>,
    pub stop_condition: Option<String>,
}
```

服务端验证（在 handler 中）：
- `mode = 'watch'` 时：`interval_minutes` 必须为正整数；若提供 `max_runs` 必须 > 0；若有 `expires_at` 必须大于 now；`schedule_kind / time_of_day` 可缺省，存 `'none'` / `'00:00'`。
- `mode = 'recurring'` 时：沿用现有 validate_workflow_input 逻辑。

### Task 2.2 — 更新 GET workflows 和 GET workflow/:id 响应

在 JSON 响应中包含新字段：`mode`、`interval_minutes`、`max_runs`、`expires_at`、`stop_condition`、`watch_status`、`run_count`。

### Task 2.3 — 更新 GET workflow_runs 响应

每条 run 响应中包含：`run_number`、`stop_condition_satisfied`、`stop_condition_reason`。

### Task 2.4 — 新增 POST /api/v1/workflows/:id/stop-watch

- 仅 watch workflow 可用，否则 400。
- `watch_status = 'stopped'`，`enabled = 0`，`next_run_at = NULL`，`updated_at = now`。
- 不强杀 running run（不改 workflow_runs）。
- 发 `REASON_WORKFLOW_CHANGED` activity event。

### Task 2.5 — 新增 POST /api/v1/workflows/:id/restart-watch

- 仅 `watch_status IN ('completed', 'stopped', 'expired', 'failed')` 的 watch workflow 可用，否则 400。
- `watch_status = 'active'`，`enabled = 1`，`run_count = 0`，`next_run_at = now`（立即触发首轮），`updated_at = now`。
- 发 `REASON_WORKFLOW_CHANGED` activity event。

在路由表中注册两个新 handler（参照现有 enable/disable handler 写法）。

验证：`cd cli && cargo test && cargo build`

---

## Phase 3：Mobile — Types & Service

### Task 3.1 — 扩展 types.ts

```ts
export type WorkflowMode = 'recurring' | 'watch';
export type WatchStatus = 'active' | 'completed' | 'stopped' | 'expired' | 'failed';

export interface Workflow {
  id: string;
  name: string;
  agent_id: string;
  prompt: string;
  enabled: boolean;
  mode: WorkflowMode;
  // recurring
  schedule_kind: 'daily' | 'weekly' | null;
  time_of_day: string | null;
  day_of_week?: number | null;
  // watch
  interval_minutes: number | null;
  max_runs: number | null;
  expires_at: number | null;
  stop_condition: string | null;
  watch_status: WatchStatus | null;
  run_count: number;
  // common
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  endpoint_id: string;
  endpoint_label: string;
}

export interface WorkflowInput {
  name: string;
  agent_id: string;
  prompt: string;
  mode: WorkflowMode;
  // recurring
  schedule_kind?: 'daily' | 'weekly';
  time_of_day?: string;
  day_of_week?: number | null;
  // watch
  interval_minutes?: number;
  max_runs?: number | null;
  expires_at?: number | null;
  stop_condition?: string;
}

export interface WorkflowRun {
  // ... 现有字段 ...
  run_number: number | null;
  stop_condition_satisfied: boolean | null;
  stop_condition_reason: string | null;
}
```

### Task 3.2 — 更新 workflowService.ts

新增两个方法：

```ts
stopWatch(endpoint, workflowId): Promise<void>
  // POST /api/v1/workflows/:id/stop-watch

restartWatch(endpoint, workflowId): Promise<void>
  // POST /api/v1/workflows/:id/restart-watch
```

更新 `createWorkflow` / `updateWorkflow` 的请求类型以接受 `WorkflowInput`（含 watch 字段）。

验证：`cd mobile && pnpm typecheck`

---

## Phase 4：Mobile — Templates

**文件：`mobile/src/features/workflows/templates.ts`**

### Task 4.1 — 扩展 WorkflowTemplate 类型

```ts
export type WorkflowMode = 'recurring' | 'watch';

export interface WorkflowTemplateInitialValues {
  name: string;
  prompt: string;
  mode: WorkflowMode;
  // recurring only
  schedule_kind?: 'daily' | 'weekly';
  time_of_day?: string;
  day_of_week?: number | null;
  // watch only
  interval_minutes?: number;
  max_runs?: number | null;
  duration_minutes?: number;   // UI helper → derives expires_at at save time
  stop_condition?: string;
}
```

### Task 4.2 — 新增 Watch 模板

新增 `watchPrompt` helper（类似现有 `readOnlyPrompt`），自动附带危险动作确认边界文案和 `WATCH_STOP_CONDITION:` 输出要求。

新增 4 个 watch 模板（ID: `watch-ci`、`watch-local-health`、`watch-release-window`、`watch-pr-review`），参照 SPEC §6.4 的默认值填写 `interval_minutes`、`max_runs`、`duration_minutes`、`stop_condition`。

新增 `WATCH_TEMPLATES` 常量（`readonly WorkflowTemplate[]`）和 `RECURRING_TEMPLATES` 常量（现有 10 个模板），统一从 `WORKFLOW_TEMPLATES` 拆出，便于 TemplatePicker 分组渲染。

验证：`cd mobile && pnpm test -- --watchAll=false`（templates.test.ts 需覆盖 4 个新模板的 id 和 mode 字段）

---

## Phase 5：Mobile — UI

### Task 5.1 — WorkflowTemplatePickerScreen：新增 Watch Templates 分组

**文件：`mobile/src/features/workflows/components/WorkflowTemplatePickerScreen.tsx`**

- 将现有模板列表按 `RECURRING_TEMPLATES` / `WATCH_TEMPLATES` 分组渲染。
- Section 顺序：Blank Workflow → Recurring Templates → Watch Templates。
- Watch 模板卡片新增 `Watch` 徽标（`#FF6B35` accent）、时长/间隔文案（例 `60 min · every 10 min`）、边界说明。

### Task 5.2 — WorkflowFormScreen：Watch 模式字段

**文件：`mobile/src/features/workflows/components/WorkflowFormScreen.tsx`**

新增字段（当 `mode === 'watch'` 时展示，隐藏 schedule_kind / time_of_day / day_of_week）：

- **Mode 选择器**：`Recurring` / `Watch` segmented control（仅 Blank Workflow 入口显示；模板入口跳过，直接按模板 mode）。
- **Interval 选择器**：5 / 10 / 15 / 30 / Custom 分段选择；Custom 弹出数字输入框，1–240 分钟校验。
- **Duration 快捷选项**：30 / 60 / 120 分钟（→ 保存时计算 `expires_at = Date.now() + duration * 60_000`）。
- **Max runs 输入**（可选，正整数）。
- **Stop condition 多行文本输入**（可选，占位文案示例）。
- **危险动作提示**：Watch 模式下在表单底部展示静态说明文案。

保存时校验：interval > 0；若有 max_runs 则 > 0；若有 expires_at 则 > now。

### Task 5.3 — WorkflowListScreen：All/Active/Ended 过滤 + Watch item 渲染

**文件：`mobile/src/features/workflows/components/WorkflowListScreen.tsx`**

- 顶部新增 Filter 胶囊：`All` / `Active` / `Ended`。
- Filter 逻辑：
  - `All`：全部显示。
  - `Active`：`enabled === true` 的 recurring 和 `watch_status === 'active'` 的 watch。
  - `Ended`：`watch_status` 在 `completed | expired | stopped | failed` 的 watch。
- Recurring item 渲染不变（Daily / Weekly + next_run_at）。
- Watch item 渲染：`Watch` 模式徽标、`watch_status` 状态标签（Active / Completed / Expired / Stopped / Failed）、`Every X min`、最近 run 摘要、下一次运行时间或结束原因。
- 已结束 watch 应使用降饱和度/dim 色调，避免与 active 混淆。

### Task 5.4 — WorkflowDetailScreen：Watch 操作与 run history 扩展

若当前没有独立 `WorkflowDetailScreen.tsx`，则新建于 `mobile/src/features/workflows/components/WorkflowDetailScreen.tsx`（并在路由中注册），否则在现有 detail 页扩展。

Watch 特有展示区域：
- Watch 状态 + 进度：`{run_count} / {max_runs ?? '∞'} runs`。
- Expires at（格式化日期时间）。
- Stop condition 展示。
- 主操作按钮：
  - `watch_status === 'active'` → `Stop Watch`（destructive 样式，但避免与 Delete 混淆）。
  - `watch_status` 已结束 → `Restart Watch`（accent 样式）。
- Run history 每条新增：run_number 徽标、stop_condition_satisfied 状态标识（✓ / —）、stop_condition_reason 简要文字。

`Stop Watch` 调用 `workflowService.stopWatch`，乐观更新本地状态后 invalidate query。
`Restart Watch` 调用 `workflowService.restartWatch`，同上。

验证：`cd mobile && pnpm typecheck && pnpm test -- --watchAll=false`

---

## Phase 6：通知与 Activity

### Task 6.1 — Watch 结束推送通知（CLI）

在 `evaluate_watch_stop` 中，当确定 watch 结束时，通过 Expo Push 发送通知（复用现有 push 基础设施）：

```text
标题：Watch completed — {workflow_name}
正文：
  stop_condition met  → "Stop condition satisfied after {run_count} runs"
  max_runs reached    → "Completed {run_count} runs"
  expired             → "Watch window expired ({run_count} runs)"
  stopped             → "Watch stopped by user"
  failed              → "Watch failed: {error}"
```

### Task 6.2 — Watch run 的 Activity 接入

每轮 watch run 完成时（`finalize_workflow_run_for_conversation`）已通过现有 `REASON_WORKFLOW_CHANGED` 触发 Activity 更新，不需额外改动。

确认 Activity 列表中 watch run 的 conversation 链接可点击跳转（复用现有 conversation route）。

---

## 验收检查清单（对应 SPEC §11）

开始施工前先全部验收，然后一次 commit：

- [ ] Task 0.1/0.2：`cargo build` 通过，新列可读可写
- [ ] Task 1.1–1.8：`cargo test` 通过，watch scheduler 单测覆盖首轮触发、overlap 跳过、各停止条件
- [ ] Task 2.1–2.5：`cargo test` 通过，stop-watch/restart-watch 路由单测
- [ ] Task 3.1–3.2：`pnpm typecheck` 通过
- [ ] Task 4.1–4.2：`pnpm test` 通过，4 个 watch 模板 id / mode 断言
- [ ] Task 5.1–5.4：`pnpm typecheck && pnpm test` 通过，WorkflowListScreen filter 单测
- [ ] Task 6.1–6.2：cargo build 通过

SPEC §11 验收条目全部覆盖后，执行一次 `git commit`，并将 `lastCompletedCommit` 写入 `docs/exec-plans/index.json`。

---

## 关键风险与决策

| 风险 | 处理 |
|------|------|
| SQLite NOT NULL on schedule_kind/time_of_day | watch 行存 `'none'` / `'00:00'`，scheduler 通过 `mode` 分支绕过 parse_time_of_day |
| finalize 后判断停止条件需要查询 workflow mode | 新增 post_run_watch_check 辅助函数，在 conversation 完成事件后调用 |
| WATCH_STOP_CONDITION 解析健壮性 | 仅在 summary 文本中搜索精确字符串，不做 LLM 输出的结构化假设 |
| WorkflowDetailScreen 不存在 | Task 5.4 若无则新建，行数限于 ≤500 行 |
| run_count 重置策略 | 第一版 restart-watch 重置为 0，历史 run 保留但 run_number 从 1 重新计数 |
