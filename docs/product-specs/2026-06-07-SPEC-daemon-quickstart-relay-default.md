# daemon quickstart 默认 Relay 模式 SPEC

## 1. 背景与目标

MultiSoul 手机端 Auto Tunnel 依赖 `msctl serve --relay`：CLI 启动 Cloudflare Tunnel、上报 Workers KV，手机通过 KV 发现公网可达地址。当前 `msctl daemon quickstart` 默认走 **tailnet**（绑定 `0.0.0.0`），launchd plist 仅注入 `--tailnet`，与产品主路径不一致。

开发者日常启动命令过长：

```bash
cargo run -- daemon quickstart --port 8765 --tailnet true
```

**目标**：将 `daemon quickstart` 简化为开箱即用的一键命令，默认等价于 `serve --relay`，tailnet / funnel 通过配置或 CLI 切换；零参数即可完成安装、启动、生成合规 token 并输出可扫描配对 QR。

## 2. 范围

### 2.1 In Scope

- `config.toml` 新增 `serve_mode`（`relay` | `tailnet` | `funnel`）及可选 `relay_url`。
- `daemon quickstart` 零参数默认：`serve_mode=relay`、`serve_port=8765`、自动生成 token。
- launchd plist 按 `serve_mode` 注入 `serve --relay` / `--tailnet` / `--funnel` 及 `--relay-url`（relay 模式）。
- quickstart 在 relay 模式下等待 tunnel 就绪（最多 20 分钟，覆盖 cloudflared 首次下载）后打印公网 URL 的 QR 与 connection string。
- CLI 互斥 flag：`--relay` / `--tailnet` / `--funnel`（默认不传 = relay）；`--port`、`--relay-url` 可覆盖并写回 config。
- 旧安装自动迁移：检测到 meta 无 `serve_mode` 时，quickstart 按 relay 迁移并重装 plist。
- `daemon status` 显示 mode、port、token 前缀。
- 文档同步：`README.md`、`cli/README.md`、`docs/references/cli-commands.md`。
- 单元测试：config 序列化、plist 生成、token 格式、mode 互斥。

### 2.2 Out of Scope

- local-only（`127.0.0.1`）作为 daemon 模式。
- 非 macOS daemon 管理。
- Cloudflare Workers / KV relay 服务本身改动。
- 新增独立 `msctl pair` 子命令（本版 QR 仅在 quickstart 输出）。
- npm 发布流程变更。

## 3. 用户与使用场景

### 3.1 典型用户

- 在本机 Mac 上运行 `msctl`、用手机 MultiSoul App 遥控 agent 的个人开发者。
- 希望「一条命令装好后台服务 + 扫码配对」、不想记忆 tailnet / relay 差异的用户。

### 3.2 关键使用场景

#### 场景 A：首次开箱（主路径）

```bash
msctl daemon quickstart
```

1. 若 `serve_token` 为空，自动生成 `ms_v2_` + 32 位小写 hex token。
2. 写入 `config.toml`：`serve_mode=relay`、`serve_port=8765`、默认 `relay_url`。
3. 安装 / 重装 launchd 服务，plist 含 `msctl serve --relay --token … --port 8765 --relay-url …`。
4. 等待 Cloudflare Tunnel 就绪（≤ 20 分钟），打印公网 tunnel URL 的 QR。
5. 用户手机扫码或粘贴 connection string，Auto Tunnel 连通。

#### 场景 B：Tailscale 内网用户

编辑 `~/.config/msctl/config.toml` 设 `serve_mode = "tailnet"`，或：

```bash
msctl daemon quickstart --tailnet
```

重装 plist 后绑定 `0.0.0.0`，QR 使用 tailnet 可达 base URL（与现有 `advertised_base_url` 逻辑一致）。

#### 场景 C：Tailscale Funnel 公网 HTTPS

```bash
msctl daemon quickstart --funnel
```

plist 注入 `--funnel`；QR 使用 Funnel HTTPS URL。

#### 场景 D：从旧 tailnet 安装迁移

用户曾运行 `daemon quickstart --tailnet true`。再次执行 `msctl daemon quickstart` 时，检测到 meta 缺少 `serve_mode`，自动按 relay 写入 config、force 重装 plist，status 显示新 mode。

## 4. 配置模型

### 4.1 config.toml 字段

