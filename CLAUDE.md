# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. **Facts and constraints below mirror [`AGENTS.md`](AGENTS.md)** where they overlap; this file adds commands, UI checklist, and architecture detail.

## Mandatory: Read AGENTS.md at Session Start

**Every conversation must begin by reading `AGENTS.md`** in the project root. It contains the agent navigation map and is required context before any task.

---

## 1. 项目概览（与 AGENTS.md 一致）

MultiSoul 是 **个人 AI Agent 随身控制台**。手机端遥控本地运行的 AI Agent（Claude Code / Codex），实时看工具调用、回应决策请求、收完成推送。**零中心后端**，数据 100% 留在用户本机。

Monorepo 两大件：

- **`mobile/`** — React Native + Expo SDK 55，NativeWind，React Query，Zustand，expo-router，expo-sqlite
- **`cli/`** — Rust，可执行文件名 `msctl`（axum 0.7，tokio 1，rusqlite 0.31 bundled，clap 4）

产品规格：`docs/product-specs/SPEC.md`。系统架构：`ARCHITECTURE.md`。

---

## 2. 关键约束（与 AGENTS.md 一致；违反前先看 §9 常用命令）

机械化（pre-commit + CI 拦截，详见 [`docs/quality/mechanized-constraints.md`](docs/quality/mechanized-constraints.md)）：

- **不可硬编码 token** —— 检测 `ms_v2_xxx` / `Bearer xxx`
- **Mobile 颜色合规** —— 仅 [`mobile/docs/design.md`](mobile/docs/design.md) §2 白名单内的色
- **Mobile feature 边界** —— `features/*` 跨域只能走公共入口，禁止深路径 import
- **AGENTS.md ≤ 150 行** —— 超长则拒绝 commit
- **单文件 ≤ 500 行** —— `mobile/src|app`、`cli/src` 源码；超长需拆分封装（见 mechanized-constraints）
- **mobile 禁 `console.log`** —— 仅允许 `console.warn` / `console.error`
- **改包必跑 typecheck/cargo check**
- **Rust 禁止 `#[allow(...)]`** —— `cli/src` 中不得用 `#[allow]` 压制任何编译器/clippy 诊断；脚本 [`scripts/check-no-allow.sh`](scripts/check-no-allow.sh) 拦截
- **Design doc 代码 hash 保鲜** —— tracked code 变更须先审阅 diff、更新设计文档（或于文档内说明为何正文不变），再对该篇执行 `python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md`；禁止未审阅即批量刷新 hash

人类可读软约束：

- 不要碰 `~/.config/msctl/*` —— 用户本地数据
- DB schema 改动走 migration —— 不允许运行时 `CREATE TABLE`（本仓库中 SQLite 由 `cli/src/db.rs` 统一演进，纪律同上）
- REST/WS 强制 Bearer auth —— 唯一例外 `GET /api/v1/healthz`
- 结构化决策见 §7 **Ask User Question** —— 禁止自由文本列选项或让用户打字回答
- **禁止直接 push main** —— 所有变更必须通过 PR；直接 push 会被 GitHub branch protection 拒绝
- **PR 开启前必须验证** —— `cargo test` + `cargo build` + `pnpm typecheck` + `pnpm test --watchAll=false` 全部通过
- **开 PR 需用户确认** —— Claude Code 自动 commit 到功能分支后，必须等用户确认才能执行 `gh pr create`
- **CI 失败自动修复** —— 读取 `gh run view --log-failed` 日志，修复 lint/type/fmt 错误后 re-push；**修复 = 解决根本原因**（重构代码、删未用项、修类型），绝不用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 压制；逻辑错误上报用户
- **CI 未通过禁止合并（强约束）** —— PR 须等 GitHub Actions 全部通过后再合并；不得在红 CI 下合并，不得以管理员选项绕过硬闸；配置核对见 [`docs/runbooks/github-pr-merge-policy.md`](docs/runbooks/github-pr-merge-policy.md)
- **同一用户流程只能有一个权威实现** —— 不要为同一 screen / route / protocol 复制并行实现；新增入口必须复用既有权威组件或抽共享模块。发现旧版分叉时，迁移入口并删除旧实现，测试覆盖入口收敛。
- **Agent 本地 iOS 发布从仓库根启动** —— 不要把工具 `workdir` 直接设为 `mobile/` 后运行 `./scripts/publish-ios-local.sh`；当前运行环境可能按仓库根目录注入 `APP_STORE_CONNECT_*`，直接以 `mobile/` 启动会导致脚本误报缺少 ASC API Key。应在仓库根目录执行同一条 `cd mobile && ./scripts/publish-ios-local.sh`。

