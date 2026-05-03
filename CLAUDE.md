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
- **AGENTS.md ≤ 120 行** —— 超长则拒绝 commit
- **单文件 ≤ 500 行** —— `mobile/src|app`、`cli/src` 源码；超长需拆分封装（见 mechanized-constraints）
- **mobile 禁 `console.log`** —— 仅允许 `console.warn` / `console.error`
- **改包必跑 typecheck/cargo check**
- **Rust 禁止 `#[allow(...)]`** —— `cli/src` 中不得用 `#[allow]` 压制任何编译器/clippy 诊断；脚本 [`scripts/check-no-allow.sh`](scripts/check-no-allow.sh) 拦截

人类可读软约束：

- 不要碰 `~/.config/msctl/*` —— 用户本地数据
- DB schema 改动走 migration —— 不允许运行时 `CREATE TABLE`（本仓库中 SQLite 由 `cli/src/db.rs` 统一演进，纪律同上）
- REST/WS 强制 Bearer auth —— 唯一例外 `GET /api/v1/healthz`
- 决策用 `AskUserQuestion` 工具调用 —— 不在自由文本问选择题
- **禁止直接 push main** —— 所有变更必须通过 PR；直接 push 会被 GitHub branch protection 拒绝
- **PR 开启前必须验证** —— `cargo test` + `cargo build` + `pnpm typecheck` + `pnpm test --watchAll=false` 全部通过
- **开 PR 需用户确认** —— Claude Code 自动 commit 到功能分支后，必须等用户确认才能执行 `gh pr create`
- **CI 失败自动修复** —— 读取 `gh run view --log-failed` 日志，修复 lint/type/fmt 错误后 re-push；**修复 = 解决根本原因**（重构代码、删未用项、修类型），绝不用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 压制；逻辑错误上报用户
- **同一用户流程只能有一个权威实现** —— 不要为同一 screen / route / protocol 复制并行实现；新增入口必须复用既有权威组件或抽共享模块。发现旧版分叉时，迁移入口并删除旧实现，测试覆盖入口收敛。

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
| **iOS 发布、CLI 发布等 SOP** | [`docs/runbooks/cli-release.md`](docs/runbooks/cli-release.md) · [`mobile/docs/ios-publish.md`](mobile/docs/ios-publish.md) · [`docs/runbooks/README.md`](docs/runbooks/README.md) |
| **`msctl serve` 跑挂了怎么查** | [`docs/runbooks/debugging.md`](docs/runbooks/debugging.md) — `msctl logs` 4 个故事 |
| **UI 设计系统**（颜色、字号、间距） | [`mobile/docs/design.md`](mobile/docs/design.md) |
| **RN UI 常见坑** | [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |
| **Agent 短导航地图** | [`AGENTS.md`](AGENTS.md) |
| **面向人类的快速上手** | [`README.md`](README.md) |
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
- **MANDATORY: When user decisions are needed** (e.g., choosing an approach, whether to continue, selecting environment, risk trade-offs, release options, architecture choices), **ALWAYS use the `AskUserQuestion` tool with structured options** instead of asking the user to type manually. Never ask decision questions in plain text.
- For enumerable decisions, provide 2-5 clear options first (including "Other/Later" when appropriate), so users can complete feedback via single- or multi-select.
- Avoid open-ended follow-up questions unless necessary; if needed, provide options first, then add "You may type additional details if needed."
- Keep responses in short, information-dense sentences: conclusion first, options second, supplementary notes last; avoid long paragraphs.
- When a task can be executed directly with controllable risk, prefer execute first, report after; only trigger the question tool at key decision branches.

---

## 7. 给 Agent 的协作约定（与 AGENTS.md 一致）

- 用户场景常常 **不便打字**。涉及决策（方案选择、是否继续、风险权衡）一律用 `AskUserQuestion` 工具给 2-5 个结构化选项，**不要让用户敲字回答**
- 行动前先检索本地文件，不要凭记忆回答
- 修改代码后必须按 §5 跑验证；引入了 lint error **必须修根本原因，禁止用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 等抑制指令掩盖**
- 同一用户流程只能有一个权威实现；避免为不同入口复制 screen / route / protocol 逻辑。需要多入口时，让入口只做参数准备，统一跳到同一页面或调用同一模块。
- **文档落盘**：产品 / 功能规格 → **只** [`docs/product-specs/`](docs/product-specs/)（`SPEC-<feature>.md`）；实施 / 执行计划 → **只** [`docs/exec-plans/`](docs/exec-plans/)（`YYYY-MM-DD-<feature>.md`）；设计权衡 → `docs/design-docs/YYYY-MM-DD-<feature>-design.md`（命名见 [`docs/design-docs/README.md`](docs/design-docs/README.md)）。**勿**在 [`docs/specs/`](docs/specs/)、[`docs/superpowers/`](docs/superpowers/) 新增权威内容。**Superpowers skills**（`writing-plans`、`executing-plans`、`brainstorming` 等）在本仓库落盘**必须**使用上述路径 · [`docs/superpowers/README.md`](docs/superpowers/README.md)
- 不要把规则塞进 `AGENTS.md`。`AGENTS.md` 只长指针，不长内容

---

## 8. 添加新规则的原则（与 AGENTS.md 一致，Harness 增量学习）

每条新规则都应来自一次真实的 Agent 犯错。流程：

1. Agent 犯错 → 分析根因
2. 把约束写到对应位置（`CLAUDE.md` / `docs/quality/` / `mobile/docs/design.md` 等）
3. 在 `AGENTS.md` §4 的地图里加指针（如果是新类别）
4. 必要时把约束机械化（lint / hook / CI），让规则从"建议"升级为"法律"

> `AGENTS.md` 超过 120 行就该重构 —— 把详细内容沉淀到 `docs/` 子目录，导航文件只保留指针。

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
```

### iOS 发布 (EAS Build + TestFlight)

```bash
cd mobile

# 构建 + 提交 TestFlight（一键）
./scripts/publish-ios.sh

# 只构建
./scripts/publish-ios.sh --build-only

# 只提交最新构建
./scripts/publish-ios.sh --submit-only
```

发布前确认 `eas.json` 中 `submit.production.ios` 已填写 `appleId`、`ascAppId`、`appleTeamId`。

**当用户说「发布一下 iOS」或类似指令时，Claude 应直接执行**（在仓库根目录下，异步跑脚本并跟日志）：

```bash
cd mobile && ./scripts/publish-ios.sh > /tmp/publish-ios.log 2>&1
```

用 `run_in_background: true` 异步执行，然后持续 `tail -f /tmp/publish-ios.log` 监听日志输出，直到脚本结束。

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

The mobile app uses a **Vault-Tec PIP-BOY terminal aesthetic** (Fallout CRT green-phosphor). Full spec: `mobile/docs/design.md` (source) and `mobile/docs/design.html` (rendered reference).

### Color Palette

| Role | Value |
|------|-------|
| Page background | `#040D04` |
| Card/nav surface | `#061206` |
| Deep surface | `#0A1A0A` |
| Border/divider | `#0F2B0F` |
| Primary text / active | `#20C20E` |
| Bright / data values | `#33FF33` |
| Secondary text | `#2D8B2D` |
| Body text | `#147A16` |
| Muted / footer text | `#0F6B0F` |
| Button label (on green) | `#040D04` |

### Typography

| Role | Font | Size |
|------|------|------|
| Display / headings | Anton | 52–120px |
| Card titles / buttons | Anton | 13–14px |
| Nav / labels / eyebrow | Inter | 11–13px |
| Body paragraphs | Geist | 15px |
| Terminal input | Geist Mono | 16px |

### Key Rules

- `cornerRadius` max 2px (terminal style is square)
- No shadows except the Hero title glow (`#20C20E88`, blur 24px)
- Colors restricted to the palette in `mobile/docs/design.md` §2 (greens + Vault-Tec warning amber/red for error states only); enforced by `scripts/check-mobile-colors.sh`
- Icons: Lucide only, 14×14px for inline, 16×16px for actions
- Spacing on 4px grid; see `mobile/docs/design.md §4` for exact values
- Before any UI change, run through the checklist in `mobile/docs/design.md §11`
- Before any UI change, also check `mobile/docs/rules/ui-pitfalls.md` — common React Native UI bugs to avoid (e.g. RefreshControl coupled to isFetching, focus refetch triggering spinner)

---

## 12. 环境变量与配置

`msctl` 以 **`~/.config/msctl/config.toml`** 与本机 SQLite 为主；端口、token、Tailscale Funnel 等见 `msctl serve --help` 与 [`ARCHITECTURE.md`](ARCHITECTURE.md)。机器可读的 env / 契约占位见 [`docs/references/`](docs/references/) 与 [`README.md`](README.md)。

---

## 13. PR 工作流（Claude Code 行为约束）

### 开发时
- 优先使用 `git worktree`（skill `superpowers:using-git-worktrees`）隔离开发
- 分支命名：`feat/<desc>`, `fix/<desc>`, `chore/<desc>`

### 完成功能后
1. 在分支上运行 `cargo test` + `cargo build` + `cd mobile && pnpm typecheck` + `pnpm test -- --watchAll=false`
2. 用 `commit` skill 提交代码
3. **等用户确认**后，执行 `gh pr create`，PR body 包含 Summary / Test plan / Risk 三段
4. 等待 CI 结果（`gh pr checks`）

### CI 失败时
1. `gh run view --log-failed` 读取日志
2. 尝试修复 lint/type/fmt 错误并 re-push
3. 复杂错误上报用户等待指示

### 禁止
- `git push origin main`（任何情况）
- 在 main 分支上 commit