路径：`~/.config/msctl/config.toml`

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `serve_token` | string | `""` | 空则 quickstart 自动生成 |
| `serve_port` | u16 | `8765` | HTTP/WS 监听端口 |
| `serve_mode` | enum | `"relay"` | `relay` \| `tailnet` \| `funnel` |
| `relay_url` | string | `https://multisoul-tunnel.berrymeryl6.workers.dev` | 仅 relay 模式使用；与 `serve --relay-url` 默认一致 |

示例：

```toml
serve_token = "ms_v2_a1b2c3d4e5f6789012345678901234ab"
serve_port = 8765
serve_mode = "relay"
relay_url = "https://multisoul-tunnel.berrymeryl6.workers.dev"
```

向后兼容：旧 config 无 `serve_mode` / `relay_url` 时，`serve_mode` 反序列化默认 `relay`，`relay_url` 使用 serve 内置默认值。

### 4.2 daemon meta 扩展

`~/.config/msctl/daemon.json`（现有 `Meta`）增加：

| 字段 | 说明 |
|------|------|
| `serve_mode` | 安装时的 mode，供 `daemon status` 展示 |
| `relay_url` | relay 模式安装时的 URL（可选，status 可展示 truncated） |

权威源为 `config.toml`；install / quickstart 时从 config 同步写入 meta。

## 5. CLI 行为

### 5.1 `daemon quickstart`

| 参数 | 默认 | 说明 |
|------|------|------|
| （无参） | — | 使用 config 默认；config 缺省时 `serve_mode=relay`、`port=8765` |
| `--relay` | 默认 mode | 互斥；设 `serve_mode=relay` 并写 config |
| `--tailnet` | — | 互斥；设 `serve_mode=tailnet` 并写 config |
| `--funnel` | — | 互斥；设 `serve_mode=funnel` 并写 config |
| `--port <u16>` | `8765` | 覆盖 `serve_port` 并写 config |
| `--relay-url <url>` | 内置默认 | 覆盖 `relay_url` 并写 config |
| `--token <str>` | 自动生成 | **deprecated**：仍可用但文档不再推荐；空则自动生成 |

**移除 / 变更**：

- 删除 `--tailnet` 的 `default_value_t = true` 语义（tailnet 不再是默认）。
- 旧文档示例 `quickstart --token test --port 8765 --tailnet true` 标记为过时。

quickstart 内部流程：

1. 加载 config，应用 CLI 覆盖，保存 config。
2. token 为空则 `generate_token()`（必须满足 `^ms_v2_[a-f0-9]{32}$`）。
3. 调用 `install(port, mode, force=true)`（保持现有 quickstart 强制重装行为）。
4. 若 `serve_mode == relay`：等待 tunnel URL（超时 20 分钟），成功则 `print_qr(token, tunnel_url)`；超时则 warn，install 仍成功。
5. 若 tailnet / funnel：安装完成后立即 `print_qr`（与现有 `print_pairing_info` 逻辑对齐）。

### 5.2 `daemon install`

与 quickstart 共用 mode 解析：从 config 读 `serve_mode`；CLI 可传 `--relay` / `--tailnet` / `--funnel` / `--port` / `--relay-url` 覆盖并写 config（与 quickstart 一致）。

### 5.3 `daemon status`

输出增加：

```
  Mode:     relay
  Token:    ms_v2_a1b2…（前缀）
  Relay:    https://multisoul-tunnel…（relay 模式）
```

## 6. launchd plist

`ProgramArguments` 按 mode 生成（互斥，仅一种）：

**relay（默认）**

```
msctl serve --token <token> --port <port> --relay --relay-url <relay_url>
```

**tailnet**

```
msctl serve --token <token> --port <port> --tailnet
```

**funnel**

```
msctl serve --token <token> --port <port> --funnel
```

relay 模式 bind 地址仍为 `127.0.0.1`（与前台 `serve --relay` 一致）；公网可达性由 cloudflared 提供。

## 7. 迁移策略

| 条件 | 行为 |
|------|------|
| meta 无 `serve_mode` 字段 | quickstart 视为 legacy；设 `serve_mode=relay`，写 config，`install --force` |
| meta 已有 `serve_mode` | 尊重 config / CLI，按需 force 重装 |
| config 有 token=`test` | 不自动改 token；新装空 token 才自动生成。用户可删 config token 后 re-quickstart |

不要求用户手动 `uninstall`；quickstart 自带 force 重装。

