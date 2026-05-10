<!-- msctl-inject-start -->
## msctl Quick Reference

### Service

```bash
msctl serve                  # Start local server (default port 8765)
msctl logs                   # Tail server logs
msctl daemon quickstart      # Install and start as background service
msctl daemon status          # Check service status
msctl daemon restart         # Restart background service
```

### Agent

```bash
msctl agent list             # List all registered agents
msctl agent get <id>         # Show agent details
msctl agent register --name <name> --project <path> --runtime claude-code
msctl agent register --name <name> --project <path> --runtime codex
msctl agent invoke <id> --message "<task>"
msctl agent delete <id>
```

### Auth

```bash
msctl auth login             # Save serve token to local config
msctl auth status            # Show current auth status
```

### Update

```bash
cargo install msctl --force  # Update to latest version
msctl --version              # Check current version
```

<!-- msctl-inject-end -->
