# Cloudflare Tunnel 自动隧道 Implementation Plan

> **⚠️ SUPERSEDED WIRE CONTRACT (历史记录，勿照抄):** 本计划内嵌的 Worker 源码与 CLI `report_tunnel`
> 片段使用了 **`POST /tunnel` + `{ user_token, tunnel_url }`（token 放 body）** 的写入形状。该形状与实际
> 部署的 Worker 不一致，导致 `msctl serve --relay` 注册时返回 `404 {"status":"not_found"}`。
> **权威契约是 token 放 path**：`POST /tunnel/<token>`，body `{ status: "active", tunnel_url }`；
> 删除 `DELETE /tunnel/<token>`；读取 `GET /tunnel/<token>`。以
> [`docs/design-docs/2026-05-29-cloudflare-tunnel-relay-design.md`](../design-docs/2026-05-29-cloudflare-tunnel-relay-design.md) §3.3
> 与当前 `cli/src/serve/relay.rs` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `msctl serve --relay` 自动建立 Cloudflare Tunnel，通过 Workers KV 分发隧道地址，mobile 端自动获取并连接，全链路无付费门禁。

**Architecture:** msctl 新增 `--relay` flag，运行时自动下载 cloudflared 二进制，启动隧道后将 URL 上报到 Cloudflare Workers KV（用现有 Bearer token 作 user_token）；mobile 设置页新增 Auto Tunnel / Custom Server 切换，Auto Tunnel 模式轮询 KV 获取地址后自动连接。

**Tech Stack:** Rust (tokio, reqwest, anyhow), Cloudflare Workers (Wrangler), KV TTL 30min, React Native (Zustand, AsyncStorage)

---

## File Structure

```
cloudflare-worker/              CREATE — 新目录，Workers KV 服务
├── wrangler.toml               CREATE — Worker 配置
├── package.json                CREATE — Wrangler 依赖
└── src/
    └── index.ts                CREATE — POST/GET/DELETE /tunnel 接口

cli/src/
├── Cargo.toml                  MODIFY — 无需新增依赖（reqwest 已有）
├── commands/serve.rs           MODIFY — 新增 --relay flag，调用 relay 模块
└── serve/
    └── relay.rs                CREATE — cloudflared 下载/启动/上报/心跳/清理

mobile/src/
├── features/settings/
│   ├── services/
│   │   ├── settingsService.ts  MODIFY — Settings 类型加 connectionMode + relayToken
│   │   └── tunnelService.ts    CREATE — 轮询 KV 获取隧道地址
│   └── components/
│       └── SettingsForm.tsx    MODIFY — 新增 Auto Tunnel / Custom Server 切换 UI
└── store/
    └── settingsStore.ts        MODIFY — 同步 connectionMode + relayToken 字段
```

---
## Task 1: Cloudflare Workers KV 服务

**Files:**
- Create: `cloudflare-worker/wrangler.toml`
- Create: `cloudflare-worker/package.json`
- Create: `cloudflare-worker/src/index.ts`

### 背景

Workers KV 服务是中间层：msctl 上报隧道 URL，mobile 轮询获取。接口设计：
- `POST /tunnel/:token` — msctl 上报（body: `{ status: "active", tunnel_url }`）
- `GET /tunnel/:token` — mobile 获取
- `DELETE /tunnel/:token` — msctl 退出时清理

> ⚠️ 下方 Step 4 内嵌的 Worker 源码与 Task 3 的 `report_tunnel` 片段仍是历史的 `POST /tunnel`
> (token in body) 形状，保留作记录。实际权威契约见本文件顶部 banner 与 design-doc §3.3。

- [ ] **Step 1: 初始化 Worker 项目**

```bash
mkdir cloudflare-worker && cd cloudflare-worker
npm init -y
npm install --save-dev wrangler@3
```

- [ ] **Step 2: 创建 `cloudflare-worker/wrangler.toml`**

```toml
name = "multisoul-tunnel"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "TUNNEL_KV"
id = "REPLACE_WITH_KV_NAMESPACE_ID"
preview_id = "REPLACE_WITH_KV_PREVIEW_ID"
```

