# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiSoul is an Agent Registry Platform — a monorepo with three components:

- **`mobile/`** — React Native + Expo (SDK 54), NativeWind, React Query, Zustand
- **`cli/`** — Rust (`msctl`), clap 4.x, blocking reqwest

Full product spec: `docs/SPEC.md`

---

## 交互与输出约束（低输入场景）

- 默认假设用户处于不方便打字的场景，优先减少自由文本输入需求。
- 当需要用户做决策（如方案选择、是否继续、环境选择、风险取舍、发布选项）时，优先使用问答工具（结构化选项）收集用户选择，而不是要求用户手动输入。
- 对可枚举决策，先给 2–5 个清晰选项（可含“其他/稍后”），让用户点击或单选/多选完成反馈。
- 非必要不追问开放式问题；若必须追问，先提供可选项，再补充“如需可手动输入其他说明”。
- 回复内容保持短句和高信息密度：先结论、再选项、后补充说明，避免大段长文。
- 当任务可直接执行且风险可控时，优先“先执行再汇报”，仅在关键分叉点触发问答工具让用户决策。

---

## Commands

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

**当用户说"发布一下 iOS"或类似指令时，Claude 应直接执行：**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul/mobile && ./scripts/publish-ios.sh > /tmp/publish-ios.log 2>&1
```

用 `run_in_background: true` 异步执行，然后持续 `tail -f /tmp/publish-ios.log` 监听日志输出，直到脚本结束。

---

## Architecture

### Backend Domain Structure

Each domain (`agent/`, `auth/`, `user/`) follows the same pattern:
- `*Controller.java` — REST endpoints
- `*Service.java` — business logic
- `*Repository.java` — Spring Data JPA
- `*Request.java` / `*Response.java` — DTOs

`common/` holds shared utilities (AES-256-GCM encryption, error handling).

Database migrations live in `src/main/resources/db/migration/` (Flyway). Schema is `validate`-only at runtime — all changes must go through migration scripts.

API Key format: `ms_<random32chars>`, stored as SHA-256 hash. Agent `auth_value` is AES-256-GCM encrypted; key injected via `ENCRYPTION_KEY` env var.

All endpoints require `Authorization: Bearer <api_key>` except `POST /api/v1/users` and `POST /api/v1/auth/keys`.

### Mobile Structure

```
mobile/src/
├── api.ts          # Axios client, base URL config
├── types.ts        # Shared TypeScript types
├── store/          # Zustand stores
├── features/       # Feature modules (agents/, settings/)
└── components/     # Shared UI components (ui/)
mobile/app/         # Expo Router file-based routing
├── (tabs)/         # Tab navigator screens
└── agent/          # Agent detail screens
```

State: Zustand for local/auth state, React Query for server state (30s polling for agent status).

### CLI Structure

```
cli/src/
├── main.rs         # clap command tree entry point
├── config.rs       # ~/.config/msctl/config.toml read/write
└── commands/
    ├── auth.rs     # msctl auth login / status
    └── agent.rs    # msctl agent register/list/get/update/delete/invoke
```

---

## UI Design System

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
- No non-green colors anywhere
- Icons: Lucide only, 14×14px for inline, 16×16px for actions
- Spacing on 4px grid; see `mobile/docs/design.md §4` for exact values
- Before any UI change, run through the checklist in `mobile/docs/design.md §11`

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `ENCRYPTION_KEY` | `change-me-32-chars-minimum-key!!` | Must be ≥32 chars in production |
| `DB_HOST` | `localhost` | |
| `DB_PORT` | `5432` | |
| `DB_NAME` | `multisoul` | |
| `DB_USER` | `multisoul` | |
| `DB_PASSWORD` | `multisoul` | |
