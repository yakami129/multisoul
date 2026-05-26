# Codex Runtime Integration — Design Spec

**Date:** 2026-04-29  
**Status:** Draft  
**Scope:** `cli/` (Rust `msctl`)

---

## 1. Problem

`serve/runtime.rs` is hardcoded to spawn `claude`. The `agents.runtime` field exists in the DB but is ignored at execution time. This spec defines how to add first-class Codex support so that agents registered with `--runtime codex` actually run the `codex` CLI.

---

## 2. Architecture

Split `serve/runtime.rs` into a module:

```
cli/src/serve/runtime/
├── mod.rs       ← public API + dispatch by agent.runtime
├── claude.rs    ← existing Claude Code logic (moved verbatim)
└── codex.rs     ← new Codex protocol implementation
```

### 2.1 `runtime/mod.rs`

- Re-exports `send_to_session(state, conv_id, user_text, project_path, runtime, mode)` — the single public entry point
- Reads `agent.runtime` to dispatch:
  - `"claude-code"` (default) → `claude::send_to_session(...)`
  - `"codex"` → `codex::send_to_session(...)`
- No trait abstraction — plain `match` on the runtime string

### 2.2 `runtime/claude.rs`

Exact content of current `runtime.rs`, moved with no functional changes. Only `send_to_session` signature gains a `_mode: &str` parameter (ignored for Claude).

### 2.3 `runtime/codex.rs` (new)

Implements a session worker that drives `codex exec` as a subprocess.

**Session lifecycle:**

1. **New session** (no thread_id in DB):
   ```
   codex [MODE_FLAGS] exec --skip-git-repo-check --json --cd <project_path> -
   ```
   Stdin: plain-text user prompt (newline-terminated)

2. **Resume session** (thread_id exists in DB):
   ```
   codex [MODE_FLAGS] exec resume --skip-git-repo-check <thread_id> --json -
   ```
   Stdin: plain-text user prompt

3. After the subprocess exits, save thread_id (from `thread.started`) to `conversations.codex_thread_id`.

**Mode flags** (from `agents.mode`):

| `mode` value  | Top-level flags added before `exec`                 |
|---------------|-----------------------------------------------------|
| `suggest`     | _(none)_                                            |
| `auto-edit`   | `-s danger-full-access -a never`                    |
| `full-auto`   | `-s danger-full-access -a never`                    |
| `yolo`        | `--dangerously-bypass-approvals-and-sandbox`        |

Default: `full-auto`.

**Stdout event parsing** (JSON lines from `codex exec --json`):

| Event type        | Action                                                         |
|-------------------|----------------------------------------------------------------|
| `thread.started`  | Store `thread_id` → `conversations.codex_thread_id`            |
| `turn.started`    | Clear pending message buffer                                   |
| `item.completed` type=`agent_message` / `message` | Extract text → broadcast `agent_text` |
| `item.completed` type=`command_execution`          | Broadcast `tool_call` + `tool_result` |
| `item.completed` type=`reasoning`                  | Broadcast `agent_text` (thinking content) |
| `turn.completed`  | Broadcast `task_status {status: "completed"}`                  |
| `turn.failed`     | Broadcast `task_status {status: "failed"}`                     |

No `control_request` handling — Codex permissions are governed by the mode flag.

**Respawn on failure:** Same retry logic as claude.rs (up to 3 attempts). On respawn, if `codex_thread_id` is set in DB, attempt resume; if resume fails (thread not found), clear `codex_thread_id` and start fresh.

---

## 3. Database Changes

Two schema migrations (Flyway-style, applied in `db.rs`):

### Migration: add `agents.mode`

```sql
ALTER TABLE agents ADD COLUMN mode TEXT NOT NULL DEFAULT 'full-auto';
```

### Migration: add `conversations.codex_thread_id`

```sql
ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT;
```

`codex_thread_id` is parallel to `claude_session_id` — both are nullable, only one is used per conversation depending on `agent.runtime`.

---

## 4. CLI Changes

### `msctl agent register`

Add optional `--mode` flag (only meaningful for `--runtime codex`):

```bash
msctl agent register \
  --name my-codex-agent \
  --project /path/to/project \
  --runtime codex \
  --mode full-auto    # suggest | auto-edit | full-auto | yolo
```

`--mode` defaults to `full-auto` if not provided. For `--runtime claude-code`, `--mode` is accepted but ignored.

### `serve` command

No new flags. `send_to_session()` fetches both `runtime` and `mode` from the DB when looking up the agent for a conversation.

---

## 5. Data Flow (Codex Path)

```
Mobile → POST /api/v1/messages
  → routes/messages.rs → runtime::send_to_session(conv_id, user_text)
    → look up agent.runtime + agent.mode from DB
    → codex::send_to_session(...)
      → spawn_blocking → session_worker_codex(...)
        → load codex_thread_id from DB
        → spawn `codex exec [resume] ...`
        → write prompt to stdin
        → read JSON lines from stdout
          → thread.started  → save thread_id to DB
          → item.completed  → broadcast to WS
          → turn.completed  → broadcast task_status, return
```

---

## 6. Affected Files

| File | Change |
|------|--------|
| `cli/src/serve/runtime.rs` | **Delete** (replaced by module) |
| `cli/src/serve/runtime/mod.rs` | **New** — dispatch + public API |
| `cli/src/serve/runtime/claude/mod.rs` | **New** — moved from runtime.rs |
| `cli/src/serve/runtime/codex/mod.rs` | **New** — Codex protocol impl |
| `cli/src/serve/mod.rs` | Update `mod runtime` reference (no other change) |
| `cli/src/db.rs` | Add 2 migrations |
| `cli/src/commands/agent.rs` | Add `--mode` to `register` and `insert_agent` |
| `cli/src/serve/routes/messages.rs` | Pass `runtime` + `mode` through to runtime dispatch |
| `cli/Cargo.toml` | No new dependencies expected |

---

## 7. Out of Scope

- Codex model selection (no `--model` flag support in this iteration)
- Codex `app_server` backend (WebSocket mode) — exec mode only
- `AskUserQuestion` interactive prompts for Codex (Codex doesn't emit `control_request`)
- Gemini or other runtimes