- [ ] **Step 3: 创建 KV namespace**

```bash
cd cloudflare-worker
npx wrangler kv namespace create TUNNEL_KV
# 输出类似: id = "abc123..."
npx wrangler kv namespace create TUNNEL_KV --preview
# 输出类似: preview_id = "def456..."
```

将输出的 id 和 preview_id 填入 `wrangler.toml`。

- [ ] **Step 4: 创建 `cloudflare-worker/src/index.ts`**

```typescript
export interface Env {
  TUNNEL_KV: KVNamespace;
}

const TTL_SECONDS = 1800; // 30 分钟

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // POST /tunnel — msctl 上报隧道地址
    if (request.method === 'POST' && path === '/tunnel') {
      const body = await request.json<{ user_token: string; tunnel_url: string }>();
      if (!body.user_token || !body.tunnel_url) {
        return new Response(JSON.stringify({ error: 'missing fields' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const value = JSON.stringify({ tunnel_url: body.tunnel_url, updated_at: new Date().toISOString() });
      await env.TUNNEL_KV.put(`tunnel:${body.user_token}`, value, { expirationTtl: TTL_SECONDS });
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // GET /tunnel/:token — mobile 获取隧道地址
    const getMatch = path.match(/^\/tunnel\/(.+)$/);
    if (request.method === 'GET' && getMatch) {
      const token = getMatch[1];
      const raw = await env.TUNNEL_KV.get(`tunnel:${token}`);
      if (!raw) {
        return new Response(
          JSON.stringify({ status: 'not_found', message: 'msctl serve --relay not running' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const data = JSON.parse(raw) as { tunnel_url: string; updated_at: string };
      return new Response(JSON.stringify({ status: 'active', ...data }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // DELETE /tunnel/:token — msctl 退出时清理
    const delMatch = path.match(/^\/tunnel\/(.+)$/);
    if (request.method === 'DELETE' && delMatch) {
      const token = delMatch[1];
      await env.TUNNEL_KV.delete(`tunnel:${token}`);
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
```

- [ ] **Step 5: 部署到 Cloudflare**

```bash
cd cloudflare-worker
npx wrangler login   # 浏览器授权
npx wrangler deploy
# 输出类似: https://multisoul-tunnel.<your-subdomain>.workers.dev
```

记录 Worker URL，后续 msctl 和 mobile 都需要用到。

- [ ] **Step 6: 验证部署**

```bash
WORKER_URL="https://multisoul-tunnel.<your-subdomain>.workers.dev"

# 上报
curl -X POST "$WORKER_URL/tunnel" \
  -H "Content-Type: application/json" \
  -d '{"user_token":"test123","tunnel_url":"https://test.trycloudflare.com"}'
# 期望: {"status":"ok"}

# 获取
curl "$WORKER_URL/tunnel/test123"
# 期望: {"status":"active","tunnel_url":"https://test.trycloudflare.com","updated_at":"..."}

# 删除
curl -X DELETE "$WORKER_URL/tunnel/test123"
# 期望: {"status":"ok"}

# 再次获取（应 404）
curl "$WORKER_URL/tunnel/test123"
# 期望: {"status":"not_found",...}
```

- [ ] **Step 7: 提交**

```bash
git add cloudflare-worker/
git commit -m "feat(worker): add Cloudflare Workers KV tunnel state service"
```

---
## Task 2: msctl `--relay` flag + cloudflared 自动下载

**Files:**
- Create: `cli/src/serve/relay.rs`
- Modify: `cli/src/commands/serve.rs`
- Modify: `cli/src/serve/mod.rs`

### 背景

`relay.rs` 负责：检测 cloudflared → 自动下载 → 启动子进程 → 解析隧道 URL → 上报 KV → 心跳 → 退出清理。

cloudflared 下载地址规则（来自 Cloudflare 官方 GitHub Release）：
- macOS arm64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64`
- macOS x86_64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64`
- Linux amd64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64`
- Linux arm64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64`
- Windows x86_64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe`
- Windows arm64: `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe`

- [ ] **Step 1: 在 `cli/src/commands/serve.rs` 新增 `--relay` flag**

在 `ServeArgs` struct 中加入：

```rust
/// Enable Cloudflare Tunnel relay (auto-downloads cloudflared)
#[arg(long)]
pub relay: bool,

