# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MultiSoul is an Agent Registry Platform — a monorepo with three components:

- **`mobile/`** — React Native + Expo (SDK 54), NativeWind, React Query, Zustand
- **`cli/`** — Rust (`msctl`), clap 4.x, blocking reqwest

Full product spec: `docs/SPEC.md`

---

## Interaction & Output Constraints (Low-Input Scenarios)

- Assume by default that the user may be in a situation where typing is inconvenient; minimize the need for free-text input.
- When user decisions are needed (e.g., choosing an approach, whether to continue, selecting environment, risk trade-offs, release options), prefer using a question tool (structured options) to collect choices instead of asking the user to type manually.
- For enumerable decisions, provide 2-5 clear options first (including "Other/Later" when appropriate), so users can complete feedback via single- or multi-select.
- Avoid open-ended follow-up questions unless necessary; if needed, provide options first, then add "You may type additional details if needed."
- Keep responses in short, information-dense sentences: conclusion first, options second, supplementary notes last; avoid long paragraphs.
- When a task can be executed directly with controllable risk, prefer execute first, report after; only trigger the question tool at key decision branches.

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
- Before any UI change, also check `mobile/docs/rules/ui-pitfalls.md` — common React Native UI bugs to avoid (e.g. RefreshControl coupled to isFetching, focus refetch triggering spinner)

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
