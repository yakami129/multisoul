# MultiSoul

MultiSoul is a personal AI Agent console for your phone. It lets you connect to AI agents running on your own computer, watch tool calls in real time, answer approval questions, and receive task completion notifications.

There is no central MultiSoul backend. `msctl` runs locally, stores data locally, and the mobile app connects to endpoints you own.

## Features

- Control local AI agents from a phone
- View agent messages, tool calls, tool results, and task status
- Answer `AskUserQuestion` decisions from the mobile app
- Keep an Inbox for pending questions and completed/failed tasks
- Connect to multiple computers through Tailscale
- Run `msctl serve` in the foreground or as a background daemon

## Architecture

```
Mobile App (React Native + Expo)
        │ Tailscale / HTTPS / WSS + Bearer token
        ▼
msctl serve (Rust, local machine)
        ├── Runtime adapters: Claude Code / Codex / Cursor Agent CLI
        ├── REST + WebSocket
        └── SQLite: ~/.config/msctl/serve.db
```

- `cli/`: Rust CLI, binary name `msctl`
- `mobile/`: Expo SDK 55 React Native app
- Network: Tailscale Tailnet by default; Tailscale Funnel can expose a public HTTPS endpoint

## Requirements

- Node.js 18+
- Rust toolchain, only needed when building `msctl` from source
- Tailscale, required for using the phone and computer across devices
- At least one supported agent runtime:
  - Claude Code: `claude`
  - Codex CLI: `codex`
  - Cursor Agent CLI: `agent`

## Install Tailscale

Install Tailscale on both your computer and your phone, then sign in to the same Tailnet.

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

For private device-to-device access, Tailnet mode is enough. For a public HTTPS URL, enable Tailscale Funnel in your Tailnet and start MultiSoul with `msctl serve --funnel`. See [Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel).

## Quick Start

### 1. Install `msctl`

```bash
npm install -g @yakami129/msctl
```

From source:

```bash
cd cli
cargo build
cargo run -- --help
```

### 2. Start the Agent service

Fastest background setup:

```bash
msctl daemon quickstart --token test --port 8765 --tailnet true
```

This saves the token, installs the background service, starts `msctl serve`, binds it for Tailnet access, and prints a pairing QR code.

Useful daemon commands:

```bash
msctl daemon status
msctl daemon logs -f
msctl daemon restart
msctl daemon stop
```

Foreground mode:

```bash
msctl serve --tailnet --port 8765 --token test
```

For real personal use, replace `test` with your own long token.

### 3. Register an Agent

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

Check registration:

```bash
msctl agent list
```

Send a first message from the terminal:

```bash
msctl agent invoke <agent-id> --message "Summarize this project"
```

### 4. Connect the mobile app

Run the app locally:

```bash
cd mobile
pnpm install
pnpm start
```

Then open it with Expo, go to Settings, and add the endpoint printed by `msctl daemon quickstart` or `msctl serve`.

You can also run native simulators:

```bash
pnpm ios
pnpm android
```

## Daily Usage

```bash
msctl daemon status
msctl daemon logs -f
msctl agent list
msctl agent invoke <agent-id> --message "Continue the task"
```

In the mobile app:

- Agents: choose a registered agent
- Chat: send prompts and watch runtime output
- Inbox: answer pending questions and review task results
- Settings: manage endpoints and tokens

## Local Data

| Path | Purpose |
|------|---------|
| `~/.config/msctl/serve.db` | Agents, conversations, messages, tasks, push tokens |
| `~/.config/msctl/config.toml` | Local `msctl` config |
| `~/.config/msctl/uploads/` | Uploaded images |
| Mobile local storage | Endpoints, tokens, Inbox cache |

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

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): system architecture
- [docs/product-specs/](docs/product-specs/): product specs
- [docs/design-docs/](docs/design-docs/): design notes
- [docs/runbooks/cli-release.md](docs/runbooks/cli-release.md): CLI release
- [mobile/docs/ios-publish.md](mobile/docs/ios-publish.md): iOS release

## Stars

[![GitHub stars](https://img.shields.io/github/stars/yakami129/multisoul?style=social)](https://github.com/yakami129/multisoul/stargazers)
