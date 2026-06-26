# Project / Session / Resource 模型重构 SPEC

**日期**：2026-06-25
**状态**：Draft
**优先级**：高
**模块**：`cli/`、`mobile/`
**关联对话**：`87a095f6-6497-4edc-ba11-09de0cb7b1f3`

---

## 1. 背景与目标

当前 MultiSoul 首页以 Agent 为第一层对象。一个项目注册多个 runtime agent 后，同一路径会在首页重复出现多张卡片，用户难以回答“哪个项目需要我处理”。这暴露出领域模型问题：`agent.project_path` 同时承担项目身份、执行资源和入口卡片三种含义。

本规格将产品模型调整为：

```text
Project / 项目
  -> Session / 会话
      -> Resource / 运行资源
```

**目标**：

- 首页从“智能体舰队”转为“项目会话控制台”。
- 项目是工作上下文；会话是用户处理的任务对象；runtime/agent 是项目内运行资源。
- Activity / Push 深链到具体会话或决策卡，而不是只进入 Agent。
- Specs / Workflows 绑定项目和默认资源，不再强迫用户先理解 Agent 列表。
- 保留旧 `/agents` API 和 `msctl agent` 命令，分阶段兼容迁移。

## 2. 术语

| 用户术语 | 技术含义 |
|----------|----------|
| 项目 Project | 某台 endpoint 上的一个本地 project path。第一版全局身份为 `endpoint_id + normalized_project_path`；单个 `msctl serve` DB 内按 normalized path 去重。 |
| 会话 Session | 用户看到的任务/对话。技术上延续现有 `conversations` 表和 conversation API，但移动端文案用“会话”。 |
| 资源 Resource | 项目内可用 runtime 配置，由现有 `agents` 记录迁移/映射而来。第一版仍保留 `agent_id` 作为 runtime dispatch 绑定。 |
| Endpoint | 一台运行 `msctl serve` 的机器。Mobile 聚合多个 endpoint。 |

## 3. 用户决策记录

| 维度 | 决策 |
|------|------|
| 文档读者 | 后续执行的 AI Agent |
| 实施深度 | 分阶段完整模型 |
| 用户命名 | 项目 / 会话 / 资源 |
| Project identity | `endpoint_id + normalized_project_path` |
| 会话归属 | 会话归项目，并绑定执行资源 |
| 资源作用域 | 项目内资源 |
| 首页排序 | 待处理/运行中会话优先 |
| Activity / Push | 深链具体会话或决策卡 |
| 旧 `/agents` | 第一阶段保留，映射为资源 |
| DB | 新增 `projects`，`agents` 加 `project_id`，`conversations` 加 `project_id` |
| API | 新增 `/projects`，保留 `/agents` |
| CLI | 保留 `msctl agent`，新增 `project/resource` 语义 |
| Mobile 导航 | 底部“智能体”改为“项目” |
| Specs / Workflows | 绑定项目 + 默认资源 |
| 阶段顺序 | 后端模型 -> 移动端 -> 清理 |

## 4. 范围

### 4.1 In Scope

- CLI DB schema migration：
  - 新增 `projects` 表。
  - `agents` 增加 `project_id`。
  - `conversations` 增加 `project_id`。
  - 从既有 `agents.project_path` 回填 projects 和 conversation project ownership。
- 新增 Projects API：
  - 项目列表、详情、项目会话、项目资源。
  - 项目级创建会话，默认使用项目默认资源。
- 保留旧 Agents API，并让旧响应继续满足现有 mobile 代码与 runtime dispatch。
- CLI 命令过渡：
  - `msctl agent ...` 行为保持兼容。
  - 新增或预留 `msctl project` / `msctl resource` 语义命令。
- Mobile：
  - 底部“智能体”入口改为“项目”。
  - 项目首页展示项目及最近/待处理会话。
  - 项目详情默认展示会话列表。
  - 项目资源页展示 runtime resources。
  - Activity / Push 点击进入会话或决策卡。
  - Specs / Workflows 目标从 Agent 改为 Project + 默认 Resource。

### 4.2 Out of Scope

- 跨机器逻辑项目合并。第一版不把不同 endpoint 上的同路径项目自动合并。
- 删除旧 `agents.project_path` 字段。第一阶段保留用于兼容和回滚。
- 破坏式移除 `/api/v1/agents` 或 `msctl agent`。
- 重写 runtime worker。runtime dispatch 仍以 `agent_id` 找到 project path、runtime、mode、model。
- 引入云端中心后端。
- 重做 Chat 消息协议。会话 UI 名称改变，但底层 messages 结构保持。

## 5. 产品信息架构

### 5.1 底部导航

第一阶段将底部“智能体”改为“项目”。推荐导航：

```text
项目 / 规格 / 动态 / 设置
```

如当前实现仍使用四个 tab 槽位，原 Agents tab 的 route 可以保留，内容和文案切换为 Projects。这样减少导航迁移风险。

### 5.2 项目首页

首页回答一个问题：**哪个项目的哪个会话需要我？**

内容结构：

```text
Large title: 项目
Toolbar: Search, Add
Summary / attention area
Search
Project list
Bottom tab
```

项目卡展示：

- 项目名称。
- endpoint label。
- project path（中间截断）。
- 待处理/运行中会话数。
- 最近 1-2 个会话标题及状态。
- 可用资源 chip（Codex / Claude / Cursor 等），不作为主要标题。

排序规则：

1. 存在 `awaiting_question` 会话的项目。
2. 存在 `running` 会话的项目。
3. 最近 `last_message_at` 更新的项目。
4. 空闲项目。

### 5.3 项目详情

项目详情默认进入“会话”：

