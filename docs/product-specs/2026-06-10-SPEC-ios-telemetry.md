# SPEC: iOS 埋点与错误追踪

**文件**：`docs/product-specs/2026-06-10-SPEC-ios-telemetry.md`
**状态**：草稿
**日期**：2026-06-10

---

## 1. 背景与目标

MultiSoul iOS App 目前缺乏对运行时错误和性能异常的可观测性。当用户遇到崩溃或页面加载慢时，开发者无法从本机日志中快速定位问题。

本 Feature 在 iOS App 中引入轻量埋点系统，将错误事件和性能指标上报至用户本机 `msctl serve`，写入现有 NDJSON 日志链路，通过 `msctl logs` 统一查看，实现全链路 Trace（mobile session → CLI 日志）。

**非目标**：
- 不引入第三方埋点 SDK（无 Sentry / Firebase 依赖）
- 不上报任何数据至云端（零中心后端原则）
- 不在 iOS App 内提供可视化面板
- 不覆盖 settings / inbox 模块（MVP 范围：全局 + agents + chat）

---

## 2. 用户故事

- 开发者运行 `msctl logs --source mobile` 可看到 App 崩溃记录和路由加载慢的告警
- 出现问题时，通过 `msctl logs --trace <session_id>` 可过滤出该次使用会话的所有事件
- 正常运行时埋点对用户无感知，不影响交互性能

---

## 3. 采集范围

### 3.1 事件类型

| 事件类型 | `event_type` 值 | 触发时机 |
|---------|----------------|---------|
| JS 崩溃 / 未捕获异常 | `js_crash` | React ErrorBoundary 捕获 + `global.ErrorUtils` 全局异常 |
| API 连接错误 | `api_error` | HTTP 4xx/5xx、超时（Axios 拦截器） |
| WebSocket 错误 | `ws_error` | WS 断线、连接失败 |
| 路由 / 屏幕加载时间 | `route_load` | expo-router 页面跳转完成（TTI） |
| Feature 模块懒加载耗时 | `module_load` | agents/chat 等模块首次 render |

### 3.2 覆盖模块（MVP）

- **全局**：App 启动、所有未捕获异常、Axios 拦截器
- **agents 模块**：Agent 列表加载时间
- **chat 模块**：Chat 页面打开时间、消息发送错误

---

## 4. 事件数据结构

```typescript
// 单个事件（上报体）
interface TelemetryEvent {
  mobile_session_id: string;    // App 启动时生成，持续整个会话
  event_id: string;             // 每事件唯一 ID
  event_type: TelemetryEventType;
  level: "info" | "warn" | "error";
  timestamp: string;            // ISO 8601
  data: Record<string, unknown>; // 事件特定字段
}

// 批量上报体
interface TelemetryBatch {
  events: TelemetryEvent[];
}
```

**各事件 `data` 字段示例：**

```jsonc
// js_crash
{ "error_message": "...", "stack_trace": "...", "component_stack": "...", "screen": "chat" }

// api_error
{ "method": "POST", "path": "/api/v1/conversations/xxx/messages", "status_code": 500, "duration_ms": 120 }

// ws_error
{ "reason": "connection_failed", "endpoint": "ws://...", "retry_count": 3 }

// route_load
{ "route": "/agent/[id]", "duration_ms": 1200, "threshold_exceeded": "warn" }

// module_load
{ "module": "chat", "duration_ms": 340 }
```

### 4.1 性能阈值

| 指标 | warn 阈值 | error 阈值 |
|------|---------|-----------|
| 路由加载（`route_load`） | >1000ms | >3000ms |
| 模块加载（`module_load`） | >800ms | >2000ms |

---

## 5. iOS 技术实现

### 5.1 TelemetryService（单例）

路径：`mobile/src/services/telemetry/TelemetryService.ts`

职责：
- 维护 `mobile_session_id`（App 启动时生成，`ulid()` 格式）
- 维护内存事件队列（上限 200 条，超出丢弃最旧）
- 监听网络状态（`@react-native-community/netinfo`）
- 重连后自动批量上报（`POST /api/v1/telemetry`）
- 离线时不持久化（App 关闭队列清空）

关键接口：
```typescript
class TelemetryService {
  static getInstance(): TelemetryService;
  track(event: Omit<TelemetryEvent, "mobile_session_id" | "event_id" | "timestamp">): void;
  flush(): Promise<void>; // 立即上报队列
}
```

### 5.2 TelemetryErrorBoundary

路径：`mobile/src/services/telemetry/TelemetryErrorBoundary.tsx`