/// Cloudflare Workers KV service URL
#[arg(long, default_value = "https://multisoul-tunnel.<your-subdomain>.workers.dev")]
pub relay_url: String,
```

在 `handle` 函数末尾，`run_server` 之前加入：

```rust
if args.relay {
    let relay_url = args.relay_url.clone();
    let token_for_relay = token.clone();
    let port_for_relay = args.port;
    tokio::spawn(async move {
        if let Err(e) = crate::serve::relay::run_relay(relay_url, token_for_relay, port_for_relay).await {
            tracing::error!(err = %e, "relay_failed");
        }
    });
}
```

- [ ] **Step 2: 写失败测试（cloudflared 路径检测）**

在 `cli/src/serve/relay.rs` 创建文件，先写测试：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cloudflared_bin_path_is_under_msctl_dir() {
        let path = cloudflared_bin_path();
        let path_str = path.to_string_lossy();
        assert!(
            path_str.contains("msctl"),
            "cloudflared should be stored under msctl config dir, got: {}",
            path_str
        );
    }

    #[test]
    fn test_cloudflared_download_url_by_platform() {
        let url = cloudflared_download_url();
        assert!(
            url.contains("cloudflared"),
            "download URL should reference cloudflared binary, got: {}",
            url
        );
        // 确保 URL 不为空
        assert!(!url.is_empty(), "download URL must not be empty");
    }
}
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd cli && cargo test relay -- --nocapture 2>&1 | head -20
# 期望: error[E0425]: cannot find function `cloudflared_bin_path`
```

- [ ] **Step 4: 实现 `cli/src/serve/relay.rs`（第一部分：路径和下载）**

```rust
use anyhow::{Context, Result};
use std::path::PathBuf;

/// cloudflared 二进制存放路径：~/.config/msctl/bin/cloudflared[.exe]
pub fn cloudflared_bin_path() -> PathBuf {
    let bin_name = if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" };
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("msctl")
        .join("bin")
        .join(bin_name)
}

/// 根据当前平台返回 cloudflared 下载 URL
pub fn cloudflared_download_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe";
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
    )))]
    return "";
}

/// 确保 cloudflared 存在，不存在则下载
pub async fn ensure_cloudflared() -> Result<PathBuf> {
    let bin_path = cloudflared_bin_path();
    if bin_path.exists() {
        return Ok(bin_path);
    }

    let url = cloudflared_download_url();
    if url.is_empty() {
        anyhow::bail!("Unsupported platform for cloudflared auto-download. Please install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    }

    println!("cloudflared not found. Downloading from Cloudflare...");
    tracing::info!(url = url, dest = %bin_path.display(), "downloading_cloudflared");

    // 创建目录
    if let Some(parent) = bin_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create dir: {}", parent.display()))?;
    }

    // 下载（reqwest blocking 在 tokio 里用 spawn_blocking）
    let url_owned = url.to_string();
    let bin_path_clone = bin_path.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let resp = reqwest::blocking::get(&url_owned)
            .with_context(|| format!("failed to download cloudflared from {}", url_owned))?;
        let bytes = resp.bytes().context("failed to read cloudflared response body")?;
        std::fs::write(&bin_path_clone, &bytes)
            .with_context(|| format!("failed to write cloudflared to {}", bin_path_clone.display()))?;

        // Unix: 设置可执行权限
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin_path_clone)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin_path_clone, perms)?;
        }
        Ok(())
    })
    .await
    .context("spawn_blocking failed")??;

    println!("cloudflared downloaded to {}", bin_path.display());
    Ok(bin_path)
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd cli && cargo test relay::tests -- --nocapture
# 期望: test relay::tests::test_cloudflared_bin_path_is_under_msctl_dir ... ok
#       test relay::tests::test_cloudflared_download_url_by_platform ... ok
```

- [ ] **Step 6: 提交**

