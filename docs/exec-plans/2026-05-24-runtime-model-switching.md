# Runtime Model Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation-level model switching for Claude Code, Codex CLI, and Cursor Agent, with CLI-owned model capabilities and iOS Chat controls.

**Architecture:** Store the current model on `conversations.model_id`, expose runtime model capabilities through a CLI provider registry, and let Chat call a PATCH endpoint to switch models only when the conversation is not running. Runtime adapters receive the selected model per turn and pass `--model <id>` to fresh/resume CLI invocations; underlying CLI session/thread history remains authoritative.

**Tech Stack:** Rust + axum + rusqlite for `msctl serve`; React Native + Expo + Zustand + existing chat services for iOS; Jest and Cargo tests.

**Repo Rule Override:** This repository requires all tasks to be verified first, then one final code review and one final `git commit`. Do not commit after each task.

---

## File Structure

### CLI

- Modify `cli/src/db.rs`
  - Add `conversations.model_id` migration.
  - Extend schema tests to assert the column exists.
- Create `cli/src/serve/runtime/models.rs`
  - Define `ModelCapability`, `ModelSource`, provider functions, runtime lookup, validation, fallback lists, and Cursor dynamic parsing.
- Modify `cli/src/serve/runtime/mod.rs`
  - Expose `models`.
  - Add `model_id` to `DispatchMessage`.
  - Pass model id to runtime adapters.
- Modify `cli/src/serve/routes/mod.rs`
  - Export model routes.
- Modify `cli/src/serve/mod.rs`
  - Register `GET /api/v1/runtime-models` and `PATCH /api/v1/conversations/:id/model`.
- Modify `cli/src/serve/routes/conversations.rs`
  - Add `model_id` to `ConversationRow`.
  - Include model in list/create responses.
  - Add `patch_conversation_model`.
  - Insert and broadcast `system_event:model_changed`.
- Modify `cli/src/serve/routes/messages.rs`
  - Read `c.model_id` alongside agent runtime/mode.
  - Pass model to runtime dispatch.
- Modify `cli/src/serve/state.rs`
  - Add `model_id: Option<String>` to `SessionMessage`.
- Modify `cli/src/serve/runtime/claude.rs`
  - Queue model ids.
  - Spawn Claude with `--model`.
  - Restart the long-lived child when the queued model changes.
- Modify `cli/src/serve/runtime/codex.rs`
  - Queue model ids.
  - Add model id to Codex argv for fresh/resume.
  - Bind pre-warmed process to model id and discard it on mismatch.
- Modify `cli/src/serve/runtime/cursor.rs`
  - Queue model ids.
  - Replace conversation-level use of `CURSOR_AGENT_MODEL` with `--model`.
- Modify or add tests:
  - `cli/src/serve/routes/conversations_tests.rs`
  - `cli/src/serve/runtime/codex_tests/text_and_mode.rs`
  - `cli/src/serve/runtime/codex_tests/argv_and_session.rs`
  - `cli/src/serve/runtime/claude_tests.rs`
  - `cli/src/serve/runtime/cursor_tests.rs`
  - New tests inside `cli/src/serve/runtime/models.rs`

### Mobile

- Modify `mobile/src/types.ts`
  - Add `model_id` to `Conversation`.
  - Add `system_event` message role and payload.
  - Add `RuntimeModel` type.
- Modify `mobile/src/features/chat/services/chatService.ts`
  - Add `fetchRuntimeModels`.
  - Add `switchConversationModel`.
- Modify `mobile/src/features/chat/services/chatService.test.ts`
  - Verify the new endpoints.
- Create `mobile/src/features/chat/components/ModelSelector.tsx`
  - Modal/list UI for runtime model selection.
- Create `mobile/src/features/chat/components/ModelSelector.test.tsx`
  - Verify enabled, disabled, and selection behavior.
- Modify `mobile/app/chat/ChatHeader.tsx`
  - Accept model label and model press handler.
- Modify `mobile/app/chat/[id].tsx`
  - Fetch models for the conversation runtime.
  - Show current model.
  - Call PATCH when user selects a model.
  - Store first-switch acknowledgement locally.
- Modify `mobile/src/features/chat/components/MessageBubble.tsx`
  - Render `system_event:model_changed` as a lightweight separator.
- Modify `mobile/src/features/chat/utils/chatRenderState.ts`
  - Treat `system_event` as renderable.
- Modify `mobile/src/features/chat/utils/conversationPreview.ts`
  - Ensure system events do not update `last_ai_reply`.

### Docs

- Existing product spec: `docs/product-specs/SPEC-runtime-model-switching.md`
- Update design-doc hash index only if tracked design docs become stale after implementation.
- After final commit, update `docs/exec-plans/index.json` with `lastCompletedCommit`.

---

## Task 1: CLI Schema And Conversation API Shape

