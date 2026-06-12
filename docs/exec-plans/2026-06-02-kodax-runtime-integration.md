# InfCode Runtime Integration Implementation Plan

> **For agentic workers:** This repository requires all tasks to be verified first, then one final code review and one final `git commit`. Do not commit after each task.

**Goal:** Add InfCode as a first-class MultiSoul runtime so users can register `infcode` agents, send messages from iOS, stream InfCode JSONL events into Chat, switch InfCode provider/model per conversation, and abort running InfCode turns.

**Source SPEC:** `docs/product-specs/2026-06-02-SPEC-infcode-runtime-integration.md`

**Architecture:** Add a `serve/runtime/infcode` adapter beside `codex` and `cursor`. The adapter spawns `infcode --mode json --session <conversation_id> --agent-mode ama <prompt>` for each turn, parses JSONL when available, falls back to plain text when needed, and reuses the existing `SessionHandle` kill path for abort. `conversation.model_id` encodes InfCode provider/model as `provider:model`.

**Tech Stack:** Rust, axum, rusqlite, serde_json, tokio blocking workers, InfCode CLI.

---

## File Structure

### CLI Runtime

- Create `cli/src/serve/runtime/infcode/mod.rs`
  - Session worker and subprocess lifecycle
  - `INFCODE_BIN` override
  - Prompt construction with optional image path prefix
  - `provider:model` parsing into `-m <provider> --model <model>`
  - InfCode argv builder tests
- Create `cli/src/serve/runtime/infcode/events.rs`
  - JSONL event parsing into MultiSoul message payloads
  - Plain-text fallback helpers
  - Unit tests for event mapping
- Modify `cli/src/serve/runtime/mod.rs`
  - Expose `infcode`
  - Dispatch runtime `infcode`
  - Inject image path hint for `infcode`
- Modify `cli/src/serve/runtime/models.rs`
  - Add InfCode builtin model capabilities
  - Validate `provider:model` ids for runtime `infcode`
  - Tests for list and validation

### CLI Registration

- Modify `cli/src/commands/agent.rs`
  - Allow `--runtime infcode`
  - Help text includes `infcode`
- Modify `cli/src/commands/agent_quick_register.rs`
  - Add `infcode` to quick-register runtimes
  - Update tests and error strings
- Modify `cli/src/commands/inject.rs`
  - Ensure `infcode` routes to `AGENTS.md`
  - Tests for injection target if needed
- Modify docs references if CLI command examples list runtime options.

### Tests

- Add InfCode runtime tests with fake `infcode` binary scripts:
  - Successful JSONL run creates `agent_text`, `tool_call`, `tool_result`, `task_status`
  - Plain stdout fallback creates `agent_text`
  - Failed run creates failed `task_status`
  - Abort kills child process
  - Image turn includes path prefix
  - `INFCODE_BIN` override is honored
  - `provider:model` becomes `-m provider --model model`

### Docs

- Existing product spec: `docs/product-specs/2026-06-02-SPEC-infcode-runtime-integration.md`
- New execution plan: `docs/exec-plans/2026-06-02-infcode-runtime-integration.md`
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

- [x] Add `infcode` to the quick-register runtime allowlist.
- [x] Update CLI help and invalid-runtime messages to include `infcode`.
- [x] Ensure `msctl agent infcode` writes `agents.runtime = 'infcode'` and default `mode = 'full-auto'`.
- [x] Ensure `msctl agent register --runtime infcode` stores runtime `infcode`.
- [x] Ensure context injection for `infcode` uses `AGENTS.md`, same as Codex/Cursor.
- [x] Update or add tests for quick register, register, invalid runtime message, and injection target.

**Verification:**

```bash
cd cli
cargo test commands::agent_quick_register
cargo test commands::agent
cargo test commands::inject
```

---

## Task 2: InfCode Model Capability Provider

**Files:**
- Modify `cli/src/serve/runtime/models.rs`
- Modify `cli/src/serve/runtime/models_tests.rs`

- [x] Add runtime `infcode` to model provider lookup.
- [x] Add Default plus builtin InfCode `provider:model` entries.
- [x] Cover InfCode provider families from the SPEC:
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

## Task 3: InfCode Runtime Adapter

**Files:**
- Create `cli/src/serve/runtime/infcode/mod.rs`
- Create `cli/src/serve/runtime/infcode/events.rs`
- Modify `cli/src/serve/runtime/mod.rs`

- [x] Add dispatch branch for runtime `infcode`.
- [x] Build argv:

```text
infcode --mode json --session <conversation_id> --agent-mode ama <prompt>
```

- [x] Use `INFCODE_BIN` when set, else `infcode`.
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
cargo test serve::runtime::infcode
cargo test serve::routes::messages
cargo test serve::routes::conversations_abort
```

---

## Task 4: JSONL Event Mapping And Fallback

**Files:**
- Create/modify `cli/src/serve/runtime/infcode/events.rs`
- Create/modify tests under `cli/src/serve/runtime/infcode/`

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
cargo test serve::runtime::infcode::events
cargo test infcode
```

---

## Task 5: End-To-End CLI Runtime Tests

**Files:**
- Add fake-binary tests near the InfCode runtime module
- Update existing route tests only where runtime allowlists change

- [x] Fake InfCode emits:

```json
{"type":"session.start","provider":"openai","sessionId":"conv-1"}
{"type":"text.delta","text":"hello"}
{"type":"tool.start","id":"tool-1","name":"bash","input":{"command":"pwd"}}
{"type":"tool.result","id":"tool-1","name":"bash","content":"/repo"}
{"type":"run.result","success":true,"sessionId":"conv-1"}
```

- [x] Assert messages are persisted and broadcast with correct roles.
- [x] Assert `INFCODE_BIN` fake receives expected argv.
- [x] Assert image file id becomes absolute path hint in prompt.
- [x] Assert abort kills a sleeping fake process and writes aborted task status.

**Verification:**

```bash
cd cli
cargo test infcode -- --nocapture
```

---

## Task 6: Documentation And Full Verification

**Files:**
- Modify `docs/references/cli-commands.md`
- Modify `docs/product-specs/index.json`
- Modify `docs/exec-plans/index.json`
- Check whether design docs need code hash updates after tracked code changes

- [x] Update CLI command reference runtime lists to include `infcode`.
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

- [x] `msctl agent infcode` registers a InfCode runtime agent.
- [x] `msctl agent register --runtime infcode` registers a InfCode runtime agent.
- [x] `GET /api/v1/runtime-models?runtime=infcode` returns Default and builtin InfCode models.
- [x] Conversation `model_id = openai:gpt-5.4` causes `-m openai --model gpt-5.4`.
- [x] Default model omits provider/model flags.
- [x] InfCode JSONL text, thinking, tool calls, tool results, and run result are visible in Chat roles.
- [x] Plain text fallback emits visible `agent_text`.
- [x] Image messages include a local path hint.
- [x] Abort kills the current InfCode process.
- [x] `INFCODE_BIN` overrides the executable.
- [x] `cargo test`, `cargo build`, and docs index checks pass.
