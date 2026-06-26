# Project / Session / Resource 模型重构 Implementation Plan

> **For agentic workers:** 按 checkbox 逐项施工。不要把本计划当成一次性大改清单；每个 phase 都要先补测试或可验证用例，再改实现，再运行该 phase 的验证命令。

- **Date**: 2026-06-26
- **Spec**: [`docs/product-specs/2026-06-25-SPEC-project-session-resource-model.md`](../product-specs/2026-06-25-SPEC-project-session-resource-model.md)
- **E2E Spec**: [`docs/product-specs/2026-06-25-SPEC-project-session-resource-model-e2e.md`](../product-specs/2026-06-25-SPEC-project-session-resource-model-e2e.md)
- **Design**: [`docs/design-docs/2026-06-25-project-session-resource-model-design.md`](../design-docs/2026-06-25-project-session-resource-model-design.md)
- **Branch**: `feat/project-session-resource-model`

---

## Goal

把 MultiSoul 从 Agent-first 导航改成 Project / Session / Resource 模型：

- Project 是用户入口，代表某个 endpoint 上的本地项目路径。
- Session 是项目内的任务/对话，技术上延续 `conversations`。
- Resource 是项目内可用 runtime，第一阶段由现有 `agents` 表兼容映射。
- 首页和底部导航以“项目”为主，项目详情优先显示会话，资源只是执行配置。

第一阶段必须保持兼容：

- 旧 `/api/v1/agents`、`/api/v1/agents/:id` 和 `/api/v1/agents/:id/conversations` 继续可用。
- 旧 `msctl agent` 命令继续可用，只是注册时同时创建/绑定 project。
- Runtime dispatch 仍走 `conversation.agent_id -> agents.runtime/mode/project_path`。
- 不删除 `agents.project_path`，只把它视为 `projects.project_path` 的兼容镜像。

## Non-goals

- 不重写 runtime worker、WebSocket transcript、Claude/Codex/Cursor/OpenCode 适配层。
- 不移除 `/agents` API 或移动端旧 agent 详情深链。
- 不把 Resource 抽成独立全局资源池；第一阶段资源作用域是 project 内。
- 不做多 endpoint 统一云端 ID；移动端用 `endpoint_id + project.id` 组合展示。

---

## Change Size And PR Slices

这是一次 **large** 级别重构，不适合单 PR 直接完成。主要风险不在单点代码复杂度，而在对象语义跨越 DB、REST API、移动端导航、Activity/Push、Specs/Workflows。

建议切成 4 个可合并单元：

| Slice | Scope | Merge condition |
|-------|-------|-----------------|
| PR 1 | CLI DB migration + project helpers + `/projects` API + `/agents` compatibility | CLI tests/build pass，旧 mobile 仍可通过 `/agents` 工作 |
| PR 2 | Mobile project data layer + Projects home/detail + legacy agent detail fallback | Mobile typecheck/tests pass，首页不再重复展示同一路径 agents |
| PR 3 | Activity/Push deep links + Specs target + Workflows target | 对话深链、决策卡、spec/workflow dispatch 都能落到 project session |
| PR 4 | Naming cleanup + docs/hash + E2E regression hardening | 用户可见 Agent 文案只保留在 Resource/compat 场景 |

