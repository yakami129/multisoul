# DB-backed Activity Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/SPEC-ui-activity-db-backed.md`](../product-specs/SPEC-ui-activity-db-backed.md)

**Goal:** 将 `Activity` 从 mobile 本地 `inbox` / `chatStore` 拼装视图改为 DB-backed 全局索引：CLI 后端提供单 endpoint 权威 Activity API，mobile 并发请求所有 configured endpoints、合并展示，并在 Activity 前台可见时轮询刷新。

**Architecture:** 不新增独立 `activity` 物化表。CLI 从 `conversations`、`messages` 和新增 `ask_answers` 持久状态按请求派生 Activity items。Mobile 新增 Activity API service 和聚合加载层，Activity tab 不再依赖 `chatStore.conversations` 是否预加载，也不再把 mobile 本地 `inbox` 作为权威 pending 来源。

**Tech Stack:** Rust, axum, rusqlite, tokio, Expo Router, React Native, React Query, Jest + React Native Testing Library

---

## Task 0: 工作区与基线确认

**Files:**
- No product code changes

- [ ] 确认在独立 git worktree 的功能分支上施工，避免在 `main` checkout 直接改产品代码
- [ ] 记录当前 `git status --short`，不要回滚与本任务无关的既有改动
- [ ] 阅读本计划和对应 SPEC，确认实现范围不包含全局 Activity WebSocket、Activity 详情页或中心云端服务
- [ ] 若执行方式未确认，先让用户选择「Subagent 驱动」或「当前会话内联执行」

## Task 1: CLI 持久化 ask answer 与 `awaiting_question` 状态

**Files:**
- Modify: `cli/src/db.rs`
- Modify: `cli/src/serve/routes/ws.rs`
- Modify: `cli/src/serve/runtime/claude_stream.rs`
- Modify as needed: `cli/src/serve/runtime/*`
- Add or modify focused tests under `cli/src/serve/**`

- [ ] 先写 CLI 测试：answer 无等待 session 时不写入 `ask_answers`
- [ ] 先写 CLI 测试：answer 成功路由到等待 session 后写入 `ask_answers`
- [ ] 先写 CLI 测试：插入 `ask_question` 后 conversation status 变为 `awaiting_question`
- [ ] 在 DB migration 中新增 `ask_answers` 表，字段与 SPEC 保持一致
- [ ] Runtime 发出 `ask_question` 时，插入消息后更新 conversation status 为 `awaiting_question`
- [ ] WS 收到 answer 时，只有 `state.send_answer(...)` 成功后才持久化 `ask_answers`
- [ ] answer 成功后将 conversation status 更新回 `running`
- [ ] answer 交付失败时返回可被 mobile 感知的失败反馈，不隐藏 pending
- [ ] 保持现有单选、多选、freeform answer payload 兼容

## Task 2: CLI Activity API

**Files:**
- Add: `cli/src/serve/routes/activity.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`
- Add or modify focused tests under `cli/src/serve/routes/**`

- [ ] 先写 CLI API 测试：无 Bearer token 请求 Activity 返回 401
- [ ] 先写 CLI API 测试：未回答 ask + `awaiting_question` conversation 出现在 `attention`
- [ ] 先写 CLI API 测试：已回答 ask 不出现在 `attention`
- [ ] 先写 CLI API 测试：未回答 ask + `completed` conversation 不出现在 `attention`
- [ ] 先写 CLI API 测试：`running` conversation 出现在 `running`
- [ ] 先写 CLI API 测试：`completed` / `failed` conversation 出现在 `done`，且 failed tone/status 正确
- [ ] 先写 CLI API 测试：`limit_per_section` 分别限制每个 section，不让 `done` 挤掉 `attention`
- [ ] 实现 `GET /api/v1/activity?limit_per_section=50`
- [ ] 返回稳定 item id：`attention:<conversation_id>:<ask_id>`、`running:<conversation_id>`、`done:<conversation_id>`
- [ ] 返回 mobile 路由所需字段：`conversation_id`、`agent_id`、`agent_name`、`ask_id`
- [ ] title/subtitle 优先级与 SPEC 保持一致：决策问题、首条用户消息、最近 agent 回复、conversation title
- [ ] timestamp 使用毫秒时间戳，并按各 section 内倒序

## Task 3: Mobile Activity service 与跨 endpoint 聚合

**Files:**
- Add: `mobile/src/features/activity/services/activityService.ts`
- Add or modify: `mobile/src/features/activity/services/activityService.test.ts`
- Modify: `mobile/src/types.ts`
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify tests: `mobile/src/__tests__/activityRoute.test.tsx`

- [ ] 先写 mobile service 测试：对单 endpoint 调用 `/api/v1/activity?limit_per_section=50`
- [ ] 先写 mobile 聚合测试：Activity 打开时请求所有 configured endpoints
- [ ] 先写 mobile 聚合测试：多 endpoint items 按 section 和 timestamp 合并
- [ ] 先写 mobile 聚合测试：跨 endpoint 相同 item id 通过 `endpoint_id:item.id` 去重/唯一化
- [ ] 定义 `ActivityApiItem` / `AggregatedActivityItem` 类型，避免复用 conversation store 类型
- [ ] 新增 fetch helper，注入 endpoint context：`endpoint_id`、`endpoint_label`
- [ ] 将 Activity tab 的数据源从 `useChatStore` / `useInboxStore` 切换为后端 Activity API 聚合结果
- [ ] 保留 `ActivityScreen` 展示组件，必要时扩展 props 支持部分 endpoint 失败提示和全局错误状态
- [ ] 删除 Activity tab 内对 `loadAnsweredAsks`、`messagesByConversation`、`inboxItems` 的权威判定逻辑

