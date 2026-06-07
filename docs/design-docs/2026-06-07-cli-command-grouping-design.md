# CLI 命令分组（`msctl spec`）Design

## 1. 背景与目标

当前 spec 相关 CLI 以顶层平铺命令存在：

```bash
msctl save-spec --path ... --conversation-id ...
msctl mark-spec-done --spec-id ...
```

这与已建立的分组模式不一致（`msctl auth login`、`msctl agent list`、`msctl daemon status`），也不利于 spec 域后续扩展（`list`、`get`、`dispatch` 等）。

**目标：**

- 收敛为 `msctl spec <subcommand>` 分组
- 文档写清「新 CLI 功能域必须分组」的约定
- 机械化 lint（R14）防止后续研发在顶层新增平铺命令

**非目标：**

- 不迁移存量顶层基础设施命令（`serve`、`ask-question`、`logs`）
- 不改 REST API（`/api/v1/specs/*` 路径与语义不变）
- mobile 端无改动

## 2. 采访结论摘要

| 维度 | 决策 |
|------|------|
| 核心痛点 | 可发现性 + 与 auth/agent 一致性 + spec 命名空间，权重相当 |
| 本轮范围 | spec 迁移 + 约定文档 + lint 只防新增违规 |
| 向后兼容 | **硬切** — 删除 `save-spec` / `mark-spec-done`，文档与脚本同步改 |
| 子命令命名 | `save` + `mark-done` |
| Lint 边界 | 只查 `main.rs` `Commands` enum + 基础设施白名单（见 §4） |
| 文档落盘 | 本 design doc + [`docs/exec-plans/2026-06-07-cli-command-grouping.md`](../exec-plans/2026-06-07-cli-command-grouping.md) |

## 3. 目标 CLI 结构

### 3.1 用户面命令

```bash
msctl spec save --path <repo-relative> --conversation-id <uuid>
msctl spec mark-done --spec-id <uuid>
msctl spec --help    # 列出 save / mark-done 及参数说明
```

硬切后以下命令**不存在**（clap 报 unknown subcommand）：

```bash
msctl save-spec ...
msctl mark-spec-done ...
```

### 3.2 分组约定（新功能必须遵守）

| 类型 | 模式 | 示例 |
|------|------|------|
| **功能域** | `msctl <domain> <subcommand>` | `auth`、`agent`、`daemon`、`spec` |
| **基础设施** | 允许顶层无 subcommand | `serve`、`logs`、`ask-question` |

新增功能域时：

1. 在 `cli/src/main.rs` 增加 `Domain { subcommand: DomainCommands }` variant
2. 在 `cli/src/commands/<domain>.rs` 定义 `DomainCommands` enum + `handle()`
3. 具体 handler 可拆到 `commands/<domain>_<action>.rs` 或保留独立模块由 aggregator dispatch
4. **禁止**在 `Commands` 顶层新增 `VerbNoun(args)` 平铺 variant（如 `SaveSpec`、`MarkSpecDone`）

## 4. 代码结构

### 4.1 迁移后模块布局

```
cli/src/main.rs
  Commands::Spec { subcommand: commands::spec::SpecCommands }

cli/src/commands/spec.rs           # 新增：SpecCommands enum + handle()
cli/src/commands/save_spec.rs      # 保留：SaveSpecArgs + handle()
cli/src/commands/mark_spec_done.rs # 保留：MarkSpecDoneArgs + handle()
cli/src/commands/mod.rs            # pub mod spec;
```

对齐 [`cli/src/commands/auth.rs`](../../cli/src/commands/auth.rs)：`spec.rs` 只做 clap 定义与 dispatch，实现留在子模块。

### 4.2 `SpecCommands` 草案

```rust
#[derive(Subcommand)]
pub enum SpecCommands {
    /// Save a repo spec file as a MultiSoul artifact snapshot
    Save(commands::save_spec::SaveSpecArgs),
    /// Mark a spec artifact as implementation complete
    MarkDone(commands::mark_spec_done::MarkSpecDoneArgs),
}
```

子命令 clap 名：`save`、`mark-done`（kebab-case，与 agent 子命令风格一致）。

### 4.3 REST / 实现层

- `save_spec.rs` / `mark_spec_done.rs` 的 HTTP 调用逻辑**不变**
- `cli/src/serve/spec/` 下 REST 路由**不变**
- 仅 CLI 入口与文档引用更新

## 5. Lint 设计（R14）

### 5.1 为什么 v1 只查 `main.rs`