每个 PR 都必须保持老路径可用。只有 PR 4 之后，才允许把用户主路径完全视为 project-first。

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `cli/migrations/20260626_project_session_resource_model.sql` | 新增 `projects`、`agents.project_id`、`conversations.project_id`、`workflows.project_id` 并回填 |
| Modify | `cli/src/db.rs` | 注册迁移、补 schema/migration 测试 |
| Create | `cli/src/serve/projects.rs` | Project normalize/upsert/load helpers，集中 DB 读写 |
| Create | `cli/src/serve/routes/projects.rs` | `/api/v1/projects` API |
| Modify | `cli/src/serve/routes/mod.rs` | 导出 project routes |
| Modify | `cli/src/serve/router.rs` | 挂载 `/api/v1/projects*` |
| Modify | `cli/src/serve/routes/agents.rs` | 旧 Agent API 兼容 join project 字段，不破坏旧 shape |
| Modify | `cli/src/serve/routes/conversations.rs` | 新增 project conversation API，写入 `project_id` |
| Modify | `cli/src/serve/routes/activity.rs` | Activity 行补 project metadata，排序继续以待处理/运行中优先 |
| Modify | `cli/src/serve/routes/push_tokens.rs` / `cli/src/serve/push.rs` | 推送 payload 补 project/session metadata |
| Modify | `cli/src/serve/routes/workflows.rs` | Workflow 目标增加 `project_id`，保留 `agent_id` 兼容执行 |
| Modify | `cli/src/commands/agent*.rs` | 注册 agent 时 upsert project 并设置默认 resource |
| Modify | `cli/src/commands/mod.rs` | 新增 `msctl project` / `msctl resource` 命令入口或 alias |
| Modify | `cli/src/commands/spec*.rs` | Spec dispatch 目标从 agent-first 过渡到 project + resource |
| Create | `mobile/src/features/projects/types.ts` | Project / ProjectSession / ProjectResource 类型 |
| Create | `mobile/src/features/projects/services/projectService.ts` | `/projects` service |
| Create | `mobile/src/features/projects/components/ProjectList.tsx` | 首页项目列表 |
| Create | `mobile/src/features/projects/components/ProjectCard.tsx` | 项目卡片，聚合会话状态 |
| Create | `mobile/src/features/projects/components/ProjectDetail.tsx` | 项目详情：Sessions / Resources / Settings |
| Create | `mobile/src/features/projects/index.ts` | 公共入口，禁止跨 feature 深路径 import |
| Modify | `mobile/src/types.ts` | 补 Project API 类型或转移到 feature public exports |
| Modify | `mobile/app/(tabs)/_layout.tsx` | 底部 `tabs.agents` 改为 `tabs.projects`，图标语义同步 |
| Modify | `mobile/app/(tabs)/index.tsx` | 首页从 AgentList 切换为 ProjectList |
| Create | `mobile/app/project/[id]/index.tsx` | 项目详情路由 |
| Modify | `mobile/app/agent/[id]/index.tsx` | 作为资源详情/兼容入口保留 |
| Modify | `mobile/app/chat/[id].tsx` | 深链参数兼容 project metadata，不破坏现有 chat |
| Modify | `mobile/src/services/notificationNavigation.ts` | 推送点击深链到具体 session/decision card |
| Modify | `mobile/src/features/activity/**` | Activity item 使用 project/session/resource 文案 |
| Modify | `mobile/src/features/specs/**` | 目标选择改为 project + default resource |
| Modify | `mobile/src/features/workflows/**` | Workflow 表单绑定 project + default resource |
| Modify | `mobile/src/i18n/locales/{zh,en}.json` | Agent 用户文案改 Project/Session/Resource |
| Modify | `mobile/src/__tests__/integration/msw/handlers.ts` | MSW 增加 `/projects` fixtures |

---

## Phase 0: Discovery And Guardrails

### Task 0.1: Audit current Agent ownership points

- [ ] 用 `rg` 列出 `project_path`、`agent_id`、`fetchAllAgents`、`/api/v1/agents`、`conversations`、`workflows`、`dispatch` 的读写点。
- [ ] 把必须迁移的点标成三类：DB writer、API reader、Mobile presentation。
- [ ] 确认没有改动 `~/.config/msctl/*`；本地测试只用 temp DB。

**Verification**

```bash
rg -n "project_path|agent_id|fetchAllAgents|/api/v1/agents|conversations|workflows|dispatch" cli/src mobile/src mobile/app
```

### Task 0.2: Establish compatibility fixtures

- [ ] 在 CLI route tests 中准备一个 fixture：同一 `project_path` 下两个 agents。
- [ ] 准备历史 DB fixture：只有 `agents`/`conversations` 老字段，无 `projects`/`project_id`。
- [ ] 在 mobile MSW handlers 中准备一个 endpoint 返回两个项目、每个项目多个 sessions/resources。

**Acceptance**

- 老 fixture 能打开并被迁移。
- mobile fixture 能表达“一个项目多个资源”的首页去重场景。

---

## Phase 1: CLI DB Model And Backfill

### Task 1.1: Add file migration

**Files**

- Create: `cli/migrations/20260626_project_session_resource_model.sql`
- Modify: `cli/src/db.rs`

