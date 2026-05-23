# AGENTS.md — MultiSoul 导航地图

> 本文是 **地图，不是说明书**（约 100 行）。它告诉你"去哪儿查"，不复制具体内容。
> 详细规则、命令、设计请按下方指针深入。
> 设计参考：[Harness Engineering](https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world)
>
> **与 [`CLAUDE.md`](CLAUDE.md) 对齐**：项目描述、关键约束、技术栈、文档地图、改完验证、协作约定、新规则原则等 **同一主题在两边表述一致**；`CLAUDE.md` 另含展开命令、架构摘要、UI 设计系统。

## 1. 这是什么

MultiSoul 是 **个人 AI Agent 随身控制台**。手机端遥控本地运行的 AI Agent（Claude Code / Codex），实时看工具调用、回应决策请求、收完成推送。**零中心后端**，数据 100% 留在用户本机。

Monorepo 两大件：

- `mobile/` — React Native + Expo SDK 55
- `cli/` — Rust，可执行文件名 `msctl`

## 2. 关键约束（违反前先看 §6）

机械化（pre-commit + CI 拦截，详见 [`docs/quality/mechanized-constraints.md`](docs/quality/mechanized-constraints.md)）：

- **不可硬编码 token** —— 检测 `ms_v2_xxx` / `Bearer xxx`
- **Mobile 颜色合规** —— 仅 [`mobile/docs/design.md`](mobile/docs/design.md) §2 白名单内的色
- **Mobile feature 边界** —— `features/*` 跨域只能走公共入口，禁止深路径 import
- **本文 ≤ 150 行** —— 超长则拒绝 commit
- **单文件 ≤ 500 行** —— `mobile/src|app`、`cli/src` 源码；超长需拆分封装（见 mechanized-constraints）
- **mobile 禁 `console.log`** —— 仅允许 `console.warn` / `console.error`
- **改包必跑 typecheck/cargo check**
- **Rust 禁止 `#[allow(...)]`** —— `cli/src` 中不得用 `#[allow]` 压制编译器/clippy 诊断；[`scripts/check-no-allow.sh`](scripts/check-no-allow.sh) 拦截
- **Design doc 代码 hash 保鲜** —— tracked code 变更须先审阅 diff、更新设计文档（或于文档内说明为何正文不变），再对该篇执行 `python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md`；禁止未审阅即批量刷新 hash

人类可读软约束：

- 不要碰 `~/.config/msctl/*` —— 用户本地数据
- DB schema 改动走 migration —— 不允许运行时 `CREATE TABLE`
- REST/WS 强制 Bearer auth —— 唯一例外 `GET /api/v1/healthz`
- 决策用 `AskUserQuestion` 工具调用 —— 不在自由文本问选择题
- **CI 未通过禁止合并 PR** —— 强约束，见 [`docs/runbooks/github-pr-merge-policy.md`](docs/runbooks/github-pr-merge-policy.md)
- **必须使用 `git worktree` 开发** —— 在独立 worktree 的功能分支上改代码；**禁止**在 **`main` 检出目录**直接提交产品变更（见 [`.cursor/rules/git-worktree-development.mdc`](.cursor/rules/git-worktree-development.mdc)、Superpowers `using-git-worktrees`）
- 同一用户流程只保留一个权威实现 —— 详见 [`CLAUDE.md`](CLAUDE.md) §2/§7

## 3. 技术栈速览

| 域 | 栈 |
|----|----|
| Mobile | React Native, Expo SDK 55, expo-router, Zustand, React Query, NativeWind, expo-sqlite |
| CLI | Rust, axum 0.7, tokio 1, rusqlite 0.31 (bundled), clap 4 |
| 协议 | REST (JSON) + WebSocket (stream-json), 全部 Bearer auth |
| 推送 | Expo Push Service（CLI 直调 `exp.host`） |
| 公网 | Tailscale Funnel |

## 4. Where to find... （核心地图）