**Files:**
- Modify: `cli/src/db.rs`
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/routes/conversations_tests.rs`

- [ ] **Step 1: Add failing schema test for `conversations.model_id`**

Add to `cli/src/db.rs` tests:

```rust
/// DB migration: conversations table has nullable model_id after open_at.
///
/// 数据构造（含关键数值的推导过程）：
///   temp DB path = tempdir/t.db（新库会完整执行 init_schema）
///   column name  = "model_id"（conversation 级模型选择，NULL 表示 runtime 默认）
///
/// 执行过程：
///   1. open_at(tempdir/t.db) 初始化 schema 和 migrations
///   2. 查询 pragma_table_info('conversations')
///   3. 检查 model_id 是否存在
///
/// 预期结果：
///   - 正断言：model_id column 存在
///   - 负断言：model_id 不应出现在 agents 表，避免误做 agent 默认模型
#[test]
fn test_schema_has_conversation_model_id() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_at(&dir.path().join("t.db")).unwrap();
    let has_conversation_model_id: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name='model_id'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap();
    let has_agent_model_id: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('agents') WHERE name='model_id'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap();
    assert!(
        has_conversation_model_id,
        "conversations.model_id column must exist after migration"
    );
    assert!(
        !has_agent_model_id,
        "agents.model_id must not exist because v1 model switching is conversation-scoped"
    );
}
```

- [ ] **Step 2: Run the schema test and confirm it fails**

Run:

```bash
cd cli && cargo test db::tests::test_schema_has_conversation_model_id
```

Expected: fails because `model_id` is missing.

- [ ] **Step 3: Add the migration**

In `cli/src/db.rs`, add after existing conversation migrations:

```rust
let _ = conn.execute_batch("ALTER TABLE conversations ADD COLUMN model_id TEXT;");
```

Do not edit the original `CREATE TABLE conversations` block for existing DB compatibility.

- [ ] **Step 4: Extend `ConversationRow` and SELECTs**

In `cli/src/serve/routes/conversations.rs`, add:

```rust
pub model_id: Option<String>,
```

to `ConversationRow`.

Update list SELECT:

```sql
SELECT c.id, c.agent_id, c.title, c.created_at, c.last_message_at, c.status, c.model_id,
...
```

Shift row indexes so `model_id: r.get(6)?`, `first_user_message: r.get(7)?`, `last_ai_reply: r.get(8)?`.

Update create response:

```rust
model_id: None,
```

- [ ] **Step 5: Add conversation response tests**

Add to `cli/src/serve/routes/conversations_tests.rs`:

```rust
/// POST /api/v1/agents/:id/conversations returns model_id null for new conversations.
///
/// 数据构造（含关键数值的推导过程）：
///   agent runtime = "claude-code"（runtime 不影响默认模型表达）
///   request body  = {"title":"My thread"}
///   expected model_id = NULL，因为 v1 不做 agent 默认模型
///
/// 执行过程：
///   1. POST 创建 conversation
///   2. 解析 JSON body
///
/// 预期结果：
///   - 正断言：model_id 字段存在且为 null
///   - 负断言：model_id 不等于 "default"，后端不得持久化 default 字符串
#[tokio::test]
async fn test_create_conversation_returns_null_model_id() {
    let (app, agent_id) = make_conv_app("tok").await;
    let body = serde_json::json!({ "title": "My thread" });
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/agents/{}/conversations", agent_id))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::CREATED,
        "create conversation must return 201"
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(
        json.get("model_id").is_some(),
        "conversation response must include model_id for mobile model display"
    );
    assert!(
        json["model_id"].is_null(),
        "new conversations should use NULL model_id for runtime default"
    );
    assert_ne!(
        json["model_id"],
        serde_json::Value::String("default".to_string()),
        "default must be represented as null, not persisted as a string"
    );
}
```

- [ ] **Step 6: Run Task 1 tests**

Run:

```bash
cd cli && cargo test db::tests::test_schema_has_conversation_model_id routes::conversations_tests::test_create_conversation_returns_null_model_id
```

Expected: both pass.

---

## Task 2: CLI Runtime Model Provider Registry

**Files:**
- Create: `cli/src/serve/runtime/models.rs`
- Modify: `cli/src/serve/runtime/mod.rs`
- Modify: `cli/src/serve/routes/mod.rs`
- Modify: `cli/src/serve/mod.rs`

- [ ] **Step 1: Create provider module with tests first**

Create `cli/src/serve/runtime/models.rs` with failing tests and the concrete type definitions below:

```rust
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelSource {
    Builtin,
    Dynamic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelCapability {
    pub id: String,
    pub label: String,
    pub is_default: bool,
    pub source: ModelSource,
    pub available: bool,
}

pub fn list_models(runtime: &str) -> Result<Vec<ModelCapability>, ModelProviderError> {
    match runtime {
        "claude-code" => Ok(with_default(claude_builtin_models())),
        "codex" => Ok(with_default(codex_builtin_models())),
        "cursor-cli" => Ok(with_default(cursor_builtin_models())),
        _ => Err(ModelProviderError::UnknownRuntime(runtime.to_string())),
    }
}

pub fn validate_model(runtime: &str, model_id: Option<&str>) -> Result<(), ModelProviderError> {
    if model_id.is_none() {
        return Ok(());
    }
    let wanted = model_id.unwrap();
    if wanted == "default" {
        return Err(ModelProviderError::InvalidDefaultString);
    }
    let models = list_models(runtime)?;
    if models.iter().any(|model| model.id == wanted && model.available) {
        Ok(())
    } else {
        Err(ModelProviderError::UnsupportedModel {
            runtime: runtime.to_string(),
            model_id: wanted.to_string(),
        })
    }
}
```

Add concrete error enum:

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelProviderError {
    UnknownRuntime(String),
    UnsupportedModel { runtime: String, model_id: String },
    InvalidDefaultString,
    Unavailable(String),
}
```

Add helper and fallback lists. Keep the initial lists short and explicitly versioned by behavior:

```rust
fn with_default(mut models: Vec<ModelCapability>) -> Vec<ModelCapability> {
    let mut all = vec![ModelCapability {
        id: "default".to_string(),
        label: "Default".to_string(),
        is_default: true,
        source: ModelSource::Builtin,
        available: true,
    }];
    all.append(&mut models);
    all
}

fn builtin(id: &str, label: &str) -> ModelCapability {
    ModelCapability {
        id: id.to_string(),
        label: label.to_string(),
        is_default: false,
        source: ModelSource::Builtin,
        available: true,
    }
}

fn claude_builtin_models() -> Vec<ModelCapability> {
    vec![
        builtin("sonnet", "Sonnet"),
        builtin("opus", "Opus"),
    ]
}

fn codex_builtin_models() -> Vec<ModelCapability> {
    vec![
        builtin("gpt-5.3-codex", "Codex 5.3"),
        builtin("gpt-5.3-codex-high", "Codex 5.3 High"),
        builtin("gpt-5.3-codex-xhigh", "Codex 5.3 Extra High"),
    ]
}

fn cursor_builtin_models() -> Vec<ModelCapability> {
    vec![
        builtin("auto", "Auto"),
        builtin("composer-2", "Composer 2"),
        builtin("gpt-5.3-codex", "Codex 5.3"),
    ]
}
```

Add tests with full comments:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// runtime model provider: every supported runtime includes Default first.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   runtimes = ["claude-code", "codex", "cursor-cli"]（v1 支持三种 runtime）
    ///   expected default id = "default"（API 虚拟项，不写入 DB）
    ///
    /// 执行过程：
    ///   1. 分别调用 list_models(runtime)
    ///   2. 检查返回列表第一项
    ///
    /// 预期结果：
    ///   - 正断言：每个 runtime 的第一项是 Default
    ///   - 正断言：Default source 是 builtin
    ///   - 负断言：Default 不应 available=false
    #[test]
    fn test_supported_runtimes_include_default_first() {
        for runtime in ["claude-code", "codex", "cursor-cli"] {
            let models = list_models(runtime).expect("supported runtime should list models");
            let first = models.first().expect("models should not be empty");
            assert_eq!(
                first.id, "default",
                "first model for {runtime} should be Default virtual option"
            );
            assert!(
                first.is_default,
                "first model for {runtime} should be marked as default"
            );
            assert_eq!(
                first.source,
                ModelSource::Builtin,
                "Default virtual option should be builtin for {runtime}"
            );
            assert!(
                first.available,
                "Default virtual option should be selectable for {runtime}"
            );
        }
    }

    /// runtime model validation: NULL means default; "default" string is rejected.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   runtime = "codex"
    ///   model_id None       = DB NULL，合法 Default
    ///   model_id "default"  = API 虚拟项字符串，不允许写入 DB
    ///
    /// 执行过程：
    ///   1. validate_model("codex", None)
    ///   2. validate_model("codex", Some("default"))
    ///
    /// 预期结果：
    ///   - 正断言：None 合法
    ///   - 负断言："default" 字符串非法
    #[test]
    fn test_validate_default_semantics() {
        assert!(
            validate_model("codex", None).is_ok(),
            "None model_id should be accepted as runtime default"
        );
        assert_eq!(
            validate_model("codex", Some("default")),
            Err(ModelProviderError::InvalidDefaultString),
            "literal default string must not be accepted as a persisted model id"
        );
    }
}
```

- [ ] **Step 2: Run provider tests**

Run:

```bash
cd cli && cargo test serve::runtime::models::tests
```

Expected: pass after completing the module.

- [ ] **Step 3: Expose module from runtime**

In `cli/src/serve/runtime/mod.rs`:

```rust
pub mod models;
```

- [ ] **Step 4: Add runtime-models route**

Either create `cli/src/serve/routes/runtime_models.rs` or keep a small route module if preferred. Use this shape:

```rust
use crate::serve::runtime::models::{self, ModelProviderError};
use axum::{extract::Query, http::StatusCode, Json};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct RuntimeModelsQuery {
    pub runtime: String,
}

