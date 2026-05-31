# CLI Question Card Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime-agnostic way for Codex, Cursor, and other CLI agents to push MultiSoul question cards through `msctl` and wait for mobile answers over the local HTTP API.

**Architecture:** Extract the existing Claude AskUserQuestion recording path into a shared `serve::ask_question` module, expose two authenticated REST endpoints, and add a thin `msctl ask-question` CLI command that posts a normalized question payload and immediately returns `pending`. Runtime CLIs then call `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>` with a timeout to block until the iOS answer is delivered through the existing WebSocket `answer` flow.

**Tech Stack:** Rust 2021, clap 4, axum 0.7, tokio 1, rusqlite 0.31, reqwest blocking client, serde/serde_json.

---

## Source Inputs

- Product spec: `docs/product-specs/SPEC-cli-question-card-push.md`
- Existing Claude implementation: `cli/src/serve/runtime/claude/stream.rs`
- Existing answer channel: `cli/src/serve/state.rs`
- Existing WebSocket answer persistence: `cli/src/serve/routes/ws.rs`
- Existing route registration: `cli/src/serve/mod.rs`
- Existing CLI entrypoint: `cli/src/main.rs`

## Baseline

Worktree:

```bash
/Users/alan/.config/superpowers/worktrees/multisoul/cli-question-card-push
```

Baseline command:

```bash
cd cli && cargo test
```

Baseline result:

```text
189 unit tests passed
10 logs_smoke tests passed
0 failed
```

## File Structure

- Create `cli/src/serve/ask_question.rs`
  - Shared `record_ask_question()` implementation.
  - Owns inserting an `ask_question` message, marking conversation `awaiting_question`, registering `pending_ask_id`, sending push, and broadcasting to WS subscribers.
- Modify `cli/src/serve/mod.rs`
  - Export `ask_question`.
  - Register `/api/v1/ask-question` and `/api/v1/answer/:ask_id` under `authed_router`.
- Create `cli/src/serve/routes/ask_question.rs`
  - Axum JSON request/response structs.
  - `POST /api/v1/ask-question`.
  - `GET /api/v1/answer/:ask_id?conversation_id=...&timeout=...`.
  - Route tests for auth, post, answered, timeout, and stale mismatch behavior.
- Modify `cli/src/serve/routes/mod.rs`
  - Export `ask_question`.
- Modify `cli/src/serve/runtime/claude/stream.rs`
  - Replace local `record_ask_question()` body with shared `serve::ask_question::record_ask_question()`.
- Modify `cli/src/serve/runtime/claude/ask_tests.rs`
  - Point tests at the shared module so Claude and HTTP route use the same behavior.
- Create `cli/src/commands/ask_question.rs`
  - Clap args, JSON validation, local server URL construction, authenticated POST, JSON/text output.
- Modify `cli/src/commands/mod.rs`
  - Export `ask_question`.
- Modify `cli/src/main.rs`
  - Add top-level `AskQuestion(commands::ask_question::AskQuestionArgs)` command and dispatch.
- Modify `docs/references/cli-commands.md`
  - Document `msctl ask-question`, `POST /api/v1/ask-question`, and `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>`.
- Modify `docs/references/msctl-inject.md` and `cli/src/templates/commands.md`
  - Add compact runtime guidance link/reference without bloating root `AGENTS.md`.
- Modify `docs/exec-plans/index.json`
  - Add this implementation plan to the manifest.

## Implementation Tasks

### Task 1: Extract Shared Ask Question Recording

**Files:**
- Create: `cli/src/serve/ask_question.rs`
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/runtime/claude/stream.rs`
- Modify: `cli/src/serve/runtime/claude/ask_tests.rs`

- [x] **Step 1: Write the shared-module test first**

Create `cli/src/serve/ask_question.rs` with only the test scaffold and expected public API. The test comments must follow the repository unit-test rule.

```rust
use crate::serve::state::AppState;
use serde_json::Value;

