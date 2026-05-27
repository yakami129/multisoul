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
msctl agent delete <id>
```

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

### Image Output

When generating images (charts, screenshots, diagrams), save them as files and
reference them in your reply using standard Markdown image syntax:

![description](/absolute/path/to/image.png)

Supported formats: png, jpg, jpeg, gif, webp.
The MultiSoul mobile app will automatically render these images inline.

<!-- msctl-inject-end -->