- [ ] 新增 `projects` 表：
  - `id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `project_path TEXT NOT NULL`
  - `normalized_project_path TEXT NOT NULL UNIQUE`
  - `default_agent_id TEXT`
  - `created_at INTEGER NOT NULL`
  - `updated_at INTEGER NOT NULL`
- [ ] 给 `agents` 增加 nullable `project_id`。
- [ ] 给 `conversations` 增加 nullable `project_id`。
- [ ] 给 `workflows` 增加 nullable `project_id`。
- [ ] 回填逻辑：
  - 从所有 `agents.project_path` 生成唯一 project。
  - 将 `agents.project_id` 指向对应 project。
  - 每个 project 选择最早创建或最新活跃 agent 作为 `default_agent_id`，规则必须写在测试名或注释里。
  - 将 `conversations.project_id` 回填为其 `agent_id` 对应 project。
  - 将 `workflows.project_id` 回填为其 `agent_id` 对应 project。
- [ ] 在 `init_schema` 中通过 `apply_migration` 注册该 SQL。

**Implementation notes**

- SQLite `ALTER TABLE ... ADD COLUMN` 对已存在列会失败；当前 `apply_migration` 只记录整条 migration 是否完成，所以 SQL 必须只在未记录时跑。
- 不要继续在 `init_schema` 里增加新的裸 `ALTER TABLE`。
- `projects.default_agent_id` 可以先不加 FK，避免循环外键和回填顺序复杂化。

### Task 1.2: Add project helper module

**Files**

- Create: `cli/src/serve/projects.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] 实现 `normalize_project_path(path: &str) -> String`。
- [ ] 实现 `derive_project_name(path: &str) -> String`。
- [ ] 实现 `upsert_project_for_path(conn, project_path, now) -> ProjectRecord`。
- [ ] 实现 `set_default_resource_if_empty(conn, project_id, agent_id)`。
- [ ] 实现 `project_id_for_agent(conn, agent_id) -> Option<String>`。
- [ ] 单元测试覆盖：
  - trailing slash 去重。
  - 相对路径和 home 展开策略与 spec 一致。
  - 同一路径重复 upsert 返回同一个 project。

### Task 1.3: Bind new writes to project

**Files**

