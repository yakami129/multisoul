<!-- msctl-inject-start -->
## msctl Quick Reference

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

### Ask User Question (`msctl ask-question`)

**MANDATORY**

- For structured decisions (approach, continue/stop, risk trade-offs, etc.), **prefer** the `AskUserQuestion` tool when available.
- **If the current runtime does not expose `AskUserQuestion`, you MUST call `msctl ask-question` to push a question card to iOS.** Never list options in free text or ask the user to type an answer.
- After pushing, continue other work. Do not poll; iOS answers are injected into the same conversation automatically.

Run `msctl ask-question -h` for flags, JSON shape, and copy-paste examples.

### Image Output

When generating images (charts, screenshots, diagrams), save them as files and
reference them in your reply using standard Markdown image syntax:

![description](/absolute/path/to/image.png)

Supported formats: png, jpg, jpeg, gif, webp.
The MultiSoul mobile app will automatically render these images inline.

<!-- msctl-inject-end -->