| 问题 | 去哪儿 |
|------|--------|
| **整体架构、协议、数据流** | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| **要做什么、为什么做**（产品规格、验收） | [`docs/product-specs/`](docs/product-specs/) |
| **某 feature 怎么设计的**（方案权衡） | [`docs/design-docs/`](docs/design-docs/) |
| **历史执行计划、施工步骤** | [`docs/exec-plans/`](docs/exec-plans/) |
| **API 路径、消息类型、env vars** | [`docs/references/`](docs/references/)（占位）+ [`README.md`](README.md) |
| **代码规范、release checklist** | [`docs/quality/`](docs/quality/)（占位）+ [`CLAUDE.md`](CLAUDE.md) |
| **iOS 发布、CLI 发布等 SOP** | [`mobile/docs/ios-publish.md`](mobile/docs/ios-publish.md)（本地 `scripts/publish-ios-local.sh` / 云端 `publish-ios.sh`）· [`docs/runbooks/cli-release.md`](docs/runbooks/cli-release.md) · [`docs/runbooks/README.md`](docs/runbooks/README.md) |
| **`msctl serve` 跑挂了怎么查** | [`docs/runbooks/debugging.md`](docs/runbooks/debugging.md) — `msctl logs` 4 个故事 |
| **PR 合并与 CI 强闸** | [`docs/runbooks/github-pr-merge-policy.md`](docs/runbooks/github-pr-merge-policy.md) |
| **Git：worktree 开发、禁止在 main 检出上改代码** | [`.cursor/rules/git-worktree-development.mdc`](.cursor/rules/git-worktree-development.mdc) · [`docs/product-specs/SPEC-pr-workflow.md`](docs/product-specs/SPEC-pr-workflow.md) |
| **UI 设计系统**（颜色、字号、间距） | [`mobile/docs/design.md`](mobile/docs/design.md) |
| **RN UI 常见坑** | [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |
| **完整命令、env 表、UI checklist** | [`CLAUDE.md`](CLAUDE.md)（详细工程手册） |
| **面向人类的快速上手** | [`README.md`](README.md) |
| **msctl 命令速记（`msctl inject`）** | [`docs/references/msctl-inject.md`](docs/references/msctl-inject.md)；完整参考 [`docs/references/cli-commands.md`](docs/references/cli-commands.md) |
| **`docs/specs/`、`docs/superpowers/`** | **勿再新增权威文档**；规格/计划规约见 [`docs/superpowers/README.md`](docs/superpowers/README.md) |

## 5. 改完代码必跑的验证

| 改了 | 跑 |
|------|----|
| `mobile/**` TS/TSX | `cd mobile && pnpm typecheck` |
| `mobile/**` 测试相关 | `cd mobile && pnpm test -- --watchAll=false` |
| `cli/**` Rust | `cd cli && cargo test` |
| `cli/**` 编译检查 | `cd cli && cargo build` |
| 改了 UI | 对照 [`mobile/docs/design.md`](mobile/docs/design.md) §11 checklist |
| 改了 RN 列表/刷新 | 对照 [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |

## 6. 常用命令（精简版，详见 [`CLAUDE.md`](CLAUDE.md)）

```bash
# Mobile
cd mobile && pnpm install
pnpm typecheck                       # TS 类型检查
pnpm test -- --watchAll=false        # 单跑测试

# CLI
cd cli && cargo build
cargo test
cargo run -- serve                   # 启动本地 HTTP/WS

# 本地 iOS（本机 Xcode；一条命令即可，脚本内含依赖与构建；详见 mobile/docs/ios-publish.md）
cd mobile && ./scripts/publish-ios-local.sh

# 云端 EAS + TestFlight（一键）
cd mobile && ./scripts/publish-ios.sh
```

## 7. 给 Agent 的协作约定

- 用户场景常常 **不便打字**。涉及决策（方案选择、是否继续、风险权衡）一律用 `AskUserQuestion` 工具给 2-5 个结构化选项，**不要让用户敲字回答**
- 行动前先检索本地文件，不要凭记忆回答
- 修改代码后必须按 §5 跑验证；引入了 lint error **必须修根本原因，禁止用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 抑制**
- **文档落盘**：产品 / 功能规格（要做什么、验收）→ **只** [`docs/product-specs/`](docs/product-specs/)（`SPEC-<feature>.md`）；实施 / 执行计划 → **只** [`docs/exec-plans/`](docs/exec-plans/)（`YYYY-MM-DD-<feature>.md`）；设计权衡 → `docs/design-docs/YYYY-MM-DD-<feature>-design.md`（命名见 [`docs/design-docs/README.md`](docs/design-docs/README.md)）。**勿**在 [`docs/specs/`](docs/specs/)、[`docs/superpowers/`](docs/superpowers/) 新增权威内容。**Superpowers skills**（`writing-plans`、`executing-plans`、`brainstorming` 等）在本仓库写规格或计划时**必须**使用上述 canonical 路径 · [`docs/superpowers/README.md`](docs/superpowers/README.md)
- **Exec plan 施工**：全部任务验证通过后一次 `git commit`；不要套用 `subagent-driven-development` 的「每任务一 commit」。提交后把 `lastCompletedCommit` 写入 [`docs/exec-plans/index.json`](docs/exec-plans/index.json)（40 位 SHA）。
- **Commit 前强制 review**：每次 `git commit` 前必须执行 `requesting-code-review`，修复 Critical/Important 反馈并重新验证后，才允许提交。
- **执行方式选择（强制）**：writing-plans 写完计划后，**必须**用 `AskUserQuestion` 弹卡片让用户选「Subagent 驱动（推荐）」或「当前会话内联执行」，**禁止**纯文本提问或自行假设。
- **Image Output**：生成图片（图表、截图、可视化）时，保存为文件并在回复中用 Markdown 语法引用：
  ```
  ![描述](/绝对路径/image.png)
  ```
  支持格式：png、jpg、jpeg、gif、webp。MultiSoul 手机端会自动渲染为内联缩略图，点击可全屏查看。

## 8. 添加新规则的原则（Harness 增量学习）

每条新规则都应来自一次真实的 Agent 犯错。流程：

1. Agent 犯错 → 分析根因
2. 把约束写到对应位置（CLAUDE.md / quality/ / design.md）
3. **CLAUDE.md 和 AGENTS.md 必须同步更新** —— 两者约束列表保持镜像，改一个必须改另一个
4. 在本文 §4 的地图里加指针（如果是新类别）
5. 必要时把约束机械化（lint / hook / CI），让规则从"建议"升级为"法律"

@RTK.md
