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
msctl agent kodax            # Quick register current project with KodaX
msctl agent register --name <name> --project <path> --runtime claude-code
msctl agent register --name <name> --project <path> --runtime codex
msctl agent register --name <name> --project <path> --runtime cursor-cli
msctl agent register --name <name> --project <path> --runtime kodax
msctl agent invoke <id> --message "<task>"
msctl agent delete <id>
```

### Ask User Question (`msctl ask-question`)

Requires running `msctl serve` and a saved Bearer token (`msctl auth login` or `--token`). Posts an `ask_question` card to iOS and returns `{"ask_id":"...","status":"pending"}` immediately. The iOS answer is injected into the same conversation as Markdown `user_text`; do not poll for answers.

`--ask-id`: optional runtime tool call id; auto-generated UUID when omitted. `--conversation-id`: value from `<multisoul-context><conversation-id>` in the prompt. `--questions`: non-empty JSON array of `{id, text, options:[{id,label}], multi_select?}`.

```bash
# 单选（省略 --ask-id 时 CLI 自动生成 UUID 并写入 stderr 日志）
msctl ask-question \
  --conversation-id "$CONV_ID" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]'

# 单选（显式传入 runtime tool call id）
msctl ask-question \
  --ask-id "$TOOL_CALL_ID" \
  --conversation-id "$CONV_ID" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]'

# 多选
msctl ask-question --ask-id "$TOOL_CALL_ID" --conversation-id "$CONV_ID" \
  --questions '[{"id":"0","text":"合并前跑哪些检查？","options":[{"id":"lint","label":"Lint"},{"id":"test","label":"单元测试"}],"multi_select":true}]'

# 一卡多题
msctl ask-question --ask-id "$TOOL_CALL_ID" --conversation-id "$CONV_ID" \
  --questions '[{"id":"env","text":"目标环境？","options":[{"id":"dev","label":"开发"},{"id":"prod","label":"生产"}]},{"id":"risk","text":"继续迁移？","options":[{"id":"yes","label":"继续"},{"id":"no","label":"停止"}]}]'
```

Use for `AskUserQuestion` and other structured decisions; do not ask multiple-choice questions in plain text.

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
