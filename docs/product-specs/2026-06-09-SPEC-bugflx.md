# SPEC: bugflx — 移动端文案、布局与端点在线检测修复

**日期**：2026-06-09  
**状态**：已完成  
**优先级**：中  
**模块**：`mobile/`  
**关联对话**：`12df5cbe-02e7-4c5d-ada5-3d3bae4684f0`

---

## 1. 背景

用户反馈移动端多处体验问题，涉及**文案语义**、**布局间距**与**端点在线状态不可信**：

| # | 区域 | 问题 |
|---|------|------|
| 1 | Agents → 快速工作流 | 卡片命名为「每日站会」，实际跳转到自动化工作流列表，语义误导 |
| 2 | Settings → 端点 | Hero 统计含「推送就绪」；行内状态为 Live/Idle；且 `pingAllEndpoints` **从未被调用**，`last_seen_at` 几乎不更新，导致可达端点也长期显示离线 |
| 3 | Activity → Done 筛选 | 未读/已读子筛选与下方卡片列表间距过紧 |

**根因（端点在线）**：`endpointService.pingAllEndpoints` 与 `endpointStore.updateLastSeen` 已实现，但无调用方；添加端点 healthz 成功后仍写入 `last_seen_at = NULL`。

---

## 2. 目标

1. 快速工作流入口命名准确反映「自动化工作流」语义。
2. Settings 端点状态统一为**在线 / 离线**二元模型；Hero 统计清晰展示设备数与在线/离线计数。
3. **接通 `last_seen_at` 刷新链路**，使 Settings 在线状态反映真实可达性。
4. Activity Done 子筛选与卡片列表之间增加视觉呼吸感（+12px）。

---

## 3. 非目标

- 不修改快速工作流卡片的跳转目标（仍为 `/workflows`）。
- 不修改在线判定阈值（仍为 `last_seen_at` 60 秒内视为在线）。
- 不统一 Specs `TargetPicker`、Activity、Chat 等模块的离线定义——**仅修 Settings 展示所依赖的 `last_seen_at` 数据**。
- 不引入定时后台 ping（如每 30s 轮询）。
- 不修改端点行图标、颜色样式（lime=在线、cyan=离线可保留）。
- 不调整 Activity Done 子筛选内部（未读/已读分段、全部标为已读）间距，除非实现时发现 +12px 不足。

---

## 4. 需求详情

### 4.1 快速工作流卡片重命名

**现状**（`AgentList.tsx` + i18n）：

- 标题：`agents.dailyStandup` → 「每日站会」/ "Daily Standup"
- 副标题：`agents.dailyStandupSubtitle` → 「获取所有智能体和任务的进展。」
- 行为：`onOpenWorkflows` → `router.push('/workflows')`

**目标文案**：

| 键 | 英文 | 简体中文 |
|----|------|----------|
| `agents.dailyStandup`（可重命名为 `agents.automations` 或保留键名仅改值） | **Automations** | **自动化工作流** |
| `agents.dailyStandupSubtitle` | View and manage scheduled automations. | 查看与管理定时自动化任务。 |

**实现约束**：

- 优先复用现有 i18n 键并更新值，避免大范围键名迁移；若重命名键，须同步更新 `AgentList.tsx`、测试与 `mobile/docs/design.md` §6.2 引用。
- `QuickWorkflowCard` 标题与副标题仍保持单行（`numberOfLines={1}`，见 `design.md`）。

### 4.2 Settings 端点状态与统计

**Hero 区**（`app/(tabs)/settings.tsx`）：

- **移除**「推送就绪」/`settings.pushReady` 展示。
- **改为**：`{N} {台设备|台设备} · {M} {在线} · {K} {离线}`
  - `N` = `endpoints.length`
  - `M` = 在线端点数（`last_seen_at` 60 秒内）
  - `K` = `N - M`
- 使用 i18n，支持单复数（沿用 `settings.machine` / `settings.machines` 或等价键）。

**端点列表行**（`EndpointList.tsx`）：

- 状态 pill 文案：`Live` → **在线**（en: **Online**）；`Idle` → **离线**（en: **Offline**）。
- 必须通过 `react-i18next` 读取，禁止硬编码英文。
- 建议新增键：`settings.online`、`settings.offline`（或与 `settings.live` 对齐后废弃 `live` 键）。

**在线判定**（阈值不变，须抽为共享函数避免重复）：

```ts
endpoint.last_seen_at !== null && Date.now() - endpoint.last_seen_at < 60_000
```

### 4.3 端点在线检测（接通 `last_seen_at` 刷新）

**现状**：

- `pingAllEndpoints()` 对每个端点请求 `GET /api/v1/healthz`（5s 超时，无需 Bearer），成功则 `updateLastSeen(id, Date.now())`。
- 全仓库无调用方；`addEndpoint` 在 healthz 已通过的情况下仍插入 `last_seen_at = NULL`。