pub async fn list_runtime_models(
    Query(query): Query<RuntimeModelsQuery>,
) -> Result<Json<Vec<models::ModelCapability>>, StatusCode> {
    models::list_models(&query.runtime)
        .map(Json)
        .map_err(model_provider_status)
}

pub fn model_provider_status(error: ModelProviderError) -> StatusCode {
    match error {
        ModelProviderError::UnknownRuntime(_) => StatusCode::NOT_FOUND,
        ModelProviderError::UnsupportedModel { .. } | ModelProviderError::InvalidDefaultString => {
            StatusCode::BAD_REQUEST
        }
        ModelProviderError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
```

Register in `routes/mod.rs`:

```rust
pub mod runtime_models;
```

Register in `serve/mod.rs` authed router:

```rust
.route(
    "/api/v1/runtime-models",
    axum::routing::get(runtime_models::list_runtime_models),
)
```

- [ ] **Step 5: Add route tests**

Add tests in the route module for:

- `GET /api/v1/runtime-models?runtime=codex` returns 200 and Default.
- Unknown runtime returns 404.

Use the existing bearer-auth router pattern from `agents.rs` or `conversations_tests.rs`.

- [ ] **Step 6: Run Task 2 tests**

Run:

```bash
cd cli && cargo test runtime_models serve::runtime::models::tests
```

Expected: pass.

---

## Task 3: PATCH Conversation Model And System Event

**Files:**
- Modify: `cli/src/serve/routes/conversations.rs`
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/routes/conversations_tests.rs`

- [ ] **Step 1: Add failing PATCH tests**

Add tests covering success, running conflict, invalid model, and default null. Use `codex` agent where the fallback list includes `gpt-5.3-codex`.

Test body for success:

```rust
/// PATCH /api/v1/conversations/:id/model updates model_id and inserts model_changed event.
///
/// 数据构造（含关键数值的推导过程）：
///   agent.runtime = "codex"（provider fallback 包含 gpt-5.3-codex）
///   initial model_id = NULL（runtime default）
///   target model_id  = "gpt-5.3-codex"
///   existing messages = 0，因此 system_event seq = 0 + 1 = 1
///
/// 执行过程：
///   1. 创建 conversation
///   2. PATCH /api/v1/conversations/:id/model
///   3. 查询 response 和 DB messages
///
/// 预期结果：
///   - 正断言：response.model_id == "gpt-5.3-codex"
///   - 正断言：DB conversations.model_id 已更新
///   - 正断言：messages 中存在 seq=1 的 system_event
///   - 负断言：system_event role 不应是 agent_text，避免污染 last_ai_reply
#[tokio::test]
async fn test_patch_conversation_model_inserts_system_event() {
    // Build a router with PATCH route and a codex agent.
    // Follow existing make_conv_app style, but insert_agent(..., "codex", ...).
}
```

Implement the full test body in this step. Required exact assertions:

```rust
assert_eq!(json["model_id"], "gpt-5.3-codex", "response should expose selected model");
assert_eq!(stored_model.as_deref(), Some("gpt-5.3-codex"), "DB model_id should be updated");
assert_eq!(role, "system_event", "model switch should be stored as system_event");
assert_ne!(role, "agent_text", "model switch must not be stored as agent_text");
assert_eq!(payload["event"], "model_changed", "system event should be model_changed");
```

Add conflict test:

```rust
/// PATCH model is rejected while conversation is running.
///
/// 数据构造（含关键数值的推导过程）：
///   status = "running"（runtime 正在执行）
///   target model_id = "gpt-5.3-codex"（有效模型，确保失败原因是状态）
///
/// 执行过程：
///   1. 将 conversation.status 更新为 running
///   2. PATCH model
///
/// 预期结果：
///   - 正断言：HTTP 409
///   - 负断言：DB model_id 仍为 NULL
#[tokio::test]
async fn test_patch_conversation_model_rejects_running_status() {
    // Implement exact setup and assertions.
}
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
cd cli && cargo test routes::conversations_tests::test_patch_conversation_model
```

Expected: fails because route is missing.

- [ ] **Step 3: Implement PATCH handler**

In `conversations.rs`:

```rust
#[derive(Deserialize)]
pub struct PatchConversationModelBody {
    pub model_id: Option<String>,
}

pub async fn patch_conversation_model(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Json(body): Json<PatchConversationModelBody>,
) -> Result<Json<ConversationRow>, StatusCode> {
    let requested_model = normalize_model_id(body.model_id)?;
    let (runtime, status, current_model) = load_conversation_runtime_status_model(&state, &conv_id)?;
    if status == "running" || status == "awaiting_question" {
        return Err(StatusCode::CONFLICT);
    }
    crate::serve::runtime::models::validate_model(&runtime, requested_model.as_deref())
        .map_err(crate::serve::routes::runtime_models::model_provider_status)?;
    if current_model == requested_model {
        return load_conversation_row(&state, &conv_id).map(Json);
    }
    update_model_and_insert_event(&state, &conv_id, current_model.as_deref(), requested_model.as_deref())?;
    load_conversation_row(&state, &conv_id).map(Json)
}
```

Use helper functions to keep `conversations.rs` under the 500-line source limit. If the file approaches the limit, split model-specific helpers into `cli/src/serve/routes/conversation_models.rs` and re-export the handler from `routes/mod.rs`.

Normalize `"default"` to error, not `None`:

```rust
fn normalize_model_id(model_id: Option<String>) -> Result<Option<String>, StatusCode> {
    match model_id {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed == "default" {
                Err(StatusCode::BAD_REQUEST)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
    }
}
```

Insert event payload:

```rust
let payload = serde_json::json!({
    "event": "model_changed",
    "from_model_id": from_model_id,
    "to_model_id": to_model_id,
    "from_label": model_label(&runtime, from_model_id),
    "to_label": model_label(&runtime, to_model_id),
});
```

Broadcast envelope:

```rust
let envelope = serde_json::json!({
    "type": "message",
    "seq": seq,
    "role": "system_event",
    "payload": payload,
    "created_at": now
});
let sender = state.get_or_create_sender(conv_id);
let _ = sender.send(envelope.to_string());
```

- [ ] **Step 4: Register PATCH route**

In `serve/mod.rs`:

```rust
.route(
    "/api/v1/conversations/:id/model",
    axum::routing::patch(conversations::patch_conversation_model),
)
```

- [ ] **Step 5: Run Task 3 tests**

Run:

```bash
cd cli && cargo test routes::conversations_tests
```

Expected: pass.

---

## Task 4: Pass Model IDs Through Runtime Dispatch

**Files:**
- Modify: `cli/src/serve/state.rs`
- Modify: `cli/src/serve/routes/messages.rs`
- Modify: `cli/src/serve/runtime/mod.rs`
- Modify: `cli/src/serve/runtime/codex.rs`
- Modify: `cli/src/serve/runtime/claude.rs`
- Modify: `cli/src/serve/runtime/cursor.rs`
- Modify tests in runtime modules

- [ ] **Step 1: Extend queued message type**

In `state.rs`:

```rust
pub struct SessionMessage {
    pub user_text: String,
    pub file_id: Option<String>,
    pub seq: i64,
    pub model_id: Option<String>,
}
```

Update every construction site to include `model_id`.

- [ ] **Step 2: Read model in message route**

In `messages.rs`, change query result:

```rust
let agent_info: Option<(String, String, String, Option<String>)> = {
    ...
    db2.query_row(
        "SELECT a.project_path, a.runtime, a.mode, c.model_id FROM agents a
         JOIN conversations c ON c.agent_id = a.id
         WHERE c.id = ?1",
        [&conv_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .ok()
};
```

Pass:

```rust
model_id: model_id.as_deref(),
```

- [ ] **Step 3: Extend dispatch type**

In `runtime/mod.rs`:

```rust
pub struct DispatchMessage<'a> {
    pub text: &'a str,
    pub file_id: Option<&'a str>,
    pub seq: i64,
    pub model_id: Option<&'a str>,
}
```

Each runtime `send_to_session` signature should receive `model_id: Option<&str>`.

- [ ] **Step 4: Add Codex model argv tests**

In `codex_tests/text_and_mode.rs` or `argv_and_session.rs`, update `build_codex_args` calls to include model id, then add:

```rust
/// build_codex_args: fresh and resume turns include selected model when model_id exists.
///
/// 数据构造（含关键数值的推导过程）：
///   fresh thread_id = None → argv uses exec --cd /repo
///   resume thread_id = Some("thread-1") → argv uses exec resume thread-1
///   model_id = "gpt-5.3-codex"（provider 支持的 Codex 模型）
///
/// 执行过程：
///   1. 调用 fresh build_codex_args(..., model_id=Some(...))
///   2. 调用 resume build_codex_args(..., model_id=Some(...))
///
/// 预期结果：
///   - 正断言：fresh argv 包含 --model gpt-5.3-codex
///   - 正断言：resume argv 包含 --model gpt-5.3-codex
///   - 负断言：model_id None 时不包含 --model
#[test]
fn test_build_codex_args_includes_selected_model() {
    let fresh = build_codex_args("/repo", None, "suggest", None, Some("gpt-5.3-codex"));
    assert!(
        fresh.windows(2).any(|pair| pair == ["--model", "gpt-5.3-codex"]),
        "fresh Codex argv should include selected --model"
    );
    let resume = build_codex_args(
        "/repo",
        Some("thread-1"),
        "suggest",
        None,
        Some("gpt-5.3-codex"),
    );
    assert!(
        resume.windows(2).any(|pair| pair == ["--model", "gpt-5.3-codex"]),
        "resume Codex argv should include selected --model"
    );
    let default_args = build_codex_args("/repo", None, "suggest", None, None);
    assert!(
        !default_args.iter().any(|arg| arg == "--model"),
        "Default model should not pass --model to Codex"
    );
}
```

- [ ] **Step 5: Implement Codex model args and pre-warm binding**

Change signature:

```rust
fn build_codex_args(
    project_path: &str,
    thread_id: Option<&str>,
    mode: &str,
    image_path: Option<&Path>,
    model_id: Option<&str>,
) -> Vec<String>
```

Append before image args:

```rust
if let Some(model_id) = model_id.filter(|m| !m.is_empty()) {
    args.push("--model".to_string());
    args.push(model_id.to_string());
}
```

Track pre-warm:

```rust
let mut pre_spawned: Option<(Option<String>, Child, ChildStdin)> = None;
```

When consuming:

```rust
let reusable_pre_spawned = match pre_spawned.take() {
    Some((pre_model, child, stdin)) if pre_model == model_id => Some((child, stdin)),
    Some((_pre_model, mut child, _stdin)) => {
        let pid = child.id();
        let _ = child.kill();
        session_handle.clear_current_pid(pid);
        let _ = child.wait();
        debug!(pid, "codex_pre_warm_discarded_for_model_change");
        None
    }
    None => None,
};
```

- [ ] **Step 6: Add Claude spawn argv helper test**

Refactor Claude argv construction into testable helper:

```rust
fn build_claude_args(session_id: Option<&str>, model_id: Option<&str>) -> Vec<String>
```

Add test:

```rust
/// build_claude_args: resume uses session id and selected model together.
///
/// 数据构造（含关键数值的推导过程）：
///   session_id = "sid-1"（已有 Claude session）
///   model_id   = "sonnet"（Claude alias）
///
/// 执行过程：
///   1. 调用 build_claude_args(Some("sid-1"), Some("sonnet"))
///   2. 检查 argv
///
/// 预期结果：
///   - 正断言：argv 包含 --resume sid-1
///   - 正断言：argv 包含 --model sonnet
///   - 负断言：model_id None 时不包含 --model
#[test]
fn test_build_claude_args_resume_with_model() {
    let args = build_claude_args(Some("sid-1"), Some("sonnet"));
    assert!(
        args.windows(2).any(|pair| pair == ["--resume", "sid-1"]),
        "Claude resume argv should include the stored session id"
    );
    assert!(
        args.windows(2).any(|pair| pair == ["--model", "sonnet"]),
        "Claude argv should include selected model"
    );
    let default_args = build_claude_args(Some("sid-1"), None);
    assert!(
        !default_args.iter().any(|arg| arg == "--model"),
        "Default model should not pass --model to Claude"
    );
}
```

- [ ] **Step 7: Implement Claude model switching**

Change `spawn_claude(project_path, session_id, model_id)`.

Inside worker loop keep:

```rust
let mut active_model_id: Option<String> = None;
```

On each queued message:

```rust
if active_model_id != msg.model_id {
    let _ = child.kill();
    session_handle.clear_current_pid(child.id());
    let _ = child.wait();
    let (new_child, new_stdin) =
        spawn_claude(&project_path, session_id.as_deref(), msg.model_id.as_deref())
            .ok_or_else(...);
    child = new_child;
    stdin = new_stdin;
    reader = BufReader::new(child.stdout.take().expect("no stdout"));
    let _ = read_system_event(&mut reader, &state, &conv_id, &mut session_id);
    active_model_id = msg.model_id.clone();
}
```

Keep the initial spawn with `None` or the first message model. Prefer spawning after receiving the first message if that keeps behavior simpler; if keeping current initial spawn, it must restart before processing the first message when `model_id` is not `None`.

- [ ] **Step 8: Add Cursor argv helper test and implementation**

Refactor Cursor command construction enough to test argv, for example:

```rust
fn build_cursor_args(prompt: &str, project_path: &str, mode: &str, resume: Option<&str>, model_id: Option<&str>) -> Vec<String>
```

Test:

```rust
/// build_cursor_args: selected conversation model overrides env default.
///
/// 数据构造（含关键数值的推导过程）：
///   prompt = "hello"
///   project_path = "/repo"
///   model_id = "gpt-5.3-codex"
///
/// 执行过程：
///   1. 调用 build_cursor_args(..., model_id=Some(...))
///   2. 调用 build_cursor_args(..., model_id=None)
///
/// 预期结果：
///   - 正断言：有 model_id 时包含 --model gpt-5.3-codex
///   - 负断言：model_id None 时不包含 --model
#[test]
fn test_build_cursor_args_includes_selected_model() {
    let args = build_cursor_args("hello", "/repo", "full-auto", Some("sid-1"), Some("gpt-5.3-codex"));
    assert!(
        args.windows(2).any(|pair| pair == ["--model", "gpt-5.3-codex"]),
        "Cursor argv should include selected conversation model"
    );
    let default_args = build_cursor_args("hello", "/repo", "full-auto", Some("sid-1"), None);
    assert!(
        !default_args.iter().any(|arg| arg == "--model"),
        "Default model should not pass --model to Cursor"
    );
}
```

Remove `model_from_env()` from the conversation-level path. If retained, use it only when `model_id` is `None` and document that environment variable is a process default, not a conversation override.

- [ ] **Step 9: Run runtime tests**

Run:

```bash
cd cli && cargo test serve::runtime
```

Expected: pass.

---

## Task 5: Mobile Types And API Services

**Files:**
- Modify: `mobile/src/types.ts`
- Modify: `mobile/src/features/chat/services/chatService.ts`
- Modify: `mobile/src/features/chat/services/chatService.test.ts`

- [ ] **Step 1: Extend shared types**

In `mobile/src/types.ts`:

```ts
export interface Agent {
  id: string;
  name: string;
  project_path: string;
  runtime: 'claude-code' | 'codex' | 'cursor-cli' | 'custom';
  created_at: number;
  endpoint_id: string;
  endpoint_label: string;
}

export interface Conversation {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  last_message_at: number;
  status: 'idle' | 'running' | 'awaiting_question' | 'completed' | 'failed';
  model_id: string | null;
  endpoint_id: string;
  agent_name: string;
  first_user_message?: string;
  last_ai_reply?: string;
}

export interface RuntimeModel {
  id: string;
  label: string;
  is_default: boolean;
  source: 'dynamic' | 'builtin';
  available: boolean;
}
```

Add role and payload:

```ts
export type MessageRole =
  | 'user_text'
  | 'agent_text'
  | 'tool_call'
  | 'tool_result'
  | 'ask_question'
  | 'task_status'
  | 'system_event';

export interface SystemEventPayload {
  event: 'model_changed';
  from_model_id: string | null;
  to_model_id: string | null;
  from_label: string;
  to_label: string;
}
```

Add `SystemEventPayload` to `MessagePayload`.

- [ ] **Step 2: Add service tests**

In `chatService.test.ts` add:

```ts
it('fetchRuntimeModels calls the runtime models endpoint with runtime param', async () => {
  mockGet.mockResolvedValueOnce({
    data: [{ id: 'default', label: 'Default', is_default: true, source: 'builtin', available: true }],
  });

  const models = await fetchRuntimeModels('http://localhost:8080', 'tok', 'codex');

  expect(mockGet).toHaveBeenCalledWith('/api/v1/runtime-models', {
    params: { runtime: 'codex' },
  });
  expect(models[0]?.id).toBe('default');
});

it('switchConversationModel sends null for Default', async () => {
  mockPatch.mockResolvedValueOnce({
    data: {
      id: 'conv-1',
      agent_id: 'agent-1',
      title: 'Chat',
      created_at: 1,
      last_message_at: 2,
      status: 'completed',
      model_id: null,
    },
  });

  const conv = await switchConversationModel('http://localhost:8080', 'tok', 'conv-1', null);

  expect(mockPatch).toHaveBeenCalledWith('/api/v1/conversations/conv-1/model', {
    model_id: null,
  });
  expect(conv.model_id).toBeNull();
});
```

Ensure assertions match the existing mocked Axios client style in the file.

- [ ] **Step 3: Implement service functions**

In `chatService.ts`:

```ts
export async function fetchRuntimeModels(
  base_url: string,
  token: string,
  runtime: Agent['runtime'],
): Promise<RuntimeModel[]> {
  const client = getEndpointClient(base_url, token);
  const res = await client.get<RuntimeModel[]>('/api/v1/runtime-models', {
    params: { runtime },
  });
  return res.data;
}

export async function switchConversationModel(
  base_url: string,
  token: string,
  conv_id: string,
  model_id: string | null,
): Promise<Conversation> {
  const client = getEndpointClient(base_url, token);
  const res = await client.patch<Conversation>(`/api/v1/conversations/${conv_id}/model`, {
    model_id,
  });
  return res.data;
}
```

- [ ] **Step 4: Run service tests**

Run:

```bash
cd mobile && pnpm test -- chatService.test.ts --watchAll=false
```

Expected: pass.

---

## Task 6: Mobile Model Selector UI And System Event Rendering

**Files:**
- Create: `mobile/src/features/chat/components/ModelSelector.tsx`
- Create: `mobile/src/features/chat/components/ModelSelector.test.tsx`
- Modify: `mobile/app/chat/ChatHeader.tsx`
- Modify: `mobile/app/chat/[id].tsx`
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`
- Modify: `mobile/src/features/chat/components/MessageBubble.test.tsx`
- Modify: `mobile/src/features/chat/utils/chatRenderState.ts`
- Modify: `mobile/src/features/chat/utils/conversationPreview.ts`
- Modify tests for render/preview utilities

- [ ] **Step 1: Add render-state tests for `system_event`**

In `chatRenderState.test.ts`, add exact positive and negative assertions:

```ts
test('system_event messages render in chat transcript but do not count as agent activity', () => {
  const msg = {
    type: 'message',
    seq: 3,
    role: 'system_event',
    payload: {
      event: 'model_changed',
      from_model_id: null,
      to_model_id: 'gpt-5.3-codex',
      from_label: 'Default',
      to_label: 'Codex 5.3',
    },
    created_at: 10,
  } as const;

  expect(isRenderableInChatTranscript(msg)).toBe(true);
  expect(getLatestAgentActivitySeq([msg])).toBe(0);
  expect(getLatestAgentTextSeq([msg])).toBe(0);
});
```

- [ ] **Step 2: Implement render-state support**

In `chatRenderState.ts`, include `system_event` in renderable roles, but do not count it in agent activity/text helpers.

- [ ] **Step 3: Add MessageBubble test**

In `MessageBubble.test.tsx`:

```tsx
it('renders model_changed system event as separator text', () => {
  render(
    <MessageBubble
      msg={{
        type: 'message',
        seq: 5,
        role: 'system_event',
        payload: {
          event: 'model_changed',
          from_model_id: null,
          to_model_id: 'gpt-5.3-codex',
          from_label: 'Default',
          to_label: 'Codex 5.3',
        },
        created_at: 1,
      }}
    />,
  );

  expect(screen.getByText('Model changed: Default -> Codex 5.3')).toBeTruthy();
  expect(screen.queryByTestId('agent-text-bubble')).toBeNull();
});
```

- [ ] **Step 4: Implement MessageBubble case**

In `MessageBubble.tsx`, add:

```tsx
case 'system_event': {
  const payload = msg.payload as SystemEventPayload;
  if (payload.event !== 'model_changed') return null;
  return (
    <View style={s.systemEventWrap}>
      <Text style={s.systemEventText}>
        {`Model changed: ${payload.from_label} -> ${payload.to_label}`}
      </Text>
    </View>
  );
}
```

Use design-approved colors already present in the file, such as `#888888` and `#252525`.

- [ ] **Step 5: Build `ModelSelector`**

Create a small modal/list component:

```tsx
interface Props {
  visible: boolean;
  models: RuntimeModel[];
  currentModelId: string | null;
  disabled: boolean;
  onClose: () => void;
  onSelect: (modelId: string | null) => void;
}
```

Render:

- Current model checked state.
- Default maps to `null` in `onSelect`.
- Disabled state shows short text: `Available when idle`.
- No custom input.

Use existing palette from `mobile/docs/design.md`; avoid new colors.

- [ ] **Step 6: Add ModelSelector tests**

Required tests:

- Selecting Default calls `onSelect(null)`.
- Selecting a concrete model calls `onSelect(model.id)`.
- Disabled selector does not call `onSelect`.

- [ ] **Step 7: Wire ChatHeader and Chat screen**

In `ChatHeader.tsx`, add optional model button props:

```ts
modelLabel?: string;
modelDisabled?: boolean;
onPressModel?: () => void;
```

In `[id].tsx`:

- Resolve agent runtime from store conversation/agent data. If unavailable, model selector remains hidden.
- Fetch models after endpoint and runtime are known:

```ts
const [runtimeModels, setRuntimeModels] = useState<RuntimeModel[]>([]);
const [modelSelectorVisible, setModelSelectorVisible] = useState(false);
```

- Current label:

```ts
const currentModelLabel =
  runtimeModels.find((model) =>
    conversation?.model_id == null ? model.is_default : model.id === conversation.model_id,
  )?.label ?? 'Default';
```

- Disable when:

```ts
const modelSwitchDisabled =
  conversationStatus === 'running' || conversationStatus === 'awaiting_question' || isAwaitingResponse;
```

- On select:

```ts
const updated = await switchConversationModel(endpoint.base_url, endpoint.token, conv_id, modelId);
updateConversation(conv_id, updated);
```

- On first switch, show `Alert.alert` and persist acknowledgement with AsyncStorage. Use a key like `multisoul:model-switch-warning-seen`.

- [ ] **Step 8: Run mobile focused tests**

Run:

```bash
cd mobile && pnpm test -- MessageBubble.test.tsx ModelSelector.test.tsx chatRenderState.test.ts --watchAll=false
```

Expected: pass.

---

## Task 7: End-To-End Integration Tests And Verification

**Files:**
- Modify test files touched above
- Optionally modify `docs/design-docs/index.json` only if design doc hash guard reports stale tracked files

- [ ] **Step 1: Run full CLI tests**

Run:

```bash
cd cli && cargo test
```

Expected: pass.

- [ ] **Step 2: Run CLI build**

Run:

```bash
cd cli && cargo build
```

Expected: pass.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
cd mobile && pnpm typecheck
```

Expected: pass.

- [ ] **Step 4: Run mobile tests**

Run:

```bash
cd mobile && pnpm test -- --watchAll=false
```

Expected: pass.

- [ ] **Step 5: Run manual runtime smoke checks**

Use a temporary local DB or a disposable agent. Do not inspect or modify user runtime private history files directly.

Smoke checklist:

```bash
cd cli
cargo run -- agent register --name model-smoke-codex --project /tmp --runtime codex --mode suggest
cargo run -- serve
```

Then from mobile or curl:

- Create a conversation.
- Send one message.
- PATCH model to a supported Codex model while status is completed.
- Send another message.
- Confirm logs show `codex exec resume <thread_id> ... --model <model>`.

Repeat equivalent checks for Claude and Cursor if both CLIs are authenticated on the machine:

- Claude logs should show spawn args containing `--resume <session_id>` and `--model <model>`.
- Cursor logs should show `agent --resume <session_id>` and `--model <model>`.

- [ ] **Step 6: Run quality guards relevant to touched files**

Run:

```bash
scripts/check-no-allow.sh
python3 scripts/check-doc-code-hashes.py
```

Expected:

- No `#[allow(...)]` introduced in `cli/src`.
- If doc-code-hash guard reports stale design docs, inspect the diff and update only the affected design doc hash with:

```bash
python3 scripts/check-doc-code-hashes.py --update-doc <basename>.md
```

- [ ] **Step 7: Final review before commit**

Per repository rule, before committing:

1. Use `superpowers:verification-before-completion`.
2. Use `superpowers:requesting-code-review`.
3. Fix Critical/Important findings.
4. Re-run affected tests.
5. Commit once.
6. Write the 40-character commit SHA into this plan's `lastCompletedCommit` entry in `docs/exec-plans/index.json`.

---

## Self-Review Checklist

- Spec coverage:
  - Conversation model state: Task 1 and Task 3.
  - Runtime model capabilities: Task 2.
  - Non-running-only switch: Task 3 and Task 6.
  - `system_event:model_changed`: Task 3 and Task 6.
  - Runtime `--model` fresh/resume behavior: Task 4.
  - Mobile model selector and no hardcoded model list: Task 5 and Task 6.
  - No manual history replay: Task 4 and Task 7 smoke checks.
- Placeholder scan:
  - This plan intentionally uses executable examples and exact commands. Implementation workers must replace any described setup helper with real code before marking a checkbox complete.
- Type consistency:
  - Backend field is `model_id`.
  - Default is represented as DB/API `null`, except the model-list virtual item uses `id: "default"`.
  - Message role is `system_event`; payload event is `model_changed`.

## Execution Choice

After this plan is accepted, choose one execution mode:

1. **Subagent 驱动（推荐）**：按任务派发独立 worker，父会话做 review 和整合。
2. **当前会话内联执行**：我在当前会话按任务执行，阶段性验证。
