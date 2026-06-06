# SPEC: Agent / Chat / Activity 状态一致性修复

**日期**：2026-06-06  
**状态**：待实现  
**优先级**：高

---

## 1. 背景

MultiSoul 手机端有三个展示 Agent 运行状态的界面：

| 界面 | 状态来源 |
|------|----------|
| Agent 列表卡片 | 从 `chatStore.conversations` 派生（`projectStatus(conversations)` 计算） |
| Chat 对话详情 | WebSocket 实时消息 + REST 历史加载，经 `resolveConversationStatusFromMessageHistory` 推断 |
| Activity 页 | 独立调用 `/api/v1/activity`（或 legacy agents→conversations 接口） |

三条链路各自独立拉取、各自维护内存状态，更新时机完全不同步。服务端 SQLite 是唯一真相来源（`conversation.status`：`idle / running / awaiting_question / completed / failed`），但移动端三个界面可能长时间持有不一致的快照。

---

## 2. 问题描述

**症状**：用户可以同时看到矛盾的状态，例如：
- Agent 卡片显示 "Running"，Activity 里已显示 "Done"
- Chat 界面任务已完成，Agent 卡片仍为 "Idle"
- 冷启动 / 从后台切回 App 后，三个界面显示不同状态

**触发场景**（全部会复现）：
- 任务刚完成时
- 重新打开 App（冷启动 / 从后台切回）
- 发送新消息后
- WS 断线重连后

**影响**：高——日常使用中频繁可见，影响用户对 Agent 运行状态的判断。

---

## 3. 目标

1. **切换到任意 tab / 进入任意界面时**，三个界面的状态最终与服务端一致。
2. **网络可达时**：后台静默拉取最新状态，完成后更新 UI；用户无感知。
3. **网络不可达时**：保留上次成功拉取的状态，不显示错误提示，不清空当前内容。
4. 无需 loading spinner / skeleton，静默刷新即可。

---

## 4. 非目标

- 实时 WebSocket 广播（将状态推送到所有界面）—— 当前 WS 仅面向活跃对话
- 定时后台轮询（不切 tab 也自动更新）
- 主动告知用户"数据可能过时"的提示横条
- 修改服务端 API 结构

---

## 5. 设计方案

### 5.1 单一数据源

以 `chatStore.conversations` 作为单一数据源，Agent 卡片和 Activity 使用同一份 conversations 快照派生状态，不再各自独立发起 conversations 列表请求。

```
服务端 /api/v1/agents/:id/conversations
        │
        ▼
chatStore.conversations  ◄── WS 实时补丁（现有逻辑）
        │
        ├─ AgentList: projectStatus(conversations) → 卡片状态
        ├─ ChatDetail: conversation.status → 对话状态
        └─ Activity: conversations 派生 ActivityItem
```

### 5.2 触发时机：Screen Focus

在以下三个页面入口各自监听 `useFocusEffect`（expo-router / React Navigation），进入页面时触发一次后台刷新：

| 页面 | 刷新动作 |
|------|----------|
| Agents tab | 为所有当前端点重新拉取 conversations（`GET /api/v1/agents/:id/conversations`） |
| Chat 详情 | 重新拉取当前对话的消息历史（现有 `fetchMessages` 逻辑，确保 `conversation.status` 同步更新） |
| Activity tab | 重新拉取 `/api/v1/activity`（现有 `useActivityInfiniteQuery`，确保 refetch on focus） |

> 备注：Activity 页拉取的 `ActivityApiItem` 仍走自己的 API，但 Agent 卡片的状态须与 chatStore conversations 同步，避免两条独立链路的差异。

### 5.3 错误处理

- 后台刷新请求失败（网络断开、5xx）时：静默忽略，保留 store 现有状态，不 throw。
- 不显示 toast、banner、错误 UI。
- React Query 的 `retry` 配置维持现有策略（默认 3 次），不修改。

### 5.4 加载状态

- 不展示 spinner 或 skeleton。
- `isFetching` / `isRefetching` 值不驱动任何 UI 变化（与现有 Activity RefreshControl 解耦，参见 `ui-pitfalls.md`）。

---

## 6. 主要流程

### 场景 A：任务完成后切换到 Agents tab