**目标**：在以下时机刷新 `last_seen_at`（用户已确认）：

| 时机 | 行为 |
|------|------|
| App 启动 | `loadEndpoints()` 完成后调用 `pingAllEndpoints()` |
| 从后台回前台 | `AppState` 变为 `active` 时调用 `pingAllEndpoints()` |
| 进入 Settings 页 | `useFocusEffect` 触发 `pingAllEndpoints()` |
| 添加端点 healthz 成功 | 写入端点后立即 `updateLastSeen(id, Date.now())` |
| 任意对该端点的成功 API 调用 | 通过 `getEndpointClient` 响应拦截器，按 `base_url` 匹配端点并 `updateLastSeen` |

**实现约束**：

- `pingAllEndpoints` 须**静默**执行：失败不弹窗、不清空端点列表。
- 并发：允许多触发源同时调用；实现须幂等（重复 `updateLastSeen` 无害）。可选去抖（如 5s 内同端点不重复写 DB）。
- `endpointClient` 拦截器仅对 **2xx 响应** 更新 `last_seen_at`；须能从 `config.baseURL` 反查 `endpoint.id`（建议规范化 URL 后匹配 `endpointStore.endpoints`）。
- 将 `endpointOnline()` 抽到共享模块（如 `mobile/src/features/settings/services/endpointLiveness.ts`），`settings.tsx` 与 `EndpointList.tsx` 共用。
- **不修改** `TargetPickerSheet` 的 `offline = !last_seen_at && !agentEndpointIds.has(...)` 逻辑。
- **不修改** Activity `failedEndpoints` 或 Chat WebSocket 离线判定。

**失败语义**（保持现有设计）：

- ping / API 失败时不改写 `last_seen_at`；超过 60s 未刷新则自然显示离线。

### 4.4 Activity Done 子筛选间距

**现状**（`activityScreenStyles.ts`）：

- `doneHeader: { gap: 8 }` — 仅控制子筛选内部元素间距
- 列表 `content: { gap: 0 }` — 第一张卡片紧贴 `ListHeaderComponent`

**目标**：

- 在 Done 子筛选区域（`doneHeader`）与下方第一张 Activity 卡片之间增加 **12px** 垂直间距。
- 推荐实现：`doneHeader` 增加 `marginBottom: 12`（或等效 `paddingBottom`），仅当 `activeFilter === 'done'` 时生效（已在 `ActivityScreen.tsx` 条件渲染内）。
- 不影响 Pending / Running / All 筛选的布局。

---

## 5. 主要用户流程

### 流程 A：从 Agents 进入自动化工作流

1. 用户打开 Agents 标签页，滚动至「快速工作流」区块。
2. 看到卡片标题「自动化工作流」，副标题说明定时自动化。
3. 点击卡片 → 进入 Workflows 列表页。

### 流程 B：在 Settings 查看端点状态

1. 用户打开 Settings → 触发 `pingAllEndpoints`。
2. Hero 显示例如「2 台设备 · 1 在线 · 1 离线」。
3. 端点列表中，可达端点显示「在线」pill；不可达显示「离线」pill。
4. 无「推送就绪」文案。

### 流程 D：添加端点后立即可见在线

1. 用户扫码或手动添加端点，healthz 成功。
2. `addEndpoint` 写入记录并 `updateLastSeen(id, now)`。
3. 返回 Settings 时该行显示「在线」（无需等待额外 ping）。

### 流程 E：使用 App 时间接刷新在线状态

1. 用户在 Agents / Activity 等页成功拉取数据（经 `getEndpointClient`）。
2. 响应拦截器更新对应端点 `last_seen_at`。
3. 用户进入 Settings 时，该端点显示「在线」（若 60s 内有过成功请求）。

### 流程 C：在 Activity 浏览 Done 完成项

1. 用户切换到 Activity，点选 Done 筛选。
2. 看到未读/已读子筛选与「全部标为已读」（若有未读）。
3. 子筛选与下方第一张卡片之间有清晰可见的 12px 间距。

---

## 6. 边界情况

| 场景 | 期望 |
|------|------|
| 0 个端点 | Hero 显示 `0 台设备 · 0 在线 · 0 离线`（或等价 i18n 组合） |
| 全部在线 | Hero `K=0`；所有行显示「在线」 |
| 全部离线 | Hero `M=0`；所有行显示「离线」 |
| 仅 1 台设备 | 使用单数「台设备」文案 |
| Done 无条目 | 子筛选仍渲染（若现有逻辑保留），间距规则不变；空状态文案不受影响 |
| 英文语言 | 全部新文案走 `en.json`，与中文键对称 |
| 端点刚添加 | `last_seen_at` 立即有值，Settings 显示在线 |
| 端点宕机 | 60s 内无成功 ping/API → Settings 显示离线；Activity 仍可能显示 `failedEndpoints` banner（行为不变） |
| 多触发源连续 ping | 不崩溃、不重复弹错；`last_seen_at` 单调更新 |

