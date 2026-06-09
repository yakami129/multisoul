# `msctl spec` 完整命令面设计

## 1. 背景与目标

`spec` 域已经有一组 REST 能力支撑 mobile 的 Ideas to Specs 流程，但 CLI 只实现了：

```bash
msctl spec save --path <repo-relative> --conversation-id <uuid>
msctl spec mark-done --spec-id <uuid>
```

这导致 Agent、脚本和本地调试需要手写 HTTP 请求才能完成 list/get/dispatch/implement/idea 等操作。`msctl spec` 应成为 spec 域对外自动化入口，REST 继续服务 mobile 和协议层，CLI 负责把同一套能力包装成稳定、可发现、可复制的命令。

**目标：**

- 补齐 `spec` 域当前已实现 REST 能力的 CLI facade。
- 所有命令都保留 `msctl spec <subcommand>` 分组，不新增顶层平铺命令。
- 每个命令必须在 help/reference 中提供可复制示例。
- 复杂输入优先采用 JSON body，与 REST payload 对齐；简单 id/path 类操作继续使用 flags。
- CLI handler 通过 HTTP 调用现有 `msctl serve`，不绕过 REST 直接写 DB。

**非目标：**

- 不改 REST 路径、请求体和 mobile 调用方式。
- 不把 `/ws/*` 订阅做进本轮 `spec` 命令面。
- 不为旧顶层命令或 curl 示例增加长期兼容 alias。

## 2. 采访结论摘要

| 维度 | 决策 |
|------|------|
| 范围 | 覆盖完整 spec 域：artifacts、ideas、dispatch、implement、save、done |
| 输入风格 | JSON body 为主；复杂写命令使用 `--json` / `--json-file`，简单 id/path 类命令使用 flags |
| 输出风格 | 默认 `--output json`，所有写命令支持人类可读 text 摘要 |
| 实现边界 | CLI 统一走 HTTP，复用 auth、事件广播、状态转换和错误语义 |
| 兼容策略 | 沿用 R14 分组约束；本设计不新增顶层 alias，旧命令兼容不作为本轮独立决策 |
| 示例要求 | 每个子命令 help 和 `docs/references/cli-commands.md` 都必须有示例 |

## 3. 命令结构

### 3.1 顶层

```bash
msctl spec <COMMAND>
```

| 命令 | 说明 | REST 对应 |
|------|------|-----------|
| `spec list` | 列出已保存 SpecArtifact | `GET /api/v1/specs` |
| `spec get` | 查看单个 SpecArtifact 详情 | `GET /api/v1/specs/:id` |
| `spec save` | 从仓库内 spec 文件保存不可变 artifact snapshot | `POST /api/v1/specs/save-from-path` |
| `spec delete` | 删除 SpecArtifact | `DELETE /api/v1/specs/:id` |
| `spec implement` | 为已保存 spec 启动实现会话 | `POST /api/v1/specs/:id/implement` |
| `spec mark-done` | 标记 SpecArtifact 实现完成 | `POST /api/v1/specs/:id/done` |
| `spec dispatch` | 写入 repo spec 文件并派发给指定 agent 实现 | `POST /api/v1/agents/:id/specs/dispatch` |
| `spec idea ...` | 管理 Idea 到 Spec 的前置素材 | `/api/v1/spec-ideas*` |

通用参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--output <json\|text>` | `json` | JSON 保留完整 server response；text 输出短摘要 |
| `--token <TOKEN>` | saved auth token | 覆盖 `msctl auth login` 保存的 Bearer token |
| `--port <PORT>` | saved config port, else `8765` | 本地 `msctl serve` 端口 |
| `--host <HOST>` | `127.0.0.1` | 本地 `msctl serve` host |

从源码开发时，示例里的 `msctl` 可替换为：

```bash
cargo run --manifest-path cli/Cargo.toml -- spec ...
```

## 4. Artifact 命令

### 4.1 `msctl spec list`

列出所有已保存 spec artifacts。默认 JSON 直接返回 `{ "specs": [...] }`；text 输出紧凑表格，包含 id、status、title、repo path。

```bash
msctl spec list --output json
```

```bash
msctl spec list --output text
```

### 4.2 `msctl spec get`

查看单个 spec 详情，包括当前 artifact、latest version、markdown、source idea 和 implementation conversation。

```bash
msctl spec get \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

```bash
msctl spec get \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output text
```

### 4.3 `msctl spec save`

保留已实现语义：根据 interview conversation 的目标 repo 读取 repo-relative product spec 文件，保存不可变 artifact snapshot，并广播 `spec_changed`。

```bash
msctl spec save \
  --path docs/product-specs/2026-06-09-SPEC-demo.md \
  --conversation-id "$CONV_ID" \
  --output json
```

text 输出沿用当前实现的短摘要格式：

```bash
msctl spec save \
  --path docs/product-specs/2026-06-09-SPEC-demo.md \
  --conversation-id "$CONV_ID" \
  --output text
```

### 4.4 `msctl spec delete`

