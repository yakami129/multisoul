# SPEC: Workflow Agent 选择组件统一

**日期**：2026-06-09  
**状态**：已完成  
**优先级**：中  
**模块**：`mobile/`  
**关联对话**：`c6908526-9969-42a3-936b-c7ec8d6afc02`

---

## 1. 背景与目标

MultiSoul Workflow 模块支持用户创建 **recurring**（每日/每周定时）与 **watch**（短期监听）两类自动化任务，均需绑定一个已注册 agent。当前 `WorkflowFormScreen` 在表单内**平铺全部 agent 列表**（radio 行 + Switch），存在以下问题：

| 问题 | 影响 |
|------|------|
| agent 数量多时表单过长 | 用户需大量滚动才能看到 schedule / prompt 等字段 |
| 无搜索 | 难以在多个 repo / agent 中快速定位 |
| 多端点 agent 混排 | endpoint 信息仅作副标题，缺乏分组筛选 |
| 默认自动选中第一个 agent | 用户可能误保存非预期 agent |

相比之下，Specs 模块 **New Idea** 已采用更合适的交互：`AgentTargetField` 单行触发器 + `TargetPickerSheet` pageSheet（搜索、endpoint 分组、checkmark、Done 确认）。用户反馈该体验「合适」。

**目标**：抽取共享 Agent Target 选择组件，Workflow 创建/编辑与 Specs 统一使用同一套 UI 与交互，并遵循 Apple Human Interface Guidelines（渐进披露、直接操控、可逆操作、即时反馈、44pt 触控区）。

**成功标准**：用户在 Workflow 表单中通过单行触发器 + sheet 完成 agent 选择；新建时必须主动选择 agent；编辑时 endpoint 锁定；Specs 现有流程行为不变。

---

## 2. 范围

### 2.1 In Scope

- 从现有 `TargetPickerSheet` 抽取共享组件套件，供 **Workflow** 与 **Specs** 统一使用。
- 共享组件包含：
  - `AgentTargetField` — 表单内单行触发器
  - `AgentTargetPickerSheet` — pageSheet 选择器（搜索 + endpoint + agent）
  - `AgentTarget` — 选中结果类型（可与现有 `SpecTarget` 对齐或为其 type alias）
- `WorkflowFormScreen` 移除内联 agent 列表，接入共享组件。
- 覆盖 **创建** 与 **编辑** workflow，两种 mode 均适用：
  - `recurring`（定时任务）
  - `watch`（监听任务）
- **新建** workflow：不预选 agent；未选择时 Save 禁用。
- **编辑** workflow：锁定 endpoint，仅允许在同一 endpoint 下更换 agent。
- Specs 模块（New Idea、`SpecsHomeScreen`、Idea 编辑）改 import 路径，**行为与视觉保持不变**（回归测试覆盖）。
- 单元 / 组件测试更新；不新增 E2E 仪器测试框架依赖。

### 2.2 Out of Scope

- Workflow **详情页**单独提供改 agent 入口（后续可独立规格）。
- 后端 / CLI REST 协议变更（仍通过 `agent_id` 创建 workflow，endpoint 由 agent 推导）。
- 「记住上次 workflow 选用的 agent」持久化偏好。
- 内联紧凑模式（搜索 + 分段，不弹 sheet）。
- 副标题同时展示 endpoint + agent + repo path 的增强 Field 变体（v1 与 New Idea 副标题一致：仅 agent 名）。
- 修改 agent 注册 / 列表 API。

---

## 3. 用户决策记录

以下决策来自 2026-06-09 问答卡片，已确认：

| 维度 | 决策 |
|------|------|
| 组件策略 | 抽取共享组件（Field + Sheet），Specs 与 Workflow 统一 |
| 改造范围 | 创建 + 编辑 workflow（recurring & watch） |
| 编辑约束 | 锁定 endpoint，仅同 endpoint 下换 agent |
| 默认行为 | 不预选 agent；未选时 Save 禁用 |
| UI 形态 | 单行触发器 + pageSheet（与 New Idea 一致） |

---

## 4. 现状与痛点（代码锚点）

| 位置 | 现状 |
|------|------|
| `mobile/src/features/workflows/components/WorkflowFormScreen.tsx` L223–248 | 内联 `agents.map` radio 列表 |
| `mobile/src/features/specs/components/TargetPickerSheet.tsx` | pageSheet：搜索、endpoint 区、agent 区、Done |
| `mobile/src/features/specs/components/IdeaEditorSheet.tsx` L305–322 | 单行 `onChooseTarget` 触发器 |
| `mobile/app/(tabs)/workflows.tsx` L132–134 | 编辑时 `agents.filter(endpoint_id === editingWorkflow.endpoint_id)` |
| `mobile/src/features/specs/components/specUiModels.ts` | `SpecTarget` 类型定义 |

