# `msctl spec` 完整命令面 Implementation Plan

> **For agentic workers:** 本计划实施 `docs/design-docs/2026-06-09-msctl-spec-cli-design.md`。仓库约定：全部任务验证通过后再做一次代码 review；若提交，单次最终 commit，并把 SHA 写回 `docs/exec-plans/index.json`。

**Design Reference:** [`docs/design-docs/2026-06-09-msctl-spec-cli-design.md`](../design-docs/2026-06-09-msctl-spec-cli-design.md)

**Goal:** 补齐 `msctl spec` 对完整 spec 域的 CLI facade，覆盖 artifact、dispatch、idea 三组能力；复杂写命令采用 JSON body 输入；所有命令通过现有 REST route 调用 `msctl serve`，不直接写 DB。

**Architecture:** 保持 `Commands::Spec` 顶层分组。`commands/spec.rs` 继续作为 clap aggregator，新增 artifact、dispatch、idea handler 模块；抽出共享 server HTTP client 与 JSON input helper，复用 token/host/port/output 解析。

**Tech Stack:** Rust + clap 4 + reqwest blocking client + serde_json；现有 axum REST server；现有 docs index/check 脚本。

---

## Baseline Evidence

- [`cli/src/commands/spec.rs`](../../cli/src/commands/spec.rs) 当前只分发 `save` / `mark-done`。
- [`cli/src/commands/save_spec.rs`](../../cli/src/commands/save_spec.rs) 和 [`cli/src/commands/mark_spec_done.rs`](../../cli/src/commands/mark_spec_done.rs) 各自重复实现 token/port/client 解析。
- [`cli/src/serve/router.rs`](../../cli/src/serve/router.rs) 已暴露 spec REST：`/api/v1/specs*`、`/api/v1/spec-ideas*`、`/api/v1/agents/:id/specs/dispatch`。
- [`docs/references/cli-commands.md`](../references/cli-commands.md) 当前 `msctl spec` 章节只记录 `save` / `mark-done`。

## Implementation Boundaries

- 不新增顶层命令，所有新增入口都在 `msctl spec ...` 下。
- 不修改 REST route 语义，不新增 mobile 依赖。
- 不绕过 REST 直接写 SQLite；写操作必须复用 server handler 的事件广播和状态转换。
- 本轮不实现 `msctl spec watch` / WebSocket 订阅。
- 复杂写命令优先 `--json` / `--json-file`，二者互斥；`--json-file -` 读取 stdin。

---

## Task 1: Shared Command Helpers

**Files:**
- Create: `cli/src/commands/server_client.rs`
- Create: `cli/src/commands/json_input.rs`
- Modify: `cli/src/commands/mod.rs`

- [x] 抽出 `ServerOptions` / `OutputFormat`，支持 `--host`、`--port`、`--token`、`--output`。
- [x] 实现 base URL、Bearer token、5s timeout、HTTP error body 统一处理。
- [x] 实现 JSON request helpers：GET、POST JSON、PATCH JSON、DELETE、POST empty。
- [x] 实现 JSON input helper：`--json` / `--json-file` 互斥，`-` 表示 stdin。
- [x] 逐步迁移 `save_spec` / `mark_spec_done` 到 shared helper，避免重复逻辑。

**Verification:**
- `cd cli && cargo build`

---

## Task 2: Artifact Commands

**Files:**
- Create: `cli/src/commands/spec_artifact.rs`
- Modify: `cli/src/commands/spec.rs`
- Modify or retire duplicated logic in `save_spec.rs` / `mark_spec_done.rs`

- [x] Add `msctl spec list` -> `GET /api/v1/specs`。
- [x] Add `msctl spec get --spec-id` -> `GET /api/v1/specs/:id`。
- [x] Keep `msctl spec save --path --conversation-id` -> `POST /api/v1/specs/save-from-path`。
- [x] Add `msctl spec delete --spec-id [--yes]` -> `DELETE /api/v1/specs/:id`。
- [x] Add `msctl spec implement --spec-id` -> `POST /api/v1/specs/:id/implement`。
- [x] Keep `msctl spec mark-done --spec-id` -> `POST /api/v1/specs/:id/done`，并补 `--output`。
- [x] JSON output 原样打印 server response；text output 打印关键 id/status/path/conversation。

