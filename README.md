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

There is no central MultiSoul backend. `msctl` runs locally, stores data locally, and exposes an endpoint that your phone connects to through Tailscale.

## What You Can Do

- Control Claude Code, Codex, or Cursor Agent CLI from a phone
- Watch agent messages, tool calls, tool results, and task status
- Answer `AskUserQuestion` prompts in the mobile app
- Keep an Inbox for pending questions and completed/failed tasks
- Connect one phone to multiple computers through Tailscale
- Run the service in the foreground or as a background daemon

## How It Works

```
Mobile App (React Native + Expo)
        │ Tailscale / HTTPS / WSS + Bearer token
        ▼
msctl serve (Rust, local machine)
        ├── Runtime adapters: Claude Code / Codex / Cursor Agent CLI
        ├── REST + WebSocket
        └── SQLite: ~/.config/msctl/serve.db
```

## Requirements

- Node.js 18+
- Tailscale on both your computer and phone
- One agent runtime installed on your computer:
  - Claude Code: `claude`
  - Codex CLI: `codex`
  - Cursor Agent CLI: `agent`
- Rust toolchain, only if you run `msctl` from source

## Install Tailscale

Install Tailscale on your computer and phone, then sign in to the same Tailnet.

Official guide: [tailscale.com/docs/install](https://tailscale.com/docs/install)

Common setup:

```bash
# macOS
# Install from https://tailscale.com/download/mac

# Linux
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Verify
tailscale status
tailscale ip
```

On iOS or Android, install Tailscale from the app store and sign in with the same account.

Tailnet access is the default and recommended private setup. If you need a public HTTPS URL, enable Tailscale Funnel and start the service with `msctl serve --funnel`.

For the first public HTTPS/Funnel setup, grant Tailscale permission to serve HTTPS on port 443 and point it at the default MultiSoul port:

```bash
tailscale funnel --https=443 8765
```

If Tailscale opens a browser approval flow, approve it once, then stop the command with `Ctrl-C` and start MultiSoul with `msctl serve --funnel`. See [Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel).

## Quick Start

### 1. Install `msctl`

```bash
npm install -g @yakami129/msctl
```

Or run it from source:

```bash
cd cli
cargo run -- --help
```

### 2. Start the Agent service

Fastest installed CLI flow:

```bash
msctl daemon quickstart
```

From source:

```bash
cd cli
cargo run -- daemon quickstart
```

This command auto-generates a token, installs and starts the background service in **relay** mode (Cloudflare Tunnel + Auto Tunnel), waits for the public tunnel URL, and prints a QR code plus connection string. First run may take several minutes while cloudflared downloads.

Switch modes via flags or `~/.config/msctl/config.toml` (`serve_mode = "tailnet"` | `"funnel"`):

```bash
msctl daemon quickstart --tailnet
msctl daemon quickstart --port 9000
```

On iOS or Android, open the mobile app and add the machine:

```text
Agents -> Tap + -> Scan QR
```

Scan the QR code printed by `msctl daemon quickstart` to register this computer as a MultiSoul endpoint on your phone. If camera access is unavailable, tap **Paste connection string** and paste the connection string printed next to the QR code.

<p align="center">
  <img src="docs/assets/multisoul-add-endpoint.png" alt="MultiSoul Add Endpoint flow: tap plus on Agents, then scan QR or paste connection string" width="520" />
</p>

For real personal use, replace `test` with your own long token.

Useful daemon commands:

```bash
msctl daemon status
msctl logs --source service -f
msctl daemon restart
msctl daemon stop
```

Foreground mode:

```bash
msctl serve --tailnet --port 8765 --token test
```

### 3. Register an Agent

Fastest installed CLI flow from the project you want to control:

```bash
cd /path/to/project
msctl agent codex
msctl agent claude-code
msctl agent cursor-cli
msctl agent kodax
```

From source, run the same quick registration path with Cargo:

```bash
cd cli
cargo run -- agent codex
cargo run -- agent claude-code
cargo run -- agent cursor-cli
cargo run -- agent kodax
```

When running from source for a different project directory, keep your shell in
that project and point Cargo at this repo's CLI manifest:

```bash
cd /path/to/project
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent codex
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent claude-code
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent cursor-cli
cargo run --manifest-path /path/to/multisoul/cli/Cargo.toml -- agent kodax
```

Codex:

```bash
msctl agent register \
  --name work-codex \
  --project /path/to/project \
  --runtime codex \
  --mode full-auto
```

Claude Code:

```bash
msctl agent register \
  --name work-claude \
  --project /path/to/project \
  --runtime claude-code
```

Cursor Agent CLI:

```bash
msctl agent register \
  --name work-cursor \
  --project /path/to/project \
  --runtime cursor-cli \
  --mode ask
```

KodaX:

```bash
msctl agent register \
  --name work-kodax \
  --project /path/to/project \
  --runtime kodax \
  --mode full-auto
```

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

## Development

CLI:

```bash
cd cli
cargo build
cargo test
cargo run -- serve
```

Mobile:

```bash
cd mobile
pnpm install
pnpm typecheck
pnpm test -- --watchAll=false
pnpm start
```

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
