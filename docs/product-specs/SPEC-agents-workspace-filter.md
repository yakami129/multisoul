# Agents 工作空间筛选功能 SPEC

## 1. 背景与目标

### 1.1 背景
当前 Agents 页面以平铺列表展示所有 Agent，当用户有多个项目时，难以快速定位特定项目相关的 Agent。

### 1.2 目标
- **核心目标**：快速定位特定项目的 Agent
- **次要目标**：减少视觉干扰，按工作流组织 Agent

## 2. 范围

### 2.1 In Scope
- 从 `Agent.project_path` 提取工作空间名称
- 顶部横向滚动的 Chip 筛选器 UI
- 点击 Chip 切换工作空间，过滤 Agent 列表
- 将选中的工作空间保存到 AsyncStorage
- 列表切换时的淡入淡出动画
- 空状态提示 UI

### 2.2 Out of Scope
- 不支持用户自定义工作空间名称（完全基于 project_path 自动提取）
- 不支持多选工作空间（一次只能选一个）
- 不支持工作空间的编辑、删除、重命名
- 不在 Header 副标题显示筛选结果数量（保持现有 "X REGISTERED" 格式）

## 3. 用户与使用场景

### 3.1 典型用户角色
- 开发者：管理多个项目的 Agent

### 3.2 关键使用场景

**场景 1：快速定位项目 Agent**
1. 用户打开 Agents 页面
2. 看到顶部显示所有工作空间 Chip（All、MultiSoul、Project X 等）
3. 点击 "MultiSoul" Chip
4. 列表只显示 MultiSoul 项目的 Agent
5. 点击某个 Agent 进入对话

**场景 2：状态恢复**
1. 用户上次选择了 "Project X" 工作空间
2. 关闭 App
3. 再次打开 App，自动恢复到 "Project X" 筛选状态

**场景 3：空工作空间**
1. 用户点击某个工作空间 Chip
2. 该工作空间下没有 Agent
3. 显示 "No agents in this workspace" 空状态提示

## 4. 业务流程与信息架构

### 4.1 高层流程

```
加载 Agents
  ↓
提取工作空间列表（从 project_path）
  ↓
按字母顺序排序
  ↓
恢复上次选中的工作空间（从 AsyncStorage）
  ↓
过滤并显示 Agent 列表
  ↓
用户点击 Chip
  ↓
保存选择 → 过滤列表 → 播放切换动画
```

### 4.2 状态流转

- **All（默认）**：显示所有 Agent
- **特定工作空间**：只显示该工作空间的 Agent
- **空工作空间**：显示空状态提示

## 5. 数据模型与接口

### 5.1 核心数据结构

```typescript
// 工作空间
interface Workspace {
  id: string;          // 工作空间唯一标识（提取的名称）
  name: string;        // 显示名称
  agentCount: number;  // 该工作空间下的 Agent 数量
}

// Agent 扩展（现有类型不变）
interface Agent {
  id: string;
  name: string;
  project_path: string;  // 从这里提取工作空间
  runtime: 'claude-code' | 'codex' | 'cursor-cli' | 'custom';
  created_at: number;
  endpoint_id: string;
  endpoint_label: string;
}
```

### 5.2 AsyncStorage 键

```typescript
const STORAGE_KEY = '@multisoul:selected_workspace';
// 存储格式：string（工作空间 id，'all' 表示 All）
```

### 5.3 工作空间提取规则

```typescript
function extractWorkspace(projectPath: string): string {
  // 1. 如果 project_path 为空或无效，返回 null（该 Agent 将被隐藏）
  if (!projectPath || projectPath.trim() === '') {
    return null;
  }
  
  // 2. 取路径最后一段
  // 例如：/Users/alan/Documents/codes/multisoul → multisoul
  const segments = projectPath.split('/').filter(s => s.length > 0);
  return segments[segments.length - 1] || null;
}
```

## 6. 技术实现概览

### 6.1 整体架构

- **实现位置**：`mobile/src/features/agents/components/AgentList.tsx`
- **实现方式**：单组件实现（在 AgentList 内部管理所有逻辑）
- **状态管理**：React.useState + AsyncStorage（不使用 Zustand）

### 6.2 关键技术决策

1. **工作空间提取**：在组件内部通过 `useMemo` 计算
2. **筛选逻辑**：通过 `useMemo` 根据选中的工作空间过滤 Agent 列表
3. **动画**：使用 React Native Animated API 实现淡入淡出
4. **持久化**：AsyncStorage 读写，组件挂载时恢复，切换时保存

### 6.3 性能优化

- 使用 `useMemo` 缓存工作空间列表和过滤结果
- 使用 `useCallback` 缓存事件处理函数
- 实时过滤（不预计算缓存）

## 7. UI/UX 需求

### 7.1 Chip 筛选器

**位置**：Header 下方，列表上方

**布局**：
- 外层容器：`padding: [12, 16]`，垂直布局，`gap: 8`
- 标签：`WORKSPACE`，字体 Inter 11px 600，颜色 `#666666`
- Chip 行：横向滚动，`gap: 8`

**Chip 样式**：
- 高度：32px
- 圆角：16px（半圆）
- 内边距：`[0, 14]`
- 未选中：背景 `#1A1A1A`，文字 `#DDDDDD` Inter 13px normal
- 选中：背景 `#FF6B35`，文字 `#FFFFFF` Inter 13px 600

**Chip 内容**：
- "All"（固定第一个）
- 其他工作空间按字母顺序排列

### 7.2 空状态

当选中的工作空间没有 Agent 时：

```
┌─────────────────────────────┐
│                             │
│   No agents in this         │
│   workspace                 │
│                             │
└─────────────────────────────┘
```