```bash
git add cli/src/serve/relay.rs cli/src/commands/serve.rs
git commit -m "feat(cli): add --relay flag and cloudflared auto-download"
```

---
## Task 3: msctl 隧道启动、URL 解析、KV 上报、心跳、退出清理

**Files:**
- Modify: `cli/src/serve/relay.rs` — 追加 `run_relay` 函数
- Modify: `cli/src/serve/mod.rs` — pub mod relay

- [ ] **Step 1: 在 `cli/src/serve/mod.rs` 注册模块**

找到 mod.rs 中现有的 `pub mod` 列表，追加：

```rust
pub mod relay;
```

- [ ] **Step 2: 写失败测试（URL 解析）**

在 `cli/src/serve/relay.rs` 的 `#[cfg(test)]` 块中追加：

```rust
    #[test]
    fn test_parse_tunnel_url_from_cloudflared_output() {
        let line = "2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+";
        assert_eq!(parse_tunnel_url(line), None, "non-URL line should return None");

        let line_with_url = "2024-01-01T00:00:00Z INF  | https://example-tunnel.trycloudflare.com                                    |";
        let result = parse_tunnel_url(line_with_url);
        assert_eq!(
            result,
            Some("https://example-tunnel.trycloudflare.com".to_string()),
            "should extract trycloudflare.com URL from cloudflared output"
        );
    }
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd cli && cargo test relay::tests::test_parse_tunnel_url -- --nocapture
# 期望: error[E0425]: cannot find function `parse_tunnel_url`
```

- [ ] **Step 4: 实现 `parse_tunnel_url` 和 `run_relay`**

在 `cli/src/serve/relay.rs` 追加（在 `#[cfg(test)]` 块之前）：

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 从 cloudflared stderr 输出行中提取隧道 URL
pub fn parse_tunnel_url(line: &str) -> Option<String> {
    // cloudflared 输出格式: "... https://xxxx.trycloudflare.com ..."
    let re = regex::Regex::new(r"https://[a-z0-9\-]+\.trycloudflare\.com").ok()?;
    re.find(line).map(|m| m.as_str().to_string())
}

/// 上报隧道地址到 Workers KV
async fn report_tunnel(relay_url: &str, user_token: &str, tunnel_url: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/tunnel", relay_url))
        .json(&serde_json::json!({
            "user_token": user_token,
            "tunnel_url": tunnel_url,
        }))
        .send()
        .await
        .context("failed to report tunnel URL to KV")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("KV report failed: {} — {}", status, body);
    }
    Ok(())
}

/// 清理 KV 中的隧道记录
async fn cleanup_tunnel(relay_url: &str, user_token: &str) {
    let client = reqwest::Client::new();
    let _ = client
        .delete(format!("{}/tunnel/{}", relay_url, user_token))
        .send()
        .await;
    tracing::info!("relay_cleanup_done");
}

