# MultiSoul

个人 AI Agent 随身控制台。在手机上遥控本地运行的 AI Agent（Claude Code / Codex 等），实时查看工具调用、回应决策请求、接收任务完成推送。

**零中心后端** — 所有数据 100% 留在你的本机。

---

## 架构

```
手机 App (React Native + Expo)
    │  HTTPS + WSS
    ▼
msctl serve (本机进程)          ← Tailscale Funnel 暴露公网
    │
    ├── REST  /api/v1/*
    ├── WebSocket  /ws/conversations/{id}
    └── SQLite  ~/.config/msctl/serve.db
```

- **mobile/** — React Native + Expo SDK 55，多端点聚合视图
- **cli/** — Rust (`msctl`)，本地 HTTP/WS 服务 + Agent 管理

---

## 快速开始

### 1. 启动本地服务

```bash
npm install -g @yakami129/msctl

# 启动服务（自动生成 token，默认端口 8765）
msctl serve

# 指定端口和 token
msctl serve --port 8765 --token ms_v2_your_token

# 通过 Tailscale Funnel 暴露公网（外网访问）
msctl serve --funnel
```

启动后终端会打印连接地址和 QR 码，用手机 App 扫码或手动填入即可配对。

### 2. 注册 Agent

```bash
# 注册一个 Claude Code agent
msctl agent register --name blog-fixer --project /path/to/project --runtime claude-code

# 查看所有 agent
msctl agent list

# 发起对话
msctl agent invoke <agent-id> --message "帮我加一个深色模式开关"
```

### 3. 运行手机 App

```bash
cd mobile
pnpm install
pnpm start        # 启动 Expo dev server（需手动在终端运行）
pnpm ios          # iOS 模拟器
pnpm android      # Android 模拟器
```

在 App 的 Settings 页面添加端点（URL + Token），即可看到该机器上所有已注册的 Agent。

---

## 功能

### 手机 App

| 模块 | 功能 |
|------|------|
| **Agents** | 聚合多台机器的 Agent 列表，显示端点标签和项目路径 |
| **Chat** | 与 Agent 对话，渲染 6 种消息类型（见下） |
| **Inbox** | 汇聚待回应的 ask_question 和复杂任务完成/失败通知 |
| **Settings** | 管理多个 `msctl serve` 端点，支持健康检测 |

**6 种消息类型：**
- `user_text` / `agent_text` — 普通对话气泡
- `tool_call` / `tool_result` — 可折叠的工具调用行
- `ask_question` — 选项卡片，直接在手机上回答
- `task_status` — 任务状态横幅（running / completed / failed）

### CLI (`msctl`)

```
msctl auth login --token <token>   # 保存 token 到本地配置
msctl auth status                  # 查看当前认证状态

msctl agent register               # 注册 agent
msctl agent list                   # 列出所有 agent
msctl agent get <id>               # 查看 agent 详情
msctl agent update <id>            # 更新 agent 信息
msctl agent delete <id>            # 删除 agent
msctl agent invoke <id>            # 发起对话

msctl serve                        # 启动本地 HTTP/WS 服务
msctl serve --funnel               # 通过 Tailscale Funnel 暴露公网
msctl serve --port <port>          # 指定端口（默认 8765）
msctl serve --token <token>        # 指定 Bearer token
```

---

## API 概览

所有请求需携带 `Authorization: Bearer <token>`（或 `?token=<token>` query 参数）。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/healthz` | 健康检查（无需认证） |
| GET | `/api/v1/agents` | 列出所有 agent |
| GET | `/api/v1/agents/:id` | 获取 agent 详情 |
| GET | `/api/v1/conversations` | 列出对话（支持 `?agent_id=` 过滤） |
| POST | `/api/v1/conversations` | 创建新对话 |
| GET | `/api/v1/conversations/:id/messages` | 获取消息（支持 `?since_seq=` 增量拉取） |
| POST | `/api/v1/conversations/:id/messages` | 发送消息 |
| POST | `/api/v1/push-tokens` | 注册 Expo Push Token |
| DELETE | `/api/v1/push-tokens/:token` | 注销 Push Token |
| WS | `/ws/conversations/:id` | WebSocket 实时消息流 |

---

## 开发

### CLI

```bash
cd cli
cargo build          # 构建
cargo test           # 运行测试
cargo run -- serve   # 直接运行
```

### CLI 发布

推送语义化版本 tag 会触发 GitHub Actions 发布：

```bash
git tag v0.1.0
git push origin v0.1.0
```

发布产物：

- GitHub Release: `msctl` 的 Linux x86_64、macOS arm64、Windows x86_64 二进制压缩包
- GitHub Packages: `ghcr.io/yakami129/multisoul/msctl`
- npm: `@yakami129/msctl`，内置三平台二进制，安装时不需要 GitHub token

也可以在 GitHub Actions 页面手动运行 `Release CLI` workflow，并输入版本号，例如 `v0.1.0`。

npm 发布需要在 GitHub 仓库配置 `NPM_TOKEN` secret。首次配置后，可以手动运行 `Publish npm Package` workflow 并输入已有 Release 版本号，例如 `v0.1.0`。

### Mobile

```bash
cd mobile
pnpm install         # 安装依赖
pnpm typecheck       # TypeScript 类型检查
pnpm test -- --watchAll=false   # 运行测试
```

### iOS 发布

```bash
cd mobile
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

详细步骤见 [mobile/docs/ios-publish.md](/Users/alan/Documents/codes/yakami0129/multisoul/mobile/docs/ios-publish.md)。

---

## 数据存储

| 位置 | 内容 |
|------|------|
| `~/.config/msctl/serve.db` | Agent、对话、消息、任务、Push Token（SQLite） |
| `~/.config/msctl/config.toml` | 本地 CLI 配置（serve token） |
| 手机 AsyncStorage | 各端点的 Bearer Token |
| 手机 SQLite | Inbox 消息（本地持久化） |

---

## 技术栈

**CLI:** Rust · axum 0.7 · rusqlite 0.31 · tokio 1 · clap 4

**Mobile:** React Native · Expo SDK 55 · expo-sqlite · expo-notifications · Zustand · React Query · NativeWind
