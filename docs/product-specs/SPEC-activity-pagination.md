# Activity 模块分页滚动加载优化 SPEC

## 1. 背景与目标

### 背景
Activity 模块当前一次性加载全部数据（100-1000 条），在数据量增长时会导致：
- 首屏加载时间过长
- 内存占用过高
- 列表滚动性能下降

### 目标
实现分页滚动加载机制，优化性能和用户体验：
- 首屏快速响应（仅加载 20 条）
- 支持无限滚动，按需加载更多数据
- 保持实时更新能力
- 大数据量下流畅滚动

## 2. 范围

### 2.1 In Scope
- 前端实现分页滚动加载（React Query + FlatList）
- 无限滚动交互（滚动到底部自动加载）
- 加载状态指示器
- 分页加载失败重试
- 防抖/节流机制
- 实时更新与分页数据的冲突处理
- Activity 弱网降级体验：增量加载失败时保留已加载数据，并提供手动重试入口
- FlatList 虚拟滚动性能优化
- 分页缓存机制
- 组件 memo 优化
- 核心逻辑与交互场景的自动化测试

### 2.2 Out of Scope
- 后端 API 改动（利用现有 `limit_per_section` 参数）
- 按 section 独立分页（采用全局分页简化实现）
- 页码分页器 UI（采用无限滚动）
- 离线检测与离线状态 UI（后续优化）
- 全局弱网/离线只读模式（Chat、Agents、Settings、WebSocket 补拉等另开规格）

## 3. 用户与使用场景

### 典型用户角色
- MultiSoul 移动端用户，查看 AI Agent 活动记录

### 关键使用场景

**场景 1：首次进入 Activity 页面**
1. 用户点击 Activity tab
2. 系统加载前 20 条数据（每个 section 各取前 20 条，合并后按时间排序取前 20）
3. 用户看到最新的活动记录
4. 用户向下滚动查看更多

**场景 2：滚动加载更多**
1. 用户滚动到列表底部
2. 系统自动触发加载下一页（防抖 300ms）
3. 底部显示 loading spinner
4. 新数据追加到列表末尾

**场景 3：切换 filter**
1. 用户从 "All" 切换到 "Done"
2. 系统重置分页状态，重新加载第一页
3. 列表滚动到顶部

**场景 4：实时更新**
1. 用户正在浏览 Activity 列表
2. 收到新 activity 推送
3. 新数据插入列表顶部，不影响当前滚动位置和已加载数据

**场景 5：加载失败**
1. 用户滚动到底部触发加载
2. 网络请求失败
3. 已加载 Activity 项继续保留在列表中，不清空首屏数据
4. 底部显示 "加载失败，点击重试" 按钮
5. 用户点击重试，重新发起当前增量页请求

## 4. 业务流程与信息架构

### 高层流程

```
[进入页面] → [加载第一页(limit=20)] → [渲染列表]
                                           ↓
                                    [用户滚动]
                                           ↓
                              [到达底部？] → No → [继续滚动]
                                    ↓ Yes
                              [防抖 300ms]
                                    ↓
                         [加载下一页(limit+=20)]
                                    ↓
                              [追加数据]
                                    ↓
                              [更新列表]
```

### 状态流转

```
idle → loading_first_page → success → idle
                          ↓
                       error → retry → loading_first_page

idle → loading_more → success → idle
                   ↓
                error → show_retry_button → retry → loading_more
```

### Activity 弱网降级流程

```
[已加载第一页或更多数据]
          ↓
[用户触底加载下一页]
          ↓
[请求 limit_per_section += 20]
          ↓
[请求成功？] → Yes → [合并去重并追加展示]
          ↓ No
[保留当前列表数据]
          ↓
[底部展示重试入口]
          ↓
[用户点击重试] → [重新请求同一增量页]
```

本流程只覆盖 Activity 列表的增量分页请求失败。它不改变 endpoint health 判定，不新增系统级离线状态，也不接管 Chat 输入禁用、WebSocket 重连或本地消息缓存策略。

### 页面/模块关系

- **ActivityScreen.tsx**：UI 组件，从 ScrollView 改为 FlatList
- **activityService.ts**：API 调用层，保持不变
- **新增 useActivityInfiniteQuery.ts**：React Query hook，管理分页状态
- **新增 activityPagination.ts**：分页逻辑工具函数

## 5. 数据模型与接口

### 核心实体

**ActivityItem**（前端）
```typescript
interface ActivityItem {
  id: string;
  section: 'attention' | 'running' | 'done';
  projectName: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: 'attention' | 'running' | 'done' | 'failed';
  timestamp: number; // 用于排序
  endpointId: string;
  endpointLabel: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  readAt?: number | null;
  askId?: string;
}
```