- Modify: `cli/src/commands/agent.rs`
- Modify: `cli/src/commands/agent_quick_register.rs`
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/routes/workflows.rs`
- Modify: `cli/src/serve/spec/routes/implement.rs`
- Modify: `cli/src/serve/spec/routes/ideas.rs`

- [ ] Agent 注册/快速注册先 upsert project，再插入/更新 agent 的 `project_id`。
- [ ] Conversation 创建时写入 `project_id`。
- [ ] Workflow 创建/更新时写入 `project_id`，同时保留 `agent_id` 作为执行资源。
- [ ] Spec interview/implementation 创建 conversation 时写入 `project_id`。
- [ ] 所有新写路径禁止产生 `project_id IS NULL`，除非是明确的 legacy fallback 测试。

**Verification**

```bash
cd cli && cargo test db::
cd cli && cargo test routes::conversations
cd cli && cargo test workflows
```

---

## Phase 2: Project API And Legacy Agent Compatibility

### Task 2.1: Add project routes

**Files**

- Create: `cli/src/serve/routes/projects.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/router.rs`

- [ ] `GET /api/v1/projects` 返回 project summary：
  - project base fields。
  - `endpoint` 由 mobile 注入，不在 server DB 内保存。
  - `session_counts` 至少包含 running、awaiting_question、completed、failed、idle。
  - `last_activity_at` 来自 conversations last_message_at 或 project updated_at。
  - `default_resource_id`。
- [ ] `GET /api/v1/projects/:id` 返回单个 project summary。
- [ ] `GET /api/v1/projects/:id/conversations` 返回该项目下 sessions，按 `last_message_at DESC`。
- [ ] `GET /api/v1/projects/:id/resources` 返回该项目下 agents 的 resource view。
- [ ] `POST /api/v1/projects/:id/conversations` 用 `resource_id` 或默认资源创建 conversation。

**Sorting contract**

Project list 排序必须服务首页：

1. 有 `awaiting_question` 的项目。
2. 有 `running` 的项目。
3. 最近 `last_activity_at`。
4. `name` 稳定排序。

### Task 2.2: Keep `/agents` stable

**Files**

- Modify: `cli/src/serve/routes/agents.rs`
- Modify: `cli/src/serve/router.rs` if route shape changes

- [ ] `GET /api/v1/agents` 仍返回旧字段：`id/name/project_path/runtime/created_at`。
- [ ] 可额外返回 `project_id`，但 mobile legacy tests 必须证明旧字段未丢。
- [ ] `GET /api/v1/agents/:id` 仍可查到 resource。
- [ ] `/api/v1/agents/:id/conversations` 仍返回该 agent 的 conversations。

### Task 2.3: API tests

- [ ] 新增 project route tests：
  - 同一路径两个 agents 只返回一个 project。
  - project resources 返回两个 resources。
  - project conversations 聚合两个 resources 下的 sessions。
  - project conversation create 默认使用 `default_agent_id`。
  - project conversation create 指定 `resource_id` 时必须校验 resource 属于该 project。
- [ ] 旧 agents route regression tests：
  - 旧 list shape 不破坏。
  - 旧 agent conversation create 仍可用，并写入 project_id。
- [ ] Auth tests：所有 `/projects` API 必须 Bearer auth。

**Verification**

```bash
cd cli && cargo test routes::projects
cd cli && cargo test routes::agents
cd cli && cargo test routes::conversations
cd cli && cargo build
```

---

## Phase 3: CLI Command Transition

### Task 3.1: Preserve `msctl agent`

**Files**

- Modify: `cli/src/commands/agent.rs`
- Modify: `cli/src/commands/agent_quick_register.rs`

- [ ] `msctl agent register` 输出中包含 project id/name/path，旧输出字段不破坏机器可读 JSON。
- [ ] 重复注册同一路径不同 runtime 时，不创建重复 project。
- [ ] 删除 agent/resource 时，如果 project 内无资源，第一阶段不自动删除 project，避免误删历史 sessions。

### Task 3.2: Add project/resource aliases

**Files**

- Modify: `cli/src/commands/mod.rs`
- Create or modify: `cli/src/commands/project.rs`
- Create or modify: `cli/src/commands/resource.rs`

- [ ] 新增 `msctl project list`。
- [ ] 新增 `msctl project resources <project-id>`。
- [ ] 新增 `msctl resource list --project <project-id>`。
- [ ] `msctl resource register` 可以先作为 `msctl agent register` 的 alias，但 help 文案使用 Resource。

**Verification**

```bash
cd cli && cargo test commands
cd cli && cargo run -- project --help
cd cli && cargo run -- resource --help
```

---

## Phase 4: Mobile Project Data Layer

### Task 4.1: Add project feature boundary

**Files**

- Create: `mobile/src/features/projects/types.ts`
- Create: `mobile/src/features/projects/services/projectService.ts`
- Create: `mobile/src/features/projects/index.ts`
- Modify: `mobile/src/types.ts`

- [ ] 定义 `Project`、`ProjectSession`、`ProjectResource`、`ProjectSessionCounts`。
- [ ] `fetchProjectsFromEndpoint` 调用 `/api/v1/projects` 并注入 `endpoint_id/endpoint_label`。
- [ ] `fetchAllProjects` 对多 endpoint 使用 `Promise.allSettled`，单 endpoint 失败不拖垮列表。
- [ ] `fetchProject`、`fetchProjectSessions`、`fetchProjectResources`、`createProjectConversation`。
- [ ] 保留 `features/agents/services/agentService.ts` 给兼容页面和旧 API。

### Task 4.2: Mobile integration tests

**Files**

- Modify: `mobile/src/__tests__/integration/msw/handlers.ts`
- Create: `mobile/src/features/projects/services/projectService.test.ts`

- [ ] MSW 加 `/api/v1/projects`、`/api/v1/projects/:id`、`/conversations`、`/resources` fixtures。
- [ ] 覆盖多 endpoint merge。
- [ ] 覆盖 endpoint 失败时返回其他 endpoint 项目。
- [ ] 覆盖 create session 使用 default resource。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false projectService.test.ts
cd mobile && pnpm typecheck
```

---

## Phase 5: Mobile Project Navigation And Screens

### Task 5.1: Replace home tab with Projects

**Files**