删除 spec artifact。此命令只包装 server 现有 `DELETE /api/v1/specs/:id` 语义；若 server 后续限制状态，CLI 不单独维护另一套规则。

```bash
msctl spec delete \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda
```

为避免误删，默认要求交互确认；自动化场景使用 `--yes`：

```bash
msctl spec delete \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --yes \
  --output text
```

### 4.5 `msctl spec implement`

为已保存 spec 启动实现 conversation，server 会写入 implementation instruction、更新 spec status 为 `planning`，并派发给目标 runtime。

```bash
msctl spec implement \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

text 输出至少包含新 conversation id：

```bash
msctl spec implement \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output text
```

### 4.6 `msctl spec mark-done`

保留已实现语义：标记 artifact 为 done，并广播 `spec_changed`。

```bash
msctl spec mark-done \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda
```

新增 `--output` 后，JSON 示例为：

```bash
msctl spec mark-done \
  --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \
  --output json
```

## 5. Dispatch 命令

### 5.1 `msctl spec dispatch`

用于“已有 markdown 内容，直接写入目标 agent repo 并启动实现”的场景。命令映射 agent-scoped REST route，但放在 `spec` 域下，以 `--agent-id` 指定目标。

JSON body 是权威输入形式。必填字段与 REST body 保持一致，`agent_id` 仍放在 flag 中，因为它来自 URL path 而不是 body：

| 参数 | 说明 |
|------|------|
| `--agent-id <ID>` | 目标 agent |
| `--json <JSON>` | inline `DispatchSpecBody` |
| `--json-file <PATH>` | 从文件读取 `DispatchSpecBody`；`-` 表示 stdin |

```bash
msctl spec dispatch \
  --agent-id "$AGENT_ID" \
  --json-file /tmp/dispatch-spec.json \
  --output json
```

`/tmp/dispatch-spec.json` 示例：

```json
{
  "title": "Workflow watch mode",
  "slug": "workflow-watch-mode",
  "markdown": "# Workflow watch mode\n\n## Background\n..."
}
```

stdin 示例，便于 Agent 管道化：

```bash
msctl spec dispatch \
  --agent-id "$AGENT_ID" \
  --json-file - \
  --output text < /tmp/dispatch-spec.json
```

不提供 `--date-prefix`，日期由 server 保持当前行为生成，避免 CLI 和 server 出现命名权威冲突。

## 6. Idea 命令

### 6.1 `msctl spec idea list`

列出 Ideas to Specs 模块里的 idea rows。

```bash
msctl spec idea list --output json
```

```bash
msctl spec idea list --output text
```

### 6.2 `msctl spec idea create`

创建 idea。JSON body 是权威输入形式，字段与 `SpecIdeaMutation` 保持一致。

```bash
msctl spec idea create \
  --json-file /tmp/spec-idea.json \
  --output json
```

inline JSON 示例：

```bash
msctl spec idea create \
  --json '{"title":"PR merge guardrail","target_agent_id":"agent_uuid","body":"用户希望把 PR 合并策略做成自动化守门流程。"}' \
  --output json
```

stdin 示例：

```bash
msctl spec idea create \
  --json-file - \
  --output text < /tmp/spec-idea.json
```

`/tmp/spec-idea.json` 示例：

```json
{
  "title": "PR merge guardrail",
  "target_agent_id": "agent_uuid",
  "body": "用户希望把 PR 合并策略做成自动化守门流程。",
  "notes": [
    { "body": "CI 未通过禁止合并" }
  ],
  "attachments": [
    {
      "kind": "link",
      "title": "Merge policy",
      "uri": "docs/runbooks/github-pr-merge-policy.md"
    }
  ]
}
```

### 6.3 `msctl spec idea update`

更新 idea。JSON body 只表达需要变更的字段；notes/attachments 仍遵循 server 当前语义，传入数组即完整替换。

```bash
msctl spec idea update \
  --idea-id "$IDEA_ID" \
  --json-file /tmp/spec-idea-update.json \
  --output json
```

```bash
msctl spec idea update \
  --idea-id "$IDEA_ID" \
  --json '{"status":"open","title":"PR merge guardrail v2"}' \
  --output text
```

### 6.4 `msctl spec idea archive`

归档 idea，包装 `PATCH /api/v1/spec-ideas/:id` 的 `status=archived`。

```bash
msctl spec idea archive \
  --idea-id "$IDEA_ID" \
  --output text
```

### 6.5 `msctl spec idea restore`

恢复已归档 idea，包装 `PATCH /api/v1/spec-ideas/:id` 的 `status=open`。

```bash
msctl spec idea restore \
  --idea-id "$IDEA_ID" \
  --output text
```

### 6.6 `msctl spec idea delete`

删除 idea。server 当前只允许删除 archived idea；CLI 不绕开该规则。

```bash
msctl spec idea delete \
  --idea-id "$IDEA_ID"
```

自动化场景：

```bash
msctl spec idea delete \
  --idea-id "$IDEA_ID" \
  --yes \
  --output text