**分页状态**
```typescript
interface PaginationState {
  currentPage: number;      // 当前页码（从 1 开始）
  pageSize: number;          // 每页大小（20）
  hasNextPage: boolean;      // 是否有下一页
  isFetchingNextPage: boolean; // 是否正在加载下一页
}
```

### 外部依赖与集成接口

**后端 API**（现有，无需改动）
```
GET /api/v1/activity?limit_per_section={limit}

Response:
{
  items: ActivityApiItem[]
}
```

**前端调用策略**
- 第 1 页：`limit_per_section=20`
- 第 2 页：`limit_per_section=40`（累加）
- 第 3 页：`limit_per_section=60`（累加）
- ...

前端对比新旧数据，提取增量部分追加到列表。

## 6. 技术实现概览

### 整体架构

```
ActivityScreen (FlatList)
    ↓
useActivityInfiniteQuery (React Query)
    ↓
aggregateActivity (activityService.ts)
    ↓
GET /api/v1/activity?limit_per_section={limit}
```

### 关键技术决策

**1. 分页策略：Offset-based（递增 limit）**
- **理由**：后端已有 `limit_per_section` 参数，无需改动后端
- **实现**：每次请求 `limit = page * pageSize`，前端对比新旧数据提取增量
- **权衡**：数据量大时后端查询成本略高，但当前数据量（100-1000）可接受

**2. 状态管理：React Query `useInfiniteQuery`**
- **理由**：内置分页支持、缓存、重试、loading 状态管理
- **实现**：`getNextPageParam` 返回下一页的 limit 值
- **权衡**：引入 React Query 依赖（项目已使用）

**3. 虚拟滚动：FlatList**
- **理由**：React Native 原生组件，性能最佳
- **实现**：替换现有 ScrollView，使用 `onEndReached` 触发加载
- **权衡**：需要重构现有 UI 结构（section header 处理）

**4. 全局分页（非按 section 分页）**
- **理由**：简化实现，用户体验更连贯
- **实现**：合并三个 section 数据后按 timestamp 排序，统一分页
- **权衡**：无法单独控制某个 section 的加载深度

### 重要约束与假设

- **约束**：后端 API 不改动，利用现有 `limit_per_section` 参数
- **约束**：保持现有 filter 和 done filter 功能
- **假设**：数据按 timestamp 倒序排列（最新的在前）
- **假设**：单个 endpoint 的 activity 数量不会超过 10000 条（性能边界）

## 7. UI/UX 需求

### 关键界面/交互说明

**1. 无限滚动**
- 用户滚动到距离底部 100px 时触发加载
- 底部显示 loading spinner（高度 60px，居中）
- 加载完成后 spinner 消失，新数据平滑追加

**2. 加载状态**
- 首次加载：全屏 loading（现有 RefreshControl）
- 加载更多：底部 spinner
- 加载失败：底部显示 "加载失败，点击重试" 按钮（橙色文字）

**3. 空状态**
- 某个 section 无数据时，显示 section 标题 + "暂无数据" 灰色文字
- 全部 section 无数据时，显示全局空状态（现有逻辑）

**4. 实时更新**
- 新 activity 插入列表顶部
- 不触发滚动，不影响用户当前浏览位置
- 新数据带有淡入动画（可选）

### 信息层级与反馈方式

- **主要信息**：Activity 列表项（title、subtitle、status、time）
- **次要信息**：加载状态、错误提示
- **反馈方式**：
  - 加载中：spinner 动画
  - 加载失败：橙色文字 + 可点击重试
  - 加载完成：无提示（数据自然追加）

### 可访问性

- 所有交互元素设置 `accessibilityRole` 和 `accessibilityLabel`
- Loading spinner 设置 `accessibilityLiveRegion="polite"`
- 重试按钮设置 `accessibilityHint="Tap to retry loading more activities"`

## 8. 状态、错误与边界情况

### 常见错误场景

**1. 网络请求失败**
- **触发条件**：网络超时、服务器错误、认证失败
- **用户看到**：底部显示 "加载失败，点击重试"
- **日志记录**：`[ActivityPagination] Load more failed: ${error.message}`
- **处理方式**：保留已加载数据，允许用户重试；重试成功后清除错误状态并追加增量数据

**2. 部分 endpoint 失败**
- **触发条件**：多 endpoint 聚合时，部分 endpoint 不可达
- **用户看到**：顶部 banner 显示失败的 endpoint（现有逻辑）
- **日志记录**：`[ActivityService] Endpoint ${id} failed: ${error}`
- **处理方式**：显示成功 endpoint 的数据 + 失败 banner

