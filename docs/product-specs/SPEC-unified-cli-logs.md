# Unified CLI Logs SPEC

## 1. 背景与目标

当前 CLI 有两个日志入口：

- `msctl logs`：读取 `msctl serve` 写入的结构化应用日志，支持按会话、级别、时间、事件名过滤。
- `msctl daemon logs`：读取 daemon/launchd 捕获的 stdout/stderr 原始文本日志，只支持按行数 tail 和 follow。

两个入口都服务于同一个用户任务：诊断本机 `msctl serve` 或后台服务为什么不工作。但它们分散在不同命令树下，参数不一致，文档也需要用户先知道应该查哪一种日志。

目标是把日志查看统一到一个公开入口：

```bash
msctl logs
```

统一后，用户不需要先理解 daemon 与 serve 的内部边界；默认命令应给出足够多的信息用于第一轮排查。

## 2. 范围

### 2.1 In Scope

- `msctl logs` 增加 source 概念，内部保留两类来源：
  - `app`：结构化应用日志。
  - `service`：daemon/launchd stdout/stderr 原始日志。
- `msctl logs` 默认查看 `all`，即同时读取 `app` 与 `service`。
- 删除公开命令 `msctl daemon logs`，不提供兼容 alias。
- 更新 CLI 帮助文案、安装提示、README、runbook、CLI reference 中的日志命令。
- 保持现有 `msctl logs --source app` 的结构化诊断能力。

### 2.2 Out of Scope

- 合并两类日志的物理存储位置。
- 把 service 原始文本日志改造成结构化 NDJSON。
- 实现远程日志采集、上传或集中式日志平台。
- 新增移动端日志查看 UI。
- 新增完整诊断命令如 `msctl diagnose`。

## 3. 用户场景

### 场景 A：用户不知道问题发生在哪一层

用户运行：

```bash
msctl logs
```

CLI 默认展示 `app` 与 `service` 两类日志，并用来源前缀区分。用户可以同时看到应用事件和后台服务 stdout/stderr。

### 场景 B：用户只想查业务运行问题

用户运行：

```bash
msctl logs --source app --conv cnv_abc --level warn
```

CLI 只读取结构化应用日志，保留现有按会话和级别过滤能力。

### 场景 C：用户只想查 daemon 启动失败

用户运行：

```bash
msctl logs --source service -f
```

CLI 只读取 daemon/launchd 捕获的原始日志，用于定位 PATH、启动脚本、panic 或 stdout/stderr 输出问题。

### 场景 D：用户输入旧命令

用户运行：

```bash
msctl daemon logs
```

CLI 不再识别该子命令，直接由 clap 返回未知子命令错误。文档不再出现该命令。

## 4. 命令契约

### 4.1 Source

`msctl logs` 新增：

```bash
--source <all|app|service>
```

默认值：

```bash
--source all
```

语义：

| source | 数据源 | 默认用途 |
|--------|--------|----------|
| `all` | app + service | 第一轮排查 |
| `app` | 结构化 serve tracing 日志 | 业务诊断、会话诊断、jq 管道 |
| `service` | daemon/launchd stdout/stderr 原始日志 | 后台服务启动与进程层诊断 |

### 4.2 参数语义

| 参数 | `app` | `service` | `all` |
|------|-------|-----------|-------|
| `--tail <N>` | 最后 N 条匹配记录 | 最后 N 行匹配文本 | 每个 source 各取最多 N 条/行 |
| `-f`, `--follow` | follow app 日志 | follow service 日志 | 同时 follow 两类日志 |
| `--grep <regex>` | 匹配 `fields.message` | 匹配原始文本行 | 分别按各自规则匹配 |
| `--conv <id>` | 按 conversation id 过滤 | 不适用 | 只作用于 app；service 不参与该过滤 |
| `--level <level>` | 按最低级别过滤 | 不适用 | 只作用于 app；service 不参与该过滤 |
| `--since <duration>` | 按 timestamp 过滤 | 不适用 | 只作用于 app；service 不参与该过滤 |
| `--json` | 输出原始 app NDJSON | 不允许 | 不允许 |

### 4.3 默认输出

`msctl logs` 等价于：

```bash
msctl logs --source all --tail 50
```

人类可读输出必须显示来源前缀：

```text
[app]     2026-05-02T11:32:14 INFO  [runtime conv=cnv_abc] agent_spawn pid=84221
[service] Listening on http://0.0.0.0:8765
```

`all` 模式不要求跨 source 做全局时间线排序。原因是 service 日志是原始文本，不保证每行有可解析 timestamp。实现可以先输出 app 再输出 service，或按内部可实现性选择稳定顺序；但必须在文档中说明该顺序不是严格时间线。

### 4.4 JSON 输出

`--json` 只允许：

```bash
msctl logs --source app --json
```

以下命令必须报错：

```bash
msctl logs --json
msctl logs --source all --json
msctl logs --source service --json
```

错误信息需提示：

```text
--json is only supported with --source app
```

原因：`service` 是原始文本；在 `all` 下伪造统一 JSON envelope 会破坏现有 `msctl logs --json | jq ...` 的直觉和稳定性。

## 5. 删除 `msctl daemon logs`

`msctl daemon` 保留服务管理职责：

- `quickstart`
- `install`
- `uninstall`
- `start`
- `stop`
- `restart`
- `status`

删除：

- `daemon logs`

安装成功提示从：

```text
msctl daemon logs -f
```

改为：

```text
msctl logs --source service -f
```

## 6. 兼容性与迁移

本变更不提供旧命令兼容层。

迁移方式：

| 旧命令 | 新命令 |
|--------|--------|
| `msctl logs` | `msctl logs --source all`，也是默认行为 |
| `msctl logs --json` | `msctl logs --source app --json` |
| `msctl daemon logs` | `msctl logs --source service` |
| `msctl daemon logs -f` | `msctl logs --source service -f` |
| `msctl daemon logs -n 200` | `msctl logs --source service --tail 200` |

## 7. 验收标准

- [ ] `msctl logs` 默认读取 `app` 和 `service` 两类日志。
- [ ] `msctl logs --source app` 保留现有结构化过滤能力。
- [ ] `msctl logs --source service` 能读取 daemon/launchd 原始日志。
- [ ] `msctl logs --source all --tail 20` 对每个 source 各取最多 20 条/行。
- [ ] `msctl logs --source all` 的人类输出包含 `[app]` / `[service]` 来源前缀。
- [ ] `msctl logs --json` 报错，并提示使用 `msctl logs --source app --json`。
- [ ] `msctl logs --source app --json` 仍输出原始 app NDJSON，可被 `jq` 解析。
- [ ] `msctl daemon logs` 已从 CLI 子命令中删除。
- [ ] `msctl daemon install` 成功后的提示使用 `msctl logs --source service -f`。
- [ ] README、runbook、CLI reference 不再推荐 `msctl daemon logs`。

## 8. 待确认问题

- `all` 模式下非 follow 输出的 source 顺序是否固定为 app 后 service。
- `all` 模式下 service 缺失时是否静默跳过，还是打印 `[service] no service log yet`。
- `--grep` 过滤后是否隐藏某个 source 的空结果提示。
