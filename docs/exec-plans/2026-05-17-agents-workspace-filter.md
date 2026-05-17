# Agents 工作空间筛选功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agents 页面添加工作空间筛选功能，用户可通过顶部 Chip 按钮快速定位特定项目的 Agent

**Architecture:** 在 AgentList 组件内部实现所有逻辑，使用 useMemo 缓存工作空间列表和过滤结果，使用 AsyncStorage 持久化选中状态，使用 Animated API 实现切换动画

**Tech Stack:** React Native, TypeScript, AsyncStorage, Animated API

---

## 文件结构

**新增文件：**
- `mobile/src/features/agents/utils/workspaceUtils.ts` - 工作空间提取和筛选逻辑
- `mobile/src/features/agents/utils/workspaceUtils.test.ts` - 单元测试

**修改文件：**
- `mobile/src/features/agents/components/AgentList.tsx` - 添加 Chip 筛选器 UI 和交互逻辑

---

## Task 1: 工作空间提取逻辑（TDD）

**Files:**
- Create: `mobile/src/features/agents/utils/workspaceUtils.ts`
- Create: `mobile/src/features/agents/utils/workspaceUtils.test.ts`

- [ ] **Step 1: 创建测试文件并写第一个失败测试**

创建 `mobile/src/features/agents/utils/workspaceUtils.test.ts`:

```typescript
import { extractWorkspace } from './workspaceUtils';

describe('extractWorkspace', () => {
  it('should extract workspace name from valid path', () => {
    expect(extractWorkspace('/Users/alan/Documents/codes/multisoul')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app')).toBe('my-app');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`Cannot find module './workspaceUtils'`

- [ ] **Step 3: 创建最小实现**

创建 `mobile/src/features/agents/utils/workspaceUtils.ts`:

```typescript
/**
 * 从 project_path 提取工作空间名称
 * @param projectPath - Agent 的 project_path
 * @returns 工作空间名称，如果路径无效则返回 null
 */
