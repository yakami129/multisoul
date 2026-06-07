# Ideas to Specs 重构 SPEC

## 1. 背景与目标

当前 Spec 管理模块已经验证了最短闭环：手机端创建 spec 草稿，通过固定结构化问答生成 `SPEC.md` preview，再派发给 agent 执行。但该模型把真实需求澄清简化成五道固定选择题，用户只能围绕预设问题填空，无法自然地把零散想法、日志、链接、截图和补充上下文交给 AI 逐步整理。

本次重构的目标是把 Spec 模块从“固定问答表单”升级为“需求资产工作流”：

```text
Idea 自由草稿
  -> 绑定项目 / agent
  -> 普通 Chat 中需求采访
  -> agent 写入 repo spec 文件
  -> msctl save-spec 保存 artifact 快照
  -> Specs 列表可见
  -> 新建 implementation Chat 进入实施
```

重构后，MultiSoul 应该让用户在手机端低成本捕捉想法，再由本地 agent 在对话中把想法塑形成可执行规格。手机端负责管理 Idea 与 Spec 资产，Chat 负责澄清和实施，Activity 负责执行状态回流。

## 2. 范围

### 2.1 In Scope

- Specs 一级 Tab 调整为 `Ideas / Specs` 两段。
- 新增 `Idea` 对象，与 `Spec` 对象分离。
- Idea 支持自由笔记、追加编辑、多条 note 合并。
- Idea V1 支持文本、链接、日志片段、截图图片。
- 开始采访前，Idea 必须绑定目标项目和 agent。
- 从 Idea 开启需求采访时，复用普通 Chat conversation，而不是专用问答表单页。
- 需求采访中的结构化决策继续使用 `msctl ask-question` / `AskUserQuestion` 问答卡片。
- agent 判断核心章节足够后，必须先向用户确认，再生成并保存 spec。
- agent 在目标 repo 写入 `docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md`。
- 新增 `msctl save-spec --path <repo-relative-path> --conversation-id <id>`，由 CLI 读取 repo 文件并保存 spec artifact。
- `save-spec` 后，原 Idea 自动归档并链接到生成的 Spec。
- Spec 使用 repo 文件 + artifact 快照作为权威记录。
- Spec 版本为不可变快照；V1 UI 只展示最新版本。
- 用户从 Spec 发起实施时，新建 implementation Chat，并引用该 Spec。
- Spec 行展示关联 Chat / Activity 的状态摘要。
- 手机通过 CLI 持久化记录、REST 权威读取、WS 变更通知和本地镜像保持同步。

### 2.2 Out of Scope

- 独立 Runs 板块或 Run 对象。
- 多 agent 并行实施。
- 手机端完整 markdown 编辑器。
- 任意文件附件。
- 复杂版本 diff、回滚和版本浏览 UI。
- 自动拆任务、自动 PR、自动 merge。
- 云端 LLM 生成 spec。
- 手机端从任意 markdown 消息中猜测并解析 spec。

## 3. 用户与使用场景

### 3.1 典型用户

- 使用 Claude Code / Codex / Cursor 等本地 agent 的个人开发者。
- 经常在手机端临时想到功能、bugfix、体验优化，但不方便一次性写完整规格的人。
- 希望 AI 先把需求问清楚，再让 agent 基于明确规格实施的人。

### 3.2 关键场景

1. 用户在手机上创建 Idea，随手输入一段模糊想法，并附加相关日志或截图。
2. 用户选择目标项目和 agent，点击开始采访。
3. MultiSoul 打开普通 Chat，并把 Idea 上下文注入给 agent。
4. agent 通过自由对话和问答卡片澄清目标、范围、非目标、验收标准和风险。
5. agent 判断规格核心章节完整且未决问题可见后，询问用户是否生成 spec。
6. 用户确认后，agent 在 repo 中写入 `docs/product-specs/...md`，再调用 `msctl save-spec`。
7. 手机端 Specs 列表实时出现新 Spec，原 Idea 自动归档。
8. 用户打开 Spec，查看最新 artifact 快照、repo path 和关联采访 Chat。
9. 用户点击实施，MultiSoul 新建 implementation Chat，并引用该 spec 让 agent 先写实施计划。
10. 用户在 Chat 中确认计划后，agent 开始实现；Spec 行通过关联 Chat / Activity 展示状态摘要。

## 4. 信息架构与交互逻辑

### 4.1 Specs Tab

Specs Tab 包含两个主段：

- `Ideas`：尚未转成 Spec 的自由草稿，以及已归档但可追溯的 Idea。
- `Specs`：已保存的规格资产，每个 Spec 行默认展示最新版本。

`Runs` 不作为 V1 板块出现。实施状态通过 Spec 行的关联 Chat / Activity 摘要体现，完整执行细节仍在 Chat 和 Activity 中查看。

### 4.2 Idea 列表与详情

Idea row 展示：

- 标题或首行摘要。
- 目标项目 / agent。
- 状态：`open`、`interviewing`、`converted`、`archived`、`failed`。
- 最近更新时间。
- 关联采访 Chat 或生成的 Spec。

