# KodaX Runtime Integration Implementation Plan

> **For agentic workers:** This repository requires all tasks to be verified first, then one final code review and one final `git commit`. Do not commit after each task.

**Goal:** Add KodaX as a first-class MultiSoul runtime so users can register `kodax` agents, send messages from iOS, stream KodaX JSONL events into Chat, switch KodaX provider/model per conversation, and abort running KodaX turns.

**Source SPEC:** `docs/product-specs/2026-06-02-SPEC-kodax-runtime-integration.md`

**Architecture:** Add a `serve/runtime/kodax` adapter beside `codex` and `cursor`. The adapter spawns `kodax --mode json --session <conversation_id> --agent-mode ama <prompt>` for each turn, parses JSONL when available, falls back to plain text when needed, and reuses the existing `SessionHandle` kill path for abort. `conversation.model_id` encodes KodaX provider/model as `provider:model`.

**Tech Stack:** Rust, axum, rusqlite, serde_json, tokio blocking workers, KodaX CLI.

---

## File Structure

### CLI Runtime

- Create `cli/src/serve/runtime/kodax/mod.rs`
  - Session worker and subprocess lifecycle
  - `KODAX_BIN` override
  - Prompt construction with optional image path prefix
  - `provider:model` parsing into `-m <provider> --model <model>`
  - KodaX argv builder tests
- Create `cli/src/serve/runtime/kodax/events.rs`
  - JSONL event parsing into MultiSoul message payloads
  - Plain-text fallback helpers
  - Unit tests for event mapping
- Modify `cli/src/serve/runtime/mod.rs`
  - Expose `kodax`
  - Dispatch runtime `kodax`
  - Inject image path hint for `kodax`
- Modify `cli/src/serve/runtime/models.rs`
  - Add KodaX builtin model capabilities
  - Validate `provider:model` ids for runtime `kodax`
  - Tests for list and validation

### CLI Registration

- Modify `cli/src/commands/agent.rs`
  - Allow `--runtime kodax`
  - Help text includes `kodax`
- Modify `cli/src/commands/agent_quick_register.rs`
  - Add `kodax` to quick-register runtimes
  - Update tests and error strings
- Modify `cli/src/commands/inject.rs`
  - Ensure `kodax` routes to `AGENTS.md`
  - Tests for injection target if needed
- Modify docs references if CLI command examples list runtime options.

### Tests

- Add KodaX runtime tests with fake `kodax` binary scripts:
  - Successful JSONL run creates `agent_text`, `tool_call`, `tool_result`, `task_status`
  - Plain stdout fallback creates `agent_text`
  - Failed run creates failed `task_status`
  - Abort kills child process
  - Image turn includes path prefix
  - `KODAX_BIN` override is honored
  - `provider:model` becomes `-m provider --model model`

### Docs

- Existing product spec: `docs/product-specs/2026-06-02-SPEC-kodax-runtime-integration.md`
- New execution plan: `docs/exec-plans/2026-06-02-kodax-runtime-integration.md`
- Update `docs/product-specs/index.json`
- Update `docs/exec-plans/index.json`
- After final commit, update `docs/exec-plans/index.json` with `lastCompletedCommit`.

---

## Task 1: Runtime Registration Surface

**Files:**
- Modify `cli/src/commands/agent.rs`
- Modify `cli/src/commands/agent_quick_register.rs`
- Modify `cli/src/commands/inject.rs`
- Modify docs references that enumerate runtimes

- [x] Add `kodax` to the quick-register runtime allowlist.
- [x] Update CLI help and invalid-runtime messages to include `kodax`.
- [x] Ensure `msctl agent kodax` writes `agents.runtime = 'kodax'` and default `mode = 'full-auto'`.
- [x] Ensure `msctl agent register --runtime kodax` stores runtime `kodax`.
- [x] Ensure context injection for `kodax` uses `AGENTS.md`, same as Codex/Cursor.
- [x] Update or add tests for quick register, register, invalid runtime message, and injection target.

**Verification:**

```bash
cd cli
cargo test commands::agent_quick_register
cargo test commands::agent
cargo test commands::inject
```

---

## Task 2: KodaX Model Capability Provider

**Files:**
- Modify `cli/src/serve/runtime/models.rs`
- Modify `cli/src/serve/runtime/models_tests.rs`

- [x] Add runtime `kodax` to model provider lookup.
- [x] Add Default plus builtin KodaX `provider:model` entries.
- [x] Cover KodaX provider families from the SPEC:
  - `anthropic`
  - `openai`
  - `deepseek`
  - `kimi`
  - `kimi-code`
  - `qwen`
  - `zhipu`
  - `zhipu-coding`
  - `minimax-coding`
  - bridge providers `gemini-cli` and `codex-cli` intentionally excluded from the builtin common list for V1
- [x] Validate legal `provider:model` ids.
- [x] Reject malformed ids such as `openai`, `openai:`, `:gpt-5.4`, and unknown entries.

