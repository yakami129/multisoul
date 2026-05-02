# AGENTS.md — MultiSoul 导航地图

> 本文是 **地图，不是说明书**（约 100 行）。它告诉你"去哪儿查"，不复制具体内容。
> 详细规则、命令、设计请按下方指针深入。
> 设计参考：[Harness Engineering](https://www.engineering.fyi/article/harness-engineering-leveraging-codex-in-an-agent-first-world)

## 1. 这是什么

MultiSoul 是 **个人 AI Agent 随身控制台**。手机端遥控本地运行的 AI Agent（Claude Code / Codex），实时看工具调用、回应决策请求、收完成推送。**零中心后端**，数据 100% 留在用户本机。

Monorepo 两大件：

- `mobile/` — React Native + Expo SDK 55
- `cli/` — Rust，可执行文件名 `msctl`

## 2. 关键约束（违反前先看 §6）

机械化（pre-commit + CI 拦截，详见 [`docs/quality/mechanized-constraints.md`](docs/quality/mechanized-constraints.md)）：

- **不可硬编码 token** —— 检测 `ms_v2_xxx` / `Bearer xxx`
- **Mobile 颜色合规** —— 仅 [`mobile/docs/design.md`](mobile/docs/design.md) §2 白名单内的色
- **本文 ≤ 120 行** —— 超长则拒绝 commit
- **单文件 ≤ 500 行** —— `mobile/src|app`、`cli/src` 源码；超长需拆分封装（见 mechanized-constraints）
- **mobile 禁 `console.log`** —— 仅允许 `console.warn` / `console.error`
- **改包必跑 typecheck/cargo check**

人类可读软约束：

- 不要碰 `~/.config/msctl/*` —— 用户本地数据
- DB schema 改动走 migration —— 不允许运行时 `CREATE TABLE`
- REST/WS 强制 Bearer auth —— 唯一例外 `GET /api/v1/healthz`
- 决策用 `AskUserQuestion` 工具调用 —— 不在自由文本问选择题

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
| **iOS 发布、CLI 发布等 SOP** | [`docs/runbooks/cli-release.md`](docs/runbooks/cli-release.md) · [`mobile/docs/ios-publish.md`](mobile/docs/ios-publish.md) · [`docs/runbooks/README.md`](docs/runbooks/README.md) |
| **`msctl serve` 跑挂了怎么查** | [`docs/runbooks/debugging.md`](docs/runbooks/debugging.md) — `msctl logs` 4 个故事 |
| **UI 设计系统**（颜色、字号、间距） | [`mobile/docs/design.md`](mobile/docs/design.md) |
| **RN UI 常见坑** | [`mobile/docs/rules/ui-pitfalls.md`](mobile/docs/rules/ui-pitfalls.md) |
| **完整命令、env 表、UI checklist** | [`CLAUDE.md`](CLAUDE.md)（详细工程手册） |
| **面向人类的快速上手** | [`README.md`](README.md) |

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

# iOS 发布（用户说"发布一下 iOS"时直接执行）
cd mobile && ./scripts/publish-ios.sh
```

## 7. 给 Agent 的协作约定

- 用户场景常常 **不便打字**。涉及决策（方案选择、是否继续、风险权衡）一律用 `AskUserQuestion` 工具给 2-5 个结构化选项，**不要让用户敲字回答**
- 行动前先检索本地文件，不要凭记忆回答
- 修改代码后必须按 §5 跑验证；引入了 lint error 要修
- 新增产品决策 → 写到 `docs/product-specs/`；新增设计权衡 → 写到 `docs/design-docs/YYYY-MM-DD-<feature>-design.md`；新增施工计划 → `docs/exec-plans/`
- 不要把规则塞进本文。本文只长指针，不长内容

## 8. 添加新规则的原则（Harness 增量学习）

每条新规则都应来自一次真实的 Agent 犯错。流程：

1. Agent 犯错 → 分析根因
2. 把约束写到对应位置（CLAUDE.md / quality/ / design.md）
3. 在本文 §4 的地图里加指针（如果是新类别）
4. 必要时把约束机械化（lint / hook / CI），让规则从"建议"升级为"法律"

> 长度控制：本文超过 120 行就该重构 —— 把详细内容沉淀到 `docs/` 子目录，本文只保留指针。