/// 主入口：启动 cloudflared，解析 URL，上报 KV，心跳，退出清理
pub async fn run_relay(relay_url: String, user_token: String, port: u16) -> Result<()> {
    let bin = ensure_cloudflared().await?;

    tracing::info!(port = port, "starting_cloudflared");
    println!("Starting Cloudflare Tunnel for port {}...", port);

    let mut child = Command::new(&bin)
        .args(["tunnel", "--url", &format!("http://localhost:{}", port)])
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .context("failed to spawn cloudflared")?;

    let stderr = child.stderr.take().context("no stderr from cloudflared")?;
    let mut reader = BufReader::new(stderr).lines();

    // 解析隧道 URL（最多等 60 秒）
    let tunnel_url = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        async {
            while let Ok(Some(line)) = reader.next_line().await {
                tracing::debug!(line = %line, "cloudflared_stderr");
                if let Some(url) = parse_tunnel_url(&line) {
                    return Ok::<String, anyhow::Error>(url);
                }
            }
            anyhow::bail!("cloudflared exited before providing tunnel URL")
        },
    )
    .await
    .context("timed out waiting for cloudflared tunnel URL")??;

    println!("Cloudflare Tunnel ready: {}", tunnel_url);
    tracing::info!(tunnel_url = %tunnel_url, "relay_tunnel_ready");

    // 上报到 KV
    report_tunnel(&relay_url, &user_token, &tunnel_url).await?;

    // 心跳：每 5 分钟刷新 KV TTL
    let relay_url_hb = relay_url.clone();
    let token_hb = user_token.clone();
    let url_hb = tunnel_url.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        interval.tick().await; // 跳过第一次立即触发
        loop {
            interval.tick().await;
            if let Err(e) = report_tunnel(&relay_url_hb, &token_hb, &url_hb).await {
                tracing::warn!(err = %e, "relay_heartbeat_failed");
            } else {
                tracing::debug!("relay_heartbeat_ok");
            }
        }
    });

    // 等待 cloudflared 子进程退出（通常跟随主进程）
    let _ = child.wait().await;

    // 退出清理
    cleanup_tunnel(&relay_url, &user_token).await;
    Ok(())
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd cli && cargo test relay::tests -- --nocapture
# 期望: 3 个测试全部 ok
```

- [ ] **Step 6: 编译检查**

```bash
cd cli && cargo build 2>&1 | head -30
# 期望: Compiling msctl ... Finished
```

- [ ] **Step 7: 提交**

```bash
git add cli/src/serve/relay.rs cli/src/serve/mod.rs
git commit -m "feat(cli): implement cloudflared tunnel launch, KV report, heartbeat, cleanup"
```

---
## Task 4: mobile Settings 类型扩展 + tunnelService

**Files:**
- Modify: `mobile/src/features/settings/services/settingsService.ts`
- Create: `mobile/src/features/settings/services/tunnelService.ts`
- Modify: `mobile/src/store/settingsStore.ts`

### 背景

`Settings` 类型新增两个字段：
- `connectionMode: 'auto' | 'custom'` — 连接方式
- `relayToken: string` — msctl Bearer token（用于 KV 查询）

`tunnelService.ts` 封装轮询逻辑：每 10 秒查一次 KV，最多 5 分钟，返回隧道 URL 或超时错误。

- [ ] **Step 1: 写失败测试（tunnelService）**

创建 `mobile/src/features/settings/services/tunnelService.test.ts`：

```typescript
import { fetchTunnelUrl } from './tunnelService';

// mock fetch
global.fetch = jest.fn();

describe('fetchTunnelUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns tunnel_url when KV responds with status active', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'active',
        tunnel_url: 'https://test-tunnel.trycloudflare.com',
        updated_at: '2026-05-29T00:00:00Z',
      }),
    });

    const result = await fetchTunnelUrl('https://worker.example.com', 'ms_v2_abc123');
    expect(result).toBe('https://test-tunnel.trycloudflare.com');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://worker.example.com/tunnel/ms_v2_abc123',
    );
  });

  it('returns null when KV responds with status not_found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ status: 'not_found' }),
    });

    const result = await fetchTunnelUrl('https://worker.example.com', 'ms_v2_abc123');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=tunnelService --watchAll=false 2>&1 | tail -10
# 期望: Cannot find module './tunnelService'
```

- [ ] **Step 3: 修改 `settingsService.ts`**

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  serverUrl: string;
  apiKey: string;
  connectionMode: 'auto' | 'custom';
  relayToken: string;
  relayWorkerUrl: string;
}

const STORAGE_KEY = 'multisoul_settings';
const DEFAULTS: Settings = {
  serverUrl: 'http://localhost:8080',
  apiKey: '',
  connectionMode: 'custom',
  relayToken: '',
  relayWorkerUrl: 'https://multisoul-tunnel.<your-subdomain>.workers.dev',
};

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
```

- [ ] **Step 4: 创建 `tunnelService.ts`**

