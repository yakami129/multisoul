# Project / Session / Resource 模型重构 E2E 功能测试用例

**日期**：2026-06-25
**来源规格**：[`2026-06-25-SPEC-project-session-resource-model.md`](2026-06-25-SPEC-project-session-resource-model.md)
**目标读者**：后续执行的 AI Agent
**状态**：Draft

---

## 1. 测试目标

验证 MultiSoul 从 Agent-first 转为 Project / Session / Resource 模型后，用户能以项目和会话为主路径完成日常操作，同时旧 Agent API 和 CLI 仍兼容。

测试应覆盖：

- DB migration 后项目、资源、会话关系正确。
- Projects API 能返回 mobile 首页所需聚合数据。
- Mobile 首页和详情页以项目/会话为主对象。
- Activity / Push 能深链具体会话或决策卡。
- Specs / Workflows 改为绑定项目 + 默认资源。
- 旧 `/agents` 和 `msctl agent` 不破坏。

## 2. 测试数据约定

建议 E2E fixture 至少包含：

| ID | 内容 |
|----|------|
| endpoint A | label `openclawdmac-mini` |
| endpoint B | label `macbook-pro` |
| project A1 | endpoint A 上 path `/repo/multisoul` |
| project A2 | endpoint A 上 path `/repo/multisoul-desktop` |
| project B1 | endpoint B 上 path `/repo/multisoul`，用于验证跨 endpoint 不合并 |
| resources A1 | Codex 默认、Claude Code、Cursor CLI |
| sessions A1 | 一个 `awaiting_question`、一个 `running`、一个 `completed` |
| workflow A1 | 绑定 project A1 + 默认 Codex resource |

## 3. 后端 / CLI E2E

### E2E-01 DB migration backfills projects from existing agents

**Given**

- 旧 DB 中存在 3 条 `agents`：
  - `/repo/multisoul` + `codex`
  - `/repo/multisoul` + `claude-code`
  - `/repo/other` + `codex`
- 旧 DB 中存在属于前两条 agent 的 conversations。

**When**

- 启动新版 `msctl serve` 或运行 schema init/migration。

**Then**

- DB 中生成 2 条 projects。
- `/repo/multisoul` 下两条 agents 指向同一个 `project_id`。
- 既有 conversations 回填到对应 `project_id`。
- 旧 `agents.project_path` 仍存在且值不丢失。

### E2E-02 GET /api/v1/projects returns aggregated project data

**Given**

- project A1 有 3 个 resources。
- project A1 有 awaiting/running/completed sessions。

**When**

- 调用 `GET /api/v1/projects`。

**Then**

- 响应包含 project id、name、project_path。
- 响应包含 resource count。
- 响应包含 pending/running/completed session counts。
- project A1 排在 idle project 前。

### E2E-03 GET /api/v1/projects/:id/conversations returns project sessions

**Given**

- project A1 有 3 个 conversations。
- project A2 有 1 个 conversation。

**When**

- 调用 `GET /api/v1/projects/:projectA1/conversations`。

**Then**

- 只返回 project A1 的 conversations。
- 每条 conversation 包含 `agent_id` / resource display metadata。
- awaiting conversation 排在 running 和 completed 前。

### E2E-04 GET /api/v1/projects/:id/resources returns project-scoped resources

**Given**

- project A1 有 Codex、Claude、Cursor 三个 resources。
- project A2 有 Codex 一个 resource。

**When**

- 调用 `GET /api/v1/projects/:projectA1/resources`。

**Then**

- 只返回 project A1 的 resources。
- 默认 resource 可识别。
- 每个 resource 包含 runtime、mode、model/default metadata。

### E2E-05 POST /api/v1/projects/:id/conversations creates a session using default resource

**Given**

- project A1 默认 resource 为 Codex。

**When**

- 调用 `POST /api/v1/projects/:projectA1/conversations`，不显式传 resource id。

**Then**

- 创建 conversation。
- conversation.project_id = project A1。
- conversation.agent_id = project A1 default Codex resource。
- runtime dispatch 仍能启动 Codex session。

### E2E-06 legacy GET /api/v1/agents remains compatible

**Given**

- 已完成 migration。

**When**

- 调用 `GET /api/v1/agents`。

**Then**

- 响应仍为旧 AgentRow 结构。
- 每条记录仍包含 id、name、project_path、runtime、created_at。
- 旧 mobile 代码和测试 fixture 不需要立即修改即可解析。

### E2E-07 msctl agent quick register upserts project and resource

**Given**

- shell 当前目录为 `/repo/multisoul`。

**When**

- 执行 `msctl agent codex`。
- 再执行 `msctl agent claude-code`。

**Then**

