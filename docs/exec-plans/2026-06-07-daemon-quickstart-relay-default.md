# daemon quickstart 默认 Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development if available; otherwise use superpowers:executing-plans or the local equivalent. This repository overrides the default per-task commit habit: implement all tasks, pass verification, run required code review, then create **one final commit** and record its SHA in `docs/exec-plans/index.json`.

**Spec Reference:** [`docs/product-specs/2026-06-07-SPEC-daemon-quickstart-relay-default.md`](../product-specs/2026-06-07-SPEC-daemon-quickstart-relay-default.md)

**Goal:** Simplify `msctl daemon quickstart` to zero-arg relay-by-default, with `serve_mode` in config.toml and launchd plist injecting `--relay` / `--tailnet` / `--funnel`.

**Architecture:** Extend `Config` + daemon `Meta` with `ServeMode` enum; launchd plist builder emits mode-specific `ProgramArguments`; quickstart resolves CLI flags → config → install → (relay only) poll KV for tunnel URL up to 20 minutes before printing QR.

**Tech Stack:** Rust + clap 4 + serde/toml + tokio + reqwest (existing relay stack).

---

## Baseline Evidence

- Quickstart today: [`cli/src/commands/daemon.rs`](../../cli/src/commands/daemon.rs) — saves token/port, calls `install(..., tailnet=true)`.
- Plist only supports `--tailnet`: [`cli/src/serve/daemon/launchd.rs`](../../cli/src/serve/daemon/launchd.rs) `build_plist`.
- Relay serve path: [`cli/src/commands/serve.rs`](../../cli/src/commands/serve.rs) `--relay` + deferred QR via oneshot.
- KV poll contract (mobile): [`mobile/src/features/settings/services/tunnelService.ts`](../../mobile/src/features/settings/services/tunnelService.ts) `GET {relay_url}/tunnel/{token}` → `{ status, tunnel_url }`.
- Token generator: `generate_token()` in serve.rs — `^ms_v2_[a-f0-9]{32}$`.

## Implementation Boundaries

- macOS daemon only (existing constraint).
- Do not change Cloudflare Worker.
- Do not change mobile Auto Tunnel (already polls KV).
- `--token` remains optional/deprecated; default auto-generate when empty.
- Single final commit after all tasks + `cargo test` + code review.

---

## Task 1: Config Model — `serve_mode` + `relay_url`

**Files:**
- Modify: `cli/src/config.rs`
- Test: `cli/src/config.rs` `#[cfg(test)]`

- [ ] Add shared enum (place in `config.rs` or small `cli/src/serve_mode.rs` if daemon needs it without circular deps):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ServeMode {
    #[default]
    Relay,
    Tailnet,
    Funnel,
}
```

- [ ] Extend `Config`:

```rust
pub struct Config {
    pub serve_token: String,
    #[serde(default = "default_port")]
    pub serve_port: u16,
    #[serde(default)]
    pub serve_mode: ServeMode,
    #[serde(default = "default_relay_url")]
    pub relay_url: String,
}

