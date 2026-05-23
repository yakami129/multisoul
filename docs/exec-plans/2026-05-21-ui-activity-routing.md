# Activity Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/product-specs/SPEC-ui-activity-routing.md`](../product-specs/SPEC-ui-activity-routing.md)

**Goal:** 将 Activity 从旧 Inbox 包装页改为全局状态索引，按 `Needs Attention`、`Running`、`Done` 三段展示，并一跳回到对应 Chat 工作现场。

**Architecture:** 不新增后端模型。`Needs Attention` 继续来自 `inboxStore.items` 的 pending decision；`Running` / `Done` 来自 `chatStore.conversations`；点击 Activity item 使用现有 `/chat/[id]` route。Pending decision 增加 `focus_ask_id` 查询参数，Chat Detail 根据 ask id 滚动到对应决策卡片。

**Tech Stack:** Expo Router, React Native, Zustand, Jest + React Native Testing Library

---

## Task 1: Activity 分段 UI

**Files:**
- Add: `mobile/src/features/activity/components/ActivityScreen.tsx`
- Modify: `mobile/app/(tabs)/activity.tsx`

- [x] 新增 `Needs Attention / Running / Done` 三段展示
- [x] 顶部显示 pending/running 计数摘要
- [x] Pending decision 展示 project/问题摘要/相对时间
- [x] Running conversation 展示 project/任务摘要/状态
- [x] Done conversation 展示 project/结果摘要/状态
- [x] 空状态符合 Activity 语义

## Task 2: Activity 路由行为

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify: `mobile/src/features/chat/utils/chatRoutes.ts`
- Modify: `mobile/app/chat/[id].tsx`

- [x] `Needs Attention` 点击进入 Chat Detail 并带 `focus_ask_id`
- [x] `Running` 点击进入 Chat Detail 最新消息
- [x] `Done` 点击进入 Chat Detail 最新消息
- [x] Chat Detail 根据 `focus_ask_id` 定位到对应 ask card
- [x] 保持 Chat timeline 的决策交互权威性

## Task 3: 测试与验证

**Files:**
- Modify: `mobile/src/__tests__/activityRoute.test.tsx`
- Modify or add focused tests as needed

- [x] Pending decision 渲染在 `Needs Attention`
- [x] Running conversation 渲染在 `Running`
- [x] Done conversation 渲染在 `Done`
- [x] Pending decision 点击带 `focus_ask_id` 跳转
- [x] Running conversation 点击跳转 Chat Detail
- [x] `cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false`
- [x] `cd mobile && pnpm typecheck`
- [x] `cd mobile && pnpm lint`
- [x] `cd mobile && pnpm test --watchAll=false`
- [x] `./scripts/check-mobile-colors.sh`

---

## 验收标准

- [x] 旧 `Inbox Tab` 不再作为全局 Tab 出现
- [x] Activity 显示 `Needs Attention / Running / Done` 三段
- [x] Pending decision 出现在 `Needs Attention`
- [x] Running chat/session/task 出现在 `Running`
- [x] 完成或失败结果出现在 `Done`
- [x] 点击 `Needs Attention` item 进入对应 Chat 并定位到决策卡片
- [x] 点击 `Running` item 进入对应 Chat 最新消息
- [x] 在 Chat 中处理决策后，Activity 状态同步更新
- [x] Activity 视觉与 pencli 第四排 Activity UI 基本一致