```typescript
/**
 * 从 Cloudflare Workers KV 获取隧道地址。
 * 返回 tunnel_url 字符串，或 null（未找到/网络错误）。
 */
export async function fetchTunnelUrl(
  workerUrl: string,
  userToken: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${workerUrl}/tunnel/${userToken}`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { status: string; tunnel_url?: string };
    if (data.status === 'active' && data.tunnel_url) {
      return data.tunnel_url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 轮询 KV 直到获取到隧道地址或超时。
 * intervalMs: 轮询间隔（默认 10s）
 * timeoutMs: 最大等待时间（默认 5min）
 */
export async function pollTunnelUrl(
  workerUrl: string,
  userToken: string,
  intervalMs = 10_000,
  timeoutMs = 300_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await fetchTunnelUrl(workerUrl, userToken);
    if (url) return url;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for msctl serve --relay to start (5 min)');
}
```

- [ ] **Step 5: 修改 `settingsStore.ts`**

```typescript
import { create } from 'zustand';
import {
  loadSettings,
  saveSettings,
  type Settings,
} from '@/features/settings/services/settingsService';

interface SettingsState {
  settings: Settings;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    serverUrl: 'http://localhost:8080',
    apiKey: '',
    connectionMode: 'custom',
    relayToken: '',
    relayWorkerUrl: 'https://multisoul-tunnel.<your-subdomain>.workers.dev',
  },
  load: async () => {
    const settings = await loadSettings();
    set({ settings });
  },
  save: async (s: Settings) => {
    await saveSettings(s);
    set({ settings: s });
  },
}));
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=tunnelService --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/settings/services/tunnelService.test.ts
```

- [ ] **Step 7: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | head -20
# 期望: 无错误
```

- [ ] **Step 8: 提交**

```bash
git add mobile/src/features/settings/services/
git add mobile/src/store/settingsStore.ts
git commit -m "feat(mobile): extend Settings type with connectionMode/relayToken, add tunnelService"
```

---
## Task 5: mobile SettingsForm — Auto Tunnel / Custom Server 切换 UI

**Files:**
- Modify: `mobile/src/features/settings/components/SettingsForm.tsx`

### 背景

设置页面新增连接方式切换：
- **Auto Tunnel**：显示 relay token 输入框（用于 KV 查询），隐藏 serverUrl 输入框
- **Custom Server**：显示 serverUrl + apiKey 输入框（现有逻辑）

Auto Tunnel 模式下，用户输入 msctl Bearer token（即 `relayToken`），app 用它去 KV 查隧道地址，查到后自动填充 serverUrl 并连接。

- [ ] **Step 1: 写失败测试（SettingsForm 渲染）**

创建 `mobile/src/features/settings/components/SettingsForm.test.tsx`（如已存在则追加）：

```typescript
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SettingsForm } from './SettingsForm';

// mock store
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      serverUrl: '',
      apiKey: '',
      connectionMode: 'custom',
      relayToken: '',
      relayWorkerUrl: 'https://worker.example.com',
    },
    save: jest.fn(),
  }),
}));

describe('SettingsForm connection mode', () => {
  it('shows Custom Server inputs by default', () => {
    const { getByPlaceholderText, queryByPlaceholderText } = render(<SettingsForm />);
    expect(getByPlaceholderText('http://localhost:8080')).toBeTruthy();
    expect(queryByPlaceholderText('ms_v2_...')).toBeNull();
  });

  it('shows relay token input when Auto Tunnel is selected', () => {
    const { getByText, getByPlaceholderText, queryByPlaceholderText } = render(<SettingsForm />);
    fireEvent.press(getByText('Auto Tunnel'));
    expect(getByPlaceholderText('ms_v2_...')).toBeTruthy();
    expect(queryByPlaceholderText('http://localhost:8080')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=SettingsForm --watchAll=false 2>&1 | tail -15
# 期望: FAIL — 找不到 'Auto Tunnel' 文本
```

- [ ] **Step 3: 实现新版 `SettingsForm.tsx`**

