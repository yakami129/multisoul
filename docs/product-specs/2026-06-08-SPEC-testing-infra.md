# SPEC: 自动化测试体系建设

- **日期**：2026-06-08
- **slug**：testing-infra
- **状态**：待实施

---

## 1. 背景与目标

MultiSoul 目前只有 Mobile 端 ~30 个 Jest 单元/组件测试和 CLI 的 Rust `#[cfg(test)]` 单元测试，**缺少 API 集成层测试和 E2E 测试**，核心用户流程（Agent 管理、对话、Inbox 推送）均未经端到端验证。

**目标：**
1. 补齐 Mobile API 集成测试，覆盖所有主要 API 端点（MSW 拦截方案）
2. 新增 CLI Serve E2E 测试，覆盖真实启动 `msctl serve` 的四大场景
3. 将各层测试沉淀为独立可运行脚本，并接入 CI 强约束

---

## 2. 非目标

- UI 自动化（Detox / Maestro / Appium）——本期不做
- 性能 / 压力测试
- 真实设备推送验证（Expo Push Service 对外调用）
- Expo EAS Build 流程的端到端验证

---

## 3. 核心交付物

### 3.1 Mobile：MSW + Jest 集成测试

**安装依赖：**
```bash
cd mobile && pnpm add -D msw
```

**新增文件结构：**
```
mobile/src/__tests__/integration/
├── msw/
│   ├── handlers.ts          # 所有 API 端点 handler（复用于多测试文件）
│   └── server.ts            # MSW node server 启动/停止封装
├── agents.integration.test.ts
├── conversations.integration.test.ts
├── inbox.integration.test.ts
└── settings.integration.test.ts
```

**Handler 覆盖范围**（对应 `ARCHITECTURE.md` 路由）：

| 端点 | 场景 |
|------|------|
| `GET /api/v1/agents` | 返回列表 / 空列表 / 401 |
| `GET /api/v1/agents/:id` | 正常 / 404 |
| `GET /api/v1/agents/:id/conversations` | 列表 / 空 |
| `POST /api/v1/agents/:id/conversations` | 创建成功 / 422 |
| `GET /api/v1/conversations/:id/messages` | 消息列表 |
| `POST /api/v1/conversations/:id/messages` | 发送成功 |
| `POST /api/v1/push-tokens` | 注册成功 / 409 重复 |
| `DELETE /api/v1/push-tokens/:id` | 删除成功 |

**测试用例（最小集）：**

- `agents.integration.test.ts`：列表加载、空态展示、详情跳转、删除
- `conversations.integration.test.ts`：对话创建、消息列表加载、消息发送
- `inbox.integration.test.ts`：Push Token 注册流程、Inbox 消息构建
- `settings.integration.test.ts`：Endpoint 切换、Token 保存

**CI 覆盖率要求：**
- 使用 `jest --coverage --coverageThreshold` 配置
- `src/features/` + `src/store/` 整体行覆盖率 ≥ 70%
- 覆盖报告输出至 `mobile/coverage/`，CI artifact 保存

---

### 3.2 CLI：Serve E2E 集成测试

**文件位置：** `cli/tests/serve/e2e_tests.rs`（符合现有 CLI test layout 约束）

**测试架构：**
```rust
// 每个测试函数：
// 1. 在临时目录启动 msctl serve（随机端口，独立 SQLite）
// 2. 等待 healthz 响应
// 3. 执行测试断言
// 4. Kill serve 进程（Drop 自动清理）
```

**场景覆盖（每场景含快乐路径 + 至少一个错误路径）：**

#### 场景 A：Auth
- ✅ `GET /api/v1/agents`（无 token）→ 401
- ✅ `GET /api/v1/agents`（错误 token）→ 401
- ✅ `GET /api/v1/agents`（正确 Bearer token）→ 200

#### 场景 B：Agent CRUD
- ✅ 注册 agent → 201，返回 id
- ✅ 列表 → 包含新注册 agent
- ✅ 详情 → 字段匹配
- ✅ 删除 → 204；再次 GET → 404

#### 场景 C：Conversation + Message
- ✅ 创建对话 → 201
- ✅ 发送消息 → 201
- ✅ 获取消息列表 → 包含已发送消息
- ✅ WebSocket 连接 `/ws/conversations/:id` → upgrade 成功，收到初始状态帧

#### 场景 D：Push Token
- ✅ 注册 push token → 201
- ✅ 重复注册同一 token → 409 或幂等 200
- ✅ 删除 token → 204

---

### 3.3 分层测试脚本

#### `scripts/test-cli.sh`
```bash
#!/usr/bin/env bash
# 运行 CLI 单元测试 + 编译检查
set -euo pipefail
cd cli
cargo build --all-targets --locked
cargo test --locked
cargo clippy --all-targets --locked -- -D warnings
```

#### `scripts/test-mobile.sh`
```bash
#!/usr/bin/env bash
# 运行 Mobile typecheck + lint + 全量 Jest（含集成测试）
set -euo pipefail
cd mobile
pnpm typecheck
pnpm lint
pnpm exec jest --watchAll=false --forceExit --coverage
```

