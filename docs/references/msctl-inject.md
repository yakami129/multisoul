<!-- msctl-inject-start -->
## msctl Quick Reference

### Service

```bash
msctl serve                  # Start local server (default port 8765)
msctl logs                   # Tail app + service logs
msctl daemon quickstart      # Install and start as background service
msctl daemon status          # Check service status
msctl daemon restart         # Restart background service
```

### Agent

```bash
msctl agent list             # List all registered agents
msctl agent get <id>         # Show agent details
msctl agent codex            # Quick register current project with Codex
msctl agent claude-code      # Quick register current project with Claude Code
msctl agent cursor-cli       # Quick register current project with Cursor
msctl agent register --name <name> --project <path> --runtime claude-code
msctl agent register --name <name> --project <path> --runtime codex
msctl agent register --name <name> --project <path> --runtime cursor-cli
msctl agent invoke <id> --message "<task>"
msctl ask-question --ask-id <id> --conversation-id <id> --questions '<json>'
msctl agent delete <id>
```

For runtime integrations, push cards with `msctl ask-question`, then wait on `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>` using the same Bearer token.

### Auth

```bash
msctl auth login             # Save serve token to local config
msctl auth status            # Show current auth status
```

### Update

```bash
npm install -g @yakami129/msctl  # Update to latest version
msctl --version                  # Check current version
```

<!-- msctl-inject-end -->
