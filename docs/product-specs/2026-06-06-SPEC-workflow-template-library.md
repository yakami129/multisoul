# Workflow 模板库 SPEC

## 1. 背景与目标

Workflow MVP 已经支持手机端创建 daily / weekly 定时 workflow，本机 CLI 按规则创建新 conversation 并发送固定 prompt。当前创建体验的问题是：用户必须从空白 prompt 开始设计任务，真正能跑起来的 workflow 依赖用户自己理解 agent 能力、调度边界和 prompt 写法。

本规格目标是把 Workflow 创建入口从“空白表单”优化为“选择起点”：

```text
点 + -> 选择 Blank Workflow 或内置模板 -> 编辑表单 -> 保存为普通 workflow
```

第一版要验证模板是否能显著降低创建成本。模板只在手机端作为预填内容存在；CLI 不需要知道 workflow 来自模板，也不新增模板 API。

## 2. 范围

### 2.1 In Scope

- Workflow 创建入口新增“选择起点”页面。
- 用户必须可以选择 `Blank Workflow` 从空白表单创建。
- 手机端内置 10 个 workflow 模板，覆盖项目状态、PR/CI/Review、本地健康、需求计划、发布回归五类场景。
- 选择模板后进入现有 Workflow 表单，并预填名称、prompt、schedule kind、time of day、day of week。
- 模板只是预填，用户保存前可修改 agent、名称、prompt 和定时规则。
- 模板卡片展示行为边界标签和一句简短说明。
- 保存时继续调用现有 `POST /api/v1/workflows`，payload 仍是普通 workflow input。
- Blank 创建和模板创建都必须复用同一个保存流程。

### 2.2 Out of Scope

- CLI 提供模板列表 API。
- 持久化保存模板来源、模板 ID 或模板版本。
- 用户自定义模板库。
- 原始 cron、interval loop、短期看护任务。
- 自动审批策略或 runtime 权限模型改造。
- 多步骤工作流编排、任务图、跨 agent 编排。
- 模板 Marketplace 或远程模板更新。

## 3. 交互与信息架构

Workflow list 的 `+` 不再直接打开空白表单，而是打开 `WorkflowTemplatePicker`。

页面结构：

- 顶部：`Blank Workflow` 一等入口。
- 下方：模板分类分组或紧凑筛选的模板列表。
- 每个模板卡片展示标题、场景说明、行为边界标签、边界说明、推荐频率。

`Blank Workflow` 不应被命名为“其他”或藏在底部。它是和模板平级的创建起点。

Blank 创建进入现有表单，不预填 prompt。可提供基础默认值：

- `schedule_kind`: `daily`
- `time_of_day`: `09:00`
- `day_of_week`: `null`
- `name`: 空
- `prompt`: 空

模板创建进入同一个表单，只是带入 `initialValues`。模板不预选 agent，除非当前只有一个可用 agent。

## 4. 行为边界

模板行为边界在 UI 中显示为标签 + 简短说明。第一版使用三类：

| 边界 | 说明 |
|------|------|
| 只读汇报 | 只检查并总结，不修改文件 |
| 允许小修并验证 | 可做低风险修改并跑验证，不提交、不发布 |
| 需要确认后行动 | 涉及发布、提交、删除、迁移等动作必须先问用户 |

行为边界是 prompt 约束，不是新的权限系统。实际工具权限仍由 runtime 和用户本地配置控制。

## 5. 首批内置模板

| 模板 | 边界 | 默认时间 | 用途 |
|------|------|----------|------|
| 项目日报 | 只读汇报 | 每日 09:00 | 汇总项目状态、最近变更、风险和今日建议 |
| 项目周报 | 只读汇报 | 每周五 17:00 | 输出本周进展、阻塞、下周建议 |
| PR 状态巡检 | 只读汇报 | 每日 10:00 | 检查 PR、CI、review comment 和合并阻塞 |
| CI 失败排查 | 允许小修并验证 | 每日 11:00 | 定位 CI 失败，修复明确且低风险的问题 |
| 本地服务健康检查 | 只读汇报 | 每日 09:30 | 检查本机服务、端口、daemon 和最近错误 |
| 日志异常摘要 | 只读汇报 | 每日 18:00 | 汇总最近日志中的错误、频率和疑似原因 |
| 需求规格检查 | 只读汇报 | 每周一 10:00 | 检查 product spec 是否有目标、范围、验收和边界遗漏 |
| 执行计划检查 | 只读汇报 | 每周一 11:00 | 检查 exec plan 是否任务清晰、验证路径完整 |
| 发布前检查 | 需要确认后行动 | 每周四 15:00 | 检查版本、验证、文档和发布阻塞项 |
| 回归巡检 | 允许小修并验证 | 每周四 16:00 | 运行关键检查，发现回归风险 |

每个模板的 prompt 必须把对应边界写清楚。涉及 commit、push、merge、发布、打 tag、删除、迁移等动作时，模板 prompt 必须要求先询问用户。

## 6. 数据与接口

第一版不新增 CLI 数据模型和接口。

手机端模板定义建议包含：

```ts
type WorkflowTemplateBoundary =
  | 'read_only'
  | 'small_fixes'
  | 'confirm_before_action';

interface WorkflowTemplate {
  id: string;
  category: string;
  title: string;
  description: string;
  boundary: WorkflowTemplateBoundary;
  boundary_label: string;
  boundary_description: string;
  initial_values: {
    name: string;
    prompt: string;
    schedule_kind: 'daily' | 'weekly';
    time_of_day: string;
    day_of_week: number | null;
  };
}
```

该结构只存在于 mobile 代码中。保存 workflow 时，不传 `template_id`、`boundary` 或 `category` 给 CLI。

## 7. UI / UX 要求

- 模板选择页遵守 `mobile/docs/design.md` 的现有 iOS 设计系统。
- 不做营销式 hero，不使用大面积装饰卡片。
- `Blank Workflow` 在第一屏可见。
- 模板卡片保持紧凑，重点展示“这个模板做什么”和“默认会不会改东西”。
- 模板分类可以用 segmented control、短列表分组或紧凑 tab；不要引入复杂筛选器。
- 模板选择后进入现有 Workflow 表单，用户能看到并编辑所有预填字段。
- 表单保存、取消、键盘避让、agent 选择继续沿用现有交互。

## 8. 验收标准

- 用户点击 `+` 后看到 `Blank Workflow` 和 10 个模板。
- 用户选择 `Blank Workflow` 可进入空白表单并创建 workflow。
- 用户选择任一模板可进入表单，并看到预填名称、prompt 和 schedule。
- 模板创建后，用户可修改所有字段。
- 保存后调用现有 `POST /api/v1/workflows`，请求体不包含模板来源字段。
- 模板卡片显示行为边界标签和简短说明。
- 10 个模板覆盖五个场景族，每族两个模板。
- Workflow List、Workflow Detail、Activity 的既有运行模型不因模板创建方式改变。
- 无 endpoint 时，创建入口应提示先添加 endpoint；无 agent 时，表单无法保存并提示选择 agent。
- Mobile typecheck 和相关 Workflow UI tests 通过。

## 9. 后续扩展

如果模板库验证有效，再考虑用户保存自定义模板、CLI 提供模板 API、interval / loop 风格短期看护任务、模板版本追踪，以及从完成 run 反向生成模板。