Idea detail 支持：

- 编辑自由笔记。
- 追加 note。
- 合并多条 note。
- 添加链接、日志片段、截图图片。
- 选择或更换目标项目 / agent。
- 开始或继续采访。

### 4.3 需求采访 Chat

从 Idea 开始采访时，MultiSoul 创建或打开关联 Chat，并注入：

- Idea 正文和 notes。
- 附件摘要和可访问引用。
- 目标项目路径。
- 目标 agent 信息。
- 对 agent 的采访指令。

agent 在 Chat 中承担“澄清需求并帮助塑形”的角色。它可以主动建议范围裁剪、交互方案和实现约束，但不能跳过用户确认直接保存 spec。

结构化决策必须使用问答卡片：

- runtime 原生支持 `AskUserQuestion` 时优先使用该工具。
- 否则调用 `msctl ask-question`。
- 回答会以同一 conversation 的用户消息注入，agent 继续采访。

### 4.4 Spec 生成与保存

当 agent 判断以下信息足够时，应建议生成 spec：

- 背景与目标明确。
- In Scope / Out of Scope 明确。
- 主要用户流程明确。
- UI/UX 要求明确到可实施。
- 状态、错误、边界情况有覆盖。
- 验收标准可检查。
- 未决问题已显式列出。

agent 必须先向用户确认是否生成 spec。用户确认后：

1. agent 在目标 repo 写入 `docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md`。
2. agent 调用：

```bash
msctl spec save \
  --path docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md \
  --conversation-id "$CONV_ID"
```

3. CLI 根据 conversation 和 agent 归属解析目标 repo，读取该文件内容。
4. CLI 保存 spec artifact 快照，并广播 `spec_changed`。
5. 手机端刷新 Specs 列表。
6. 原 Idea 自动归档，并记录 `convertedSpecId`。

### 4.5 Spec 详情与实施入口

Spec detail 展示：

- 标题。
- 当前最新版本号。
- repo path。
- artifact 快照内容。
- markdown hash。
- 来源 Idea。
- 采访 Chat。
- 最近实施 Chat / Activity 摘要。

用户点击实施时，MultiSoul 新建 implementation Chat，而不是复用采访 Chat。新 Chat 初始消息引用 spec，并要求 agent：

1. 阅读项目规则和 spec。
2. 先写实施计划。
3. 等待用户确认计划。
4. 确认后实施。
5. 如遇阻塞，通过问答卡片回问用户。
6. 完成后报告修改文件和验证结果。

## 5. 状态模型

### 5.1 IdeaStatus

```ts
type IdeaStatus =
  | 'open'
  | 'interviewing'
  | 'converted'
  | 'archived'
  | 'failed';
```

状态说明：

- `open`：用户仍在记录想法。
- `interviewing`：已绑定 Chat，正在需求采访。
- `converted`：已生成 Spec，保留来源关系。
- `archived`：不再默认显示在 Ideas 主列表。
- `failed`：采访或转换失败，需要用户处理。

### 5.2 SpecStatus

```ts
type SpecStatus =
  | 'draft'
  | 'ready'
  | 'planning'
  | 'implementing'
  | 'blocked'
  | 'done'
  | 'failed';
```

状态说明：

- `draft`：存在 artifact 记录，但未被用户确认进入实施。
- `ready`：可用于新建 implementation Chat。
- `planning`：implementation Chat 正在产出或等待确认计划。
- `implementing`：agent 已开始实施。
- `blocked`：关联 Chat / Activity 中存在待用户处理的问题。
- `done`：关联实施完成。
- `failed`：保存、计划或实施失败。

V1 的 `planning` / `implementing` / `blocked` / `done` / `failed` 可由关联 Chat / Activity 派生，不要求单独 Run 表。

## 6. 数据模型与接口

### 6.1 Idea

```ts
interface SpecIdea {
  id: string;
  title: string;
  status: IdeaStatus;
  targetAgentId: string;
  targetEndpointId: string;
  targetRepoPath: string;
  targetAgentName: string;
  body: string;
  notes: SpecIdeaNote[];
  attachments: SpecIdeaAttachment[];
  interviewConversationId?: string;
  convertedSpecId?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

interface SpecIdeaNote {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface SpecIdeaAttachment {
  id: string;
  kind: 'link' | 'log' | 'image';
  title?: string;
  uri?: string;
  text?: string;
  fileId?: string;
  createdAt: number;
}
```

### 6.2 Spec Artifact

```ts
interface SpecArtifact {
  id: string;
  title: string;
  slug: string;
  status: SpecStatus;
  targetAgentId: string;
  targetEndpointId: string;
  targetRepoPath: string;
  repoSpecPath: string;
  latestVersionId: string;
  sourceIdeaId?: string;
  interviewConversationId: string;
  latestImplementationConversationId?: string;
  linkedActivityItemId?: string;
  createdAt: number;
  updatedAt: number;
}

interface SpecArtifactVersion {
  id: string;
  specId: string;
  revision: number;
  repoSpecPath: string;
  markdown: string;
  markdownSha256: string;
  sourceConversationId: string;
  createdAt: number;
}
```