1. **权威注册点** — clap CLI 面对外暴露面即 `enum Commands`；分组模式在此定义。
2. **与现有脚本一致** — 参照 [`scripts/check-cli-test-layout.sh`](../../scripts/check-cli-test-layout.sh)：bash + regex，pre-commit 友好。
3. **`commands/` 是实现细节** — handler 可拆文件；强制「每域单文件」会与 R6（500 行上限）冲突。
4. **精准防破窗** — 目标是不再出现顶层 `SaveSpec` 类 variant，而非约束模块树深度。

### 5.2 为什么 v1 不做 `cli-commands.md` 自动 sync

- 仓库尚无「改 CLI 必改 reference doc」的机械化先例
- 本次为一次性迁移；验收 checklist 人工更新 [`docs/references/cli-commands.md`](../references/cli-commands.md)
- 后续若需机械化，可单独加 R15 或对本文档 `trackedFiles` 扩展

### 5.3 脚本：`scripts/check-cli-command-layout.sh`

| 规则 ID | 说明 |
|---------|------|
| R14-1 | 解析 `cli/src/main.rs` 中 `enum Commands { ... }` 每个 variant |
| R14-2 | variant 必须满足其一：(a) 含 `subcommand:` 的分组模式；(b) 名称在基础设施白名单 |
| R14-3 | 白名单（常量，脚本内文档化）：`Serve`、`AskQuestion`、`Logs` |
| R14-4 | 违规示例：`SaveSpec(...)`、`MarkSpecDone(...)`、`FooBar(...)` 等顶层平铺 |

**检测范围：** 全量扫描 `cli/src/main.rs`（CI）；pre-commit 仅在 staged 含 `cli/src/main.rs` 时运行或始终 cheap 全量（与 R13 一致，始终全量 cheap）。

**接入：**

- [`.husky/pre-commit`](../../.husky/pre-commit)
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) `repo-checks`
- [`docs/quality/mechanized-constraints.md`](../quality/mechanized-constraints.md) 登记为 R14

### 5.4 违规时的修复指引

```
ERROR: CLI command layout violation — new top-level Commands variant must use Subcommand grouping or be infrastructure-whitelisted.

  SaveSpec(...): use msctl spec save via Commands::Spec { subcommand: ... }

Whitelist: Serve, AskQuestion, Logs
Doc: docs/design-docs/2026-06-07-cli-command-grouping-design.md
```

## 6. 需同步更新的引用

| 文件 | 变更 |
|------|------|
| [`docs/references/cli-commands.md`](../references/cli-commands.md) | 顶层命令表 + `msctl spec` 章节 |
| [`cli/AGENTS.md`](../../cli/AGENTS.md) / inject 块 | Quick Reference |
| [`cli/src/serve/spec/routes/ideas.rs`](../../cli/src/serve/spec/routes/ideas.rs) | Agent 指引字符串中的 `msctl save-spec` |
| 历史 product-spec / exec-plan 中的命令示例 | `save-spec` → `spec save`，`mark-spec-done` → `spec mark-done` |

## 7. 验收标准

### 7.1 功能

- [ ] `msctl spec save --path ... --conversation-id ...` 行为与原 `save-spec` 一致
- [ ] `msctl spec mark-done --spec-id ...` 行为与原 `mark-spec-done` 一致
- [ ] `msctl spec --help` 列出 `save`、`mark-done` 及参数说明
- [ ] `msctl save-spec` / `msctl mark-spec-done` 返回 unknown command（硬切）

### 7.2 机械化

- [ ] `bash scripts/check-cli-command-layout.sh` 全仓通过
- [ ] 故意在 `main.rs` 添加顶层 `FooBar` variant → pre-commit / CI 失败
- [ ] R14 已写入 `mechanized-constraints.md`；pre-commit + CI 已接入

### 7.3 质量

- [ ] `cd cli && cargo test && cargo build` 通过
- [ ] `rg 'save-spec|mark-spec-done'` 在 `cli/src` 与 `docs/references` 中无残留（历史 product-spec 正文可保留语境但示例须更新）

## 8. 风险与权衡

| 权衡 | 选择 | 理由 |
|------|------|------|
| 兼容 vs 干净 | 硬切 | 项目早期；alias 增加 clap 与文档维护成本 |
| Lint 范围 | 仅 `main.rs` | 精准、低成本、与 clap 注册点对齐 |
| 存量顶层命令 | 白名单保留 | `ask-question` 归组留待后续独立 PR |
| product-spec vs design-doc | 仅 design-doc | 偏架构/约定；验收写在本 doc §7 |

## 9. 后续扩展（不在本轮）

- `msctl spec list` / `get` — 读操作 CLI 封装
- `ask-question` → `msctl chat ask-question` 或类似分组
- R15：`cli-commands.md` 与 `main.rs` 变更联动检查