---

## 5. 方案设计

### 5.1 组件架构

```
mobile/src/components/agent-target/
├── AgentTargetField.tsx          # 表单单行触发器
├── AgentTargetPickerSheet.tsx    # pageSheet 选择器（自 TargetPickerSheet 迁移/refactor）
├── types.ts                      # AgentTarget
└── index.ts                      # 公共导出
```

**迁移策略**：

- `AgentTargetPickerSheet` 为 `TargetPickerSheet` 的权威实现；原 `features/specs/components/TargetPickerSheet.tsx` 改为 thin re-export 或删除并由 specs 改 import（**同一用户流程只能有一个权威实现**）。
- `SpecTarget` 在 `specUiModels.ts` 中改为 `export type SpecTarget = AgentTarget`（或 re-export），避免 specs 域内大量类型重命名。
- `AgentTargetField` 从 `IdeaEditorSheet` 内 target 行样式抽取，Props 支持：
  - `value?: AgentTarget`
  - `onPress: () => void`
  - `placeholder` / i18n 默认文案
  - `accessibilityLabel`

**`AgentTargetPickerSheet` Props**（在现有 `TargetPickerSheet` 基础上扩展）：

```ts
interface AgentTargetPickerSheetProps {
  visible: boolean;
  endpoints: Endpoint[];
  agents: Agent[];
  selectedTarget?: AgentTarget;
  /** 编辑 workflow 时传入，锁定 endpoint 选择 */
  lockedEndpointId?: string;
  presentation?: 'modal' | 'inline';
  onClose: () => void;
  onDone: (target: AgentTarget) => void;
}
```

**锁定 endpoint 行为**（`lockedEndpointId` 有值时）：

- Endpoint 区：**隐藏或只读展示**当前 endpoint（推荐只读单行，避免用户困惑为何不能切换）。
- Agent 列表：仅展示 `agent.endpoint_id === lockedEndpointId` 的 agent。
- 搜索：仍可按 agent 名 / repo path 过滤。
- 打开 sheet 时：`endpointId` 初始化为 `lockedEndpointId`。

### 5.2 Workflow 表单集成

`WorkflowFormScreen` 变更：

1. **移除** L223–248 内联 agent 列表及关联样式（`agentRow*`）。
2. **新增** state：`selectedTarget?: AgentTarget`；从 `initialValues.agent_id` + agents/endpoints 反查初始化（编辑场景）。
3. **新建**场景：`selectedTarget` 初始为 `undefined`；移除 `useEffect` 自动选第一个 agent 的逻辑（L114–121）。
4. 渲染 `AgentTargetField` + 条件渲染 `AgentTargetPickerSheet`。
5. `canSave*` 条件增加 `selectedTarget != null`（等价于 `agentId.length > 0`）。
6. `handleSave` 使用 `selectedTarget.agentId` 作为 `agent_id`。
7. 编辑模式：向 sheet 传入 `lockedEndpointId={editingEndpointId}`；`agents` prop 已由父级过滤（保持现有 `workflows.tsx` 逻辑）。

父级 `workflows.tsx` / `workflow/[id].tsx`：

- 向 `WorkflowFormScreen` 传入 `endpoints` 列表（当前仅传 `agents`）。
- 编辑时传入 `lockedEndpointId={workflow.endpoint_id}`。

### 5.3 Specs 模块集成

以下入口改 import 为 `@/components/agent-target`（或等价公共路径）：

- `mobile/app/new-idea.tsx`
- `mobile/app/idea/[id].tsx`
- `mobile/src/features/specs/components/SpecsHomeScreen.tsx`

`IdeaEditorSheet` 内 target 行替换为 `AgentTargetField`（可选：v1 仅 Workflow 用 Field，Specs 保持 IdeaEditorSheet 内联行但共用 sheet——**推荐 Field 也统一**，减少重复样式）。

行为要求：**与改前 pixel-级一致或等价**（toolbar、搜索、endpoint/agent 分组、Done disabled 规则、offline endpoint 禁用）。

### 5.4 Apple HIG 对齐要点

| 原则 | 实现 |
|------|------|
| 渐进披露 | 表单仅一行 Agent 字段；详情在 sheet |
| 直接操控 | Tap 行 → 选 endpoint/agent → Done |
| 可逆 | Cancel / 下滑 dismiss 不提交选择 |
| 即时反馈 | checkmark、Done disabled、Save disabled |
| 清晰导航 | pageSheet `presentationStyle="pageSheet"` |
| 无障碍 | `accessibilityRole="button"`、`accessibilityState`、minHeight 44 |

### 5.5 i18n

- Workflow 复用 specs 已有键（如 `specs.editorChoose`、`specs.chooseTarget`）或新增 `workflows.agentChoose` 等 workflow 域键；**禁止硬编码英文**。
- 新增键须同步 `mobile/src/i18n/` en + zh。