```typescript
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useSettingsStore } from '@/store/settingsStore';
import type { Settings } from '@/features/settings/services/settingsService';

export function SettingsForm() {
  const insets = useSafeAreaInsets();
  const { settings, save } = useSettingsStore();

  const [mode, setMode] = useState<'auto' | 'custom'>(settings.connectionMode);
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [relayToken, setRelayToken] = useState(settings.relayToken);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated: Settings = {
        ...settings,
        connectionMode: mode,
        serverUrl: serverUrl.trim(),
        apiKey: apiKey.trim(),
        relayToken: relayToken.trim(),
      };
      await save(updated);
      Alert.alert('Saved', 'Settings saved successfully.');
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        className="flex-1 bg-[#0D0D0D]"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[28px] font-bold text-white px-4 pt-4 pb-6">
          Settings
        </Text>

        {/* 连接方式切换 */}
        <Card className="mx-4 mb-4">
          <Text className="text-[#888888] text-[12px] mb-3">CONNECTION MODE</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              onPress={() => setMode('auto')}
              className={`flex-1 py-3 rounded-[26px] items-center ${
                mode === 'auto' ? 'bg-[#FF6B35]' : 'bg-[#1A1A1A]'
              }`}
            >
              <Text className={`text-[14px] font-semibold ${mode === 'auto' ? 'text-white' : 'text-[#888888]'}`}>
                Auto Tunnel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('custom')}
              className={`flex-1 py-3 rounded-[26px] items-center ${
                mode === 'custom' ? 'bg-[#FF6B35]' : 'bg-[#1A1A1A]'
              }`}
            >
              <Text className={`text-[14px] font-semibold ${mode === 'custom' ? 'text-white' : 'text-[#888888]'}`}>
                Custom Server
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Auto Tunnel 模式 */}
        {mode === 'auto' && (
          <Card className="mx-4 mb-4">
            <Text className="text-[#888888] text-[12px] mb-1">
              Run `msctl serve --relay` on your Mac, then paste the Bearer token below.
            </Text>
            <Input
              label="Bearer Token"
              value={relayToken}
              onChangeText={setRelayToken}
              placeholder="ms_v2_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Card>
        )}

        {/* Custom Server 模式 */}
        {mode === 'custom' && (
          <Card className="mx-4 mb-4">
            <Input
              label="Server URL"
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://localhost:8080"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Input
              label="API Key"
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="ms_..."
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
          </Card>
        )}

        <View className="mx-4">
          <Button
            label="Save"
            onPress={() => { void handleSave(); }}
            loading={saving}
            loadingLabel="Saving..."
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd mobile && pnpm test -- --testPathPattern=SettingsForm --watchAll=false 2>&1 | tail -10
# 期望: PASS src/features/settings/components/SettingsForm.test.tsx
```

- [ ] **Step 5: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | head -20
# 期望: 无错误
```

- [ ] **Step 6: 提交**

```bash
git add mobile/src/features/settings/components/SettingsForm.tsx
git add mobile/src/features/settings/components/SettingsForm.test.tsx
git commit -m "feat(mobile): add Auto Tunnel / Custom Server connection mode UI"
```

---
## Task 6: mobile Auto Tunnel 连接逻辑 + 端到端验证

**Files:**
- Modify: `mobile/src/features/settings/components/SettingsForm.tsx` — 保存时 Auto Tunnel 模式触发轮询并自动填充 serverUrl

### 背景

Auto Tunnel 模式保存时：
1. 调用 `pollTunnelUrl(relayWorkerUrl, relayToken)` 轮询 KV
2. 获取到隧道 URL 后，自动将 `serverUrl` 设为该 URL，`apiKey` 设为 `relayToken`
3. 保存到 settings，连接成功

- [ ] **Step 1: 写失败测试（Auto Tunnel 保存触发轮询）**

在 `SettingsForm.test.tsx` 追加：

```typescript
import { pollTunnelUrl } from '@/features/settings/services/tunnelService';

jest.mock('@/features/settings/services/tunnelService', () => ({
  pollTunnelUrl: jest.fn(),
}));