## Task 4: Mobile 刷新、轮询和失败状态

**Files:**
- Modify: `mobile/app/(tabs)/activity.tsx`
- Modify: `mobile/src/features/activity/components/ActivityScreen.tsx`
- Modify tests: `mobile/src/__tests__/activityRoute.test.tsx`

- [ ] 先写测试：Activity 首次打开或获得焦点时拉取 Activity
- [ ] 先写测试：下拉刷新重新请求所有 endpoints
- [ ] 先写测试：Activity 前台可见时启动 15 秒轮询
- [ ] 先写测试：Activity 失焦、卸载或 App 进入后台时停止轮询
- [ ] 先写测试：上一轮请求未完成时不发起重叠轮询
- [ ] 先写测试：单 endpoint 失败不影响其它 endpoint items 渲染
- [ ] 先写测试：全部 endpoint 失败时展示可重试错误状态
- [ ] 实现默认 15 秒轮询，仅在 Activity 页面前台可见时运行
- [ ] 使用 in-flight guard 防止下拉刷新、焦点刷新、轮询之间的请求堆积
- [ ] 部分 endpoint 失败时展示失败 endpoint label 和 Retry 入口
- [ ] 全部 endpoint 失败时展示全局错误状态和 Retry
- [ ] endpoint 未配置时展示空状态或引导去 Settings，不制造加载失败假象

## Task 5: Chat answer 反馈与路由兼容

**Files:**
- Modify: `mobile/src/hooks/useWebSocket.ts`
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/features/chat/services/chatService.ts`
- Modify tests: `mobile/src/__tests__/useWebSocket.test.ts`
- Modify tests: `mobile/src/__tests__/chatDetailRoute.test.tsx`

- [ ] 先写测试：answer 交付失败时 mobile 不应把 ask 标记为 answered
- [ ] 先写测试：answer 成功后本地 Chat card 进入 answered 状态
- [ ] 先写测试：Chat history 从后端 `ask_answers` 恢复已回答 ask 状态
- [ ] 先写测试：pending Activity item 路由包含 `endpoint_id`、`agent_id`、`conversation_id`、`focus_ask_id`
- [ ] 先写测试：running/done Activity item 路由包含 `endpoint_id`、`agent_id`、`conversation_id`
- [ ] 处理 CLI answer 成功/失败反馈，避免当前 blind optimistic answered 状态隐藏未处理 ask
- [ ] 让 `GET /api/v1/conversations/:id/messages` 对 `ask_question` 暴露 backend answered 状态，避免本地 mobile DB 丢失后重复回答
- [ ] 确认 `focus_ask_id` 定位逻辑继续适用于后端 Activity item
- [ ] 保持 notification tap 路由兼容，不把 foreground notification inbox 当作 Activity 权威来源

## Task 6: 验证与收尾

**Files:**
- Modify if needed: `docs/exec-plans/index.json`
- Modify if needed: related design docs only after reviewing code diff

- [ ] `cd cli && cargo test`
- [ ] `cd cli && cargo build`
- [ ] `cd mobile && pnpm typecheck`
- [ ] `cd mobile && pnpm test -- activityRoute.test.tsx --watchAll=false`
- [ ] `cd mobile && pnpm test -- useWebSocket.test.ts --watchAll=false`
- [ ] `cd mobile && pnpm test -- chatDetailRoute.test.tsx --watchAll=false`
- [ ] `cd mobile && pnpm test -- --watchAll=false`
- [ ] 若改 UI，按 `mobile/docs/design.md` §11 checklist 手工核对
- [ ] 若 tracked code 变更影响设计文档，先审阅 diff，再更新对应设计文档 hash
- [ ] 完成前执行 verification-before-completion 等价检查：验收标准逐项核对，不只依赖测试通过
- [ ] 提交前执行 requesting-code-review，修复 Critical/Important 反馈后重新验证
- [ ] 若最终 commit，提交后把 40 位 SHA 写入 `docs/exec-plans/index.json` 的 `lastCompletedCommit`

---

## 验收标准映射

- [ ] CLI Activity API 有 Bearer auth，未授权返回 401
- [ ] CLI `ask_answers` 成为 pending 是否已处理的后端权威事实
- [ ] CLI answer delivery 只接受当前匹配的 pending `ask_id`，拒绝 stale / mismatch answer
- [ ] Chat history 能从后端 `ask_answers` 恢复已回答 ask 状态
- [ ] CLI `awaiting_question` 状态参与 `Needs Attention` 判定
- [ ] `Needs Attention` 不显示 completed/failed conversation 下的历史未回答 ask
- [ ] `Running` / `Done` 以后端 `conversations.status` 为准
- [ ] `limit_per_section` 不让 `Done` 挤掉 `Needs Attention`
- [ ] Mobile 并发请求所有 configured endpoints 并合并展示
- [ ] Mobile 部分 endpoint 失败时继续展示其它 endpoint 数据
- [ ] Mobile 全部 endpoint 失败时展示可重试错误状态
- [ ] Mobile Activity 前台可见时轮询，失焦/后台/卸载时停止
- [ ] Activity item 点击路由到对应 endpoint 的 Chat Detail
- [ ] Activity 不再依赖 `chatStore.conversations` 预加载，也不再以 mobile `inbox` 作为权威 pending 数据源