---

## 6. 主流程

### 6.1 新建 recurring / watch workflow

```text
Workflow Tab → + → Blank / Template → WorkflowFormScreen
  → Agent 行显示「选择 Agent」
  → Tap → AgentTargetPickerSheet
  → （可选）选 Endpoint → 搜索/选 Agent → Done
  → 行显示 agent 名；Save 启用
  → 填写 name / schedule|watch / prompt → Save
```

### 6.2 编辑已有 workflow

```text
Workflow 列表 / 详情 → Edit → WorkflowFormScreen
  → Agent 行显示当前 agent
  → Sheet 内 endpoint 锁定为 workflow.endpoint_id
  → 仅可换同 endpoint 下其他 agent
  → Save → updateWorkflow（endpoint 不变）
```

### 6.3 New Idea（回归，行为不变）

```text
New Idea → IdeaEditorSheet → Choose Target
  → AgentTargetPickerSheet（无 lockedEndpointId）
  → 选 Endpoint + Agent → Done → 创建 Idea
```

---

## 7. 边界与异常

| 场景 | 预期行为 |
|------|----------|
| 无任何 agent | Field 可 tap；sheet 内 empty state；Save 禁用 |
| 仅一个 endpoint、一个 agent | 用户仍需 tap 并 Done 确认（不自动选中） |
| 编辑时 endpoint 下 agent 被删除 | Field 显示原 agent 名或「未选择」；sheet 列表 empty；Save 禁用直至重选 |
| endpoint offline | sheet 内 endpoint 行 disabled（与现 TargetPickerSheet 一致） |
| 取消 sheet | 保留进入 sheet 前的选择 |
| Template 预填 `agent_id` | 若 agent 仍存在，反查为 `selectedTarget` 并展示；Save 规则仍要求有效 target |

---

## 8. 验收标准

### 8.1 共享组件

- [ ] `AgentTargetField` 与 `AgentTargetPickerSheet` 位于 `mobile/src/components/agent-target/`，为唯一权威实现。
- [ ] Specs 与 Workflow 均从公共路径 import，无深路径跨 feature import。
- [ ] `TargetPickerSheet` 旧路径无重复实现（re-export 或已删除）。

### 8.2 Workflow 创建

- [ ] 表单不再内联展示 agent 列表。
- [ ] 新建 recurring workflow：未选 agent 时 Save 禁用。
- [ ] 新建 watch workflow：未选 agent 时 Save 禁用。
- [ ] 选 agent 后 Save 可用，创建成功且绑定正确 `agent_id`。
- [ ] 不自动预选第一个 agent。

### 8.3 Workflow 编辑

- [ ] 编辑 recurring / watch workflow 均可通过 sheet 换 agent。
- [ ] 编辑时 endpoint 锁定，sheet 不展示其他 endpoint 的可选切换（只读或隐藏）。
- [ ] 保存后 `endpoint_id` 不变，仅 `agent_id` 可变更。

### 8.4 Specs 回归

- [ ] New Idea 选 target 流程与改前一致。
- [ ] Idea 编辑改 target 流程与改前一致。
- [ ] SpecsHome 创建 Idea 选 target 与改前一致。
- [ ] 现有 `TargetPickerSheet.test.tsx` 用例迁移后仍通过（或等价覆盖）。

### 8.5 质量闸

- [ ] `cd mobile && pnpm typecheck` 通过。
- [ ] `cd mobile && pnpm test -- --watchAll=false` 通过。
- [ ] 无新增 `console.log`；颜色符合 `mobile/docs/design.md` §2。
- [ ] 单文件 ≤ 500 行；feature 边界检查通过。

---

## 9. E2E 功能测试用例

### E2E-1：新建 workflow — 未选 agent 时 Save 禁用

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.2 |
| 用户场景 | 用户创建空白 recurring workflow，尚未选择 agent |
| 前置条件 | `agents` ≥ 1；`initialValues` 无 `agent_id`；渲染 `WorkflowFormScreen` |
| 操作步骤 | 1. 填写 name 与 prompt<br>2. 不打开 agent sheet<br>3. 查找 Save 按钮 |
| 预期结果 | Save 为 disabled；`onSave` 未被调用 |
| 目标层级 | Mobile |
| 自动化提示 | `WorkflowFormScreen.test.tsx`；`accessibilityState.disabled` 或样式断言；mock `onSave` |