1. 用户在 Chat 看到任务完成（`task_status: completed` WS 消息到达，chatStore 更新 `conversation.status = 'completed'`）
2. 用户切换到 Agents tab
3. `useFocusEffect` 触发后台拉取 conversations
4. `chatStore.setConversations` 用新数据覆盖，`projectStatus(conversations)` 重新计算
5. Agent 卡片显示 "Idle"（或对应正确状态）

### 场景 B：冷启动 / 从后台切回

1. App 进入前台，当前 tab 触发 `useFocusEffect`
2. 对应后台拉取执行，所有界面恢复到服务端最新状态
3. 其他 tab 在用户切换过去时再触发各自的 focus 刷新

### 场景 C：网络不可达时切换 tab

1. `useFocusEffect` 触发后台拉取
2. 请求失败，静默忽略
3. UI 继续显示上次成功拉取的状态（chatStore 未被清空）

---

## 7. 边界情况

| 场景 | 期望行为 |
|------|----------|
| 快速连续切换多个 tab | 各 tab 各自触发一次拉取，React Query 去重（`staleTime`/`gcTime` 防重复请求） |
| 服务端返回与本地 WS 状态不同 | 以 REST 拉取结果为准（后到优先，覆盖 WS 中间状态） |
| 多端点（多台机器）时 | 各端点独立拉取，仅更新该端点的 conversations，互不影响 |
| Chat 页面打开时的 WS 实时消息 | WS 仍是 Chat 详情的主更新路径，focus 拉取为补充保底 |
| 端点不可达（offline endpoint） | 该端点拉取失败静默忽略，其他端点正常更新 |

---

## 8. UI/UX 要求

- **无新增 UI 元素**：不引入 loading 指示器、状态提示 banner
- **不影响 Pull-to-Refresh**：现有手动下拉刷新行为保持不变
- **`isFetching` 不触发 RefreshControl**（参见 `mobile/docs/rules/ui-pitfalls.md` 中 RefreshControl 耦合问题）
- 状态标签与现有设计一致：Running / Awaiting answer / Idle / Failed / Done

---

## 9. 验收标准

| # | 场景 | 期望结果 |
|---|------|----------|
| AC-1 | Agent 任务运行完成后，切换到 Agents tab | Agent 卡片状态在 2s 内变为 Idle（无 loading UI） |
| AC-2 | 冷启动 App，直接看到 Agents tab | 5s 内显示服务端最新状态 |
| AC-3 | Activity tab 任务已完成，切换到 Agents tab | Agent 卡片与 Activity 状态一致（均为 Done/Idle） |
| AC-4 | Chat 详情任务完成，切换到 Activity | Activity 1-2 次轮询内显示 Done |
| AC-5 | 断网后切换 tab | 不显示错误，不清空现有状态 |
| AC-6 | 连续快速切换 3 个 tab | 不出现闪烁或竞争条件导致的状态倒退 |

---

## 10. 实现要点（供开发参考）

- 在 `mobile/app/(tabs)/agents.tsx`（或对应路由文件）添加 `useFocusEffect` + conversations 拉取
- 在 `mobile/src/features/activity/hooks/useActivityInfiniteQuery.ts` 确保 React Query `refetchOnWindowFocus`（或 `useFocusEffect` 手动 refetch）已启用
- 在 `mobile/app/agent/[id].tsx`（Chat 详情路由）确认 focus 时触发消息历史重拉，且 `conversation.status` 同步写入 chatStore
- `chatStore.setConversations` / `updateConversation` 须处理 status 覆盖逻辑（REST 拉取结果优先于陈旧 WS 状态）
- 每处修改均需对照 `mobile/docs/rules/ui-pitfalls.md` 排查 RefreshControl 耦合风险

---

## 11. 相关文件

- `mobile/src/store/chatStore.ts` — conversations 状态管理
- `mobile/src/features/agents/components/AgentList.tsx` — `projectStatus()` 派生逻辑
- `mobile/src/features/activity/services/activityService.ts` — Activity 数据拉取
- `mobile/src/features/chat/utils/conversationPreview.ts` — `resolveConversationStatusFromMessageHistory`
- `mobile/src/features/activity/hooks/useActivityInfiniteQuery.ts` — Activity 查询 hook
- `mobile/docs/rules/ui-pitfalls.md` — RefreshControl 耦合警告