---

## 7. UI/UX 要求

- 遵守 `mobile/docs/design.md` §2 颜色白名单；不引入新色。
- Settings 状态 pill 尺寸、圆角、字号保持现有 22px pill / Inter 10px/700 规范。
- Activity 间距增量为 12px，对齐 4px 网格（12 = 3×4）。
- iOS 文案长度：Hero 统计与 pill 文案在 iPhone SE 宽度下不截断关键数字（可用 `numberOfLines` + 合理缩写）。

---

## 8. 验收标准

| # | 场景 | 期望结果 |
|---|------|----------|
| AC-1 | Agents 页快速工作流区块（中文） | 标题为「自动化工作流」，副标题不含「站会」 |
| AC-2 | Agents 页快速工作流区块（英文） | 标题为 "Automations"，副标题描述 scheduled automations |
| AC-3 | 点击自动化工作流卡片 | 导航至 `/workflows`，行为与改前一致 |
| AC-4 | Settings Hero（2 端点，1 在线 1 离线，中文） | 显示「2 台设备 · 1 在线 · 1 离线」，无「推送就绪」 |
| AC-5 | Settings 端点行（在线） | pill 显示「在线」/ "Online" |
| AC-6 | Settings 端点行（离线） | pill 显示「离线」/ "Offline"，无 Live/Idle 残留 |
| AC-7 | Activity Done 筛选有卡片 | 子筛选底缘至首张卡片顶缘视觉间距 ≥ 12px |
| AC-8 | 切换系统语言 | 上述文案随语言切换立即更新 |
| AC-9 | 添加端点 healthz 成功后 | `last_seen_at` 非 null；Settings 显示在线 |
| AC-10 | App 启动且端点可达 | `pingAllEndpoints` 被调用；60s 内 Settings 显示在线 |
| AC-11 | 从后台回前台 | 再次调用 `pingAllEndpoints` |
| AC-12 | 经 `getEndpointClient` 成功请求后 | 对应端点 `last_seen_at` 更新 |
| AC-13 | Specs TargetPicker 离线逻辑 | 与改前一致（不因本 spec 改变禁用规则） |

---

## 9. E2E 功能测试用例

### E2E-1：快速工作流卡片文案与导航

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-1, AC-2, AC-3 |
| 用户场景 | 用户从 Agents 页进入自动化工作流管理 |
| 前置条件 | App 已启动；语言分别为 zh / en 各测一次；`router` 可 mock |
| 操作步骤 | 1. 渲染 Agents 主页（`index.tsx` / `AgentList`）<br>2. 断言快速工作流第一张卡片文案<br>3. `fireEvent.press` 卡片<br>4. 断言 `router.push('/workflows')` |
| 预期结果 | zh: 「自动化工作流」；en: "Automations"；无 "Daily Standup"/「每日站会」；导航正确 |
| 目标层级 | Mobile |
| 自动化提示 | `AgentList.test.tsx`；`getByText('Automations')` / `getByText('自动化工作流')`；mock `onOpenWorkflows` |

### E2E-2：Settings Hero 在线/离线统计

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-4 |
| 用户场景 | 用户查看指挥台摘要 |
| 前置条件 | `endpointStore` 种子：2 端点，`last_seen_at` 分别为 now 与 null |
| 操作步骤 | 1. 渲染 `SettingsScreen`<br>2. 查询 Hero meta 文本 |
| 预期结果 | 含「2 台设备 · 1 在线 · 1 离线」；`queryByText('推送就绪')` 为 null |
| 目标层级 | Mobile |
| 自动化提示 | `settings.test.tsx`；seed `useEndpointStore`；`getByText` 正则匹配 meta |

### E2E-3：Settings 端点行状态 pill

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-5, AC-6 |
| 用户场景 | 用户辨认单台设备是否在线 |
| 前置条件 | 1 在线端点 + 1 离线端点 |
| 操作步骤 | 1. 渲染 `EndpointList` 或 `SettingsScreen`<br>2. 分别断言两行 pill 文案 |
| 预期结果 | 在线行「在线」/ "Online"；离线行「离线」/ "Offline"；无 Live/Idle |
| 目标层级 | Mobile |
| 自动化提示 | 新建或扩展 `EndpointList` 测试；`getAllByText` |

### E2E-4：Activity Done 子筛选间距

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-7 |
| 用户场景 | 用户在 Done 列表阅读已完成任务 |
| 前置条件 | Activity mock 含 ≥1 条 done 未读项 |
| 操作步骤 | 1. 渲染 `ActivityScreen`，`activeFilter='done'`<br>2. 读取 `doneHeader` 与首张卡片 layout（`marginBottom` 或 snapshot style） |
| 预期结果 | `doneHeader` 含 `marginBottom: 12`（或等效）；首张卡片不被子筛选遮挡 |
| 目标层级 | Mobile |
| 自动化提示 | `ActivityScreen.test.tsx`；style 断言或 `testID="activity-done-header"` |