### E2E-2：新建 workflow — sheet 选 agent 后 Save 成功

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.2 |
| 用户场景 | 用户通过 sheet 选择 agent 并保存 recurring workflow |
| 前置条件 | 2 个 agent、1 个 endpoint；`endpoints` + `agents` mock |
| 操作步骤 | 1. 渲染表单<br>2. Tap Agent 行<br>3. Sheet 选 endpoint → 选 agent → Done<br>4. 填写必填项 → Save |
| 预期结果 | `onSave` 调用且 `agent_id` 为所选 agent；表单无内联 agent 列表 |
| 目标层级 | Mobile |
| 自动化提示 | `getByLabelText` / `getByText`；mock sheet visible；断言 `onSave` payload |

### E2E-3：新建 watch workflow — agent 选择同样适用

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.2 |
| 用户场景 | 用户创建 watch 模式 workflow 并选择 agent |
| 前置条件 | `showModeSelector` 或 `mode: 'watch'`；agents mock |
| 操作步骤 | 1. 切换到 watch 模式（若需要）<br>2. 通过 sheet 选 agent<br>3. 填 interval 等 → Save |
| 预期结果 | `onSave` 含正确 `agent_id` 与 `mode: 'watch'` |
| 目标层级 | Mobile |
| 自动化提示 | 复用 E2E-2 fixture；断言 `mode` 字段 |

### E2E-4：编辑 workflow — endpoint 锁定

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.3 |
| 用户场景 | 用户编辑已有 workflow，仅能在原 endpoint 下换 agent |
| 前置条件 | `initialValues.agent_id` 有效；`lockedEndpointId='ep-1'`；agents 含 ep-1 与 ep-2 的 agent |
| 操作步骤 | 1. 渲染编辑表单<br>2. 打开 agent sheet<br>3. 断言 endpoint 区不可切换到 ep-2<br>4. 选择 ep-1 下另一 agent → Done → Save |
| 预期结果 | sheet 仅展示 ep-1 agents；Save 成功；不出现 ep-2 agent |
| 目标层级 | Mobile |
| 自动化提示 | 传入 `lockedEndpointId`；`queryByText` 其他 endpoint agent 为 null |

### E2E-5：AgentTargetPickerSheet — 搜索过滤

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.1 |
| 用户场景 | agent 较多时通过搜索快速定位 |
| 前置条件 | ≥ 3 agents，不同 name / project_path |
| 操作步骤 | 1. 打开 sheet<br>2. 选 endpoint<br>3. 输入搜索词（匹配 repo path） |
| 预期结果 | 列表仅显示匹配 agent；Done 在未选时 disabled |
| 目标层级 | Mobile |
| 自动化提示 | 自 `TargetPickerSheet.test.tsx` 迁移至 `AgentTargetPickerSheet.test.tsx` |

### E2E-6：Specs New Idea — target 选择回归

| 字段 | 内容 |
|------|------|
| 关联验收 | 8.4 |
| 用户场景 | New Idea 仍可通过 picker 选 target 并创建 |
| 前置条件 | `SpecsHomeScreen` 或 `new-idea` route mock；endpoints + agents |
| 操作步骤 | 1. Tap New Idea<br>2. Choose Target → 选 agent → Done<br>3. Save Idea |
| 预期结果 | `onCreateIdea` / `createIdea` 收到完整 `targetAgentId` 等字段；UI 与改前一致 |
| 目标层级 | Mobile |
| 自动化提示 | `SpecsHomeScreen.test.tsx` 现有用例应继续绿 |

### E2E-7：无 agent — empty state

| 字段 | 内容 |
|------|------|
| 关联验收 | §7 |
| 用户场景 | 用户在没有注册 agent 时打开 workflow 表单 |
| 前置条件 | `agents=[]` |
| 操作步骤 | 1. 渲染表单<br>2. Tap Agent 行打开 sheet |
| 预期结果 | sheet 显示 empty state；Save 始终禁用 |
| 目标层级 | Mobile |
| 自动化提示 | 断言 empty 文案 i18n key |

---

## 10. 实施提示（非规范性）

建议实施顺序：

1. 创建 `components/agent-target/`，迁移 `TargetPickerSheet` → `AgentTargetPickerSheet`，加 `lockedEndpointId`。
2. 抽取 `AgentTargetField`；Specs 改 import + 回归测试。
3. 改 `WorkflowFormScreen` + 父级传 `endpoints` / `lockedEndpointId`。
4. 删除重复样式与 dead code；跑 typecheck + test。

**风险**：Workflow 与 Specs 视觉主题均使用 `brandRefresh`，Field 样式应复用 IdeaEditorSheet 的 target 行，避免 workflow 表单出现第二套 Field 皮肤。

---

## 11. 参考

- `mobile/src/features/workflows/components/WorkflowFormScreen.tsx`
- `mobile/src/features/specs/components/TargetPickerSheet.tsx`
- `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- `docs/product-specs/2026-06-01-SPEC-workflow-module.md`
- `docs/product-specs/2026-06-07-SPEC-workflow-watch-mode.md`
- Apple Human Interface Guidelines — Navigation, Modality, Controls
