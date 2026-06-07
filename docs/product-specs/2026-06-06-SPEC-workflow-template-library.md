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

## 3. 用户与使用场景

### 3.1 典型用户

- 使用 MultiSoul 控制本机 Claude Code / Codex / Cursor CLI 的个人开发者。
- 想让 agent 周期性做项目巡检、状态总结、日志检查、发布检查，但不想从零写 prompt 的用户。
- 仍希望保留完全自定义 workflow 创建能力的高级用户。

### 3.2 关键场景

1. 用户在 Workflow tab 点击 `+`。
2. 手机端打开“选择起点”页面，顶部展示 `Blank Workflow`。
3. 用户可以直接选择 Blank，进入空白 Workflow 表单。
4. 用户也可以选择一个模板，例如 `CI 失败排查`。
5. 模板卡片显示边界标签，例如 `允许小修并验证`，并说明 `可做低风险修复，但不提交、不发布`。
6. 用户进入表单后看到模板预填的名称、prompt 和推荐时间。
7. 用户选择 agent，必要时修改 prompt 或 schedule。
8. 用户保存后，手机端调用现有 workflow 创建接口。
9. 到点后 CLI 按原有 Workflow MVP 逻辑触发运行。
10. 运行结果继续进入 Activity、Workflow run history 和对应 conversation。

## 4. 信息架构与交互

### 4.1 创建入口

Workflow list 的 `+` 不再直接打开空白表单，而是打开 `WorkflowTemplatePicker`。

页面结构：

- 顶部：`Blank Workflow` 一等入口。
- 下方：模板分类分组或可横向筛选的模板列表。
- 每个模板卡片展示标题、场景说明、行为边界标签、边界说明、推荐频率。

`Blank Workflow` 不应被命名为“其他”或藏在底部。它是和模板平级的创建起点。

### 4.2 Blank Workflow

Blank 创建进入现有表单，不预填 prompt。可提供基础默认值：

- `schedule_kind`: `daily`
- `time_of_day`: `09:00`
- `day_of_week`: `null`
- `name`: 空
- `prompt`: 空

保存校验沿用现有表单规则：名称、agent、prompt、有效时间必填。

### 4.3 模板创建

模板创建进入同一个表单，只是带入 `initialValues`。

模板预填字段：

- `name`
- `prompt`
- `schedule_kind`
- `time_of_day`
- `day_of_week`

模板不预选 agent，除非当前只有一个可用 agent。多 endpoint / 多 agent 场景下，用户必须明确选择或确认 agent。

### 4.4 行为边界展示

模板行为边界在 UI 中显示为标签 + 简短说明。第一版使用三类：

| 边界 | 说明 |
|------|------|
| 只读汇报 | 只检查并总结，不修改文件 |
| 允许小修并验证 | 可做低风险修改并跑验证，不提交、不发布 |
| 需要确认后行动 | 涉及发布、提交、删除、迁移等动作必须先问用户 |

行为边界是 prompt 约束，不是新的权限系统。实际工具权限仍由 runtime 和用户本地配置控制。

## 5. 首批内置模板

### 5.1 项目状态

#### 项目日报

- 边界：只读汇报。
- 默认时间：每日 09:00。
- 用途：汇总当前项目状态、最近变更、风险和今日建议。
- Prompt 要求：
  - 检查 git status、最近提交、未提交变更和关键文档。
  - 总结昨日/最近进展、当前风险、建议下一步。
  - 不修改文件。

#### 项目周报

- 边界：只读汇报。
- 默认时间：每周五 17:00。
- 用途：输出本周进展、阻塞、下周建议。
- Prompt 要求：
  - 汇总本周 commit、重要变更、未完成任务。
  - 给出风险和下周优先级建议。
  - 不修改文件。

### 5.2 PR / CI / Review

#### PR 状态巡检

- 边界：只读汇报。
- 默认时间：每日 10:00。
- 用途：检查当前分支或相关 PR 的 CI、review comment、合并阻塞。
- Prompt 要求：
  - 检查当前分支、PR 状态、CI 状态和 review comments。
  - 汇总阻塞项和建议处理顺序。
  - 不创建 PR、不 push、不 merge。

#### CI 失败排查

- 边界：允许小修并验证。
- 默认时间：每日 11:00。
- 用途：定位 CI 失败，修复明确且低风险的问题。
- Prompt 要求：
  - 检查失败日志和本地验证结果。
  - 可做最小低风险修复并重新运行相关验证。
  - 不 commit、不 push、不 merge；遇到语义取舍必须询问用户。

### 5.3 本地健康

#### 本地服务健康检查

- 边界：只读汇报。
- 默认时间：每日 09:30。
- 用途：检查本机服务、端口、daemon 和最近错误。
- Prompt 要求：
  - 检查本地服务状态、端口可用性和最近日志。
  - 汇总异常、可能原因和建议动作。
  - 不重启服务、不改配置，除非用户确认。

#### 日志异常摘要

- 边界：只读汇报。
- 默认时间：每日 18:00。
- 用途：汇总最近日志中的错误、频率和疑似原因。
- Prompt 要求：
  - 查看最近日志，聚合错误类型和时间分布。
  - 给出优先级和下一步排查建议。
  - 不修改文件。

### 5.4 需求与计划

#### 需求规格检查

- 边界：只读汇报。
- 默认时间：每周一 10:00。
- 用途：检查产品规格是否有目标、范围、验收和边界遗漏。
- Prompt 要求：
  - 阅读相关 product spec。
  - 标出模糊目标、缺失验收标准、未说明的 out of scope。
  - 不改文档，只给建议。

#### 执行计划检查

- 边界：只读汇报。
- 默认时间：每周一 11:00。
- 用途：检查 exec plan 是否任务清晰、验证路径完整。
- Prompt 要求：
  - 阅读相关 exec plan。
  - 检查任务粒度、依赖顺序、验证命令和风险项。
  - 不改文档，只给建议。

### 5.5 发布与回归

#### 发布前检查

- 边界：需要确认后行动。
- 默认时间：每周四 15:00。
- 用途：发布前检查版本、验证、文档和阻塞项。
- Prompt 要求：
  - 检查 release checklist、版本号、测试状态和文档状态。
  - 输出是否可发布，以及阻塞原因。
  - 不执行发布、不上传、不打 tag；任何发布动作必须先问用户。

#### 回归巡检

- 边界：允许小修并验证。
- 默认时间：每周四 16:00。
- 用途：运行关键检查，发现回归风险。
- Prompt 要求：
  - 运行或建议运行关键验证。
  - 对明确低风险问题可做最小修复并重新验证。
  - 不 commit、不发布；遇到范围不清的修复必须询问用户。

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
- 模板卡片应保持紧凑，重点展示“这个模板做什么”和“默认会不会改东西”。
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

如果模板库验证有效，再考虑：

- 用户保存自定义模板。
- CLI 提供模板 API，支持跨设备共享模板定义。
- interval / loop 风格短期看护任务。
- 模板版本和来源追踪。
- 从完成 run 反向生成模板。