**Verification:**
- `cd cli && cargo run -- spec --help`
- `cd cli && cargo run -- spec list --help`
- `cd cli && cargo test`

---

## Task 3: Dispatch Command

**Files:**
- Create: `cli/src/commands/spec_dispatch.rs`
- Modify: `cli/src/commands/spec.rs`

- [x] Add `msctl spec dispatch --agent-id --json|--json-file`。
- [x] JSON body 必须至少包含 `title`、`slug`、`markdown`；验证交给 server，但 CLI 应拒绝空 JSON。
- [x] `--json-file -` 支持 stdin。
- [x] text output 至少打印 `conversation_id` 和 `repo_spec_path`。

**Verification:**
- `cd cli && cargo run -- spec dispatch --help`

---

## Task 4: Idea Commands

**Files:**
- Create: `cli/src/commands/spec_idea.rs`
- Modify: `cli/src/commands/spec.rs`

- [x] Add `msctl spec idea list` -> `GET /api/v1/spec-ideas`。
- [x] Add `msctl spec idea create --json|--json-file` -> `POST /api/v1/spec-ideas`。
- [x] Add `msctl spec idea update --idea-id --json|--json-file` -> `PATCH /api/v1/spec-ideas/:id`。
- [x] Add `msctl spec idea archive --idea-id` -> PATCH `{ "status": "archived" }`。
- [x] Add `msctl spec idea restore --idea-id` -> PATCH `{ "status": "open" }`。
- [x] Add `msctl spec idea delete --idea-id [--yes]` -> `DELETE /api/v1/spec-ideas/:id`。
- [x] Add `msctl spec idea interview --idea-id` -> `POST /api/v1/spec-ideas/:id/interview`。
- [x] text output 打印关键 idea id/status/title 或 conversation id。

**Verification:**
- `cd cli && cargo run -- spec idea --help`
- `cd cli && cargo run -- spec idea create --help`

---

## Task 5: Documentation

**Files:**
- Modify: `docs/references/cli-commands.md`
- Possibly modify: command `after_help` strings in new Args structs

- [x] 更新顶层命令说明：`spec` 覆盖完整 spec 域。
- [x] 扩展 `msctl spec` 章节，覆盖每个命令的参数、默认值、说明。
- [x] 每个命令至少提供一个可复制示例。
- [x] 为复杂 JSON body 提供文件示例，避免用户手写长 inline JSON。

**Verification:**
- `rg -n "msctl spec (list|get|save|delete|implement|mark-done|dispatch)|msctl spec idea" docs/references/cli-commands.md`

---

## Task 6: Tests and Validation

**Files:**
- Extend or add tests under `cli/tests/` or module unit tests if low-cost.

- [x] Add tests for JSON input parsing mutual exclusion and stdin/file behavior if practical.
- [x] Add tests for text summary functions where practical.
- [x] Verify clap help paths for new subcommands.

**Final Verification:**
- [x] `cd cli && cargo test`
- [x] `cd cli && cargo build`
- [x] `bash scripts/check-cli-command-layout.sh`
- [x] `python3 scripts/check-docs-indices.py`
- [x] `git diff --check`

---

## Risk Notes

- **Command surface size:** Keep artifact verbs flat under `spec`, idea verbs under `spec idea`.
- **JSON body ergonomics:** Prefer `--json-file` examples in docs and help; inline JSON is supported for scripts.
- **Existing helper duplication:** Shared helper migration can touch existing `save` / `mark-done`; keep behavior compatible.
- **Serve dependency:** Commands that call REST require running `msctl serve` and a saved or explicit token; error messages should point to `msctl auth login` or `--token`.