**Verification:**

```bash
cd cli
cargo test serve::runtime::models
cargo test serve::routes::runtime_models
cargo test serve::routes::conversation_model_patch
```

---

## Task 3: KodaX Runtime Adapter

**Files:**
- Create `cli/src/serve/runtime/kodax/mod.rs`
- Create `cli/src/serve/runtime/kodax/events.rs`
- Modify `cli/src/serve/runtime/mod.rs`

- [x] Add dispatch branch for runtime `kodax`.
- [x] Build argv:

```text
kodax --mode json --session <conversation_id> --agent-mode ama <prompt>
```

- [x] Use `KODAX_BIN` when set, else `kodax`.
- [x] Omit `-m` and `--model` for Default/None.
- [x] Split `provider:model` into `-m <provider> --model <model>`.
- [x] Inject image path prefix before runtime context for turns with `file_id`.
- [x] Use the existing `SessionHandle` PID tracking so abort can kill the current child.
- [x] Mark conversation `running` at turn start.
- [x] Mark `completed`, `failed`, or `aborted` at turn end.
- [x] Do not implement prewarm in V1.

**Verification:**

```bash
cd cli
cargo test serve::runtime::kodax
cargo test serve::routes::messages
cargo test serve::routes::conversations_abort
```

---

## Task 4: JSONL Event Mapping And Fallback

**Files:**
- Create/modify `cli/src/serve/runtime/kodax/events.rs`
- Create/modify tests under `cli/src/serve/runtime/kodax/`

- [x] Map `text.delta` into `agent_text`.
- [x] Map `thinking.delta` and `thinking.end` into `agent_text`.
- [x] Map `tool.start` into `tool_call` with `tool`, `args`, and `call_id`.
- [x] Map `tool.result` into `tool_result` with `call_id`, `ok`, and `summary`.
- [x] Map `complete` and `run.result success=true` into completed `task_status`.
- [x] Map `run.result success=false`, `error`, and child failure into failed `task_status`.
- [x] Ignore unknown JSON events with debug logging.
- [x] Treat non-JSON stdout as plain text fallback and emit `agent_text`.

**Verification:**

```bash
cd cli
cargo test serve::runtime::kodax::events
cargo test kodax
```

---

## Task 5: End-To-End CLI Runtime Tests

**Files:**
- Add fake-binary tests near the KodaX runtime module
- Update existing route tests only where runtime allowlists change

- [x] Fake KodaX emits:

```json
{"type":"session.start","provider":"openai","sessionId":"conv-1"}
{"type":"text.delta","text":"hello"}
{"type":"tool.start","id":"tool-1","name":"bash","input":{"command":"pwd"}}
{"type":"tool.result","id":"tool-1","name":"bash","content":"/repo"}
{"type":"run.result","success":true,"sessionId":"conv-1"}
```

- [x] Assert messages are persisted and broadcast with correct roles.
- [x] Assert `KODAX_BIN` fake receives expected argv.
- [x] Assert image file id becomes absolute path hint in prompt.
- [x] Assert abort kills a sleeping fake process and writes aborted task status.

**Verification:**

```bash
cd cli
cargo test kodax -- --nocapture
```

---

## Task 6: Documentation And Full Verification

**Files:**
- Modify `docs/references/cli-commands.md`
- Modify `docs/product-specs/index.json`
- Modify `docs/exec-plans/index.json`
- Check whether design docs need code hash updates after tracked code changes

- [x] Update CLI command reference runtime lists to include `kodax`.
- [x] Run docs index verification.
- [x] Run CLI tests.
- [x] Run CLI build.
- [x] Review tracked code changes and update design-doc code hashes only where a referenced code excerpt changed.
- [x] Before final commit, run the required code review workflow and address Critical/Important feedback.
- [x] Make one final commit for the entire plan.
- [x] Update `docs/exec-plans/index.json` with the final 40-character `lastCompletedCommit`.

**Verification:**

```bash
python3 scripts/check-docs-indices.py
cd cli && cargo test
cd cli && cargo build
```

---

## Acceptance Checklist

- [x] `msctl agent kodax` registers a KodaX runtime agent.
- [x] `msctl agent register --runtime kodax` registers a KodaX runtime agent.
- [x] `GET /api/v1/runtime-models?runtime=kodax` returns Default and builtin KodaX models.
- [x] Conversation `model_id = openai:gpt-5.4` causes `-m openai --model gpt-5.4`.
- [x] Default model omits provider/model flags.
- [x] KodaX JSONL text, thinking, tool calls, tool results, and run result are visible in Chat roles.
- [x] Plain text fallback emits visible `agent_text`.
- [x] Image messages include a local path hint.
- [x] Abort kills the current KodaX process.
- [x] `KODAX_BIN` overrides the executable.
- [x] `cargo test`, `cargo build`, and docs index checks pass.
