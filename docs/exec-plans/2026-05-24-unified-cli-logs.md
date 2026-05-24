# Unified CLI Logs Implementation Plan

## 1. 目标

按 [`docs/product-specs/SPEC-unified-cli-logs.md`](../product-specs/SPEC-unified-cli-logs.md) 统一 CLI 日志入口：

- 公开入口只保留 `msctl logs`。
- `msctl logs` 默认 `--source all`，同时读取 app 和 service 两类日志。
- 内部保留 `app` 与 `service` 两个 source。
- 删除 `msctl daemon logs`，不提供兼容 alias。
- 更新文档与安装提示。

## 2. 约束

- 写代码前先补失败测试。
- `cli/src/**` 单文件不超过 500 行；当前 `cli/src/commands/logs.rs` 已接近上限，需要拆分。
- 不使用 `#[allow(...)]` 压制诊断。
- 不碰 `~/.config/msctl/*` 用户真实数据；测试通过隐藏参数或临时 HOME 注入 synthetic logs。
- 改 CLI Rust 代码后运行 `cd cli && cargo test` 和 `cd cli && cargo build`。

## 3. 实施步骤

### Step 1: 测试先行

- 扩展 `cli/tests/logs_smoke.rs`：
  - 覆盖 `msctl logs --source app --json` 保持 NDJSON。
  - 覆盖默认 `msctl logs` 输出 app + service，并带 `[app]` / `[service]` 前缀。
  - 覆盖 `msctl logs --source service --tail N` 读取 service 原始日志。
  - 覆盖 `msctl logs --json` 报错。
  - 覆盖 `msctl daemon logs` 不再可用。
- 为测试增加隐藏参数注入 service log 文件路径，避免读用户本机 daemon 文件。

### Step 2: 拆分 logs 实现

- 保留 `cli/src/commands/logs.rs` 作为 dispatch 层：
  - `LogsArgs`
  - `LogSource`
  - 参数校验
  - `app/service/all` 调度
- 新增 `cli/src/commands/logs_app.rs`：
  - 迁移现有结构化 app 日志 reader/filter/render/follow。
  - 支持可选 source prefix。
- 新增 `cli/src/commands/logs_service.rs`：
  - 读取 daemon meta 中的 log file，或 hidden test override。
  - 支持 `--tail` / `--follow` / `--grep`。
  - 支持可选 source prefix。

### Step 3: 删除 daemon logs

- 从 `cli/src/commands/daemon.rs` 删除 `DaemonCommands::Logs` 分支和对应 helper。
- 将 daemon install 成功提示改成 `msctl logs --source service -f`。

### Step 4: 文档更新

- 更新 `README.md`、`cli/README.md`、`docs/runbooks/debugging.md`、`docs/references/cli-commands.md`。
- 确认不再推荐 `msctl daemon logs`。

### Step 5: 验证

- `python3 scripts/check-docs-indices.py`
- `cd cli && cargo test`
- `cd cli && cargo build`

## 4. 验收映射

| SPEC 验收 | 验证方式 |
|-----------|----------|
| 默认读取 app + service | smoke test |
| app source 保留结构化过滤 | 现有 smoke tests + app json test |
| service source 读取原始日志 | smoke test |
| all tail 每 source 各取 N | smoke test |
| all 输出来源前缀 | smoke test |
| 默认 `--json` 报错 | smoke test |
| `--source app --json` 可 jq | smoke test JSON parse |
| 删除 `daemon logs` | smoke test |
| install 提示更新 | source grep |
| 文档不推荐旧命令 | source grep |
