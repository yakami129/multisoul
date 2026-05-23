# Projects-First Navigation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/product-specs/SPEC-ui-projects-navigation.md`](../product-specs/SPEC-ui-projects-navigation.md)

**Goal:** 将 mobile 第一阶段导航从旧 `Agents / Chat / Inbox / Settings` 改为新版 `Projects / Activity / Settings`，App 默认进入 `Projects`，Project 行进入 Project Detail，旧全局 `Agents / Chat / Inbox` Tab 不再出现。

**Architecture:** 不引入新 project 数据模型。复用现有 `agents` 数据、`AgentList`/`AgentCard` 组件和 `agent/[id]` detail route，把 UI 命名与路由入口迁移为 project/workspace 语义。`Activity` 第一阶段可复用现有 Inbox 数据与页面壳，但全局 Tab 文案和 route 语义改为 Activity。

**Tech Stack:** Expo Router Tabs, React Native, React Query, Zustand, Jest + React Native Testing Library, Lucide React Native

---

## 文件清单

**新增文件：**
- `mobile/app/(tabs)/activity.tsx` - 新 Activity Tab route，第一阶段承接旧 Inbox UI/数据

**修改文件：**
- `mobile/app/(tabs)/_layout.tsx` - Tab 收敛为 `Projects / Activity / Settings`
- `mobile/app/(tabs)/index.tsx` - 从 Agents 入口改为 Projects 入口，点击行进入 Project Detail
- `mobile/src/features/agents/components/AgentList.tsx` - UI 文案从 Agents 改为 Projects，空状态改为 `Connect a machine`
- `mobile/src/features/agents/components/AgentCard.tsx` - 卡片信息改为 project/workspace 呈现
- `mobile/app/(tabs)/index.test.tsx` - 更新 Project 行点击行为测试
- `mobile/src/__tests__/navigation.test.tsx` - 更新 Tab 路由/标签测试
- `mobile/src/__tests__/inboxRoute.test.tsx` 或新增对应 Activity route 测试 - 覆盖旧 Inbox 入口迁移

**可能删除/停用文件：**
- `mobile/app/(tabs)/chat.tsx` - 旧全局 Chat Tab 不再作为 Tab 出现
- `mobile/app/(tabs)/inbox.tsx` - 旧 Inbox Tab 被 Activity 替代

---

## Task 1: 锁定导航测试

**Files:**
- Modify: `mobile/src/__tests__/navigation.test.tsx`
- Modify: `mobile/app/(tabs)/index.test.tsx`

- [x] **Step 1: 更新 Tab 测试期望**

将 Tab 测试从旧 `Agents / Settings` 期望改为：

- 渲染 `Projects`
- 渲染 `Activity`
- 渲染 `Settings`
- 不渲染 `Agents`
- 不渲染 `Chat`
- 不渲染 `Inbox`
- 点击 `Activity` 后 active tab 为 `activity`
- Tab bar iOS safe-area 高度测试保持不变

- [x] **Step 2: 更新 Projects 行点击测试**

将 `mobile/app/(tabs)/index.test.tsx` 中“press agent opens chat directly”改为“press project opens project detail”：

- 不再 mock/expect `createConversation`
- 点击 `ALPHA AGENT` 后 expect `router.push` 指向 `/agent/a1?endpoint_id=ep-1`
- 保留 URL/query 编码边界测试，覆盖 endpoint_id 和 agent id

- [x] **Step 3: 运行定向测试，确认先失败**

```bash
cd mobile
pnpm test -- navigation.test.tsx index.test.tsx --watchAll=false
```

Expected: 由于代码仍是旧 Tabs/旧点击行为，测试失败。

---