- 在 `mobile/app/_layout.tsx` 根布局包裹全局 ErrorBoundary
- `componentDidCatch` 中调用 `TelemetryService.track({ event_type: "js_crash", level: "error", data: {...} })`
- 渲染后备 UI，不直接崩溃 App

### 5.3 useTelemetryTimer Hook

路径：`mobile/src/services/telemetry/useTelemetryTimer.ts`

```typescript
function useTelemetryTimer(module: string): void;
// 在 useEffect mount 时记录开始，unmount 前不计时
// 首次 render 完成后上报 module_load 事件
```

在 agents 模块根组件和 chat 模块根组件各调用一次。

### 5.4 Axios 拦截器

路径：`mobile/src/api.ts`（现有文件扩展）

在 response 拦截器中捕获 HTTP 4xx/5xx 和超时，调用 `TelemetryService.track()`。
**不** rethrow 原有错误（仅埋点，不干扰现有错误处理）。

### 5.5 WebSocket 错误监听

路径：`mobile/src/features/chat/`（扩展现有 WS 相关代码）

在 WS 断线 / 连接失败时调用 `TelemetryService.track({ event_type: "ws_error" })`。

---

## 6. CLI 技术实现

### 6.1 新 REST 端点

```
POST /api/v1/telemetry
Authorization: Bearer <token>
Content-Type: application/json

Body: TelemetryBatch
```

响应：
- `200 OK` `{ "accepted": N }` —— 成功写入 N 条事件
- `400 Bad Request` —— 格式错误
- `401 Unauthorized` —— token 无效

实现路径：`cli/src/serve/routes/telemetry.rs`（新文件）

### 6.2 日志写入

Handler 将每条事件序列化为 NDJSON，写入当日 `serve.log.<YYYY-MM-DD>` 文件，格式与现有 app 日志兼容：

```jsonc
{
  "timestamp": "2026-06-10T10:00:00Z",
  "level": "WARN",
  "target": "msctl::serve::mobile_telemetry",
  "fields": {
    "message": "route_load",
    "source": "mobile",
    "mobile_session_id": "01HX...",
    "event_id": "01HX...",
    "event_type": "route_load",
    "duration_ms": 1200,
    "route": "/agent/[id]"
  }
}
```

### 6.3 msctl logs 扩展

**`--source` 新增 `mobile` 选项**（现有值：`all | app | service`）：

```bash
msctl logs --source mobile              # 仅看 mobile 埋点事件
msctl logs --source mobile -f           # 实时跟踪
msctl logs --source mobile --level warn # 仅看 warn/error
```

实现：在 `cli/src/commands/logs_app.rs` 按 `source == "mobile"` 过滤。

**`--trace` 新增标志**：

```bash
msctl logs --trace <mobile_session_id>  # 过滤该会话所有事件
```

---

## 7. 数据流

```
iOS App
  TelemetryService.track(event)
    → 加入内存队列
    → 网络恢复 / 定时（30s） flush
      POST /api/v1/telemetry
        ↓
  msctl serve (Rust)
    → 写入 serve.log.<date> NDJSON
        ↓
  msctl logs --source mobile
        ↓
  开发者 Terminal 可读输出
```

---

## 8. 验收标准

| # | 场景 | 预期结果 |
|---|------|---------|
| AC-1 | React 组件抛出未捕获异常 | `msctl logs --source mobile` 出现 `js_crash` error 级别日志，包含组件堆栈 |
| AC-2 | API 请求返回 500 | `msctl logs --source mobile` 出现 `api_error`，包含 path 和 status_code |
| AC-3 | WS 连接失败 | `msctl logs --source mobile` 出现 `ws_error`，包含 reason |
| AC-4 | Chat 页面加载耗时 1200ms | 日志出现 `route_load` warn，`duration_ms=1200` |
| AC-5 | Chat 页面加载耗时 3500ms | 日志出现 `route_load` error，`duration_ms=3500` |
| AC-6 | agents 模块首次 render 耗时 350ms | 日志出现 `module_load`，`module="agents"` |
| AC-7 | `msctl logs --trace <session_id>` | 仅输出该 session 的事件，不含其他会话或 CLI 日志 |
| AC-8 | 无 msctl serve 连接时触发事件 | 事件入内存队列，重连后自动上报，不丢失（队列未满前） |
| AC-9 | `POST /api/v1/telemetry` 无 token | 返回 401，不写入日志 |
| AC-10 | 队列超 200 条 | 最旧事件被丢弃，不崩溃，新事件正常入队 |