- 标题：Anton 18px `#FFFFFF`
- 描述：Inter 13px `#888888`
- 居中显示

### 7.3 切换动画

- 列表淡出（200ms）→ 更新数据 → 列表淡入（200ms）
- 使用 `Animated.timing`

### 7.4 设计规范符合性

所有颜色、字体、间距必须符合 `mobile/docs/design.md` 规范：
- 背景色：`#0D0D0D`
- 卡片背景：`#1A1A1A`
- 强调色：`#FF6B35`（仅用于选中状态）
- 文字颜色：`#FFFFFF`、`#DDDDDD`、`#888888`、`#666666`、`#555555`

## 8. 状态、错误与边界情况

### 8.1 常见场景

| 场景 | 处理方式 |
|------|---------|
| Agent 的 project_path 为空 | 隐藏该 Agent（不显示在任何工作空间中） |
| Agent 的 project_path 无效（如 "/"） | 隐藏该 Agent |
| 多个 Agent 提取出相同工作空间名称 | 合并显示在同一工作空间下 |
| 选中的工作空间没有 Agent | 显示空状态提示 |
| AsyncStorage 读取失败 | 默认选中 "All" |
| AsyncStorage 保存失败 | 静默失败，不影响当前筛选 |
| 首次打开（无历史状态） | 默认选中 "All" |

### 8.2 极端情况

- **数百个 Agent**：实时过滤性能足够（O(n) 遍历）
- **工作空间名称过长**：Chip 横向滚动，不截断
- **工作空间名称重复**：按设计合并显示

## 9. 非功能性需求

### 9.1 性能

- 工作空间提取：< 10ms（100 个 Agent）
- 筛选过滤：< 10ms（100 个 Agent）
- 切换动画：流畅 60fps

### 9.2 可访问性

- Chip 按钮支持触摸反馈（`Pressable` 的 `pressed` 状态）
- 空状态文字清晰可读

### 9.3 可维护性

- 工作空间提取逻辑独立为纯函数，便于测试
- 筛选逻辑独立为纯函数，便于测试

## 10. 风险、权衡与未决问题

### 10.1 已知风险

| 风险 | 应对 |
|------|------|
| 工作空间名称冲突（不同路径提取出相同名称） | 按设计合并显示，用户可通过 project_path 区分 |
| 用户期望自定义工作空间名称 | 本期不支持，未来可扩展 |

### 10.2 已做的 trade-off

- **简单 vs 灵活**：选择简单的自动提取，放弃自定义工作空间名称
- **性能 vs 功能**：选择实时过滤，放弃预计算缓存（代码更简单）
- **完整 vs 快速**：隐藏无效 Agent，而不是分配到 "Uncategorized"（减少边界情况）

### 10.3 未决问题

无

## 11. 验收标准与示例

### 11.1 验收 Checklist

- [ ] 打开 Agents 页面，顶部显示所有工作空间 Chip，"All" 默认选中
- [ ] 点击某个工作空间 Chip，列表只显示该工作空间的 Agent
- [ ] 切换工作空间时，列表有平滑的淡入淡出动画
- [ ] 选择空工作空间时，显示 "No agents in this workspace" 提示
- [ ] 关闭 App 再打开，恢复上次选中的工作空间
- [ ] 所有颜色、字体、间距符合 `mobile/docs/design.md` 规范
- [ ] 工作空间按字母顺序排列（All 除外）
- [ ] project_path 为空或无效的 Agent 不显示在列表中
- [ ] 单元测试覆盖工作空间提取逻辑和筛选逻辑

### 11.2 代表性用例

**用例 1：基本筛选**
```
Given: 有 3 个 Agent
  - Agent A: project_path = "/Users/alan/codes/multisoul"
  - Agent B: project_path = "/Users/alan/codes/multisoul"
  - Agent C: project_path = "/Users/alan/codes/project-x"

When: 打开 Agents 页面
Then: 显示 3 个 Chip：All、multisoul、project-x

When: 点击 "multisoul" Chip
Then: 列表只显示 Agent A 和 Agent B
```

**用例 2：状态恢复**
```
Given: 用户上次选择了 "project-x"
When: 关闭 App 再打开
Then: "project-x" Chip 为选中状态，列表只显示 project-x 的 Agent
```

**用例 3：空状态**
```
Given: 工作空间 "empty-project" 下没有 Agent
When: 点击 "empty-project" Chip
Then: 显示 "No agents in this workspace" 提示
```

**用例 4：无效路径**
```
Given: Agent D 的 project_path = ""
When: 打开 Agents 页面
Then: Agent D 不显示在任何工作空间中（包括 All）
```

### 11.3 自动化测试范围

**单元测试**：
- `extractWorkspace()` 函数：测试各种路径格式
- 筛选逻辑：测试 All、特定工作空间、空工作空间
- 工作空间列表生成：测试排序、去重

**集成测试**（可选）：
- 完整的用户交互流程（点击 Chip → 列表更新 → 状态保存）

---

## 附录：实现文件清单

### 需要修改的文件

1. **`mobile/src/features/agents/components/AgentList.tsx`**
   - 添加工作空间提取逻辑
   - 添加 Chip 筛选器 UI
   - 添加筛选交互逻辑
   - 添加状态持久化
   - 添加切换动画
   - 添加空状态处理

### 需要新增的文件

1. **`mobile/src/features/agents/utils/workspaceUtils.ts`**（可选）
   - `extractWorkspace()` 函数
   - `getWorkspaceList()` 函数

2. **`mobile/src/features/agents/utils/workspaceUtils.test.ts`**
   - 单元测试

### 需要更新的文档

1. **`mobile/docs/design.md`**（如有新增颜色或组件）
2. **`ARCHITECTURE.md`**（如有架构变更）