**3. 快速滚动触发多次请求**
- **触发条件**：用户快速滚动到底部，触发多次 `onEndReached`
- **用户看到**：只有一个 loading spinner
- **处理方式**：防抖 300ms + React Query 自动去重

### 灰色状态

**1. 加载中途切换 filter**
- **状态**：正在加载第 3 页，用户切换到 "Done" filter
- **处理**：取消当前请求（React Query abort），重置分页，加载新 filter 的第一页

**2. 加载中途收到实时推送**
- **状态**：正在加载第 2 页，收到新 activity 推送
- **处理**：新数据插入顶部，不影响正在加载的第 2 页数据

**3. 已加载全部数据**
- **状态**：`hasNextPage = false`
- **处理**：不再触发 `onEndReached`，底部不显示 loading

### 极端情况

**1. 单个 endpoint 有 10000+ 条 activity**
- **预期行为**：前端分页加载，每次 20 条，理论上可以加载到 10000 条
- **性能边界**：后端查询 `limit_per_section=10000` 时可能超时
- **降级方案**：设置最大页数限制（如 50 页 = 1000 条），超过后显示 "已加载全部数据"

**2. 网络极不稳定（频繁断连）**
- **预期行为**：每次加载失败都显示重试按钮，用户手动重试
- **用户体验**：可能需要多次点击重试
- **当前边界**：不自动判定全局离线，不禁用整个 Activity 页
- **未来优化**：检测离线状态，禁用加载更多或展示统一离线 banner

**3. 实时推送频率极高（每秒多条）**
- **预期行为**：新数据批量插入顶部（防抖 500ms）
- **性能影响**：FlatList 虚拟滚动可以处理大列表
- **未来优化**：限制顶部插入频率，超过阈值时显示 "有 N 条新消息" 提示

## 9. 非功能性需求

### 性能与容量预期

- **首屏加载时间**：< 1s（20 条数据）
- **滚动帧率**：60 FPS（FlatList 虚拟滚动）
- **内存占用**：< 50MB（1000 条数据）
- **数据量级**：支持单个 endpoint 1000+ 条 activity
- **并发请求**：支持 5 个 endpoint 并发聚合

### 安全/权限要求

- 保持现有 Bearer token 认证机制
- 不引入新的安全风险

### 可扩展性

- **未来支持按 section 独立分页**：当前全局分页逻辑可以拆分为 per-section 逻辑
- **未来支持 cursor-based 分页**：后端新增 cursor 参数后，前端可以切换到 cursor 模式
- **未来支持离线缓存**：React Query 缓存可以持久化到 AsyncStorage

### 可维护性

- 分页逻辑封装在独立 hook（`useActivityInfiniteQuery`）
- 工具函数封装在独立文件（`activityPagination.ts`）
- 单元测试覆盖核心逻辑（分页、防抖、实时更新）
- 集成测试覆盖交互场景（滚动加载、filter 切换）

## 10. 风险、权衡与未决问题

### 已知风险与应对思路

**风险 1：后端查询性能**
- **描述**：递增 limit 策略导致后端每次查询全部数据，数据量大时可能慢
- **应对**：当前数据量（100-1000）可接受；未来数据量增长时，改为 cursor-based 分页
- **监控指标**：后端 API 响应时间，超过 2s 时告警

**风险 2：实时更新与分页冲突**
- **描述**：用户正在浏览第 3 页，新数据插入顶部，可能导致数据重复或遗漏
- **应对**：新数据插入顶部时，不影响已加载的分页数据；下次刷新时重新加载全部数据
- **权衡**：可能出现短暂的数据不一致，但用户体验更流畅

**风险 3：FlatList 重构成本**
- **描述**：现有 UI 使用 ScrollView + 手动渲染 section，改为 FlatList 需要重构
- **应对**：使用 FlatList 的 `sections` prop 或 `ListHeaderComponent` 实现 section header
- **预估工作量**：2-3 天

### 已做的 trade-off 及其理由

**Trade-off 1：全局分页 vs 按 section 分页**
- **选择**：全局分页
- **理由**：实现简单，用户体验连贯，当前数据量下性能足够
- **代价**：无法单独控制某个 section 的加载深度

**Trade-off 2：Offset-based vs Cursor-based**
- **选择**：Offset-based（递增 limit）
- **理由**：后端零改动，快速上线
- **代价**：后端查询性能略低，未来需要迁移到 cursor-based

**Trade-off 3：虚拟滚动 vs 普通滚动**
- **选择**：FlatList 虚拟滚动
- **理由**：支持大数据量，性能最佳
- **代价**：需要重构现有 UI 结构

### 仍未决策的问题

**未决 1：最大页数限制**
- **问题**：是否设置最大页数（如 50 页 = 1000 条）？
- **影响**：防止后端查询超时，但可能无法加载全部数据
- **建议**：先不设限制，监控后端性能后再决定