## 8. 状态、错误与边界情况

| 场景 | 预期行为 |
|------|----------|
| cloudflared 首次下载慢 | quickstart 阻塞等待，最多 20 分钟 |
| 20 分钟内 tunnel 未就绪 | 打印 `[warn] Tunnel URL unavailable…`；服务仍 running；提示 `msctl logs --source service -f` |
| relay KV 上报失败 | 服务仍 running；warn；QR 可能仍可用（tunnel URL 本地已知） |
| 同时传 `--relay` 和 `--tailnet` | clap 互斥组报错，exit non-zero |
| 非 macOS 执行 daemon | 保持现有 `anyhow::bail!("daemon management is only supported on macOS")` |
| token=`test` + relay | Worker 返回 `invalid_token`；document 推荐自动生成 token；不在本版强制迁移旧 test token |

## 9. 非功能性需求

- **安全**：token 128-bit 熵；status 仅打印前缀。
- **可运维性**：mode / port / relay_url 均可从 config 修改后 `daemon install --force` 生效。
- **一致性**：CLI flag 命名与 `msctl serve` 对齐（`--relay`、`--tailnet`、`--funnel`、`--relay-url`）。

## 10. 风险与权衡

| 权衡 | 选择 | 理由 |
|------|------|------|
| 默认 mode | relay 而非 tailnet | 对齐手机 Auto Tunnel 主路径 |
| quickstart 阻塞等待 tunnel | 最多 20 分钟 | 覆盖 cloudflared 首次下载；用户需要 QR 才退出 |
| 保留 `--token` | deprecated 可选 | 减少 breaking；文档引导自动生成 |
| legacy 迁移 | 自动升 relay | 降低旧用户摩擦 |

## 11. 验收标准

### 11.1 Must（采访确认）

- [ ] `cargo run -- daemon quickstart` 零参数：config 写入、launchd installed、服务 running。
- [ ] launchd plist 含 `serve --relay` 及默认 `--relay-url`。
- [ ] 自动生成 token 匹配 `^ms_v2_[a-f0-9]{32}$`。
- [ ] relay quickstart 完成后 QR / connection string 使用公网 tunnel URL，手机可连。
- [ ] 改 `serve_mode` 或通过 `--tailnet` / `--funnel` + reinstall 可切换模式。
- [ ] `msctl daemon status` 显示 mode、port、token 前缀。
- [ ] README / cli-commands 文档更新为一行 quickstart 示例。

### 11.2 代表性测试用例

1. **零参 relay**：空 config → quickstart → plist 含 `--relay` → token 合规 →（mock tunnel）QR URL 非 127.0.0.1。
2. **mode 切换**：quickstart `--tailnet` → plist 含 `--tailnet` 不含 `--relay` → status Mode=tailnet。
3. **config 往返**：`serve_mode` + `relay_url` TOML serialize/deserialize 默认值正确。
4. **legacy 迁移**：旧 meta 无 serve_mode → quickstart → meta.serve_mode=relay。
5. **互斥 flag**：`--relay --tailnet` 同时传递 → CLI 错误。

### 11.3 验证命令

```bash
cd cli && cargo test
cd cli && cargo build
# 手工（macOS + 网络）
cargo run -- daemon quickstart
msctl daemon status
```

## 12. 实现触点（供施工参考）

| 文件 | 变更 |
|------|------|
| `cli/src/config.rs` | `serve_mode`、`relay_url` 字段与默认值 |
| `cli/src/commands/daemon.rs` | quickstart/install mode 解析、relay 等待 QR、status 输出 |
| `cli/src/serve/daemon/mod.rs` | `Config` / `Meta` 增加 mode、relay_url |
| `cli/src/serve/daemon/launchd.rs` | plist 按 mode 注入参数；单元测试 |
| `README.md`、`cli/README.md`、`docs/references/cli-commands.md` | 简化 quickstart 示例 |

## 13. 文档示例（目标态）

```bash
# 开箱即用（默认 relay + 自动 token + QR）
msctl daemon quickstart

# 切换 tailnet
msctl daemon quickstart --tailnet

# 自定义端口（写回 config）
msctl daemon quickstart --port 9000
```

---

*采访记录：2026-06-07；默认 relay、config.toml 权威、token 自动生成、互斥 mode flag、port 持久化、relay 等待 20min 出 QR、legacy 自动迁移。*
