# msctl CLI

`msctl` 是 MultiSoul 的本地命令行工具，用于管理 Agent 并启动本地服务。

## 构建命令

```bash
cd cli

# 构建
cargo build

# 运行测试
cargo test
```

## 安装命令（后台服务）

推荐用**稳定安装**的 `msctl` 管理后台服务（`cargo install --path .` 或 `npm i -g @yakami129/msctl`）。
不要用 IDE 沙箱里的 `cargo run -- daemon install`——会把临时二进制路径写进 launchd，清理后服务会起不来。

```bash
msctl daemon quickstart
```

开发期若尚未全局安装，可用项目内二进制（路径稳定）：

```bash
cd cli
./target/debug/msctl daemon quickstart
```

常见安装场景：

```bash
# 自定义 token / 端口 / tailnet
msctl daemon quickstart --token test --port 8765 --tailnet true

# 手动安装（已配置 token 时）
msctl daemon install --port 8765 --tailnet
```

## 使用命令示例

### 1) 认证

```bash
cargo run -- auth login --token test
cargo run -- auth status
```

### 2) Agent 管理

```bash
# 注册 Agent
cargo run -- agent register --name demo --project /Users/alan/Documents/codes/yakami0129/multisoul --runtime claude-code

# Cursor Agent CLI（本机已安装 `agent`，非交互需 `--trust` + `--force`，由 runtime 自动传入）
cargo run -- agent register --name cursor-demo --project /path/to/repo --runtime cursor-cli

# 列表与详情
cargo run -- agent list
cargo run -- agent get <agent-id>

# 更新与删除
cargo run -- agent update <agent-id> --name demo2
cargo run -- agent delete <agent-id>
```

### 3) 前台启动服务（调试用）

```bash
cargo run -- serve --token test --tailnet
```

### 4) 后台服务管理

```bash
msctl daemon status
msctl logs --source service -f
msctl daemon restart
msctl daemon stop
msctl daemon uninstall
```

## 最小架构说明

- `src/main.rs`：CLI 入口与子命令分发
- `src/commands/*`：命令实现（`auth` / `agent` / `serve` / `daemon`）
- `src/serve/*`：HTTP/WS 服务与运行时桥接
- `src/db.rs`：SQLite schema 与连接
- `src/config.rs`：本地配置读写（`~/.config/msctl/config.toml`）