- Modify: `mobile/app/(tabs)/_layout.tsx`
- Modify: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/src/features/projects/components/ProjectList.tsx`
- Create: `mobile/src/features/projects/components/ProjectCard.tsx`
- Create: `mobile/src/features/projects/components/ProjectList.test.tsx`
- Modify: `mobile/src/i18n/locales/zh.json`
- Modify: `mobile/src/i18n/locales/en.json`

- [ ] 底部 tab 文案从“智能体/Agents”改为“项目/Projects”。
- [ ] 首页 hero 统计改为 session 统计：运行中、需要您、已完成。
- [ ] Project card 展示：
  - project name。
  - endpoint label。
  - project path。
  - status chip 来自最高优先级 session 状态。
  - resource count 不作为主标题，只作为次级 metadata。
- [ ] 首页排序使用 API 顺序；客户端只做 endpoint 级稳定 merge。
- [ ] 点击 project card 进入 `/project/[id]?endpoint_id=...`。
- [ ] 搜索对象从 agent 改为 project name/path/session title。

### Task 5.2: Add project detail

**Files**

- Create: `mobile/app/project/[id]/index.tsx`
- Create: `mobile/src/features/projects/components/ProjectDetail.tsx`
- Create: `mobile/src/features/projects/components/ProjectDetail.test.tsx`

- [ ] Project detail 顶部显示项目身份，不把 resource 名称放成主标题。
- [ ] 默认分段是 Sessions。
- [ ] Sessions 列表按状态和时间显示，支持打开 chat。
- [ ] Resources 分段显示可用 runtime resource，可打开旧 agent/resource detail。
- [ ] Settings 分段第一阶段只显示默认 resource 和只读路径，不做危险操作。
- [ ] New Session CTA 默认使用 `default_resource_id`，必要时提供 resource picker。

### Task 5.3: Keep legacy agent detail

**Files**

- Modify: `mobile/app/agent/[id]/index.tsx`
- Modify: `mobile/src/features/agents/components/AgentDetail.tsx`

- [ ] 旧 agent 详情改文案为 Resource detail 或兼容资源页。
- [ ] 旧路由仍能从历史 Activity/Push/chat 参数打开。
- [ ] 不在首页再直接展示 agent cards。

**Verification**

```bash
cd mobile && pnpm test -- --watchAll=false ProjectList.test.tsx
cd mobile && pnpm test -- --watchAll=false ProjectDetail.test.tsx
cd mobile && pnpm test -- --watchAll=false index.test.tsx navigation.test.tsx
cd mobile && pnpm typecheck
```

---

## Phase 6: Activity, Push, And Deep Links

### Task 6.1: Server activity metadata

**Files**

- Modify: `cli/src/serve/routes/activity.rs`
- Modify: `cli/src/serve/routes/activity_events.rs`
- Modify: `cli/src/serve/push.rs`
- Modify: `cli/src/serve/ask_question.rs`

- [ ] Activity items include `project_id/project_name/project_path` and `resource_id/resource_name` when available.
- [ ] Push payload includes `projectId` for all conversation-based notifications.
- [ ] Ask question activity keeps `conversation_id` as deep-link source of truth。
- [ ] Existing payload keys `agentId/convId/endpointId` remain until mobile cleanup phase。

### Task 6.2: Mobile navigation

**Files**

- Modify: `mobile/src/services/notificationNavigation.ts`
- Modify: `mobile/src/services/notificationService.ts`
- Modify: `mobile/src/features/activity/components/ActivityScreen.tsx`
- Modify: `mobile/src/features/activity/components/activityItem.ts`

- [ ] 推送点击仍深链到 `chat/[id]`，附带 `project_id` 作为上下文。
- [ ] 如果 payload 指向 decision card，chat 页面定位逻辑继续使用 ask payload/conversation transcript。
- [ ] Activity row 文案从 agent-first 改为 project/session-first。
- [ ] 缺少 project metadata 的旧事件继续 fallback 到 agent metadata。

**Verification**

```bash
cd cli && cargo test routes::activity
cd mobile && pnpm test -- --watchAll=false notificationNavigation.test.ts activityRoute.test.tsx ActivityScreen.test.tsx
```

---

## Phase 7: Specs And Workflows Target Model

### Task 7.1: Specs target becomes project + resource

**Files**

- Modify: `mobile/src/components/agent-target/**`
- Modify: `mobile/src/features/specs/components/IdeaEditorSheet.tsx`
- Modify: `mobile/src/features/specs/components/specUiModels.ts`
- Modify: `mobile/src/features/specs/services/specDispatchService.ts`
- Modify: `mobile/src/store/specStore.ts`
- Modify: `cli/src/serve/spec/routes/ideas.rs`
- Modify: `cli/src/serve/spec/routes/implement.rs`

- [ ] Rename shared target model to project target or add new wrapper without breaking imports.
- [ ] Idea/Spec target stores `project_id` plus optional `resource_id` override。
- [ ] Dispatch API accepts project target and resolves default resource server-side when resource omitted。
- [ ] Existing drafts with only `agent_id` still render and can be dispatched。

### Task 7.2: Workflow target becomes project + resource

**Files**

- Modify: `mobile/src/features/workflows/types.ts`
- Modify: `mobile/src/features/workflows/services/workflowService.ts`
- Modify: `mobile/src/features/workflows/components/WorkflowFormScreen.tsx`
- Modify: `mobile/app/(tabs)/workflows.tsx`
- Modify: `mobile/app/workflow/[id].tsx`
- Modify: `cli/src/serve/routes/workflows.rs`
- Modify: `cli/src/serve/workflows.rs`

- [ ] Workflow create/update payload includes `project_id` and optional `agent_id/resource_id`。
- [ ] Existing workflow execution still uses resolved `agent_id`。
- [ ] Watch/recurring mode continues unchanged once target resolves。
- [ ] Workflow list/detail displays project as primary target, resource secondary。

**Verification**

```bash
cd cli && cargo test workflows
cd mobile && pnpm test -- --watchAll=false WorkflowFormScreen.test.tsx workflows.test.tsx
cd mobile && pnpm test -- --watchAll=false IdeaEditorSheet.test.tsx SpecsHomeScreen.test.tsx
cd mobile && pnpm typecheck
```

---

## Phase 8: Cleanup, Docs, And Full Regression

### Task 8.1: User-facing naming cleanup

- [ ] Search mobile strings for user-visible “Agent/智能体” that now means Project or Resource。
- [ ] Keep technical/API names where compatibility requires `agent_id`。
- [ ] Update screenshots/prototype references only if behavior diverges from design doc。
- [ ] Ensure no new feature imports violate feature boundary rules。

### Task 8.2: Docs update

- [ ] If implementation changes the design, update [`docs/design-docs/2026-06-25-project-session-resource-model-design.md`](../design-docs/2026-06-25-project-session-resource-model-design.md) before refreshing code hashes。
- [ ] Update product spec only for behavior changes, not implementation trivia。
- [ ] Run doc index/hash checks。

### Task 8.3: Full verification

```bash
cd cli && cargo test
cd cli && cargo build
cd mobile && pnpm typecheck
cd mobile && pnpm test -- --watchAll=false
python3 scripts/check-docs-indices.py
python3 scripts/check-doc-code-hashes.py --check
```

If API behavior changed across REST/WS, also run:

```bash
bash scripts/test-e2e.sh
```

---

## E2E Acceptance Mapping

Before marking this plan complete, verify the implementation against the E2E spec:

- [ ] E2E-01 to E2E-04: DB migration and project/resource API。
- [ ] E2E-05 to E2E-07: Conversation ownership and resource binding。
- [ ] E2E-08 to E2E-10: Mobile Projects home/detail/new session。
- [ ] E2E-11 to E2E-12: Activity and push deep links。
- [ ] E2E-13 to E2E-14: Specs target model。
- [ ] E2E-15 to E2E-16: Workflows target model。
- [ ] E2E-17 to E2E-19: Legacy `/agents` and compatibility regressions。

---

## Rollout And Rollback

- DB migration is additive; rollback can keep new columns/tables in place while app falls back to `/agents`。
- Mobile can ship after CLI project API is available, because old Agent UI remains behind compatibility routes until final cleanup。
- If project API has a production issue, mobile can temporarily switch home data source back to `fetchAllAgents` while preserving DB migration。
- Do not delete `projects` rows automatically when resources are removed until a separate deletion spec exists。

---

## Completion Rules

- All checkboxes in this plan are complete or explicitly moved to a follow-up exec plan。
- Full verification commands pass。
- Product spec E2E acceptance list is checked against real implementation。
- Commit only after required code review. After the single completion commit lands, write its 40-char SHA into `docs/exec-plans/index.json` as `lastCompletedCommit` for this file。
