# Project / Session / Resource Mobile UI Slice Implementation Plan

> **For agentic workers:** 这是总计划的 PR 2，只实现移动端 project-first 首页和项目详情页。不要在本片里改 Activity/Push、Specs、Workflows 的目标模型，除非为了保持编译或旧路径兼容必须做最小改动。

- **Date**: 2026-06-26
- **Parent Plan**: [`2026-06-26-project-session-resource-model.md`](2026-06-26-project-session-resource-model.md)
- **Spec**: [`docs/product-specs/2026-06-25-SPEC-project-session-resource-model.md`](../product-specs/2026-06-25-SPEC-project-session-resource-model.md)
- **E2E Spec**: [`docs/product-specs/2026-06-25-SPEC-project-session-resource-model-e2e.md`](../product-specs/2026-06-25-SPEC-project-session-resource-model-e2e.md)
- **Design**: [`docs/design-docs/2026-06-25-project-session-resource-model-design.md`](../design-docs/2026-06-25-project-session-resource-model-design.md)
- **Depends on**: PR 1 backend API slice on branch/worktree `feat/project-session-resource-model`

---

## Goal

把移动端主路径从 Agent-first 改成 Project-first：

- 底部第一个 tab 文案从“智能体/Agents”改为“项目/Projects”。
- 首页展示 Project card，而不是 Agent card；同一路径多个 resources 只出现一个 project。
- Project detail 默认展示 Sessions，会话是用户继续工作的主对象。
- Resources 在项目详情里作为执行资源管理区，不再是首页第一层对象。
- 旧 agent/resource detail 路由保留，用于兼容旧 deep link 和资源查看。

## Non-goals

- 不实现 Activity/Push project metadata 深链；本片只确保旧 deep link 不坏。
- 不改 Specs/Workflows target picker；本片只避免相关页面 typecheck 失败。
- 不删除 `features/agents`；旧 agent service/page 继续存在。
- 不新增后端 API；如果发现 API 契约缺口，先记录并回 PR 1 修。

---

## Backend API Contract Used By This Slice

本片假设 PR 1 已提供以下接口：

```text
GET  /api/v1/projects
GET  /api/v1/projects/:id
GET  /api/v1/projects/:id/conversations
GET  /api/v1/projects/:id/resources
POST /api/v1/projects/:id/conversations
```

Mobile service 层需要注入 endpoint metadata，server 不保存 endpoint：

```ts
type Project = {
  id: string;
  name: string;
  project_path: string;
  normalized_project_path: string;
  default_resource_id: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  session_counts: {
    idle: number;
    running: number;
    awaiting_question: number;
    completed: number;
    failed: number;
  };
  resource_count: number;
  endpoint_id: string;
  endpoint_label: string;
};
```

`ProjectSession` 兼容现有 `Conversation` 字段，并额外带 `project_id`。`ProjectResource` 兼容现有 `Agent` 字段，并额外带 `project_id` / `is_default`。

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `mobile/src/features/projects/types.ts` | Project / ProjectSession / ProjectResource 类型 |
| Create | `mobile/src/features/projects/services/projectService.ts` | `/projects` API client + endpoint merge |
| Create | `mobile/src/features/projects/services/projectService.test.ts` | service unit tests |
| Create | `mobile/src/features/projects/components/ProjectCard.tsx` | 首页项目卡片 |
| Create | `mobile/src/features/projects/components/ProjectList.tsx` | 首页项目列表、搜索、空态、刷新 |
| Create | `mobile/src/features/projects/components/ProjectDetail.tsx` | 项目详情：Sessions / Resources / Settings |
| Create | `mobile/src/features/projects/components/ProjectList.test.tsx` | 首页 UI tests |
| Create | `mobile/src/features/projects/components/ProjectDetail.test.tsx` | 详情 UI tests |
| Create | `mobile/src/features/projects/index.ts` | feature public exports |
| Create | `mobile/app/project/[id]/index.tsx` | expo-router project detail route |
| Modify | `mobile/app/(tabs)/_layout.tsx` | tab 文案和图标语义 |
| Modify | `mobile/app/(tabs)/index.tsx` | 从 AgentListScreen 切换到 ProjectListScreen |
| Modify | `mobile/app/(tabs)/index.test.tsx` | 首页 route tests |
| Modify | `mobile/src/types.ts` | 只保留跨 feature 必需类型；优先从 projects feature 导出 |
| Modify | `mobile/src/features/agents/components/AgentDetail.tsx` | 文案降级为 Resource/兼容详情 |
| Modify | `mobile/app/agent/[id]/index.tsx` | 保留 legacy route，避免旧 deep link 断裂 |
| Modify | `mobile/src/features/chat/services/chatService.ts` | 支持 project session create/open 所需最小参数 |
| Modify | `mobile/src/store/chatStore.ts` | merge conversations 时保留 project_id |
| Modify | `mobile/src/i18n/locales/zh.json` | Projects / Sessions / Resources 文案 |
| Modify | `mobile/src/i18n/locales/en.json` | Projects / Sessions / Resources copy |
| Modify | `mobile/src/__tests__/integration/msw/handlers.ts` | `/projects` mock handlers |