pub fn record_ask_question(_state: &AppState, _conv_id: &str, _payload: Value) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, serve::plugin::PluginManager};
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    /// Shared AskQuestion recording persists an answerable pending ask.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation.status = running（模拟 runtime turn 正在执行）
    ///   messages before     = 0 rows
    ///   answer channel cap  = 1（create_answer_channel 为当前 conversation 建立等待槽）
    ///   ask payload         = ask_id ask-shared + one question + one option
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. create_answer_channel("conv-shared") 注册等待会话
    ///   2. record_ask_question 写入 ask_question message，seq 从 0 + 1 = 1
    ///   3. record_ask_question 更新 conversation.status 为 awaiting_question
    ///   4. record_ask_question 在广播前注册 pending_ask_id=ask-shared
    ///   5. send_answer("ask-shared") 模拟 iOS 立即回答
    ///
    /// 预期结果：
    ///   - 断言 A：record_ask_question 返回 true，说明写入成功
    ///   - 断言 B：conversation.status == awaiting_question，说明 Activity 可进入 Needs Attention
    ///   - 断言 C：ask_question row 存在且 ask_id == ask-shared，说明 timeline 可恢复问题卡片
    ///   - 断言 D：agent_text row 不存在，说明 pending ask 不会被误写为普通文本
    ///   - 断言 E：send_answer Accepted，说明 pending ask 在客户端可见前已可回答
    #[test]
    fn shared_record_ask_question_persists_answerable_pending_ask() {
        let state = make_state();
        let answer_rx = state.create_answer_channel("conv-shared");
        let payload = serde_json::json!({
            "ask_id": "ask-shared",
            "questions": [{"id":"0","text":"Deploy?","options":[{"id":"0","label":"Yes"}],"multi_select":false}],
            "allow_freeform": false
        });

        let ok = record_ask_question(&state, "conv-shared", payload);
        let send_result = state.send_answer(
            "conv-shared",
            crate::serve::interactive::AnswerPayload {
                _ask_id: "ask-shared".to_string(),
                choice_id: Some("0".to_string()),
                choice_ids: None,
                freeform: None,
            },
        );
        let delivered = answer_rx
            .try_recv()
            .expect("runtime channel should receive the answer for ask-shared");

        let db = state.db.lock().unwrap();
        let status: String = db
            .query_row(
                "SELECT status FROM conversations WHERE id = 'conv-shared'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ask_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-shared' AND role='ask_question'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let ask_id: String = db
            .query_row(
                "SELECT json_extract(payload, '$.ask_id') FROM messages WHERE conversation_id='conv-shared'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let agent_text_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id='conv-shared' AND role='agent_text'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert!(ok, "record_ask_question should return true when the ask is persisted");
        assert_eq!(
            status, "awaiting_question",
            "recording an ask_question must mark the conversation awaiting_question"
        );
        assert_eq!(
            ask_count, 1,
            "recording an ask_question must insert exactly one ask_question message"
        );
        assert_eq!(
            ask_id, "ask-shared",
            "the stored ask_question payload must preserve the ask_id"
        );
        assert_eq!(
            agent_text_count, 0,
            "record_ask_question must not write the pending ask as agent_text"
        );
        assert!(
            matches!(send_result, crate::serve::state::AnswerSendResult::Accepted),
            "fast answer must be accepted because pending ask is registered before broadcast"
        );
        assert_eq!(
            delivered._ask_id, "ask-shared",
            "answer channel must deliver the same ask_id that was recorded"
        );
    }

    fn make_state() -> AppState {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("ask.db")).unwrap();
        conn.execute(
            "INSERT INTO agents (id, name, project_path, runtime, created_at)
             VALUES ('agent-shared', 'Shared Agent', '/tmp/project', 'codex', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-shared', 'agent-shared', 'Shared Conv', 10, 20, 'running')",
            [],
        )
        .unwrap();
        AppState::new(
            conn,
            "token".to_string(),
            dir.path().join("uploads"),
            PluginManager::empty(Arc::new(Mutex::new(
                db::open_at(&dir.path().join("plugin.db")).unwrap(),
            ))),
        )
    }
}
```

- [x] **Step 2: Run the new test and verify it fails**

Run:

```bash
cd cli && cargo test serve::ask_question::tests::shared_record_ask_question_persists_answerable_pending_ask
```

Expected:

```text
FAILED
record_ask_question should return true when the ask is persisted
```

- [x] **Step 3: Implement the shared recorder**

Replace the non-test section of `cli/src/serve/ask_question.rs` with:

```rust
use crate::db::now_ms;
use crate::serve::{push, state::AppState};
use serde_json::Value;
use tracing::debug;
use uuid::Uuid;

pub fn record_ask_question(state: &AppState, conv_id: &str, payload: Value) -> bool {
    let ask_id = payload
        .get("ask_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let db = state.db.lock().unwrap();
    if let Ok(seq) = insert_message(&db, conv_id, "ask_question", &payload) {
        let _ = db.execute(
            "UPDATE conversations SET status = 'awaiting_question' WHERE id = ?1",
            [conv_id],
        );
        if !ask_id.is_empty() {
            state.begin_waiting_answer(conv_id, &ask_id);
        }
        push::send_ask_question_push(&db, conv_id, &payload);
        drop(db);
        broadcast(state, conv_id, seq, "ask_question", payload);
        return true;
    }
    false
}

fn insert_message(
    db: &rusqlite::Connection,
    conv_id: &str,
    role: &str,
    payload: &Value,
) -> rusqlite::Result<i64> {
    let seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![id, conv_id, role, payload.to_string(), now, seq],
    )?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok(seq)
}

#[derive(serde::Serialize)]
struct WsEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: Value,
    created_at: i64,
}