## Task 2: 收敛 Tab Layout

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx`
- Add: `mobile/app/(tabs)/activity.tsx`
- Remove or disable: `mobile/app/(tabs)/chat.tsx`
- Remove or disable: `mobile/app/(tabs)/inbox.tsx`

- [x] **Step 1: 更新图标和 Tab Screen**

在 `_layout.tsx` 中：

- 使用 lucide `Layers` 作为 `Projects`
- 使用 lucide `Inbox` 作为 `Activity`
- 保留 `Settings`
- 删除 `Chat` Tab Screen
- 删除 `Inbox` Tab Screen
- 将 `index` title 改为 `Projects`
- 新增 `activity` title 为 `Activity`

保留现有 tab bar 尺寸、安全区、字体和颜色约束。

- [x] **Step 2: 新建 Activity route**

创建 `mobile/app/(tabs)/activity.tsx`，第一阶段可从旧 `inbox.tsx` 迁移实现：

- 继续读取 `useInboxStore`
- 继续支持 pending decision 展示和回答
- 页面组件可暂时复用 `InboxScreen`
- route 和 Tab 文案必须是 `Activity`

- [x] **Step 3: 处理旧 Tab route**

移除旧 `chat.tsx` 和 `inbox.tsx` 作为 Tab route。若担心历史入口崩溃，可保留非 Tab 跳转兼容，但不得让旧 `Chat`/`Inbox` 出现在 Tab bar。

- [x] **Step 4: 运行导航测试**

```bash
cd mobile
pnpm test -- navigation.test.tsx --watchAll=false
```

Expected: 新三 Tab 测试通过，iOS tab bar 高度测试继续通过。

---

## Task 3: Projects 入口复用 Agents 数据

**Files:**
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/src/features/agents/components/AgentList.tsx`
- Modify: `mobile/src/features/agents/components/AgentCard.tsx`

- [x] **Step 1: 改 Project 行点击行为**

在 `mobile/app/(tabs)/index.tsx` 中：

- 删除 `createConversation` 和 `buildChatDetailPath` 依赖
- `onAgentPress` 改为 push 到 agent detail route
- 路由参数带上 `endpoint_id`
- 不在 Projects 列表点击时创建 conversation

目标行为：

```ts
router.push(`/agent/${id}?endpoint_id=${endpoint_id}`);
```

- [x] **Step 2: 将 AgentList 文案改为 Projects**

在 `AgentList.tsx` 中：

- loading/error/header 文案从 `AGENTS` 改为 `Projects`
- 计数文案从 `REGISTERED` 改为 project/workspace 语义
- 顶部标题采用第四排大标题风格，避免旧版全大写技术感
- 空状态标题为 `Connect a machine`
- 空状态描述引导扫描 QR 或粘贴 connection string 添加 machine
- 继续复用 workspace filter，但文案不能暴露旧 Agents-first 心智

- [x] **Step 3: 将 AgentCard 呈现为 Project Card**

在 `AgentCard.tsx` 中保持 props 类型不变，先不重命名文件，降低改动面：

- Project 名称仍可来自 `agent.name`
- Runtime badge 显示 agent 类型，例如 `CODEX` / `CLAUDE-CODE`
- 最近任务标题如现有数据不足，第一阶段可保留 `project_path` 或展示可用 fallback，但不要展示 machine 作为主信息
- endpoint/machine 信息降级为辅助或隐藏，避免违反 spec “列表主信息不展示 machine”

- [x] **Step 4: 运行 Projects 测试**

```bash
cd mobile
pnpm test -- index.test.tsx AgentList.test.tsx AgentCard.test.tsx --watchAll=false
```

Expected: Project 行进入 detail，相关组件测试通过。

---

## Task 4: 旧入口兼容与路由清理

**Files:**
- Inspect/Modify: `mobile/src/services/notificationNavigation.ts`
- Inspect/Modify: `mobile/src/__tests__/notificationNavigation.test.ts`
- Inspect/Modify: any tests importing old `(tabs)/chat` or `(tabs)/inbox`

- [x] **Step 1: 搜索旧 Tab 入口引用**

```bash
rg -n "\"/\\(tabs\\)/chat|/chat\\b|name=\\\"chat\\\"|tab-chat|Inbox|Agents" mobile/app mobile/src
```

