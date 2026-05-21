# Project Detail and Chat Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/product-specs/SPEC-ui-project-detail-chat.md`](../product-specs/SPEC-ui-project-detail-chat.md)

**Goal:** 将旧 Agent Detail 改造成 Project Detail：页面展示 project/workspace 信息，只保留 `New Chat` 作为主要发起入口，最近聊天入口迁移到 Project Detail，Chat Detail 继续承载对话、工具调用和决策卡片。

**Architecture:** 继续复用现有 `agent/[id]` route、agent 数据和 conversation API。移除 Project Detail 内的独立 Invoke UI，不新增 project 数据模型。`New Chat` 继续调用 `createConversation` 并进入 `/chat/[id]`，recent chats 通过 `fetchConversations` 拉取当前 agent 的 conversations。

**Tech Stack:** Expo Router, React Native, React Query-style local effects, Zustand chat store, Jest + React Native Testing Library

---

## Task 1: 更新 Project Detail 组件契约

**Files:**
- Modify: `mobile/src/features/agents/components/AgentDetail.tsx`
- Modify: `mobile/src/features/agents/components/AgentDetail.test.tsx`

- [x] 移除 `onInvoke` prop、Invoke 输入框、Invoke button、`InvokeModal`
- [x] 将页面文案从 `AGENT` 调整为 project/workspace 语义
- [x] 保留 project 名称、状态/agent type、project path 等基础信息
- [x] 只保留 `New Chat` 作为主要 action
- [x] 增加 `Recent Chats` 列表 props，展示 conversation title / status / latest summary
- [x] 测试覆盖不渲染独立 `INVOKE` 主入口

## Task 2: Route 加载 recent chats 并处理 New Chat

**Files:**
- Modify: `mobile/app/agent/[id]/index.tsx`
- Modify: `mobile/src/__tests__/agentDetail.test.tsx`

- [x] 删除 `invokeAgent` 依赖
- [x] 使用 `fetchConversations` 拉取当前 agent conversations
- [x] 将 conversations seed 到 `useChatStore`
- [x] `New Chat` 创建 conversation 后立即进入 `Chat Detail`
- [x] 点击 recent chat 进入对应 `Chat Detail`
- [x] 测试覆盖 `New Chat` 和 recent chat 路由

## Task 3: 验证

- [x] `cd mobile && pnpm test -- AgentDetail.test.tsx agentDetail.test.tsx --watchAll=false`
- [x] `cd mobile && pnpm typecheck`
- [x] `cd mobile && pnpm test --watchAll=false`
- [x] `./scripts/check-mobile-colors.sh`
- [x] `python3 scripts/check-docs-indices.py`

---

## 验收标准

- [x] Project Detail 显示 project 名称、状态、agent 类型
- [x] Project Detail 只提供 `New Chat` 作为主要发起入口
- [x] Project Detail 不显示独立 `Invoke` 主入口
- [x] Recent Chats 出现在 Project Detail
- [x] 点击 `New Chat` 直接进入新的 Chat Detail
- [x] 点击 Recent Chat 进入对应 Chat Detail
- [x] Chat timeline 现有消息、工具调用、决策请求卡片逻辑不被重写