- DB 中只有一条 `/repo/multisoul` project。
- Codex 和 Claude Code resources 均指向该 project。
- 注入式 runtime 指南仍写入正确 project path。

## 4. Mobile E2E / Integration

### E2E-08 Projects tab renders one project card for multiple resources

**Given**

- `fetchProjects` 返回 project A1，resource count = 3。

**When**

- 用户打开底部“项目”tab。

**Then**

- 页面只展示一张 `multisoul` 项目卡。
- 卡片展示 pending/running session 信息。
- Codex/Claude/Cursor 只作为 resource chip/badge 出现。

### E2E-09 Projects tab sorts by awaiting/running sessions

**Given**

- project A1 有 awaiting session。
- project A2 有 running session。
- project B1 idle。

**When**

- 用户打开项目首页。

**Then**

- project A1 排第一。
- project A2 排第二。
- idle project 排在后面。

### E2E-10 Project detail defaults to sessions

**Given**

- 用户点击 project A1。

**When**

- Project detail 打开。

**Then**

- 默认选中“会话”段。
- 会话列表出现 awaiting/running/completed sessions。
- 不默认展示资源列表。

### E2E-11 Project resources tab renders runtime resources

**Given**

- 用户在 project detail 点击“资源”。

**When**

- Resources tab 打开。

**Then**

- 显示 Codex、Claude Code、Cursor CLI resources。
- 默认 resource 有明确标记。
- 页面文案不把 resource 作为主工作对象。

### E2E-12 New project session uses default resource and can switch resource

**Given**

- project A1 默认 resource 为 Codex。

**When**

- 用户在 project detail 点击“新会话”。

**Then**

- Composer 默认显示 Codex。
- 用户可通过高级入口切换 Claude/Cursor。
- 发送第一条消息后创建 conversation，并绑定 project_id 与 agent_id。

### E2E-13 Activity awaiting row deep-links to session decision card

**Given**

- Activity 中有一条 awaiting_question event，关联 conversation C1。

**When**

- 用户点击该 Activity row 或 Push notification。

**Then**

- App 打开 C1 chat detail。
- Pending decision card 可见或被定位到。
- 不进入 resource/agent detail。

### E2E-14 Multi-endpoint same path stays separate

**Given**

- endpoint A 和 endpoint B 都返回 path `/repo/multisoul`。

**When**

- Mobile 聚合 projects。

**Then**

- 列表中显示两个独立项目，或通过 endpoint label 明确区分。
- 不把两个 endpoint 的 sessions/resources 合并。

## 5. Specs / Workflows E2E

### E2E-15 Specs target picker selects project and default resource

**Given**

- project A1 有默认 Codex resource。

**When**

- 用户新建 Idea / Spec 并选择目标。

**Then**

- 选择器主对象为 Project。
- 保存结果包含 project id。
- 后续实施默认使用 project default resource。

### E2E-16 Workflow create binds project and default resource

**Given**

- 用户创建 recurring workflow。

**When**

- 用户选择 project A1，不显式切换 resource。

**Then**

- Workflow 保存 project_id。
- Workflow 保存 default resource 或能从 project 默认值解析。
- Watch/recurring 触发时创建 project A1 下的新 conversation。

### E2E-17 Workflow trigger creates session under project

**Given**

- workflow W1 绑定 project A1。

**When**

- watch/recurring scheduler 触发 W1。

**Then**

- 创建 conversation C1。
- C1.project_id = project A1。
- C1.agent_id = resolved resource。
- Project detail sessions list 能看到 C1。

## 6. Regression

### E2E-18 Existing chat send path still works

**Given**

- 用户从旧 Agent detail 或兼容路径打开 chat。

**When**

- 用户发送消息。

**Then**

- Runtime dispatch 找到 agent runtime/mode/project path。
- Message 写入 conversation。
- conversation.project_id 不为空。

### E2E-19 Legacy agent list tests continue to pass during phase 1

**Given**

- 现有 mobile/CLI 测试仍使用 Agent fixture。

**When**

- Phase 1 后端模型完成。

**Then**

- 旧 `/agents` fixture 仍可解析。
- 旧 Agent detail route 不因缺字段崩溃。
- 新 Project route 使用新 fixtures。

## 7. 生成测试时的注意事项

- 优先用 API/integration tests 覆盖 DB migration、Projects API、legacy Agents API。
- Mobile 组件测试应 mock `/projects` 聚合响应，不要通过多次 `/agents/:id/conversations` 人工聚合来验证新首页。
- Activity deep link 测试必须验证目标是 conversation id，而不是 agent id。
- 对跨 endpoint 场景，mobile key 使用 `endpoint_id:project_id`；不要只用 project path。
- 测试名称应体现用户语言：Project / Session / Resource；底层兼容测试可继续使用 Agent。