Spec version 是不可变快照。后续修订会创建新的 `SpecArtifactVersion`，并更新 `SpecArtifact.latestVersionId`。V1 列表只展示最新版本。

### 6.3 CLI Command

```bash
msctl spec save \
  --path <repo-relative-spec-path> \
  --conversation-id <conversation-id> \
  --output json
```

行为：

- 读取与 conversation 关联的 agent / repo。
- 验证 `--path` 是 repo 内相对路径。
- 验证文件存在、非空、扩展名为 `.md`。
- 验证路径位于 `docs/product-specs/`。
- 读取 markdown，提取 title 和 slug。
- 计算 `markdownSha256`。
- 如果该 path 对应已有 spec，则创建不可变新版本。
- 如果是新 spec，则创建 Spec artifact。
- 写入 conversation artifact 记录。
- 返回 spec id、version id、repo path、revision。

返回示例：

```json
{
  "spec_id": "spec_123",
  "version_id": "specver_456",
  "repo_spec_path": "docs/product-specs/2026-06-06-SPEC-example.md",
  "revision": 1,
  "status": "saved"
}
```

### 6.4 HTTP / WS

新增或调整接口：

- `GET /api/v1/spec-ideas`
- `POST /api/v1/spec-ideas`
- `PATCH /api/v1/spec-ideas/:id`
- `POST /api/v1/spec-ideas/:id/interview`
- `GET /api/v1/specs`
- `GET /api/v1/specs/:id`
- `POST /api/v1/specs/:id/implement`
- `POST /api/v1/specs/save-from-path`

WS 事件：

```json
{
  "type": "spec_changed",
  "spec_id": "spec_123",
  "conversation_id": "conv_123"
}
```

WS 事件只负责实时通知；REST 仍是冷启动、重连和最终一致性的权威读取通道。

## 7. 错误与边界情况

- 目标 endpoint 不可用：Idea 不能开始采访，显示可恢复错误。
- 目标 agent 不存在：提示重新选择 agent。
- 采访 Chat 创建失败：Idea 保持 `open` 或 `failed`，不丢失草稿。
- agent 写入 spec 文件失败：不调用 `save-spec`，Chat 中说明失败原因。
- `save-spec` path 越界：CLI 返回错误，不读取 repo 外文件。
- `save-spec` 文件不存在：CLI 返回明确错误。
- `save-spec` 文件重名但内容不同：创建新 version，不覆盖旧快照。
- `save-spec` markdown 为空或无法提取标题：CLI 返回错误，Spec 不进入列表。
- WS 推送丢失：手机下次 REST 刷新必须能看到最新 Spec。
- 手机离线：Idea 本地草稿仍可编辑；需要服务端动作的采访、保存、实施入口禁用或提示连接 endpoint。

## 8. 验收标准

1. 用户可以在 Specs Tab 的 Ideas 段创建自由草稿。
2. Idea 支持编辑正文、追加 note、合并多条 note。
3. Idea V1 支持文本、链接、日志片段和截图图片附件。
4. 开始采访前，用户必须选择目标项目和 agent。
5. 从 Idea 开始采访会打开普通 Chat，并把 Idea 上下文传给 agent。
6. 采访过程中 agent 可以通过 `msctl ask-question` 推送结构化问题卡片。
7. agent 判断信息足够时，必须先请求用户确认生成 spec。
8. 用户确认后，agent 可在 repo 写入 spec 文件，并调用 `msctl save-spec --path --conversation-id`。
9. CLI 能读取 repo 内 spec 文件，保存 artifact 快照，并返回 spec id/version id。
10. `save-spec` 后，原 Idea 自动归档并链接到新 Spec。
11. Specs 段实时出现新 Spec；重启 app 后也能通过 REST 加载。
12. Spec 列表只展示最新版本。
13. Spec 详情展示最新 artifact 快照、repo path、markdown hash、来源 Idea 和采访 Chat。
14. 用户点击实施会新建 implementation Chat，并引用 spec。
15. implementation Chat 的首轮要求 agent 先写实施计划并等待用户确认。
16. Spec 行展示关联 Chat / Activity 的状态摘要。
17. endpoint 不可用、agent 不存在、路径非法、文件不存在、文件为空、WS 丢失等情况有明确错误或恢复路径。

## 9. 未决问题

- 历史版本 UI 是否在 V2 展示为版本列表、diff，还是只在调试入口可见。
- Idea 附件中的截图图片是否复用现有 Chat upload/file_id 管线，还是建立 Specs 专属附件表。
- `save-spec` 是否允许 agent 显式传 `--idea-id`，从而减少通过 conversation 反查来源 Idea 的歧义。
- Spec status 从 Chat / Activity 派生的具体映射规则是否需要单独设计文档。