export function extractWorkspace(projectPath: string): string | null {
  if (!projectPath || projectPath.trim() === '') {
    return null;
  }

  const segments = projectPath.split('/').filter((s) => s.length > 0);
  return segments[segments.length - 1] || null;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`PASS`

- [ ] **Step 5: 添加边界情况测试**

在 `workspaceUtils.test.ts` 中添加：

```typescript
  it('should return null for empty or invalid paths', () => {
    expect(extractWorkspace('')).toBeNull();
    expect(extractWorkspace('   ')).toBeNull();
    expect(extractWorkspace('/')).toBeNull();
  });

  it('should handle paths with trailing slashes', () => {
    expect(extractWorkspace('/Users/alan/codes/multisoul/')).toBe('multisoul');
    expect(extractWorkspace('/home/user/projects/my-app///')).toBe('my-app');
  });

  it('should handle Windows-style paths', () => {
    expect(extractWorkspace('C:\\Users\\alan\\codes\\multisoul')).toBe('multisoul');
  });
```

- [ ] **Step 6: 更新实现以支持 Windows 路径**

更新 `workspaceUtils.ts` 中的 `extractWorkspace`:

```typescript
export function extractWorkspace(projectPath: string): string | null {
  if (!projectPath || projectPath.trim() === '') {
    return null;
  }

  // 统一处理 Unix 和 Windows 路径分隔符
  const normalizedPath = projectPath.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter((s) => s.length > 0);
  return segments[segments.length - 1] || null;
}
```

- [ ] **Step 7: 运行所有测试验证通过**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`PASS  5 tests`

- [ ] **Step 8: Commit**

```bash
git add mobile/src/features/agents/utils/
git commit -m "feat(agents): add workspace extraction logic with tests"
```

---

## Task 2: 工作空间列表生成逻辑（TDD）

**Files:**
- Modify: `mobile/src/features/agents/utils/workspaceUtils.ts`
- Modify: `mobile/src/features/agents/utils/workspaceUtils.test.ts`

- [ ] **Step 1: 添加失败测试**

在 `workspaceUtils.test.ts` 中添加：

```typescript
import { extractWorkspace, getWorkspaceList } from './workspaceUtils';
import type { Agent } from '@/types';

describe('getWorkspaceList', () => {
  const mockAgents: Agent[] = [
    {
      id: '1',
      name: 'Agent 1',
      project_path: '/Users/alan/codes/multisoul',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '2',
      name: 'Agent 2',
      project_path: '/Users/alan/codes/multisoul',
      runtime: 'codex',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '3',
      name: 'Agent 3',
      project_path: '/Users/alan/codes/project-x',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
  ];

  it('should generate sorted workspace list', () => {
    const workspaces = getWorkspaceList(mockAgents);
    expect(workspaces).toEqual(['multisoul', 'project-x']);
  });

  it('should deduplicate workspace names', () => {
    const workspaces = getWorkspaceList(mockAgents);
    expect(workspaces.filter((w) => w === 'multisoul')).toHaveLength(1);
  });

  it('should filter out agents with invalid paths', () => {
    const agentsWithInvalid: Agent[] = [
      ...mockAgents,
      {
        id: '4',
        name: 'Invalid Agent',
        project_path: '',
        runtime: 'claude-code',
        created_at: Date.now(),
        endpoint_id: 'ep1',
        endpoint_label: 'MacBook',
      },
    ];
    const workspaces = getWorkspaceList(agentsWithInvalid);
    expect(workspaces).toEqual(['multisoul', 'project-x']);
  });

  it('should return empty array for empty agent list', () => {
    expect(getWorkspaceList([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`Cannot find module 'getWorkspaceList'`

- [ ] **Step 3: 实现 getWorkspaceList**

在 `workspaceUtils.ts` 中添加：

```typescript
import type { Agent } from '@/types';

/**
 * 从 Agent 列表生成工作空间列表
 * @param agents - Agent 列表
 * @returns 按字母顺序排序的工作空间名称数组
 */
export function getWorkspaceList(agents: Agent[]): string[] {
  const workspaceSet = new Set<string>();

  for (const agent of agents) {
    const workspace = extractWorkspace(agent.project_path);
    if (workspace) {
      workspaceSet.add(workspace);
    }
  }

  return Array.from(workspaceSet).sort();
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`PASS  9 tests`

- [ ] **Step 5: Commit**

```bash
git add mobile/src/features/agents/utils/
git commit -m "feat(agents): add workspace list generation logic"
```

---

## Task 3: Agent 筛选逻辑（TDD）

**Files:**
- Modify: `mobile/src/features/agents/utils/workspaceUtils.ts`
- Modify: `mobile/src/features/agents/utils/workspaceUtils.test.ts`

- [ ] **Step 1: 添加失败测试**

在 `workspaceUtils.test.ts` 中添加：

```typescript
import { extractWorkspace, getWorkspaceList, filterAgentsByWorkspace } from './workspaceUtils';

describe('filterAgentsByWorkspace', () => {
  const mockAgents: Agent[] = [
    {
      id: '1',
      name: 'Agent 1',
      project_path: '/Users/alan/codes/multisoul',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '2',
      name: 'Agent 2',
      project_path: '/Users/alan/codes/project-x',
      runtime: 'codex',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
    {
      id: '3',
      name: 'Agent 3',
      project_path: '',
      runtime: 'claude-code',
      created_at: Date.now(),
      endpoint_id: 'ep1',
      endpoint_label: 'MacBook',
    },
  ];

  it('should return all valid agents when workspace is "all"', () => {
    const filtered = filterAgentsByWorkspace(mockAgents, 'all');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('should filter agents by workspace', () => {
    const filtered = filterAgentsByWorkspace(mockAgents, 'multisoul');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('should return empty array for non-existent workspace', () => {
    const filtered = filterAgentsByWorkspace(mockAgents, 'non-existent');
    expect(filtered).toEqual([]);
  });

  it('should exclude agents with invalid paths', () => {
    const filtered = filterAgentsByWorkspace(mockAgents, 'all');
    expect(filtered.find((a) => a.id === '3')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`Cannot find module 'filterAgentsByWorkspace'`

- [ ] **Step 3: 实现 filterAgentsByWorkspace**

在 `workspaceUtils.ts` 中添加：

```typescript
/**
 * 按工作空间筛选 Agent
 * @param agents - Agent 列表
 * @param workspace - 工作空间名称，'all' 表示显示所有
 * @returns 筛选后的 Agent 列表
 */
export function filterAgentsByWorkspace(agents: Agent[], workspace: string): Agent[] {
  if (workspace === 'all') {
    // 返回所有有效路径的 Agent
    return agents.filter((agent) => extractWorkspace(agent.project_path) !== null);
  }

  return agents.filter((agent) => extractWorkspace(agent.project_path) === workspace);
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd mobile
pnpm test workspaceUtils.test.ts --watchAll=false
```

预期输出：`PASS  13 tests`

- [ ] **Step 5: 运行完整测试套件**

```bash
cd mobile
pnpm test --watchAll=false
```

预期输出：所有测试通过

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/agents/utils/
git commit -m "feat(agents): add agent filtering logic by workspace"
```

---

## Task 4: Chip 筛选器 UI 组件

**Files:**
- Modify: `mobile/src/features/agents/components/AgentList.tsx:1-184`

- [ ] **Step 1: 添加 AsyncStorage 和 Animated 导入**

在 `AgentList.tsx` 顶部添加导入：

```typescript
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getWorkspaceList, filterAgentsByWorkspace } from '../utils/workspaceUtils';
```

- [ ] **Step 2: 添加状态和常量**

在 `AgentList` 组件内部，`handleRefresh` 之后添加：

```typescript
const STORAGE_KEY = '@multisoul:selected_workspace';
const [selectedWorkspace, setSelectedWorkspace] = React.useState<string>('all');
const [fadeAnim] = React.useState(new Animated.Value(1));
```

- [ ] **Step 3: 添加工作空间列表计算**

在状态声明之后添加：

```typescript
const workspaces = React.useMemo(() => getWorkspaceList(agents), [agents]);

const filteredAgents = React.useMemo(
  () => filterAgentsByWorkspace(agents, selectedWorkspace),
  [agents, selectedWorkspace]
);
```

- [ ] **Step 4: 添加状态恢复逻辑**

在 `useMemo` 之后添加：

```typescript
// 恢复上次选中的工作空间
React.useEffect(() => {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((value) => {
      if (value && (value === 'all' || workspaces.includes(value))) {
        setSelectedWorkspace(value);
      }
    })
    .catch(() => {
      // 静默失败，使用默认值 'all'
    });
}, [workspaces]);
```

- [ ] **Step 5: 添加工作空间切换处理函数**

在 `useEffect` 之后添加：

```typescript
const handleWorkspaceChange = React.useCallback(
  (workspace: string) => {
    if (workspace === selectedWorkspace) return;

    // 淡出动画
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      // 更新选中的工作空间
      setSelectedWorkspace(workspace);

      // 保存到 AsyncStorage
      AsyncStorage.setItem(STORAGE_KEY, workspace).catch(() => {
        // 静默失败
      });

      // 淡入动画
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  },
  [selectedWorkspace, fadeAnim]
);
```

- [ ] **Step 6: 添加 Chip 组件渲染函数**

在 `handleWorkspaceChange` 之后添加：

```typescript
const renderWorkspaceChip = (workspace: string, label: string) => {
  const isSelected = selectedWorkspace === workspace;
  return (
    <Pressable
      key={workspace}
      onPress={() => handleWorkspaceChange(workspace)}
      style={({ pressed }) => [
        s.chip,
        isSelected && s.chipSelected,
        pressed && s.chipPressed,
      ]}
    >
      <Text style={[s.chipText, isSelected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
};
```

- [ ] **Step 7: Commit**

```bash
git add mobile/src/features/agents/components/AgentList.tsx
git commit -m "feat(agents): add workspace filter state and handlers"
```

---

## Task 5: 集成 Chip 筛选器到 UI

**Files:**
- Modify: `mobile/src/features/agents/components/AgentList.tsx:82-124`

- [ ] **Step 1: 在 Header 下方添加 Chip 筛选器**

找到 `return` 语句中的 `<View style={s.header}>` 部分，在其后添加：

```typescript
      {/* Workspace Filter */}
      <View style={s.filterSection}>
        <Text style={s.filterLabel}>WORKSPACE</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScrollContent}
        >
          {renderWorkspaceChip('all', 'All')}
          {workspaces.map((workspace) => renderWorkspaceChip(workspace, workspace))}
        </ScrollView>
      </View>
```

- [ ] **Step 2: 用 Animated.View 包裹 FlatList**

将现有的 `<FlatList>` 替换为：

```typescript
      <Animated.View style={[s.listContainer, { opacity: fadeAnim }]}>
        <FlatList
          data={filteredAgents}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AgentCard
              agent={item}
              onPress={() => onAgentPress(item.id, item.endpoint_id, item.name)}
            />
          )}
          ItemSeparatorComponent={AgentCardSeparator}
          scrollEnabled={filteredAgents.length > 0}
          bounces={filteredAgents.length > 0}
          alwaysBounceVertical={filteredAgents.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                void handleRefresh();
              }}
              tintColor="#FF6B35"
              colors={['#FF6B35']}
            />
          }
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              <Text style={s.emptyTitle}>
                {selectedWorkspace === 'all'
                  ? 'NO AGENTS REGISTERED'
                  : 'NO AGENTS IN THIS WORKSPACE'}
              </Text>
              <Text style={s.emptyDesc}>
                {selectedWorkspace === 'all'
                  ? 'Register your first agent via the CLI or API.'
                  : `No agents found in the "${selectedWorkspace}" workspace.`}
              </Text>
            </View>
          }
          contentContainerStyle={filteredAgents.length === 0 ? s.emptyContainer : s.listContent}
        />
      </Animated.View>
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/features/agents/components/AgentList.tsx
git commit -m "feat(agents): integrate workspace chip filter into UI"
```

---

## Task 6: 添加样式

**Files:**
- Modify: `mobile/src/features/agents/components/AgentList.tsx:128-184`

- [ ] **Step 1: 添加 Chip 筛选器样式**

在 `StyleSheet.create` 中添加新样式（在 `emptyDesc` 之后）：

```typescript
  filterSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#0D0D0D',
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E1E',
  },
  filterLabel: {
    fontFamily: 'Inter',
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    letterSpacing: 1.5,
  },
  chipScrollContent: {
    gap: 8,
    paddingRight: 16,
  },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: '#FF6B35',
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: 'normal',
    color: '#DDDDDD',
  },
  chipTextSelected: {
    fontWeight: '600',
    color: '#FFFFFF',
  },
  listContainer: {
    flex: 1,
  },
```

- [ ] **Step 2: 运行 TypeScript 检查**

```bash
cd mobile
pnpm typecheck
```

预期输出：无错误

- [ ] **Step 3: Commit**

```bash
git add mobile/src/features/agents/components/AgentList.tsx
git commit -m "feat(agents): add workspace filter styles"
```

---

## Task 7: 手动测试与验证

**Files:**
- Test: `mobile/src/features/agents/components/AgentList.tsx`

- [ ] **Step 1: 启动开发服务器**

```bash
cd mobile
pnpm start
```

在另一个终端运行：

```bash
cd mobile
pnpm ios
```

- [ ] **Step 2: 验证基本功能**

手动测试清单：
- [ ] 打开 Agents 页面，顶部显示工作空间 Chip
- [ ] "All" 默认选中（橙色背景）
- [ ] 点击其他工作空间 Chip，列表更新
- [ ] 切换时有淡入淡出动画
- [ ] 选择空工作空间时显示 "NO AGENTS IN THIS WORKSPACE"

- [ ] **Step 3: 验证状态持久化**

手动测试清单：
- [ ] 选择某个工作空间（非 All）
- [ ] 关闭 App（完全退出）
- [ ] 重新打开 App
- [ ] 验证上次选中的工作空间仍然选中

- [ ] **Step 4: 验证边界情况**

手动测试清单：
- [ ] 所有 Agent 的 project_path 都无效时，只显示 "All" Chip
- [ ] 工作空间名称很长时，Chip 可以横向滚动
- [ ] 快速点击多个 Chip，动画不会卡顿或重叠

- [ ] **Step 5: 验证设计规范**

对照 `mobile/docs/design.md` 检查：
- [ ] 所有颜色符合规范（#0D0D0D, #1A1A1A, #FF6B35, #DDDDDD, #FFFFFF, #666666）
- [ ] 字体符合规范（Inter）
- [ ] 间距符合规范（12px, 16px, 8px）
- [ ] Chip 圆角 16px（半圆）

- [ ] **Step 6: 运行完整测试套件**

```bash
cd mobile
pnpm test --watchAll=false
```

预期输出：所有测试通过

- [ ] **Step 7: 运行 TypeScript 检查**

```bash
cd mobile
pnpm typecheck
```

预期输出：无错误

- [ ] **Step 8: 最终 Commit**

```bash
git add -A
git commit -m "feat(agents): complete workspace filter feature with tests"
```

---

## 验收标准检查

完成所有任务后，对照 SPEC 文档的验收标准逐项检查：

- [ ] 打开 Agents 页面，顶部显示所有工作空间 Chip，"All" 默认选中
- [ ] 点击某个工作空间 Chip，列表只显示该工作空间的 Agent
- [ ] 切换工作空间时，列表有平滑的淡入淡出动画
- [ ] 选择空工作空间时，显示 "No agents in this workspace" 提示
- [ ] 关闭 App 再打开，恢复上次选中的工作空间
- [ ] 所有颜色、字体、间距符合 `mobile/docs/design.md` 规范
- [ ] 工作空间按字母顺序排列（All 除外）
- [ ] project_path 为空或无效的 Agent 不显示在列表中
- [ ] 单元测试覆盖工作空间提取逻辑和筛选逻辑

---

## 实施注意事项

1. **严格遵循 TDD**：每个逻辑函数都先写测试，再写实现
2. **频繁 Commit**：每完成一个小步骤就 commit
3. **保持 DRY**：工作空间提取逻辑只在 `workspaceUtils.ts` 中实现一次
4. **YAGNI**：不添加 SPEC 中未要求的功能（如自定义工作空间名称）
5. **类型安全**：所有函数都有明确的类型签名
6. **错误处理**：AsyncStorage 操作失败时静默处理，不影响用户体验
7. **性能**：使用 `useMemo` 和 `useCallback` 避免不必要的重新计算

---

## 故障排查

**问题：测试失败 "Cannot find module '@/types'"**
- 解决：确保 `mobile/tsconfig.json` 中配置了路径别名

**问题：AsyncStorage 导入错误**
- 解决：运行 `cd mobile && pnpm install @react-native-async-storage/async-storage`

**问题：动画卡顿**
- 解决：确保 `useNativeDriver: true` 已设置

**问题：Chip 文字被截断**
- 解决：检查 `chipText` 样式，确保没有设置 `maxWidth`