pub fn default_relay_url() -> String {
    "https://multisoul-tunnel.berrymeryl6.workers.dev".into()
}
```

- [ ] Add tests:
  - empty/minimal TOML deserializes with `serve_mode=Relay`, `relay_url=default`, `serve_port=8765`
  - round-trip all three modes + custom relay_url

**Verification:**
- Run: `cd cli && cargo test config::`
- Expected: PASS

---

## Task 2: Daemon Config / Meta — Replace `tailnet: bool` with `ServeMode`

**Files:**
- Modify: `cli/src/serve/daemon/mod.rs`
- Modify: `cli/src/commands/daemon.rs` (call sites only in this task if needed for compile)

- [ ] Replace `tailnet: bool` on macOS `Config` with `serve_mode: ServeMode` + `relay_url: String`.
- [ ] Extend `Meta`:

```rust
pub struct Meta {
    // ... existing fields ...
    #[serde(default)]
    pub serve_mode: ServeMode,
    #[serde(default)]
    pub relay_url: String,
    /// Legacy field — kept for deserialize; ignored when serve_mode is set.
    #[serde(default)]
    pub tailnet: bool,
}
```

- [ ] Migration helper `fn resolve_serve_mode(meta: &Meta, cfg: &Config) -> ServeMode`:
  - If meta has non-default `serve_mode` from new installs → use it
  - Else if meta exists but only legacy `tailnet` → map `tailnet=true` → Tailnet, else Relay (quickstart will overwrite to Relay per spec auto-migrate)
  - Else use `cfg.serve_mode`

**Verification:**
- Run: `cd cli && cargo build`
- Expected: compile (launchd/daemon.rs updated in Task 3)

---

## Task 3: launchd Plist — Mode-Specific ProgramArguments

**Files:**
- Modify: `cli/src/serve/daemon/launchd.rs`

- [ ] Refactor `build_plist(cfg: &Config)` to emit **one** mode flag:

```rust
fn mode_args(cfg: &Config) -> String {
    match cfg.serve_mode {
        ServeMode::Relay => format!(
            "        <string>--relay</string>\n\
             <string>--relay-url</string>\n\
             <string>{}</string>\n",
            cfg.relay_url
        ),
        ServeMode::Tailnet => "        <string>--tailnet</string>\n".into(),
        ServeMode::Funnel => "        <string>--funnel</string>\n".into(),
    }
}
```

- [ ] Update existing tests + add:
  - `test_build_plist_relay_contains_relay_and_url`
  - `test_build_plist_funnel_contains_funnel`
  - `test_build_plist_tailnet_omits_relay`
  - relay plist must NOT contain `--tailnet`

**Verification:**
- Run: `cd cli && cargo test launchd`
- Expected: PASS

---

## Task 4: KV Poll Helper for Post-Install QR (relay)

**Files:**
- Modify: `cli/src/serve/relay.rs`

- [ ] Add (mirror mobile contract):

```rust
pub const QUICKSTART_TUNNEL_POLL_TIMEOUT: Duration = Duration::from_secs(20 * 60);
pub const TUNNEL_POLL_INTERVAL: Duration = Duration::from_secs(10);

pub async fn fetch_tunnel_url(relay_url: &str, user_token: &str) -> Result<Option<String>> {
    let resp = reqwest::get(format!("{}/tunnel/{}", relay_url, user_token)).await?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let data: serde_json::Value = resp.json().await?;
    if data["status"] == "active" {
        return Ok(data["tunnel_url"].as_str().map(String::from));
    }
    Ok(None)
}

pub async fn poll_tunnel_url(
    relay_url: &str,
    user_token: &str,
    timeout: Duration,
) -> Result<String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Some(url) = fetch_tunnel_url(relay_url, user_token).await? {
            return Ok(url);
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for relay tunnel registration");
        }
        tokio::time::sleep(TUNNEL_POLL_INTERVAL).await;
    }
}
```

- [ ] Unit test with mockito: GET returns active + tunnel_url; poll succeeds.
- [ ] Unit test: timeout path returns error.

**Verification:**
- Run: `cd cli && cargo test poll_tunnel`
- Expected: PASS

---

## Task 5: CLI — quickstart / install Flag Redesign

**Files:**
- Modify: `cli/src/commands/daemon.rs`

- [ ] Replace `Quickstart` struct:

```rust
Quickstart {
    /// Mutually exclusive with --tailnet and --funnel
    #[arg(long, conflicts_with_all = ["tailnet", "funnel"])]
    relay: bool,
    #[arg(long, conflicts_with_all = ["relay", "funnel"])]
    tailnet: bool,
    #[arg(long, conflicts_with_all = ["relay", "tailnet"])]
    funnel: bool,
    #[arg(long)]
    port: Option<u16>,
    #[arg(long, default_value = default_relay_url())]
    relay_url: Option<String>, // only applied when mode is relay
    #[arg(long)]
    token: Option<String>,
},
```

- [ ] `fn resolve_mode_from_flags(relay, tailnet, funnel, cfg: &Config) -> ServeMode`:
  - if exactly one flag → that mode
  - if none → `cfg.serve_mode` (default Relay)

- [ ] `fn apply_quickstart_config(...) -> Config`:
  - merge flags into config, persist port/token/mode/relay_url
  - empty token → `generate_token()`

- [ ] `install` signature → `install(port_arg, mode, relay_url, force)`; pass `ServeMode` + `relay_url` into `DaemonConfig`.

- [ ] Legacy meta migration inside `quickstart` before install:
  - if `load_meta()` ok and meta lacks `serve_mode` field in JSON sense → treat as legacy, set mode Relay in config (auto-migrate)

- [ ] **Relay QR after install** (sync wrapper using existing tokio runtime or `#[tokio::main]` helper):