**未决 2：离线检测**
- **问题**：是否需要检测离线状态并禁用加载更多？
- **影响**：提升弱网体验，但增加实现复杂度
- **建议**：后续优化，当前版本先实现基础分页

## 11. 验收标准与示例

### 验收 Checklist

- [ ] **基础功能**
  - [ ] 首次进入页面，加载前 20 条数据
  - [ ] 滚动到底部，自动加载下一页（20 条）
  - [ ] 加载过程中显示 loading spinner
  - [ ] 加载失败显示重试按钮，点击可重试
  - [ ] 切换 filter 时重置分页，重新加载第一页

- [ ] **边界情况**
  - [ ] 快速滚动时不会触发多次请求（防抖 300ms）
  - [ ] 收到新 activity 推送时，插入顶部，不影响已加载数据
  - [ ] 加载中途切换 filter，取消当前请求
  - [ ] 已加载全部数据时，不再触发加载
  - [ ] 弱网下加载下一页失败时，已加载数据不消失
  - [ ] 弱网失败后点击重试，只重试当前增量页，不重置到第一页

- [ ] **性能优化**
  - [ ] FlatList 虚拟滚动，1000 条数据滚动流畅（60 FPS）
  - [ ] 分页缓存生效，切换 filter 后再切回，不重新请求
  - [ ] 组件 memo 生效，滚动时不重新渲染已显示的行

- [ ] **测试覆盖**
  - [ ] 单元测试：分页逻辑、防抖逻辑、数据合并逻辑
  - [ ] 集成测试：滚动加载、filter 切换、实时更新、错误处理

### 代表性用例/场景

**用例 1：正常滚动加载**
1. 进入 Activity 页面
2. 看到前 20 条数据
3. 滚动到底部
4. 看到 loading spinner
5. 1 秒后，新数据追加到列表
6. 继续滚动，重复步骤 3-5

**用例 2：加载失败重试**
1. 进入 Activity 页面
2. 滚动到底部
3. 模拟网络失败
4. 看到 "加载失败，点击重试" 按钮
5. 点击重试
6. 看到 loading spinner
7. 1 秒后，新数据追加到列表

**用例 3：切换 filter**
1. 进入 Activity 页面（All filter）
2. 滚动加载到第 3 页
3. 切换到 Done filter
4. 列表滚动到顶部
5. 看到 Done filter 的前 20 条数据
6. 切换回 All filter
7. 看到缓存的第 3 页数据（不重新请求）

**用例 4：实时更新**
1. 进入 Activity 页面
2. 滚动到第 2 页
3. 收到新 activity 推送
4. 新数据插入列表顶部
5. 当前滚动位置不变
6. 向上滚动，看到新数据

### 自动化验收脚本/测试

**单元测试**
```typescript
// activityPagination.test.ts
describe('mergePages', () => {
  it('should extract incremental data from new page', () => {
    const page1 = [item1, item2];
    const page2 = [item1, item2, item3, item4];
    const result = mergePages([page1, page2]);
    expect(result).toEqual([item1, item2, item3, item4]);
  });
});

describe('debounceLoadMore', () => {
  it('should debounce multiple calls within 300ms', async () => {
    const loadMore = jest.fn();
    const debounced = debounceLoadMore(loadMore, 300);
    debounced();
    debounced();
    debounced();
    await wait(350);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
```

**集成测试**
```typescript
// ActivityScreen.test.tsx
describe('ActivityScreen pagination', () => {
  it('should load more when scrolling to bottom', async () => {
    const { getByTestId } = render(<ActivityScreen />);
    const flatList = getByTestId('activity-list');
    
    // Scroll to bottom
    fireEvent.scroll(flatList, { nativeEvent: { contentOffset: { y: 1000 } } });
    
    // Should show loading
    expect(getByTestId('loading-spinner')).toBeTruthy();
    
    // Wait for data
    await waitFor(() => {
      expect(getByTestId('activity-item-21')).toBeTruthy();
    });
  });

  it('should reset pagination when switching filter', async () => {
    const { getByText, queryByTestId } = render(<ActivityScreen />);
    
    // Load to page 2
    fireEvent.scroll(getByTestId('activity-list'), { nativeEvent: { contentOffset: { y: 1000 } } });
    await waitFor(() => expect(queryByTestId('activity-item-21')).toBeTruthy());
    
    // Switch filter
    fireEvent.press(getByText('Done'));
    
    // Should reset to page 1
    expect(queryByTestId('activity-item-21')).toBeNull();
    expect(queryByTestId('activity-item-1')).toBeTruthy();
  });
});
```