---

## Phase 0: Contract Sync And Current UI Audit

### Task 0.1: Verify PR 1 API shape

- [ ] 从 PR 1 worktree 确认 `/api/v1/projects` response 字段。
- [ ] 把 mobile 类型只按已实现字段建模，不预留未实现字段。
- [ ] 记录任何 API 缺口，回 PR 1 修，不在 mobile 写临时 mock-only 字段。

**Verification**

```bash
rg -n "ProjectSummary|ProjectConversationRow|ProjectResourceRow" cli/src/serve/routes/projects.rs
```

### Task 0.2: Audit existing Agents home behavior

- [ ] 阅读 `mobile/app/(tabs)/index.tsx`。
- [ ] 阅读 `mobile/src/features/agents/components/AgentList.tsx`、`AgentCard.tsx`。
- [ ] 标记可复用的视觉结构，避免复制 Agent-first 领域语义。
- [ ] 确认 `mobile/docs/design.md` 色彩/字号/间距白名单。

**Verification**

```bash
rg -n "AgentList|AgentCard|tabs.agents|fetchAllAgents" mobile/app mobile/src
```

---

## Phase 1: Project Data Layer

### Task 1.1: Add project feature boundary

**Files**

- Create: `mobile/src/features/projects/types.ts`
- Create: `mobile/src/features/projects/index.ts`

- [ ] 定义 `ProjectSessionCounts`。
- [ ] 定义 `Project`，包含 injected `endpoint_id` / `endpoint_label`。
- [ ] 定义 `ProjectSession`，字段与 `Conversation` 对齐并包含 `project_id`。
- [ ] 定义 `ProjectResource`，字段与 `Agent` 对齐并包含 `project_id` / `is_default`。
- [ ] 从 `index.ts` 导出类型和后续 service/component，其他 feature 禁止深路径 import。

### Task 1.2: Add service

**Files**

- Create: `mobile/src/features/projects/services/projectService.ts`
- Create: `mobile/src/features/projects/services/projectService.test.ts`
- Modify: `mobile/src/__tests__/integration/msw/handlers.ts`

- [ ] `fetchProjectsFromEndpoint(base_url, token, endpoint_id, endpoint_label)`。
- [ ] `fetchAllProjects(endpoints)` 使用 `Promise.allSettled`，单 endpoint 失败不拖垮其他 endpoint。
- [ ] `fetchProject(base_url, token, project_id, endpoint_id, endpoint_label)`。
- [ ] `fetchProjectSessions(base_url, token, project_id, endpoint_id, endpoint_label)`。
- [ ] `fetchProjectResources(base_url, token, project_id, endpoint_id, endpoint_label)`。
- [ ] `createProjectConversation(base_url, token, project_id, title?, resource_id?)` 返回 conversation id/row。
- [ ] MSW handlers 增加项目、会话、资源 fixtures。

**Acceptance**

- 两个 endpoint 各自返回 project 时，service 注入正确 endpoint metadata。
- 一个 endpoint 失败时，另一个 endpoint 的 projects 仍显示。
- create conversation 默认不传 resource 时使用后端 default resource。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false projectService.test.ts
cd mobile && pnpm typecheck
```

---

## Phase 2: Projects Home

### Task 2.1: Replace tab semantics

**Files**

- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/src/i18n/locales/zh.json`
- Modify: `mobile/src/i18n/locales/en.json`

- [ ] `tabs.agents` 改为 `tabs.projects` 或保留 key 但 value 改为 Projects/项目。
- [ ] active icon 可第一版继续使用品牌 bot 图标，但 accessibility label 必须是 Projects/项目。
- [ ] 不改 Specs/Activity/Settings tab。

### Task 2.2: Implement ProjectCard

**Files**

- Create: `mobile/src/features/projects/components/ProjectCard.tsx`

- [ ] 主标题是 project name。
- [ ] 次行显示 endpoint label 和 project path。
- [ ] 状态 chip 优先级：`awaiting_question` > `running` > `failed` > `idle` > `completed`。
- [ ] metadata 显示 session counts 和 resource count，但 resource 不抢主视觉。
- [ ] 触摸区域稳定，不因长路径/长项目名撑坏布局。

### Task 2.3: Implement ProjectList

**Files**

- Create: `mobile/src/features/projects/components/ProjectList.tsx`
- Create: `mobile/src/features/projects/components/ProjectList.test.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`
- Modify: `mobile/app/(tabs)/index.test.tsx`

- [ ] 首页 query 从 `fetchAllAgents` 改为 `fetchAllProjects`。
- [ ] Hero 统计改为 session 视角：运行中、需要您、已完成。
- [ ] 搜索匹配 project name/path/session hint，不再搜索 agent name 作为主对象。
- [ ] Empty state 引导添加 endpoint，不出现“注册智能体”作为主 CTA。
- [ ] Pull/refetch 继续工作。
- [ ] 点击 project card 跳转 `/project/[id]?endpoint_id=<id>`。
- [ ] 保留打开 workflows 的入口，除非当前 UI 已隐藏 workflows tab。