#### `scripts/test-e2e.sh`
```bash
#!/usr/bin/env bash
# 运行 CLI Serve E2E 测试（真实启动 serve）
set -euo pipefail
cd cli
cargo test --test e2e_tests --locked
```

#### `scripts/test-all.sh`
```bash
#!/usr/bin/env bash
# 按层顺序运行全套测试：CLI 单元 → CLI E2E → Mobile
# 任意层失败立即退出
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== [1/3] CLI 单元 + 编译 ==="
bash "$REPO_ROOT/scripts/test-cli.sh"
echo "=== [2/3] CLI Serve E2E ==="
bash "$REPO_ROOT/scripts/test-e2e.sh"
echo "=== [3/3] Mobile 全量 ==="
bash "$REPO_ROOT/scripts/test-mobile.sh"
echo "=== 全部通过 ==="
```

---

### 3.4 CI 更新（`.github/workflows/ci.yml`）

新增 `cli-e2e` job：

```yaml
cli-e2e:
  name: cli (serve e2e)
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: cli
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
    - uses: Swatinem/rust-cache@v2
      with:
        workspaces: cli
    - name: Build
      run: cargo build --locked
    - name: Serve E2E
      run: cargo test --test e2e_tests --locked
```

更新 `mobile-check` job，增加覆盖率上报：
```yaml
- name: Test with coverage
  run: pnpm exec jest --watchAll=false --forceExit --coverage --coverageReporters=text-summary
```

`mobile-check` 的 jest 配置中增加 `coverageThreshold`（`mobile/package.json` jest 节）：
```json
"coverageThreshold": {
  "global": {
    "lines": 70
  }
}
```

---

## 4. 主要流程图

```
scripts/test-all.sh
├── test-cli.sh
│   ├── cargo build --all-targets
│   ├── cargo test (unit + cli/tests/*)
│   └── cargo clippy
├── test-e2e.sh
│   └── cargo test --test e2e_tests
│       └── 每个测试：spawn serve → wait healthz → assert → kill
└── test-mobile.sh
    ├── pnpm typecheck
    ├── pnpm lint
    └── pnpm jest --coverage
        ├── unit tests (mobile/src/__tests__/*.test.ts)
        └── integration tests (mobile/src/__tests__/integration/*.test.ts)
            └── MSW 拦截 HTTP，不依赖真实 serve
```

---

## 5. 边界条件与风险

| 风险 | 缓解措施 |
|------|----------|
| CLI E2E 端口冲突 | 使用 `port=0` 让 OS 分配随机端口，测试读取实际绑定端口 |
| serve 启动慢，E2E 超时 | 轮询 `GET /healthz` 最多 5s，超时则 panic 并打印 stderr |
| MSW handler 与真实 API 契约漂移 | handlers.ts 中类型来自 `mobile/src/types.ts`，类型变更自动触发 TS 报错 |
| 覆盖率 70% 阈值在初期太高 | 先以当前实测覆盖率为基线（预计 ~55-60%），首个 PR 先设 60%，下个迭代提至 70% |
| WebSocket E2E 测试复杂度高 | 使用 `tokio-tungstenite` 客户端，仅验证 upgrade 成功 + 一帧格式正确，不验证全状态机 |

---

## 6. 验收标准

| 项目 | 标准 |
|------|------|
| Mobile 覆盖率 | `pnpm jest --coverage` 行覆盖率 ≥ 70%（`src/features/` + `src/store/`） |
| CLI Serve E2E | 四个场景（Auth / Agent CRUD / Conv+Message / Push Token）全部有用例且 `cargo test --test e2e_tests` 通过 |
| CI `cli-e2e` job | GitHub Actions 中该 job 全绿，PR 合并前必须通过（接入 branch protection） |
| `scripts/test-all.sh` | 在全新环境（仅 Rust + Node）无需额外手动步骤即可完整运行 |
| 不引入新 lint 抑制 | 不得使用 `#[allow]` / `// eslint-disable` / `@ts-ignore` 绕过任何检查 |

---

## 7. 文件变更清单（预估）

```
mobile/
  package.json                          # 新增 msw devDep + coverageThreshold
  src/__tests__/integration/
    msw/handlers.ts                     # 新建
    msw/server.ts                       # 新建
    agents.integration.test.ts          # 新建
    conversations.integration.test.ts   # 新建
    inbox.integration.test.ts           # 新建
    settings.integration.test.ts        # 新建

cli/
  Cargo.toml                            # 新增 reqwest/tokio test 依赖
  tests/serve/e2e_tests.rs              # 新建（四场景）

scripts/
  test-cli.sh                           # 新建
  test-mobile.sh                        # 新建
  test-e2e.sh                           # 新建
  test-all.sh                           # 新建

.github/workflows/ci.yml               # 新增 cli-e2e job，更新 mobile-check
```