```

### 6.7 `msctl spec idea interview`

为 idea 启动采访 conversation。若 idea 已经有 interview conversation，server 返回既有 conversation id；CLI 原样展示。

```bash
msctl spec idea interview \
  --idea-id "$IDEA_ID" \
  --output json
```

```bash
msctl spec idea interview \
  --idea-id "$IDEA_ID" \
  --output text
```

## 7. 实现结构

### 7.1 模块布局

```text
cli/src/main.rs
  Commands::Spec { subcommand: commands::spec::SpecCommands }

cli/src/commands/spec.rs             # SpecCommands + dispatch
cli/src/commands/spec_artifact.rs    # list/get/save/delete/implement/mark-done
cli/src/commands/spec_dispatch.rs    # dispatch JSON body command
cli/src/commands/spec_idea.rs        # idea subcommands
cli/src/commands/server_client.rs    # shared HTTP client/config/output helpers
cli/src/commands/json_input.rs       # --json / --json-file parser shared by write commands
```

`spec.rs` 只做 clap enum 和 dispatch，避免超过单文件 500 行，也保持与 `auth`、`agent` 的分组模式一致。

### 7.2 HTTP client 复用

当前 `save_spec.rs` 和 `mark_spec_done.rs` 各自实现 token/port/client 解析。完整命令面应抽出共享 helper：

- 从 `--token` 或 `msctl auth login` config 解析 token。
- 从 `--port` 或 config 解析 port。
- 统一 `http://{host}:{port}` base URL。
- 统一 5s timeout、HTTP 非 2xx 错误输出、JSON parse 错误。
- 统一 `--output json|text` 分派。

### 7.3 直接复用 REST，禁止双写 DB

所有新 `spec` 命令必须调用现有 REST route。理由：

- REST handler 已负责 `spec_changed` / `activity_changed` 广播。
- `implement`、`interview`、`dispatch` 会启动 runtime session，不能由 CLI 另写 DB 后假装完成。
- 认证和错误语义应与 mobile 看到的一致。
- 后续 server 规则变化时，CLI 不需要维护第二套状态机。

## 8. Help 与 Reference 要求

每个 Args struct 必须用 `#[command(after_help = "...")]` 提供至少一个完整示例。示例遵守以下规则：

- 使用安装后命令形态 `msctl spec ...`。
- 需要从源码运行时，在 reference 文档顶部给统一替换说明，不在每个命令重复。
- 复杂写命令的 clap help 展示 `--json-file` 示例；完整 JSON body 示例放在 reference 文档。
- 所有写命令示例都显式展示 `--output json` 或 `--output text`。
- 删除类命令同时展示人工确认和 `--yes` 自动化形式。

## 9. 验收标准

### 9.1 功能

- [ ] `msctl spec list/get/save/delete/implement/mark-done/dispatch` 可用。
- [ ] `msctl spec idea list/create/update/archive/restore/delete/interview` 可用。
- [ ] 所有命令支持 `--host`、`--port`、`--token`、`--output`。
- [ ] `dispatch`、`idea create`、`idea update` 支持 `--json` / `--json-file`，且二者互斥。
- [ ] JSON 输出保留 server response，不丢字段。
- [ ] text 输出包含关键 id、status、path/conversation id。
- [ ] 删除命令默认需要确认，`--yes` 可跳过确认。

### 9.2 文档

- [ ] `docs/references/cli-commands.md` 的 `msctl spec` 章节覆盖每个命令。
- [ ] 每个命令在 reference 中至少有一个可复制示例。
- [ ] 每个 command Args 的 `after_help` 至少有一个示例。
- [ ] 新增命令不出现在 `msctl` 顶层，符合 R14。

### 9.3 验证

- [ ] `cd cli && cargo test` 通过。
- [ ] `cd cli && cargo build` 通过。
- [ ] `bash scripts/check-cli-command-layout.sh` 通过。
- [ ] `python3 scripts/check-docs-indices.py` 通过。

## 10. 风险与权衡

| 风险 | 处理 |
|------|------|
| 命令数量变多 | 保持 `artifact` 操作在 `spec <verb>`，idea 操作在 `spec idea <verb>`，help 中按域分组 |
| JSON payload 手写成本高 | reference 给完整 JSON 文件示例；简单 id/path 类命令仍使用 flags |
| CLI 和 REST 状态机分叉 | CLI 只调 REST，不直接写 DB |
| 删除误操作 | 默认确认，自动化必须显式 `--yes` |
| 文档示例漂移 | 新命令验收要求同步更新 clap help 和 `docs/references/cli-commands.md` |

## 11. 后续扩展

- `msctl spec watch` 不纳入本轮；如需要实时订阅 `spec_changed`，应单独设计 WebSocket 调试命令。
- `msctl spec export` 可后续加入，用于把 saved artifact markdown 写回文件。
- 若更多功能域补 CLI facade，应抽象 `server_client.rs` 为跨 domain helper。