```rust
if mode == ServeMode::Relay {
    println!("Waiting for Cloudflare Tunnel (up to 20 min)...");
    match rt.block_on(poll_tunnel_url(&cfg.relay_url, &cfg.serve_token, QUICKSTART_TUNNEL_POLL_TIMEOUT)) {
        Ok(tunnel_url) => print_qr(&cfg.serve_token, &tunnel_url),
        Err(e) => eprintln!("[warn] Tunnel URL unavailable: {e}. Service is running; check `msctl logs --source service -f`"),
    }
} else {
    print_pairing_info(&cfg.serve_token, cfg.serve_port, mode);
}
```

- [ ] Refactor `print_pairing_info` to take `ServeMode` instead of `bool tailnet` (funnel uses existing `advertised_base_url(..., funnel=true)` path from serve.rs — extract shared helper if needed).

- [ ] `daemon status`: print `Mode`, token prefix (first 12 chars + `…`), relay_url truncated for relay mode.

- [ ] Apply same flag resolution to `Install` subcommand.

**Verification:**
- Run: `cd cli && cargo test && cargo build`
- Run: `cargo run -- daemon quickstart --help` — shows `--relay` `--tailnet` `--funnel`, no default `--tailnet true`

---

## Task 6: Regression Tests

**Files:**
- Modify: `cli/src/serve/daemon/launchd.rs` (tests)
- Modify: `cli/src/config.rs` (tests)
- Modify: `cli/src/serve/relay.rs` (tests)
- Optional: `cli/tests/daemon_quickstart_tests.rs` if clap parsing integration is useful

- [ ] Test clap conflict: `--relay --tailnet` fails parse (unit test via clap or try_main).
- [ ] Test legacy meta JSON `{ "tailnet": true, ... }` without serve_mode deserializes; migration sets Relay on quickstart (pure fn test).
- [ ] Test token auto-gen matches regex (reuse existing serve test or call `generate_token` in daemon test).

**Verification:**
- Run: `cd cli && cargo test`
- Expected: all green

---

## Task 7: Documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `cli/README.md`
- Modify: `docs/references/cli-commands.md`

- [ ] Replace long quickstart examples with:

```bash
msctl daemon quickstart
msctl daemon quickstart --tailnet
msctl daemon quickstart --port 9000
```

- [ ] Document `config.toml` fields `serve_mode`, `relay_url`.
- [ ] Note: relay quickstart may block up to 20 minutes on first cloudflared download.
- [ ] Mark old `--tailnet true` default examples as removed.

**Verification:**
- Run: `rg 'quickstart --token test --port 8765 --tailnet' README.md cli/README.md docs/references/cli-commands.md`
- Expected: no hits (or only in changelog/historical note)

---

## Task 8: Exec Plan Index

**Files:**
- Modify: `docs/exec-plans/index.json`

- [ ] Add entry:

```json
{
  "file": "2026-06-07-daemon-quickstart-relay-default.md",
  "title": "daemon quickstart 默认 Relay Implementation Plan"
}
```

- [ ] After final commit: set `lastCompletedCommit` to 40-char SHA.

---

## Final Verification Checklist

- [ ] `cd cli && cargo test && cargo build`
- [ ] `msctl daemon quickstart` (macOS, network): service running, QR with trycloudflare.com URL
- [ ] `msctl daemon status` shows Mode=relay
- [ ] `msctl daemon quickstart --tailnet`: plist has `--tailnet`, no `--relay`
- [ ] Spec §11 Must items all checked
- [ ] Code review (requesting-code-review skill) — fix Critical/Important
- [ ] Single commit; update `docs/exec-plans/index.json` `lastCompletedCommit`

---

## Risk Notes

- **quickstart blocks up to 20 min:** intentional for first cloudflared download; print progress messages.
- **daemon `serve --relay` stdout QR useless:** QR only at quickstart via KV poll — document clearly.
- **Legacy `tailnet: true` meta:** auto-migrate to relay on next quickstart may surprise tailnet-only users; spec accepted this trade-off.
- **tokio in quickstart:** daemon commands are sync today; use minimal `Runtime::new()?.block_on(...)` for poll only, or extract `msctl daemon quickstart` async subcommand later — avoid refactoring entire CLI.