分类处理：

- `/chat/[id]` detail route 保留
- 旧 global chat tab 引用删除或改为 Projects/Activity
- 旧 inbox tab 引用改为 Activity
- 测试 mock 中的旧 tab label 更新

- [x] **Step 2: 保留必要历史跳转兼容**

如果 notification/deep link 仍会打开 conversation，应继续跳到 `/chat/[id]` detail route，而不是旧全局 Chat Tab。

如果有旧 Inbox 通知入口，应改到 `Activity` 或具体 `/chat/[id]`。

- [x] **Step 3: 运行相关测试**

```bash
cd mobile
pnpm test -- notificationNavigation.test.ts inboxRoute.test.tsx chatDetailRoute.test.tsx --watchAll=false
```

Expected: 通知和 detail route 不因旧 Tab 移除而断裂。

---

## Task 5: 视觉对照与设计规则

**Files:**
- Modify as needed: `AgentList.tsx`, `AgentCard.tsx`, `_layout.tsx`, `activity.tsx`

- [x] **Step 1: 对照设计文档**

检查：

- 颜色只使用 `mobile/docs/design.md` §2 白名单
- Tab bar 保持第四排更矮、更克制的样式
- `Projects / Activity / Settings` 页面标题使用大标题风格
- 主界面不显示 `MULTISOUL` 大品牌字
- 橙色只用于 action / 状态强调

- [x] **Step 2: 对照 pencli 第四排**

视觉目标：

- `Projects` 接近 pencli 第四排 `ptjY3`
- `Activity` 接近 pencli 第四排 `fTndg` / `FCNos`
- `Settings` 不在本阶段重构功能，但 Tab 视觉与新导航一致

- [ ] **Step 3: UI 手工验证**

在 iOS simulator 或 Expo 中验证：

- App 默认落到 `Projects`
- Tab 只有三项
- Project 行点击进入 detail
- 空状态可见并引导 `Connect a machine`
- RefreshControl 不因 focus refetch 显示错误 spinner

---

## Task 6: 全量验证

- [x] **Step 1: TypeScript 检查**

```bash
cd mobile
pnpm typecheck
```

- [x] **Step 2: Mobile 测试**

```bash
cd mobile
pnpm test -- --watchAll=false
```

- [x] **Step 3: 约束检查**

```bash
python3 scripts/check-docs-indices.py
```

If tracked mobile code changes touch design docs covered by hash guard, review the diff and update the relevant design-doc hash per `AGENTS.md`.

---

## 验收标准

- [x] 打开 App 默认进入 `Projects`
- [x] 底部 Tab 仅显示 `Projects / Activity / Settings`
- [x] Tab 图标为 `layers / inbox / settings`
- [x] 旧 `Agents / Chat / Inbox` 全局 Tab 不再出现
- [x] `Projects` 列表使用旧 agents 数据源展示 project/workspace
- [x] Project 行点击进入 `Project Detail`
- [x] 最近聊天入口不出现在全局 Tab，只保留给后续 `Project Detail`
- [x] 空状态显示 `Connect a machine`，并提供添加 machine 的入口
- [ ] `Projects / Activity / Settings` 视觉与 pencli 第四排新 UI 基本一致

---

## 风险与注意事项

- `mobile/app/(tabs)/index.tsx` 当前点击 agent 会直接创建 conversation；这是第一阶段必须改掉的核心行为。
- `Activity` 第一阶段复用 Inbox 数据和组件时，UI 文案不能继续暴露 `Inbox` 作为全局 Tab。
- `AgentList.tsx` 已接近 500 行限制，实施时若继续增长，应拆出 project-specific 小组件或工具，不要硬塞。
- 删除旧 Tab route 前必须搜索通知、测试、deep link 入口，确保 `/chat/[id]` detail route 仍可被直接打开。
- 不要新增 project/activity 后端模型；本阶段只做 mobile 信息架构迁移。