fn broadcast(state: &AppState, conv_id: &str, seq: i64, role: &'static str, payload: Value) {
    let env = WsEnvelope {
        kind: "message",
        seq,
        role,
        payload,
        created_at: now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&env) {
        let tx = state.get_or_create_sender(conv_id);
        let n = tx.send(json).unwrap_or(0);
        debug!(role, seq, receivers = n, "broadcast");
    }
}
```

- [x] **Step 4: Export the shared module**

Modify `cli/src/serve/mod.rs`:

```rust
pub mod ask_question;
pub mod auth;
pub mod daemon;
pub mod interactive;
```

- [x] **Step 5: Switch Claude stream to shared recorder**

In `cli/src/serve/runtime/claude/stream.rs`, add:

```rust
use crate::serve::ask_question;
```

Change:

```rust
if !record_ask_question(state, conv_id, payload) {
```

to:

```rust
if !ask_question::record_ask_question(state, conv_id, payload) {
```

Delete the local `pub(super) fn record_ask_question(...) -> bool` from `stream.rs`.

- [x] **Step 6: Update Claude ask tests to call the shared module**

In `cli/src/serve/runtime/claude/ask_tests.rs`, replace both calls to:

```rust
stream::record_ask_question(&state, "conv-ask", payload);
```

with:

```rust
crate::serve::ask_question::record_ask_question(&state, "conv-ask", payload);
```

- [x] **Step 7: Run focused tests**

Run:

```bash
cd cli && cargo test ask_question
```

Expected:

```text
test result: ok
```

### Task 2: Add Authenticated HTTP Ask/Answer Routes

**Files:**
- Create: `cli/src/serve/routes/ask_question.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`

- [x] **Step 1: Write failing route tests**

Create `cli/src/serve/routes/ask_question.rs` with handler stubs and tests for:

```rust
#[tokio::test]
async fn ask_question_without_bearer_returns_401() { /* expects 401 */ }

#[tokio::test]
async fn post_ask_question_records_pending_ask() { /* expects 200 + DB ask row */ }

#[tokio::test]
async fn get_answer_returns_matching_mobile_answer() { /* expects answered map */ }

#[tokio::test]
async fn get_answer_times_out_without_mobile_answer() { /* expects 408 timeout */ }
```

Each test must use the repository-required doc comment structure and concrete positive/negative assertions. Seed one `agents` row and one `conversations` row in a temp DB, use `serve::build_router(state.clone()).await`, and send requests with `tower::ServiceExt::oneshot`.

- [x] **Step 2: Register routes so tests reach the stubs**

Modify `cli/src/serve/routes/mod.rs`:

```rust
pub mod activity;
pub mod agents;
pub mod ask_question;
```

Modify `cli/src/serve/mod.rs` inside `authed_router`:

```rust
.route(
    "/api/v1/ask-question",
    axum::routing::post(ask_question::post_ask_question),
)
.route(
    "/api/v1/answer/:ask_id",
    axum::routing::get(ask_question::get_answer),
)
```

- [x] **Step 3: Run route tests and verify failure**

Run:

```bash
cd cli && cargo test serve::routes::ask_question::tests
```

Expected:

```text
ask_question_without_bearer_returns_401 ... ok
post_ask_question_records_pending_ask ... FAILED with 501
get_answer_returns_matching_mobile_answer ... FAILED with 501
get_answer_times_out_without_mobile_answer ... FAILED with 501
```

- [x] **Step 4: Implement POST and GET handlers**

Implement these public types and handlers in `cli/src/serve/routes/ask_question.rs`:

```rust
#[derive(Debug, serde::Deserialize)]
pub struct AskQuestionRequest {
    pub ask_id: String,
    pub questions: Vec<serde_json::Value>,
    pub conversation_id: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct AnswerQuery {
    pub conversation_id: String,
    pub timeout: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
pub struct AskStatusResponse {
    pub ask_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct AnswerResponse {
    pub ask_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<std::collections::HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
```

POST behavior:

```rust
let payload = serde_json::json!({
    "ask_id": req.ask_id,
    "questions": req.questions,
    "allow_freeform": false,
});
crate::serve::ask_question::record_ask_question(&state, &req.conversation_id, payload)
```

GET behavior:

```rust
let timeout_secs = query.timeout.unwrap_or(600).clamp(1, 3600);
let answer_rx = state.create_answer_channel(&query.conversation_id);
state.begin_waiting_answer(&query.conversation_id, &ask_id);
let wait_result = tokio::task::spawn_blocking(move || {
    answer_rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
})
.await;
state.clear_waiting_answer(&query.conversation_id, &ask_id);
```

Map answers as:

```rust
choice_ids -> answers as-is
freeform   -> {"0": freeform}
choice_id  -> {"0": choice_id}
none       -> {}
```

- [x] **Step 5: Run focused route tests**

Run:

```bash
cd cli && cargo test serve::routes::ask_question::tests
```

Expected:

```text
test result: ok
```

### Task 3: Add `msctl ask-question` CLI Command

**Files:**
- Create: `cli/src/commands/ask_question.rs`
- Modify: `cli/src/commands/mod.rs`
- Modify: `cli/src/main.rs`

- [x] **Step 1: Write command parsing and validation tests**

Create tests in `cli/src/commands/ask_question.rs`:

```rust
#[test]
fn parse_questions_rejects_non_array_json() { /* object JSON errors with "questions" + "array" */ }

#[test]
fn parse_questions_accepts_non_empty_array() { /* len == 1, options[1].label == "B" */ }
```

Use full repository-required doc comments and assertion messages. The helper under test is:

```rust
fn parse_questions_json(input: &str) -> anyhow::Result<Vec<serde_json::Value>>
```

- [x] **Step 2: Run tests and verify missing helper failure**

Run:

```bash
cd cli && cargo test commands::ask_question::tests
```

Expected:

```text
cannot find function `parse_questions_json`
```

- [x] **Step 3: Implement command args and handler**

Implement:

```rust
#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum OutputFormat {
    Json,
    Text,
}

#[derive(clap::Args, Debug)]
pub struct AskQuestionArgs {
    #[arg(long)]
    pub ask_id: String,
    #[arg(long)]
    pub questions: String,
    #[arg(long)]
    pub conversation_id: String,
    #[arg(long, value_enum, default_value_t = OutputFormat::Json)]
    pub output: OutputFormat,
    #[arg(long)]
    pub token: Option<String>,
    #[arg(long)]
    pub port: Option<u16>,
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,
}
```

Handler behavior:

```rust
pub fn handle(args: AskQuestionArgs) -> anyhow::Result<()> {
    let questions = parse_questions_json(&args.questions)?;
    let config = crate::config::load_config().unwrap_or_default();
    let token = args
        .token
        .or_else(|| (!config.serve_token.is_empty()).then_some(config.serve_token))
        .ok_or_else(|| anyhow::anyhow!("missing token; run `msctl auth login --token <TOKEN>` or pass --token"))?;
    let port = args.port.unwrap_or(config.serve_port);
    let url = format!("http://{}:{}/api/v1/ask-question", args.host, port);
    let response = reqwest::blocking::Client::new()
        .post(url)
        .bearer_auth(token)
        .json(&serde_json::json!({
            "ask_id": args.ask_id,
            "questions": questions,
            "conversation_id": args.conversation_id,
        }))
        .send()
        .context("failed to contact msctl serve; is it running?")?;
    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .context("msctl serve returned a non-JSON ask-question response")?;
    if !status.is_success() {
        return Err(anyhow::anyhow!("ask-question failed with HTTP {}: {}", status, body));
    }
    match args.output {
        OutputFormat::Json => println!("{}", serde_json::to_string(&body)?),
        OutputFormat::Text => println!(
            "{} {}",
            body["ask_id"].as_str().unwrap_or(""),
            body["status"].as_str().unwrap_or("")
        ),
    }
    Ok(())
}
```

Parser behavior:

```rust
fn parse_questions_json(input: &str) -> anyhow::Result<Vec<serde_json::Value>> {
    let value: serde_json::Value =
        serde_json::from_str(input).context("questions must be valid JSON")?;
    let questions = value
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("questions must be a JSON array"))?;
    if questions.is_empty() {
        return Err(anyhow::anyhow!("questions must contain at least one question"));
    }
    Ok(questions.clone())
}
```

- [x] **Step 4: Export and dispatch command**

Modify `cli/src/commands/mod.rs`:

```rust
pub mod ask_question;
```

Modify `cli/src/main.rs`:

```rust
/// Push an AskUserQuestion card to mobile through msctl serve
AskQuestion(commands::ask_question::AskQuestionArgs),
```

and:

```rust
Commands::AskQuestion(args) => commands::ask_question::handle(args),
```

- [x] **Step 5: Run command tests and help check**

Run:

```bash
cd cli && cargo test commands::ask_question::tests
cd cli && cargo run -- --help
```

Expected:

```text
test result: ok
ask-question
```

### Task 4: Document Runtime Integration

**Files:**
- Modify: `docs/references/cli-commands.md`
- Modify: `docs/references/msctl-inject.md`
- Modify: `cli/src/templates/commands.md`

- [x] **Step 1: Update CLI command reference**

Add `## msctl ask-question` to `docs/references/cli-commands.md` with:

```markdown
Pushes a structured question card to the paired MultiSoul mobile app through a running `msctl serve` process. The command only submits the question and returns `pending`; runtimes that need to block should call the answer API after this command returns.
```

Include parameter table for `--ask-id`, `--questions`, `--conversation-id`, `--output`, `--token`, `--port`, and `--host`.

Include examples for:

```bash
msctl ask-question \
  --ask-id "call_123" \
  --conversation-id "conv_456" \
  --questions '[{"id":"0","text":"选择方案","options":[{"id":"0","label":"A"},{"id":"1","label":"B"}],"multi_select":false}]' \
  --output json
```

and:

```bash
curl -X GET "http://localhost:8765/api/v1/answer/call_123?conversation_id=conv_456&timeout=600" \
  -H "Authorization: Bearer <token>"
```

- [x] **Step 2: Update injected quick reference**

In both `docs/references/msctl-inject.md` and `cli/src/templates/commands.md`, add under `### Agent`:

```markdown
msctl ask-question --ask-id <id> --conversation-id <id> --questions '<json>'
```

Add one sentence below the command block:

```markdown
For runtime integrations, push cards with `msctl ask-question`, then wait on `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>` using the same Bearer token.
```

- [x] **Step 3: Run doc grep**

Run:

```bash
rg -n "ask-question|/api/v1/answer" docs/references cli/src/templates/commands.md
```

Expected:

```text
docs/references/cli-commands.md
docs/references/msctl-inject.md
cli/src/templates/commands.md
```

### Task 5: Full Verification and Plan Index Hygiene

**Files:**
- Modify: `docs/exec-plans/index.json`
- Check: `docs/product-specs/SPEC-cli-question-card-push.md`

- [x] **Step 1: Ensure exec plan is indexed**

Add this entry at the top of `docs/exec-plans/index.json` `documents`:

```json
{
  "file": "2026-05-31-cli-question-card-push.md",
  "title": "CLI Question Card Push Implementation Plan"
}
```

- [x] **Step 2: Run Rust tests**

Run:

```bash
cd cli && cargo test
```

Expected:

```text
test result: ok
```

- [x] **Step 3: Run Rust build**

Run:

```bash
cd cli && cargo build
```

Expected:

```text
Finished `dev` profile
```

- [x] **Step 4: Run no-allow guard**

Run:

```bash
./scripts/check-no-allow.sh
```

Expected: exit code 0. If the script prints a different success string, accept success by exit code and do not edit source.

- [x] **Step 5: Review code/doc hash requirement**

Run:

```bash
git diff -- docs/design-docs docs/product-specs docs/exec-plans cli/src docs/references
```

Expected:

```text
Diff shows no design-doc code hash block requiring refresh.
```

If a tracked design doc with code hash references changed code, update only that reviewed doc with:

```bash
python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md
```

- [x] **Step 6: Run final status check**

Run:

```bash
git status --short
```

Expected changed files:

```text
M  cli/src/main.rs
M  cli/src/commands/mod.rs
A  cli/src/commands/ask_question.rs
A  cli/src/commands/ask_question_tests.rs
A  cli/src/serve/ask_question.rs
M  cli/src/serve/mod.rs
M  cli/src/serve/routes/mod.rs
A  cli/src/serve/routes/ask_question.rs
A  cli/src/serve/routes/ask_question_fast_tests.rs
A  cli/src/serve/routes/ask_question_isolation_tests.rs
A  cli/src/serve/routes/ask_question_tests.rs
M  cli/src/serve/runtime/claude/stream.rs
M  cli/src/serve/runtime/claude/ask_tests.rs
M  cli/src/serve/state.rs
A  cli/src/serve/state_tests.rs
M  cli/src/templates/commands.md
M  docs/references/cli-commands.md
M  docs/references/msctl-inject.md
A  docs/exec-plans/2026-05-31-cli-question-card-push.md
M  docs/exec-plans/index.json
A  docs/product-specs/SPEC-cli-question-card-push.md
M  docs/product-specs/index.json
```

The copied SPEC file is intentionally committed in this worktree with canonical product-spec naming and `docs/product-specs/index.json` registration, because the source spec was untracked in the original checkout.

## Self-Review

- Spec coverage:
  - `msctl ask-question` command: Task 3.
  - `POST /api/v1/ask-question`: Task 2.
  - `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>`: Task 2.
  - iOS card delivery: Task 1 reuses push/broadcast path.
  - Claude behavior preservation: Task 1 focused tests.
  - Codex/Cursor runtime integration path: Task 4 docs.
  - Bearer auth: Task 2 auth test.
  - timeout handling: Task 2 timeout test.
- Placeholder scan:
  - No `TBD`, `TODO`, "implement later", or placeholder task bodies.
- Type consistency:
  - `AskQuestionRequest`, `AskStatusResponse`, `AnswerResponse`, and `AnswerQuery` are used consistently across route and command tasks.
  - `ask_id` remains snake_case in HTTP/CLI JSON, matching existing payload style.

## Execution Notes

- This plan intentionally does not modify mobile UI; existing `AskQuestionCard` and `MultiAskQuestionCard` should receive the same `ask_question` payload shape.
- This plan intentionally keeps `msctl ask-question` non-blocking. Blocking behavior belongs to `GET /api/v1/answer/{ask_id}?conversation_id=<conversation_id>` so runtime CLIs can decide timeout and retry policy.
- Before any final commit, run `superpowers:requesting-code-review` per repository rule, fix Critical/Important findings, rerun verification, then commit once after all tasks pass.
