<p align="center">
  <h1 align="center">MultiSoul</h1>
  <p align="center">A mobile console for local AI agents.</p>
  <p align="center">
    <a href="ARCHITECTURE.md">Architecture</a>
    ·
    <a href="docs/product-specs/">Product Specs</a>
    ·
    <a href="docs/runbooks/cli-release.md">CLI Release</a>
  </p>
  <p align="center">
    <a href="https://github.com/yakami129/multisoul/stargazers">
      <img alt="GitHub stars" src="https://img.shields.io/github/stars/yakami129/multisoul?style=social">
    </a>
  </p>
  <p align="center">
    English | <a href="README.zh-CN.md">中文</a>
  </p>
</p>

<p align="center">
  <img src="docs/assets/multisoul-core-features.png" alt="MultiSoul core features: connect local agents, track live activity, and answer decisions from iOS or Android" width="860" />
</p>

---

MultiSoul lets you control AI agents running on your own computer from your phone. You can watch messages and tool calls in real time, answer approval questions, and receive task completion notifications.

There is no central MultiSoul backend. `msctl` runs locally, stores data locally, and exposes an HTTPS endpoint your phone connects to. The default setup uses a public relay tunnel—no VPN required.

## What You Can Do

- Control Claude Code, Codex, or Cursor Agent CLI from a phone
- Watch agent messages, tool calls, tool results, and task status
- Answer `AskUserQuestion` prompts in the mobile app
- Keep an Inbox for pending questions and completed/failed tasks
- Connect one phone to multiple computers
- Run the service in the foreground or as a background daemon

## How It Works

```
Mobile App (React Native + Expo)
        │ HTTPS / WSS + Bearer token
        ▼
msctl serve (Rust, local machine)
        ├── Relay (default): Cloudflare Tunnel → public HTTPS URL
        ├── Tailscale / Funnel (optional): private or public Tailnet URL
        ├── Runtime adapters: Claude Code / Codex / Cursor Agent CLI
        ├── REST + WebSocket
        └── SQLite: ~/.config/msctl/serve.db
```

## Requirements

- Node.js 18+
- One agent runtime installed on your computer:
  - Claude Code: `claude`
  - Codex CLI: `codex`
  - Cursor Agent CLI: `agent`

## Quick Start

### 1. Install `msctl`

```bash
npm install -g @yakami129/msctl
```

### 2. Start the service

```bash
msctl daemon quickstart
```

Auto-generates a token, installs a background daemon, opens a public HTTPS relay tunnel, and prints a QR code. Scan it in the app (**Agents → + → Scan QR**), or tap **Paste connection string** and use the string printed beside the QR. First run may take several minutes while cloudflared downloads.

<p align="center">
  <img src="docs/assets/multisoul-add-endpoint.png" alt="MultiSoul Add Endpoint flow: tap plus on Agents, then scan QR or paste connection string" width="520" />
</p>

If the QR does not appear in time, run `msctl logs --source service -f` — the pairing QR is printed there once the tunnel is live.

```bash
msctl daemon status
msctl logs --source service -f
msctl daemon restart
msctl daemon stop
```

### 3. Register an Agent

From the project you want to control:

```bash
cd /path/to/project
msctl agent codex
msctl agent claude-code
msctl agent cursor-cli
msctl agent kodax
```

<details>
<summary>Advanced: full <code>msctl agent register</code> options</summary>

Use explicit registration when you need custom names, modes, or project paths:

**Codex**

```bash
msctl agent register \
  --name work-codex \
  --project /path/to/project \
  --runtime codex \
  --mode full-auto
```

**Claude Code**

```bash
msctl agent register \
  --name work-claude \
  --project /path/to/project \
  --runtime claude-code
```

**Cursor Agent CLI**

```bash
msctl agent register \
  --name work-cursor \
  --project /path/to/project \
  --runtime cursor-cli \
  --mode ask
```

**KodaX**

```bash
msctl agent register \
  --name work-kodax \
  --project /path/to/project \
  --runtime kodax \
  --mode full-auto
```

</details>

Check registered agents:

```bash
msctl agent list
```

### 4. Run the mobile app locally

```bash
cd mobile
pnpm install
pnpm start
```

Native simulators:

```bash
pnpm ios
pnpm android
```

## Extended mode: Tailscale (optional)

The default relay tunnel works without a VPN. Use Tailscale when you want a **private Tailnet** or **public HTTPS via Tailscale Funnel** instead.

Install Tailscale on your computer and phone, then sign in to the same Tailnet. Official guide: [tailscale.com/docs/install](https://tailscale.com/docs/install)

```bash
# Linux example
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
tailscale status
```

Switch the daemon to Tailscale:

```bash
msctl daemon quickstart --tailnet    # private Tailnet IP
msctl daemon quickstart --funnel     # public HTTPS via Funnel
```

Or set `serve_mode = "tailnet"` | `"funnel"` in `~/.config/msctl/config.toml`.

For Funnel, grant HTTPS on port 443 once (approve in browser if prompted), then stop with `Ctrl-C`:

```bash
tailscale funnel --https=443 8765
msctl daemon quickstart --funnel
```

See [Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel).

Foreground serve (without daemon):

```bash
msctl serve --tailnet --port 8765 --token YOUR_TOKEN
msctl serve --funnel --port 8765 --token YOUR_TOKEN
```

## Development

CLI:

```bash
cd cli
cargo build
cargo test
```

Mobile:

```bash
cd mobile
pnpm install
pnpm typecheck
pnpm test -- --watchAll=false
pnpm start
```

## Run from source (local development)

When working on this repo—or before the CLI is published—run commands through Cargo instead of the installed `msctl`. Requires a Rust toolchain.

From the `cli/` directory:

```bash
cd cli
cargo run -- daemon quickstart
cargo run -- agent codex
cargo run -- agent claude-code
cargo run -- agent cursor-cli
cargo run -- agent kodax
cargo run -- serve
```

To register an agent while your shell is in another project directory:

```bash
cd /path/to/project
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent codex
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent claude-code
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent cursor-cli
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent kodax
```

Replace `msctl` with `cargo run --` (or `cargo run --manifest-path … --`) for any other subcommand, e.g. `cargo run -- logs --source service -f`.

## Local Data

| Path | Purpose |
|------|---------|
| `~/.config/msctl/serve.db` | Agents, conversations, messages, tasks, push tokens |
| `~/.config/msctl/config.toml` | Local `msctl` config |
| `~/.config/msctl/uploads/` | Uploaded images |
| Mobile local storage | Endpoints, tokens, Inbox cache |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): system architecture
- [docs/product-specs/](docs/product-specs/): product specs
- [docs/design-docs/](docs/design-docs/): design notes
- [docs/runbooks/cli-release.md](docs/runbooks/cli-release.md): CLI release
- [mobile/docs/ios-publish.md](mobile/docs/ios-publish.md): iOS release