**Acceptance**

- 同一个项目多个 resources 只显示一张 card。
- awaiting/running projects 在 API 顺序基础上自然靠前；客户端不要重新制造 agent-first 排序。
- 页面没有嵌套卡片，符合现有 `brandRefresh` 视觉系统。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false ProjectList.test.tsx index.test.tsx
cd mobile && pnpm typecheck
```

---

## Phase 3: Project Detail

### Task 3.1: Add project route

**Files**

- Create: `mobile/app/project/[id]/index.tsx`
- Create: `mobile/src/features/projects/components/ProjectDetail.tsx`

- [ ] 从 route params 读取 `id` 和 `endpoint_id`。
- [ ] 根据 endpoint store 找到 base_url/token。
- [ ] 并行加载 project summary、sessions、resources。
- [ ] Loading/error/empty states 使用现有 UI primitives，不新增视觉体系。
- [ ] Header 主标题是 project name，subtitle 是 endpoint + path。

### Task 3.2: Sessions segment

- [ ] 默认 segment 为 Sessions。
- [ ] Session row 显示 title、status、last activity、resource name fallback。
- [ ] 点击 session 打开现有 `chat/[id]`，传入 `endpoint_id`、`agent_id`、`agent_name`，并附带 `project_id` 作为兼容上下文。
- [ ] New Session CTA 调用 `createProjectConversation`，成功后进入 chat。
- [ ] 无 session 时显示轻量空态和 New Session CTA。

### Task 3.3: Resources segment

- [ ] Resources 只作为项目内执行资源列表。
- [ ] 显示 resource name、runtime、default badge、created age。
- [ ] 点击 resource 进入旧 `/agent/[id]` route，保留兼容详情。
- [ ] 不在本片里实现默认 resource 修改。

### Task 3.4: Settings segment

- [ ] 第一版只读展示 project path、normalized path、default resource。
- [ ] 不提供删除 project/resource 的危险操作。
- [ ] 如果需要修改默认 resource，留 TODO 到后续 spec，不在 UI 放假按钮。

### Task 3.5: Tests

**Files**

- Create: `mobile/src/features/projects/components/ProjectDetail.test.tsx`

- [ ] Loading state。
- [ ] Sessions 默认 segment。
- [ ] New Session 成功后调用 router push 到 chat。
- [ ] Resources segment 显示 default badge。
- [ ] Settings segment 只读。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false ProjectDetail.test.tsx
cd mobile && pnpm typecheck
```

---

## Phase 4: Legacy Agent Compatibility

### Task 4.1: Keep old agent route usable

**Files**

- Modify: `mobile/app/agent/[id]/index.tsx`
- Modify: `mobile/src/features/agents/components/AgentDetail.tsx`
- Modify: `mobile/src/features/agents/components/AgentDetail.test.tsx`

- [ ] 旧 route 不删除。
- [ ] 用户可见文案从 Agent detail 调整为 Resource detail / 执行资源详情。
- [ ] 数据仍走 `fetchAgent`，不在本片强行改成 resource API。
- [ ] 旧 Activity/Push/chat deep link 仍能打开该 route。

### Task 4.2: Keep chat route stable

**Files**

- Modify only if needed: `mobile/app/chat/[id].tsx`
- Modify only if needed: `mobile/src/features/chat/services/chatService.ts`

- [ ] 现有 chat 打开参数继续兼容 `agent_id`。
- [ ] Project detail 打开 chat 不要求 chat 页面立刻理解完整 Project model。
- [ ] `project_id` 参数可以传递但不可成为必填项。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false agentDetail.test.tsx chatDetailRoute.test.tsx navigation.test.tsx
cd mobile && pnpm typecheck
```

---

## Phase 5: Polish, Accessibility, And Full Mobile Validation

### Task 5.1: iOS interaction quality

- [ ] Project card tap targets >= 44pt。
- [ ] Long project path uses `numberOfLines` and does not overlap chips/buttons。
- [ ] Segmented control state is clear and reversible。
- [ ] Search/filter never changes card height unpredictably。
- [ ] Empty/error/loading states do not introduce marketing/landing-page copy。
- [ ] Colors only use `mobile/docs/design.md` allowed tokens / existing `brandRefresh` values。

### Task 5.2: Full validation

```bash
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
python3 scripts/check-docs-indices.py
python3 scripts/check-doc-code-hashes.py --check
```

If this slice changes any tracked code referenced by design docs, update the relevant design doc intentionally before refreshing hashes.

---

## Done Criteria

- Projects tab is the first mobile tab and no longer lists agents as top-level cards。
- One project with multiple resources appears once on home。
- Project detail opens and defaults to Sessions。
- New Session from project detail creates a conversation and opens chat。
- Resources remain accessible from project detail and old `/agent/[id]` route。
- Existing Activity/Push/chat deep links are not broken。
- `mobile` typecheck and relevant tests pass。
- No `mobile/src|app` file exceeds 500 lines。