---

## 3. 技术栈速览（与 AGENTS.md 一致）

| 域 | 栈 |
|----|----|
| Mobile | React Native, Expo SDK 55, expo-router, Zustand, React Query, NativeWind, expo-sqlite |
| CLI | Rust, axum 0.7, tokio 1, rusqlite 0.31 (bundled), clap 4 |
| 协议 | REST (JSON) + WebSocket (stream-json), 全部 Bearer auth |
| 推送 | Expo Push Service（CLI 直调 `exp.host`） |
| 公网 | Tailscale Funnel |

---

## 4. 文档地图（与 AGENTS.md 一致）

| 问题 | 去哪儿 |
|------|--------|
| **整体架构、协议、数据流** | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| **要做什么、为什么做**（产品规格、验收） | [`docs/product-specs/`](docs/product-specs/) |
| **某 feature 怎么设计的**（方案权衡） | [`docs/design-docs/`](docs/design-docs/) |
| **历史执行计划、施工步骤** | [`docs/exec-plans/`](docs/exec-plans/) |
| **API 路径、消息类型、env vars** | [`docs/references/`](docs/references/)（占位）+ [`README.md`](README.md) |
| **代码规范、release checklist** | [`docs/quality/`](docs/quality/)（占位）+ 本文 |
| **iOS 发布、CLI 发布等 SOP** | [`mobile/docs/ios-publish.md`](mobile/docs/ios-publish.md)（本地 `scripts/publish-ios-local.sh` / 云端 `publish-ios.sh`）· [`docs/runbooks/cli-release.md`](docs/runbooks/cli-release.md) · [`docs/runbooks/README.md`](docs/runbooks/README.md) |
| **`msctl serve` 跑挂了怎么查** | [`docs/runbooks/debugging.md`](docs/runbooks/debugging.md) — `msctl logs` 4 个故事 |
| **PR 合并与 CI 强闸** | [`docs/runbooks/github-pr-merge-policy.md`](docs/runbooks/github-pr-merge-policy.md) |
| **UI 设计系统**（颜色、字号、间距） | [`mobile/docs/design.md`](mobile/docs/design.md) |
| **RN UI 常见坑** | [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |
| **Agent 短导航地图** | [`AGENTS.md`](AGENTS.md) |
| **面向人类的快速上手** | [`README.md`](README.md) |
| **msctl 命令速记（`msctl inject`）** | [`docs/references/msctl-inject.md`](docs/references/msctl-inject.md)；完整参考 [`docs/references/cli-commands.md`](docs/references/cli-commands.md) |
| **`docs/specs/`、`docs/superpowers/`** | **勿再新增权威文档** · [`docs/superpowers/README.md`](docs/superpowers/README.md) |

---

## 5. 改完代码必跑的验证（与 AGENTS.md 一致）

| 改了 | 跑 |
|------|----|
| `mobile/**` TS/TSX | `cd mobile && pnpm typecheck` |
| `mobile/**` 测试相关 | `cd mobile && pnpm test -- --watchAll=false` |
| `cli/**` Rust | `cd cli && cargo test` |
| `cli/**` 编译检查 | `cd cli && cargo build` |
| 改了 UI | 对照 [`mobile/docs/design.md`](mobile/docs/design.md) §11 checklist |
| 改了 RN 列表/刷新 | 对照 [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |

### Regression Tests

- Every bug fix must include a focused regression test that fails before the fix and passes after the fix.
- If the bug crosses layers, cover the boundary that broke (for example: WebSocket → store, DB persistence → UI load, route fetch → Inbox backfill).
- Do not ship behavior-only fixes without tests unless the user explicitly accepts the risk; document the reason in the final response.

---

## 6. Interaction & Output Constraints (Low-Input Scenarios)

- Assume by default that the user may be in a situation where typing is inconvenient; minimize the need for free-text input.
- **MANDATORY: When user decisions are needed** (e.g., choosing an approach, whether to continue, selecting environment, risk trade-offs, release options, architecture choices), **prefer** the `AskUserQuestion` tool with structured options. **If `AskUserQuestion` is unavailable, you MUST call `msctl ask-question`** (see §7). Never ask decision questions in plain text or ask the user to type an answer.
- For enumerable decisions, provide 2-5 clear options first (including "Other/Later" when appropriate), so users can complete feedback via single- or multi-select.
- Avoid open-ended follow-up questions unless necessary; if needed, provide options first, then add "You may type additional details if needed."
- Keep responses in short, information-dense sentences: conclusion first, options second, supplementary notes last; avoid long paragraphs.
- When a task can be executed directly with controllable risk, prefer execute first, report after; only trigger the question tool at key decision branches.

---

## 7. 给 Agent 的协作约定（与 AGENTS.md 一致）

### Ask User Question (`msctl ask-question`)

**MANDATORY**

- For structured decisions (approach, continue/stop, risk trade-offs, etc.), **prefer** the `AskUserQuestion` tool when available.
- **If the current runtime does not expose `AskUserQuestion`, you MUST call `msctl ask-question` to push a question card to iOS.** Never list options in free text or ask the user to type an answer.
- After pushing, continue other work. Do not poll; iOS answers are injected into the same conversation automatically.

Run `msctl ask-question -h` for flags, JSON shape, and copy-paste examples.

- 用户场景常常 **不便打字**。涉及决策一律按上文 MANDATORY 执行；有 `AskUserQuestion` 时用该工具给 2-5 个结构化选项，**不要让用户敲字回答**
- 行动前先检索本地文件，不要凭记忆回答
- 修改代码后必须按 §5 跑验证；引入了 lint error **必须修根本原因，禁止用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 等抑制指令掩盖**
- 同一用户流程只能有一个权威实现；避免为不同入口复制 screen / route / protocol 逻辑。需要多入口时，让入口只做参数准备，统一跳到同一页面或调用同一模块。
- **文档落盘**：产品 / 功能规格 → **只** [`docs/product-specs/`](docs/product-specs/)（`YYYY-MM-DD-SPEC-<feature>.md`）；实施 / 执行计划 → **只** [`docs/exec-plans/`](docs/exec-plans/)（`YYYY-MM-DD-<feature>.md`）；设计权衡 → `docs/design-docs/YYYY-MM-DD-<feature>-design.md`（命名见 [`docs/design-docs/README.md`](docs/design-docs/README.md)）。**勿**在 [`docs/specs/`](docs/specs/)、[`docs/superpowers/`](docs/superpowers/) 新增权威内容。**Superpowers skills**（`writing-plans`、`executing-plans`、`brainstorming` 等）在本仓库落盘**必须**使用上述路径 · [`docs/superpowers/README.md`](docs/superpowers/README.md)
- **Exec plan 施工**：`docs/exec-plans/*.md` 所列任务 **全部验证通过后一次** `git commit`；**不要**套用 Superpowers `subagent-driven-development` 的「每任务一 commit」。该次提交后把对应 `documents[]` 条目的 `lastCompletedCommit` 写入 [`docs/exec-plans/index.json`](docs/exec-plans/index.json)（40 位小写 hex，`git rev-parse HEAD`），便于 `git revert <sha>` 撤回该批改动。
- **Commit 前强制 review**：每次 `git commit` 前必须执行 `requesting-code-review`，修复 Critical/Important 反馈并重新跑对应验证后，才允许提交。若当前运行环境不允许自动派发 subagent，则在当前会话按该 skill 的审查标准执行等效 review。
- **执行方式选择（强制）**：writing-plans 写完计划后，**必须**用 `AskUserQuestion` 工具弹出问答卡片，让用户在「Subagent 驱动（推荐）」和「当前会话内联执行」之间选择，**禁止**在纯文本里提问或自行假设默认选项。
- **Image Output**：生成图片（图表、截图、可视化）时，保存为文件并在回复中用 Markdown 语法引用：`![描述](/绝对路径/image.png)`。支持格式：png、jpg、jpeg、gif、webp。MultiSoul 手机端会自动渲染为内联缩略图，点击可全屏查看。
- 不要把规则塞进 `AGENTS.md`。`AGENTS.md` 只长指针，不长内容

---

## 8. 添加新规则的原则（与 AGENTS.md 一致，Harness 增量学习）

每条新规则都应来自一次真实的 Agent 犯错。流程：

1. Agent 犯错 → 分析根因
2. 把约束写到对应位置（`CLAUDE.md` / `docs/quality/` / `mobile/docs/design.md` 等）
3. 在 `AGENTS.md` §4 的地图里加指针（如果是新类别）
4. 必要时把约束机械化（lint / hook / CI），让规则从"建议"升级为"法律"

> `AGENTS.md` 超过 150 行就该重构 —— 把详细内容沉淀到 `docs/` 子目录，导航文件只保留指针。

---

## 9. 常用命令（精简版见 AGENTS.md；此处为展开版）

### Mobile (React Native / Expo)

```bash
cd mobile

# Install deps
pnpm install

# Start dev server (run manually in terminal)
pnpm start

# iOS / Android
pnpm ios
pnpm android

# Type check
pnpm typecheck

# Tests (single run, no watch)
pnpm test -- --watchAll=false
```

### CLI (Rust)

```bash
cd cli

# Build
cargo build

# Run
cargo run -- <command>

# Tests
cargo test

# Run a single test
cargo test <test_name>

# Local HTTP/WS
cargo run -- serve

# Runtime AskUserQuestion push (local dev; use installed `msctl ask-question` outside source)
cargo run -- ask-question --conversation-id "$CONV_ID" --questions '[...]' --output json
```

See §7 **Ask User Question** for MANDATORY rules. Run `msctl ask-question -h` for flags, JSON shape, and copy-paste examples.

### iOS 发布

#### 本地（本机 Xcode，日常默认）

人类终端在 `mobile` 下 **只需执行** `./scripts/publish-ios-local.sh`：脚本内会 `pnpm install`、`pod install`、archive、export；上传 App Store Connect / TestFlight 需在环境中配置脚本文件头注释中的 `APP_STORE_CONNECT_*`（见 `mobile/scripts/publish-ios-local.sh`）。**无需**再单独跑 `eas login` 或把 `pnpm typecheck` 当作发布前置步骤（发版前质量闸仍以 PR / `CLAUDE.md` §5 为准）。

Agent / 自动化运行时必须从仓库根目录启动，并在同一个 shell 里 `cd mobile` 后执行。不要把工具 `workdir` 设成 `mobile/` 再运行脚本；否则按仓库根目录注入的 `APP_STORE_CONNECT_*` 可能不会进入脚本进程。

```bash
cd mobile

./scripts/publish-ios-local.sh

# 仅打 IPA：./scripts/publish-ios-local.sh --build-only
# 仅上传已有 IPA：./scripts/publish-ios-local.sh --submit-only --ipa=/path/to/MultiSoul.ipa
```

#### 云端（EAS Build + TestFlight）

```bash
cd mobile

./scripts/publish-ios.sh              # 构建 + 提交 TestFlight（一键）
./scripts/publish-ios.sh --build-only
./scripts/publish-ios.sh --submit-only
```

发布前确认 `eas.json` 中 `submit.production.ios` 已填写 `appleId`、`ascAppId`、`appleTeamId`。

**当用户说「本地发布 iOS」「本机打包 iOS」或等价表述时**，在仓库根异步执行并跟日志：

```bash
cd mobile && ./scripts/publish-ios-local.sh > /tmp/publish-ios-local.log 2>&1
```

关键点：命令的启动目录必须是仓库根目录；`cd mobile && ...` 要写在同一个命令字符串里。不要用工具参数把 `workdir` 改成 `mobile/` 后直接跑 `./scripts/publish-ios-local.sh`。

**当用户明确要云端 EAS / 沿用历史一键脚本时**：

```bash
cd mobile && ./scripts/publish-ios.sh > /tmp/publish-ios.log 2>&1
```

用 `run_in_background: true` 异步执行，然后持续 `tail -f` 对应日志文件直到结束。

---

## 10. 系统架构摘要（与 ARCHITECTURE.md 一致；非旧版 Java 后端）

- **msctl serve**：本机 axum 服务，REST `/api/v1/*`、WebSocket `/ws/conversations/{id}`、Expo Push 出站。
- **数据**：SQLite 于 `~/.config/msctl/serve.db`（agents、conversations、messages、tasks、push_tokens 等），由 `cli/src/db.rs` 管理。
- **认证**：除 `GET /api/v1/healthz` 外，HTTP/WS 需 `Authorization: Bearer <token>`（部分场景亦支持 query token；以 `ARCHITECTURE.md` 为准）。
- **运行时**：`cli/src/serve/runtime*` 等对接 Claude Code / Codex 等。

主要 HTTP 路由（摘自 `ARCHITECTURE.md`）：

```
GET   /api/v1/healthz
GET   /api/v1/agents
GET   /api/v1/agents/:id
GET   /api/v1/agents/:id/conversations
POST  /api/v1/agents/:id/conversations
GET   /api/v1/conversations/:id/messages
POST  /api/v1/conversations/:id/messages
POST  /api/v1/push-tokens
DEL   /api/v1/push-tokens/:id
WS    /ws/conversations/:id
```

### Mobile 目录结构（与 ARCHITECTURE.md 一致）

```
mobile/src/
├── api.ts            # Axios client，base URL = 当前选中端点
├── types.ts          # 跨模块 TS 类型
├── store/            # Zustand：本地/认证状态
├── features/         # agents/, chat/, inbox/, settings/ 等
└── components/       # 共享 UI（含 ui/）

mobile/app/           # Expo Router
├── (tabs)/
└── agent/
```

状态：Zustand（本地/认证）、React Query（服务端状态，如 30s 轮询）、expo-sqlite（Inbox 等持久化）。

### CLI 目录结构（与 ARCHITECTURE.md 一致）

```
cli/src/
├── main.rs           # clap 命令树入口
├── config.rs         # ~/.config/msctl/config.toml 读写
├── db.rs             # SQLite 初始化与 schema
├── commands/         # auth, agent, serve, logs, ...
└── serve/            # mod, state, auth, push, runtime, routes, ...
```

---

## 11. UI Design System

The mobile app uses a **dark modern aesthetic** — near-black backgrounds, white text, orange (`#FF6B35`) accent for actions. Full spec: `mobile/docs/design.md` (source) and `mobile/docs/design.html` (rendered reference).

### Color Palette

| Role | Value |
|------|-------|
| Page background | `#0D0D0D` |
| Card / component surface | `#1A1A1A` |
| Deep surface (unread rows) | `#111111` |
| Bottom Sheet background | `#161616` |
| Divider | `#1E1E1E` |
| Primary text | `#FFFFFF` |
| Secondary text | `#DDDDDD` |
| Muted text | `#888888` |
| Disabled / placeholder | `#666666` |
| Dim text (timestamps) | `#555555` |
| Accent / action | `#FF6B35` |
| Success / selected | `#4CAF50` |

### Typography

| Role | Font | Size |
|------|------|------|
| Brand / display | Anton | 32px+ |
| Page titles | Inter | 28px / 700 |
| Body / labels | Inter | 11–16px |

### Key Rules

- Tab Bar: `cornerRadius` 36px, height 62px (capsule shape)
- Input row: `cornerRadius` 26px, height 52px
- `#FF6B35` only for CTA, unread badges, selected state — not decoration
- Colors restricted to the palette in `mobile/docs/design.md` §2; enforced by `scripts/check-mobile-colors.sh`
- Icons: Lucide only, 16×16px for Tab Bar / actions
- Spacing on 4px grid; see `mobile/docs/design.md §4` for exact values
- Before any UI change, run through the checklist in `mobile/docs/design.md §9`
- Before any UI change, also check `mobile/docs/rules/ui-pitfalls.md` — common React Native UI bugs to avoid (e.g. RefreshControl coupled to isFetching, focus refetch triggering spinner)

---

## 12. 环境变量与配置

`msctl` 以 **`~/.config/msctl/config.toml`** 与本机 SQLite 为主；端口、token、Tailscale Funnel 等见 `msctl serve --help` 与 [`ARCHITECTURE.md`](ARCHITECTURE.md)。机器可读的 env / 契约占位见 [`docs/references/`](docs/references/) 与 [`README.md`](README.md)。

---

## 13. PR 工作流（Claude Code 行为约束）

### 开发时
- 分支命名：`feat/<desc>`, `fix/<desc>`, `chore/<desc>`

### 完成功能后
1. 在分支上运行 `cargo test` + `cargo build` + `cd mobile && pnpm typecheck` + `pnpm test -- --watchAll=false`
2. 用 `commit` skill 提交代码
3. **等用户确认**后，执行 `gh pr create`，PR body 包含 Summary / Test plan / Risk 三段
4. 等待 CI 结果（`gh pr checks`）；**仅当全部检查通过后再** `gh pr merge`（或网页合并）

### CI 失败时
1. `gh run view --log-failed` 读取日志
2. 尝试修复 lint/type/fmt 错误并 re-push
3. 复杂错误上报用户等待指示

### 禁止
- `git push origin main`（任何情况）
- 在 main 分支上 commit
- **CI 未绿时合并 PR**（含使用「绕过 protection」类操作）

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%). Format flags (-c, -l, -L, -o, -Z) run raw.
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