### E2E-5：添加端点写入 last_seen_at

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-9 |
| 用户场景 | 用户新连接一台可达机器 |
| 前置条件 | mock healthz 成功 |
| 操作步骤 | 1. 调用 `addEndpoint`<br>2. 读取 store 中该端点 `last_seen_at` |
| 预期结果 | `last_seen_at` 为最近时间戳（非 null） |
| 目标层级 | Mobile |
| 自动化提示 | `endpointStore` 单元测试；mock `updateLastSeen` 或查 DB |

### E2E-6：pingAllEndpoints 在启动与 Settings focus 时调用

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-10, AC-11 |
| 用户场景 | 用户打开 App 或进入 Settings 刷新端点状态 |
| 前置条件 | mock `pingAllEndpoints`；种子 1 个端点 |
| 操作步骤 | 1. 模拟 `_layout` 启动 effect<br>2. 模拟 Settings `useFocusEffect`<br>3. 断言 mock 调用次数 |
| 预期结果 | 启动至少 1 次；进入 Settings 再 1 次 |
| 目标层级 | Mobile |
| 自动化提示 | jest.mock `endpointService`；`settings.test.tsx` / `_layout` 测试 |

### E2E-7：endpointClient 成功响应刷新 last_seen_at

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-12 |
| 用户场景 | 用户拉取 agents/activity 后 Settings 反映在线 |
| 前置条件 | 种子端点；mock axios 2xx |
| 操作步骤 | 1. `getEndpointClient(base, token).get('/api/v1/agents')` 成功<br>2. 读 store `last_seen_at` |
| 预期结果 | 匹配端点的 `last_seen_at` 已更新 |
| 目标层级 | Mobile |
| 自动化提示 | `endpointClient` 或 `agentService.test.ts` 扩展 |

### E2E-8：语言切换回归

| 字段 | 内容 |
|------|------|
| 关联验收 | AC-8 |
| 用户场景 | 用户在设置中切换语言后文案同步 |
| 前置条件 | `languageStore` 可切换 |
| 操作步骤 | 1. zh 下断言 AC-1/AC-4/AC-5<br>2. 切 en<br>3. 重新断言英文文案 |
| 预期结果 | 所有受影响文案随语言变化，无硬编码残留 |
| 目标层级 | Mobile |
| 自动化提示 | `i18n` test helper；`setLanguage('en')` |

---

## 10. 实现要点（供开发参考）

| 文件 | 变更 |
|------|------|
| `mobile/src/i18n/locales/en.json` | 更新/新增 automations、online、offline、hero meta 相关键 |
| `mobile/src/i18n/locales/zh.json` | 同上（中文） |
| `mobile/src/features/agents/components/AgentList.tsx` | 使用更新后的 i18n 键（若重命名） |
| `mobile/app/(tabs)/settings.tsx` | Hero meta；`useFocusEffect` → `pingAllEndpoints` |
| `mobile/app/_layout.tsx` | 启动 + `AppState` active → `pingAllEndpoints` |
| `mobile/src/store/endpointStore.ts` | `addEndpoint` 成功后 `updateLastSeen` |
| `mobile/src/features/settings/services/endpointService.ts` | 导出 `pingAllEndpoints`、`endpointOnline`（或抽到 liveness 模块） |
| `mobile/src/api/endpointClient.ts` | 响应拦截器 → `updateLastSeen` |
| `mobile/src/features/settings/components/EndpointList.tsx` | pill 文案改 i18n；共用 `endpointOnline` |
| `mobile/src/features/activity/components/activityScreenStyles.ts` | `doneHeader` +12px 底部间距 |
| `mobile/docs/design.md` §6.2 | Daily Standup → Automations 引用 |
| 测试文件 | `endpointStore.test.ts`、`settings.test.tsx`、`endpointService.test.ts`、`ActivityScreen.test.tsx` 等 |

**验证命令**：

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
```

---

## 11. 相关文件

- `mobile/src/features/agents/components/AgentList.tsx`
- `mobile/app/_layout.tsx`
- `mobile/app/(tabs)/settings.tsx`
- `mobile/src/store/endpointStore.ts`
- `mobile/src/api/endpointClient.ts`
- `mobile/src/features/settings/services/endpointService.ts`
- `mobile/src/features/settings/components/EndpointList.tsx`
- `mobile/src/features/activity/components/ActivityScreen.tsx`
- `mobile/src/features/activity/components/activityScreenStyles.ts`
- `mobile/docs/design.md`