```text
Project header
Segmented control: 会话 / 资源 / 设置
会话列表
New Session CTA
```

会话列表展示：

- 会话标题。
- 状态：Needs You / Running / Done / Failed / Idle。
- 最近摘要或 first user message。
- 绑定资源 badge（例如 Codex · gpt-5）。
- 最后更新时间。

点击会话进入现有 Chat Detail。若会话包含待答决策卡，进入时应定位到决策卡或展示置顶 pending decision。

### 5.4 项目资源页

资源页展示当前项目内可用 runtime resources：

- Codex / Claude Code / Cursor CLI / OpenCode 等。
- 默认资源标识。
- mode / model。
- 当前运行会话数。
- 可用/空闲/失败状态。

资源不是首页主对象。它只回答“这个项目有哪些执行能力、默认用哪个、是否可用”。

### 5.5 Activity / Push

Activity row 和 Push payload 第一阶段必须包含足够上下文：

```text
project_name
conversation_id / session title
resource display name
status
```

点击行为：

- `awaiting_question`：进入对应会话，并定位到决策卡。
- `running`：进入对应会话的实时消息流。
- `completed` / `failed`：进入对应会话摘要或最终消息。

禁止只深链到 resource/agent 详情，因为用户要处理的是会话状态。

### 5.6 Specs / Workflows

Specs / Workflows 的目标选择改为 Project + 默认 Resource：

- 新建 Spec Idea：选择项目，系统使用项目默认资源作为实施资源；高级入口允许切换资源。
- Workflow：绑定项目和默认资源；触发时创建该项目下的新会话。
- 编辑 Workflow：可更换同 endpoint 下项目；资源默认跟随项目默认值，必要时单独覆盖。

## 6. API 需求

第一阶段新增 Projects API，同时保留 Agents API。

建议 API：

```text
GET  /api/v1/projects
GET  /api/v1/projects/:id
GET  /api/v1/projects/:id/conversations
GET  /api/v1/projects/:id/resources
POST /api/v1/projects/:id/conversations
```

响应应提供 mobile 首页需要的聚合字段，避免移动端为每个项目逐个拉取所有会话才能排序。

`GET /api/v1/agents` 第一阶段保持原响应字段：

```json
{
  "id": "agent-id",
  "name": "multisoul-codex",
  "project_path": "/Users/openclawd/Documents/code/multisoul",
  "runtime": "codex",
  "created_at": 123
}
```

Mobile 新代码应优先用 `/projects`；旧代码和兼容路径继续可用 `/agents`。

## 7. CLI 需求

### 7.1 兼容命令

以下命令保持可用：

```bash
msctl agent codex
msctl agent claude-code
msctl agent cursor-cli
msctl agent register --name work-codex --project /path/to/project --runtime codex
msctl agent list
```

兼容行为：

- quick register 当前目录时，先 upsert project，再注册/更新项目内资源。
- `agent list` 可继续输出旧列；后续可增加 `PROJECT` 和 `RESOURCE` 更清晰的文案。

### 7.2 新语义命令

第一阶段可以新增：

```bash
msctl project list
msctl project get <project-id>
msctl resource list --project <project-id|path>
msctl resource register --project <project-id|path> --runtime codex --name multisoul-codex
```

新命令不是必须一次全部完成，但产品规格要求最终语义从 Agent 迁到 Resource。

## 8. 验收标准

- [ ] 同一 endpoint + project path 下注册多个 runtime 后，移动端首页只显示一个项目卡。
- [ ] 项目卡展示最近/待处理会话，runtime 只作为资源 chip 或 badge 出现。
- [ ] 项目详情默认展示会话列表，而不是资源列表。
- [ ] 项目资源页能展示该项目内的 Codex / Claude / Cursor 等资源和默认资源。
- [ ] Activity 中的 awaiting question 点击进入具体会话/决策卡。
- [ ] Push 通知点击进入具体会话/决策卡。
- [ ] Specs 新建/实施目标可选择项目，并默认使用项目默认资源。
- [ ] Workflows 绑定项目和默认资源，触发后在项目下创建新会话。
- [ ] 旧 `/api/v1/agents` 仍可返回兼容数据。
- [ ] 旧 `msctl agent` quick register 仍可注册当前目录 runtime。
- [ ] 多 endpoint 下相同 path 的项目在 mobile 中保持不同项目，不被错误合并。
- [ ] 既有 conversation 历史在迁移后能通过 project detail 看到。

## 9. E2E 功能测试文档

验收标准派生的 E2E 功能测试用例见：

- [`2026-06-25-SPEC-project-session-resource-model-e2e.md`](2026-06-25-SPEC-project-session-resource-model-e2e.md)

## 10. 风险与约束

- `endpoint_id` 是 mobile 聚合层概念，CLI serve DB 内没有 endpoint id。后端 project 唯一性只能按单 endpoint DB 内 path 去重；mobile 使用 `endpoint_id:project_id` 作为全局 key。
- 旧 `agents.project_path` 不能第一阶段删除，否则 runtime dispatch、Specs、Workflow、测试 fixture 会大面积破坏。
- `conversations.project_id` 必须回填，否则项目详情无法可靠查历史会话。
- 资源默认值需要明确落点。第一阶段可以在 `projects.default_agent_id` 或 mobile 偏好中实现；推荐 server 持久化。
- 项目首页聚合字段应由 server 返回，否则 mobile 会出现 N+1 拉取和状态排序不一致。

## 11. 非目标后续项

- 跨 endpoint 逻辑项目合并。
- 项目图标/封面自定义。
- 资源池全局化。
- 会话跨资源迁移。
- 删除旧 Agent 命名和 API。