---

## 9. E2E 功能测试用例

### TC-1：JS 崩溃捕获

- **关联验收**：AC-1
- **场景**：Chat 页面渲染时组件抛出异常
- **前置**：`msctl serve` 运行中，App 已连接，chat 模块已打开
- **步骤**：
  1. 触发目标组件异常（测试时可用 mock throw）
  2. 等待 TelemetryService flush（≤30s）
  3. 执行 `msctl logs --source mobile --level error`
- **预期**：输出包含 `js_crash`、`component_stack`、当前 `mobile_session_id`
- **层级**：Mobile + CLI REST
- **自动化提示**：Mock `TelemetryService.flush` 验证 track 调用；CLI 端可用 `curl POST /api/v1/telemetry` fixture

### TC-2：API 错误记录

- **关联验收**：AC-2
- **场景**：发送消息时服务器返回 500
- **前置**：mock server 返回 500
- **步骤**：
  1. 发送消息触发 POST `/conversations/:id/messages`
  2. 等待 flush
  3. `msctl logs --source mobile`
- **预期**：日志包含 `api_error`，`status_code: 500`，`path` 含 `messages`
- **层级**：Mobile + CLI REST
- **自动化提示**：Axios mock adapter + fixture event batch

### TC-3：路由加载慢告警

- **关联验收**：AC-4, AC-5
- **场景**：Chat 页面加载耗时超阈值
- **步骤**：
  1. Mock `performance.now()` 返回使耗时 = 1200ms / 3500ms
  2. 导航到 `/agent/[id]`
  3. `msctl logs --source mobile --level warn`
- **预期**：1200ms → warn；3500ms → error
- **层级**：Mobile unit + CLI 写入验证
- **自动化提示**：`useTelemetryTimer` 单元测试 + Jest fake timer

### TC-4：Trace 过滤

- **关联验收**：AC-7
- **步骤**：
  1. 生成两次独立会话事件，session_id 不同
  2. 上报两批
  3. `msctl logs --trace <session_id_1>`
- **预期**：仅输出 session_id_1 的事件
- **层级**：CLI
- **自动化提示**：CLI logs unit test 用 fixture NDJSON

### TC-5：离线队列

- **关联验收**：AC-8
- **步骤**：
  1. 断开 msctl 连接
  2. 触发 3 个埋点事件
  3. 重连 msctl
  4. 等待 flush
  5. `msctl logs --source mobile`
- **预期**：3 条事件全部出现
- **层级**：Mobile + CLI
- **自动化提示**：Mock NetInfo 状态切换

---

## 10. 文件变更清单

### Mobile（新增 / 修改）

| 文件 | 操作 |
|------|------|
| `mobile/src/services/telemetry/TelemetryService.ts` | 新增 |
| `mobile/src/services/telemetry/TelemetryErrorBoundary.tsx` | 新增 |
| `mobile/src/services/telemetry/useTelemetryTimer.ts` | 新增 |
| `mobile/src/services/telemetry/index.ts` | 新增（barrel export） |
| `mobile/app/_layout.tsx` | 修改：包裹 ErrorBoundary |
| `mobile/src/api.ts` | 修改：添加 Axios 拦截器 |
| `mobile/src/features/agents/` | 修改：根组件加 `useTelemetryTimer("agents")` |
| `mobile/src/features/chat/` | 修改：根组件加 `useTelemetryTimer("chat")`，WS 错误埋点 |

### CLI（新增 / 修改）

| 文件 | 操作 |
|------|------|
| `cli/src/serve/routes/telemetry.rs` | 新增 |
| `cli/src/serve/router.rs` | 修改：注册 telemetry 路由 |
| `cli/src/commands/logs_app.rs` | 修改：支持 `--source mobile` 过滤和 `--trace` 标志 |
| `cli/src/commands/logs.rs` | 修改：新增 `LogSource::Mobile` 变体和 `--trace` 参数 |

---

## 11. 依赖与约束

- 无新增第三方依赖（`ulid` 若未引入则用 `uuid` 替代）
- `POST /api/v1/telemetry` 必须 Bearer auth，与其他 API 一致
- 不得在 `mobile/` 中使用 `console.log`（符合现有 mobile 禁 `console.log` 约束）
- 日志 NDJSON 格式必须与现有 `serve.log.*` 兼容，避免破坏 `msctl logs` 现有解析
- 单文件 ≤ 500 行约束：TelemetryService 若超限须拆分（queue.ts / uploader.ts）
