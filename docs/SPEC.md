# MultiSoul — Agent Registry Platform SPEC

## 1. 背景与目标

MultiSoul 是一个面向开发者的 Agent 注册平台。开发者可以将自己运行的 HTTP 服务注册为 Agent，通过 CLI 工具（`msctl`）管理，通过手机端监控状态并手动触发。

**目标：**
- 提供标准化的 Agent 注册/发现机制
- `msctl` CLI 作为开发者主要操作入口
- 手机端提供随时随地的监控和触发能力

## 2. 范围

### In Scope
- Spring Boot 后端（REST API + PostgreSQL）
- Rust CLI 工具（`msctl`）
- React Native + Expo 手机端
- Docker Compose 一键启动
- API Key 认证（通过 API 生成，无 Web 控制台）

### Out of Scope
- Web 控制台（后期）
- Agent 代码托管/执行（只注册 HTTP 地址，不托管代码）
- 多租户/团队协作（本期）

## 3. 用户与使用场景

**典型用户：** 开发者，有自己运行的 HTTP 服务，想注册到平台统一管理

**核心场景：**
1. 开发者调用 `POST /api/v1/auth/keys` 生成 API Key
2. 用 `msctl agent register` 将本地/远程 HTTP 服务注册为 Agent（含名称、endpoint、调用认证信息）
3. 在手机端查看所有 Agent 状态，手动触发某个 Agent

## 4. 数据模型

### Agent
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string | Agent 名称 |
| description | string | 描述 |
| endpoint | string | HTTP URL |
| auth_type | enum | none / api_key / bearer_token / basic |
| auth_value | string | 加密存储（AES-256-GCM） |
| status | enum | active / inactive / error |
| owner_id | UUID | 所属用户 |
| created_at | timestamp | |
| updated_at | timestamp | |

### User
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| email | string | 唯一 |
| created_at | timestamp | |

### ApiKey
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| key_hash | string | SHA-256 hash |
| key_prefix | string | 明文前缀（如 `ms_abc123...`） |
| created_at | timestamp | |
| last_used_at | timestamp | |

## 5. API 设计（REST）

所有请求通过 `Authorization: Bearer <api_key>` 认证（注册用户和生成 Key 除外）。

### 用户 & 认证
- `POST /api/v1/users` — 注册用户
- `POST /api/v1/auth/keys` — 生成 API Key（返回唯一一次明文）
- `GET /api/v1/auth/keys` — 列出所有 Key（只返回前缀）
- `DELETE /api/v1/auth/keys/{keyId}` — 撤销 API Key

### Agent 管理
- `POST /api/v1/agents` — 注册 Agent
- `GET /api/v1/agents` — 列出所有 Agent
- `GET /api/v1/agents/{id}` — 获取 Agent 详情
- `PUT /api/v1/agents/{id}` — 更新 Agent
- `DELETE /api/v1/agents/{id}` — 删除 Agent
- `POST /api/v1/agents/{id}/invoke` — 触发 Agent（后端转发请求到 endpoint）

**统一错误格式：**
```json
{ "error": "描述", "code": "ERROR_CODE" }
```

## 6. 技术架构

### Monorepo 结构
```
multisoul/
├── backend/                  # Spring Boot + Java 21
│   ├── src/
│   │   ├── main/java/com/multisoul/
│   │   │   ├── agent/        # Agent 领域（controller/service/repository）
│   │   │   ├── auth/         # API Key 认证
│   │   │   ├── user/         # 用户管理
│   │   │   └── common/       # 共享工具（加密、错误处理）
│   │   └── resources/
│   │       ├── application.yml
│   │       └── db/migration/ # Flyway 迁移脚本
│   └── Dockerfile
├── mobile/                   # React Native + Expo
│   └── src/
├── cli/                      # Rust msctl
│   └── src/
├── docker-compose.yml
└── docs/
    ├── SPEC.md
    └── superpowers/
        ├── specs/
        └── plans/
```

### 后端关键决策
- Spring Boot 3.x + Java 21（虚拟线程 `spring.threads.virtual.enabled=true`）
- Spring Data JPA + Flyway 数据库迁移
- API Key 格式：`ms_<random32chars>`，存储 SHA-256 hash
- Agent `auth_value` 使用 AES-256-GCM 加密，密钥通过环境变量 `ENCRYPTION_KEY` 注入

### CLI 关键决策
- Rust + `clap` 4.x
- 配置存储在 `~/.config/msctl/config.toml`
- 命令风格参考 `kubectl`

### 手机端关键决策
- Expo SDK 51+ + React Navigation 6
- React Query 用于数据获取和缓存
- 轮询（30s）获取 Agent 状态

## 7. CLI 命令设计

```bash
msctl auth login --key <api_key>        # 配置认证，写入 config.toml
msctl auth status                        # 显示当前认证状态

msctl agent register                     # 交互式注册 Agent
msctl agent list                         # 列出所有 Agent（表格格式）
msctl agent get <id>                     # 查看详情（JSON 格式）
msctl agent update <id> [--name] [--endpoint] [--description]
msctl agent delete <id>                  # 删除（需确认）
msctl agent invoke <id> [--body <json>]  # 触发 Agent
```

## 8. 手机端页面

1. **Agent 列表页** — 状态概览（active/inactive/error 颜色标记）
2. **Agent 详情页** — 信息展示 + 触发按钮
3. **设置页** — API Key 配置、服务器地址配置

## 9. 非功能性需求

- API Key 只在生成时返回明文，之后不可查
- Agent 调用认证信息 AES-256-GCM 加密存储
- Docker Compose 包含：后端服务、PostgreSQL
- 后端提供健康检查端点 `/actuator/health`

## 10. 验收标准

- [ ] `docker-compose up` 启动后端 + 数据库，健康检查通过
- [ ] `POST /api/v1/users` 注册用户，`POST /api/v1/auth/keys` 生成 API Key
- [ ] `msctl auth login --key <key>` 配置认证
- [ ] `msctl agent register` 成功注册一个 Agent
- [ ] `msctl agent list` 能看到已注册的 Agent
- [ ] 手机端能看到 Agent 列表
- [ ] 手机端点击触发，后端转发请求到 Agent endpoint
- [ ] 主要 API 接口有集成测试覆盖（JUnit 5 + Testcontainers）