describe('SettingsForm Auto Tunnel save', () => {
  it('calls pollTunnelUrl and saves resolved URL as serverUrl', async () => {
    const mockSave = jest.fn();
    (pollTunnelUrl as jest.Mock).mockResolvedValueOnce('https://resolved.trycloudflare.com');

    // re-render with auto mode
    jest.mock('@/store/settingsStore', () => ({
      useSettingsStore: () => ({
        settings: {
          serverUrl: '',
          apiKey: '',
          connectionMode: 'auto',
          relayToken: 'ms_v2_test',
          relayWorkerUrl: 'https://worker.example.com',
        },
        save: mockSave,
      }),
    }));

    const { getByText } = render(<SettingsForm />);
    fireEvent.press(getByText('Save'));

    await new Promise((r) => setTimeout(r, 50));
    expect(pollTunnelUrl).toHaveBeenCalledWith('https://worker.example.com', 'ms_v2_test');
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'https://resolved.trycloudflare.com' }),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd mobile && pnpm test -- --testPathPattern=SettingsForm --watchAll=false 2>&1 | tail -10
# 期望: FAIL — pollTunnelUrl not called
```

- [ ] **Step 3: 修改 `SettingsForm.tsx` 的 `handleSave`**

将 `handleSave` 替换为：

```typescript
  const handleSave = async () => {
    setSaving(true);
    try {
      let resolvedServerUrl = serverUrl.trim();
      let resolvedApiKey = apiKey.trim();

      if (mode === 'auto') {
        if (!relayToken.trim()) {
          Alert.alert('Missing Token', 'Please enter your msctl Bearer token.');
          return;
        }
        // 轮询 KV 获取隧道地址
        resolvedServerUrl = await pollTunnelUrl(settings.relayWorkerUrl, relayToken.trim());
        resolvedApiKey = relayToken.trim();
      }

      const updated: Settings = {
        ...settings,
        connectionMode: mode,
        serverUrl: resolvedServerUrl,
        apiKey: resolvedApiKey,
        relayToken: relayToken.trim(),
      };
      await save(updated);
      Alert.alert('Connected', mode === 'auto' ? `Tunnel: ${resolvedServerUrl}` : 'Settings saved.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Connection Failed', msg);
    } finally {
      setSaving(false);
    }
  };
```

在文件顶部 import 追加：

```typescript
import { pollTunnelUrl } from '@/features/settings/services/tunnelService';
```

- [ ] **Step 4: 运行所有 settings 相关测试**

```bash
cd mobile && pnpm test -- --testPathPattern=settings --watchAll=false 2>&1 | tail -15
# 期望: 全部 PASS
```

- [ ] **Step 5: 全量 typecheck + 测试**

```bash
cd mobile && pnpm typecheck && pnpm test -- --watchAll=false 2>&1 | tail -20
# 期望: 无类型错误，所有测试通过
```

- [ ] **Step 6: CLI 全量测试**

```bash
cd cli && cargo test && cargo build
# 期望: 全部通过，编译成功
```

- [ ] **Step 7: 端到端手动验证**

```
1. 部署 Worker（Task 1 已完成）
2. 运行: cd cli && cargo run -- serve --relay --relay-url <worker-url>
   期望输出: "Cloudflare Tunnel ready: https://xxxx.trycloudflare.com"
3. 打开 iOS 模拟器，进入 Settings
4. 选择 Auto Tunnel，输入 Bearer token，点 Save
   期望: Alert 显示 "Tunnel: https://xxxx.trycloudflare.com"
5. 返回主页，确认 agent 列表正常加载
```

- [ ] **Step 8: 最终提交**

```bash
git add mobile/src/features/settings/components/SettingsForm.tsx
git add mobile/src/features/settings/components/SettingsForm.test.tsx
git commit -m "feat(mobile): Auto Tunnel mode polls KV and auto-connects on save"
```

---

## 验收 Checklist

- [ ] `msctl serve --relay` 能自动下载 cloudflared（首次运行）
- [ ] cloudflared 启动后隧道 URL 出现在终端输出
- [ ] Workers KV `GET /tunnel/:token` 返回正确的隧道 URL
- [ ] mobile 设置页 Auto Tunnel / Custom Server 切换正常
- [ ] Auto Tunnel 模式保存后自动连接到隧道地址
- [ ] msctl 退出后 KV 记录被清理（`GET /tunnel/:token` 返回 404）
- [ ] `cargo test` 全部通过
- [ ] `pnpm test --watchAll=false` 全部通过
- [ ] `pnpm typecheck` 无错误
