# Chat 图片上传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从手机选 JPEG/PNG 图片，通过 msctl 传递给 Claude Agent，实现端到端视觉分析。

**Architecture:** CLI 新增 `POST /api/v1/uploads` multipart 端点临时存图；`POST .../messages` 扩展 `file_id`，runtime 以 base64 image content block 写入 Claude stdin，turn 结束后删文件；手机端 expo-image-picker 选图压缩，发送时上传再发消息，MessageBubble 展示缩略图。

**Tech Stack:** Rust/axum 0.7 multipart feature, `base64 = "0.22"`, expo-image-picker, expo-image-manipulator, React Native Image + Modal

---

## File Map

| 操作 | 文件 | 职责 |
|------|------|------|
| CREATE | `cli/src/serve/routes/uploads.rs` | multipart 上传处理器，格式/大小校验，写磁盘 |
| MODIFY | `cli/Cargo.toml` | axum 加 `multipart` feature；添加 `base64 = "0.22"` |
| MODIFY | `cli/src/serve/routes/mod.rs` | 加 `pub mod uploads;` |
| MODIFY | `cli/src/serve/state.rs` | 添加 `uploads_dir: PathBuf`；`SessionMessage` 结构体；更新 `SessionMap` 类型 |
| MODIFY | `cli/src/serve/mod.rs` | 注册 uploads 路由；`AppState::new` 传 uploads_dir |
| MODIFY | `cli/src/serve/routes/messages.rs` | `PostMessageBody` 加 `file_id: Option<String>`；传给 runtime |
| MODIFY | `cli/src/serve/runtime/mod.rs` | `send_to_session` 加 `file_id: Option<&str>` 参数 |
| MODIFY | `cli/src/serve/runtime/claude.rs` | 使用 `SessionMessage` channel；`write_user_message_with_image`；turn 后删文件 |
| MODIFY | `cli/src/serve/runtime/codex.rs` | 使用 `SessionMessage` channel（忽略 file_id） |
| MODIFY | `cli/src/serve/runtime/claude_stream.rs` | `process_turn` 加 `file_id`；按需调用 image 写入 |
| MODIFY | `mobile/package.json` | 加 expo-image-picker, expo-image-manipulator |
| MODIFY | `mobile/src/types.ts` | `UserTextPayload` 加 `file_id?: string` |
| MODIFY | `mobile/src/features/chat/services/chatService.ts` | 加 `uploadImage()`；`postMessage` 支持 `file_id` |
| MODIFY | `mobile/app/agent/[id]/chat.tsx` | 图片按钮 + 待发图片状态 + 上传发送流程 |
| MODIFY | `mobile/src/features/chat/components/MessageBubble.tsx` | `user_text` case 加图片缩略图渲染 |

---

## Task 1: CLI — 更新依赖

**Files:**
- Modify: `cli/Cargo.toml`

- [ ] **Step 1: 修改 Cargo.toml**

将以下两行替换/更新：

```toml
axum = { version = "0.7", features = ["ws", "multipart"] }
base64 = "0.22"
```

完整 diff — 在 `[dependencies]` 区块里：
- `axum` 行从 `features = ["ws"]` 改为 `features = ["ws", "multipart"]`
- 在 `base64` 行（新增）之后

- [ ] **Step 2: 验证编译**

```bash
cd cli && cargo check 2>&1 | tail -5
```

期望：`Finished ... (0 errors)`

- [ ] **Step 3: Commit**

```bash
cd cli && git add Cargo.toml Cargo.lock
git commit -m "chore(cli): add axum multipart + base64 deps for image upload"
```

---

## Task 2: CLI — AppState 扩展 uploads_dir 与 SessionMessage

**Files:**
- Modify: `cli/src/serve/state.rs`

这是其他任务的基础，先改 state。

- [ ] **Step 1: 写测试**

在 `cli/src/serve/state.rs` 末尾加：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// AppState::new accepts uploads_dir and stores it correctly.
    ///
    /// 执行：构造 AppState，验证 uploads_dir 字段被保留。
    ///
    /// 预期结果：
    ///   - uploads_dir 与传入路径相同
    #[test]
    fn test_app_state_stores_uploads_dir() {
        use crate::db;
        let dir = tempdir().unwrap();
        let uploads_dir = dir.path().join("uploads");
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(conn, "ms_v2_tok".to_string(), uploads_dir.clone());
        assert_eq!(
            state.uploads_dir, uploads_dir,
            "uploads_dir should be stored in AppState"
        );
    }

    /// SessionMessage carries both user_text and file_id.
    ///
    /// 预期结果：
    ///   - text 和 file_id 都能正确读取
    #[test]
    fn test_session_message_fields() {
        let msg = SessionMessage {
            user_text: "hello".to_string(),
            file_id: Some("abc.jpg".to_string()),
        };
        assert_eq!(msg.user_text, "hello", "user_text should match");
        assert_eq!(
            msg.file_id.as_deref(),
            Some("abc.jpg"),
            "file_id should match"
        );

        let text_only = SessionMessage {
            user_text: "text only".to_string(),
            file_id: None,
        };
        assert!(text_only.file_id.is_none(), "file_id should be None for text-only");
    }
}
```

- [ ] **Step 2: 运行确认 fail（类型未定义）**

```bash
cd cli && cargo test serve::state::tests 2>&1 | tail -10
```

期望：编译错误，`SessionMessage` 未找到。

- [ ] **Step 3: 修改 state.rs**

将 `state.rs` 全部内容替换为：

```rust
use crate::serve::interactive::AnswerPayload;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tracing::warn;

/// Message sent from HTTP handler to session worker via channel.
#[derive(Debug)]
pub struct SessionMessage {
    pub user_text: String,
    pub file_id: Option<String>,
}

pub type ConvBus = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;
pub type SessionMap = Arc<Mutex<HashMap<String, std::sync::mpsc::Sender<SessionMessage>>>>;
pub type AnswerMap = Arc<Mutex<HashMap<String, std::sync::mpsc::SyncSender<AnswerPayload>>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub token: String,
    pub uploads_dir: PathBuf,
    pub bus: ConvBus,
    pub sessions: SessionMap,
    pub answer_txs: AnswerMap,
}

impl AppState {
    pub fn new(conn: Connection, token: String, uploads_dir: PathBuf) -> Self {
        AppState {
            db: Arc::new(Mutex::new(conn)),
            token,
            uploads_dir,
            bus: Arc::new(Mutex::new(HashMap::new())),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            answer_txs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn get_or_create_sender(&self, conv_id: &str) -> broadcast::Sender<String> {
        let mut bus = self.bus.lock().unwrap();
        bus.entry(conv_id.to_string())
            .or_insert_with(|| broadcast::channel(64).0)
            .clone()
    }

    /// Returns (tx, rx) for the answer channel of this conversation.
    pub fn create_answer_channel(&self, conv_id: &str) -> std::sync::mpsc::Receiver<AnswerPayload> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        self.answer_txs
            .lock()
            .unwrap()
            .insert(conv_id.to_string(), tx);
        rx
    }

    /// Send a user answer to the session waiting for it.
    pub fn send_answer(&self, conv_id: &str, answer: AnswerPayload) -> bool {
        let txs = self.answer_txs.lock().unwrap();
        match txs.get(conv_id) {
            None => {
                let registered: Vec<String> = txs.keys().cloned().collect();
                warn!(
                    conv_id = %conv_id,
                    registered = ?registered,
                    "answer_no_channel"
                );
                false
            }
            Some(tx) => match tx.try_send(answer) {
                Ok(()) => true,
                Err(e) => {
                    warn!(
                        conv_id = %conv_id,
                        reason = ?e,
                        "answer_send_failed"
                    );
                    false
                }
            },
        }
    }
}
```

- [ ] **Step 4: 运行测试**

```bash
cd cli && cargo test serve::state::tests 2>&1 | tail -10
```

期望：`2 passed`

Note: `cargo check` 可能还有其他文件因 `AppState::new` 签名变化报错，Task 3-7 会逐一修复。

- [ ] **Step 5: Commit**

```bash
git add cli/src/serve/state.rs
git commit -m "feat(cli): add SessionMessage + uploads_dir to AppState"
```

---

## Task 3: CLI — 创建 uploads 路由

**Files:**
- Create: `cli/src/serve/routes/uploads.rs`
- Modify: `cli/src/serve/routes/mod.rs`

- [ ] **Step 1: 写测试（在 uploads.rs 底部）**

先创建文件，写测试：

```rust
// cli/src/serve/routes/uploads.rs

use crate::serve::state::AppState;
use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use std::path::PathBuf;
use tracing::warn;
use uuid::Uuid;

#[derive(Serialize)]
pub struct UploadResponse {
    pub file_id: String,
}

/// POST /api/v1/uploads — accept a single image/jpeg or image/png file (≤4 MB).
/// Saves the file to `state.uploads_dir/<uuid>.<ext>` and returns the file_id.
pub async fn upload_image(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UploadResponse>), StatusCode> {
    // Read the first field
    let field = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .ok_or(StatusCode::BAD_REQUEST)?;

    let content_type = field
        .content_type()
        .unwrap_or("")
        .to_string();

    let ext = match content_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        _ => {
            warn!(content_type = %content_type, "upload_rejected_unsupported_type");
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
    };

    let data: Bytes = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;

    const MAX_BYTES: usize = 4 * 1024 * 1024; // 4 MB server-side limit
    if data.len() > MAX_BYTES {
        warn!(size = data.len(), "upload_rejected_too_large");
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let file_id = format!("{}.{}", Uuid::new_v4(), ext);
    let file_path = state.uploads_dir.join(&file_id);

    // Ensure directory exists
    std::fs::create_dir_all(&state.uploads_dir)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    std::fs::write(&file_path, &data)
        .map_err(|e| {
            warn!(error = %e, "upload_write_failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok((StatusCode::CREATED, Json(UploadResponse { file_id })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tempfile::tempdir;
    use tower::ServiceExt;

    fn make_app(uploads_dir: PathBuf) -> axum::Router {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(conn, "tok".to_string(), uploads_dir);
        axum::Router::new()
            .route("/api/v1/uploads", axum::routing::post(upload_image))
            .with_state(state)
    }

    fn jpeg_multipart_body(data: &[u8]) -> (String, Vec<u8>) {
        // Build a minimal multipart/form-data body with one JPEG field.
        let boundary = "testboundary123";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!("--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n", boundary).as_bytes()
        );
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", boundary), body)
    }

    fn png_multipart_body(data: &[u8]) -> (String, Vec<u8>) {
        let boundary = "testboundary456";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!("--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.png\"\r\nContent-Type: image/png\r\n\r\n", boundary).as_bytes()
        );
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", boundary), body)
    }

    /// JPEG アップロードが 201 を返し、uploads_dir にファイルが書き込まれること。
    ///
    /// 実行過程：
    ///   1. 4バイトのダミー JPEG データで multipart リクエストを構築
    ///   2. POST /api/v1/uploads に送信
    ///   3. レスポンスと uploads_dir のファイル存在を検証
    ///
    /// 期待結果：
    ///   - status == 201
    ///   - JSON に file_id が含まれ、.jpg で終わる
    ///   - uploads_dir/<file_id> のファイルが存在する
    #[tokio::test]
    async fn test_upload_jpeg_returns_201_and_writes_file() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let (ct, body) = jpeg_multipart_body(b"\xff\xd8\xff\xe0");

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED, "JPEG upload should return 201");

        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let file_id = json["file_id"].as_str().expect("file_id should be a string");
        assert!(file_id.ends_with(".jpg"), "file_id should end with .jpg, got: {}", file_id);

        let file_path = upload_dir.path().join(file_id);
        assert!(file_path.exists(), "uploaded file should exist at {}", file_path.display());
    }

    /// PNG アップロードが 201 を返すこと。
    ///
    /// 期待結果：
    ///   - status == 201
    ///   - file_id が .png で終わる
    #[tokio::test]
    async fn test_upload_png_returns_201() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let (ct, body) = png_multipart_body(b"\x89PNG\r\n");

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED, "PNG upload should return 201");
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            json["file_id"].as_str().unwrap_or("").ends_with(".png"),
            "file_id should end with .png"
        );
    }

    /// 5MB のボディは 413 を返すこと。
    ///
    /// 期待結果：
    ///   - status == 413
    #[tokio::test]
    async fn test_upload_too_large_returns_413() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let big_data = vec![0u8; 5 * 1024 * 1024]; // 5 MB
        let (ct, body) = jpeg_multipart_body(&big_data);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::PAYLOAD_TOO_LARGE,
            "files >4 MB should return 413"
        );
    }

    /// image/gif は 415 を返すこと。
    ///
    /// 期待結果：
    ///   - status == 415
    #[tokio::test]
    async fn test_upload_wrong_type_returns_415() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let boundary = "testboundary789";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!("--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.gif\"\r\nContent-Type: image/gif\r\n\r\nGIF89a\r\n--{}--\r\n", boundary, boundary).as_bytes()
        );
        let ct = format!("multipart/form-data; boundary={}", boundary);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "non JPEG/PNG should return 415"
        );
    }
}
```

- [ ] **Step 2: 加 `pub mod uploads;` 到 routes/mod.rs**

```rust
// cli/src/serve/routes/mod.rs
pub mod agents;
pub mod conversations;
pub mod healthz;
pub mod messages;
pub mod push_tokens;
pub mod uploads;
pub mod ws;
```

- [ ] **Step 3: 运行测试确认 fail**

```bash
cd cli && cargo test serve::routes::uploads::tests 2>&1 | tail -15
```

期望：编译通过（uploads.rs 存在），但由于 `AppState::new` 签名变化可能有编译错误。先修复编译错误，再看测试。

- [ ] **Step 4: 运行测试确认 pass**

```bash
cd cli && cargo test serve::routes::uploads::tests 2>&1 | tail -20
```

期望：`4 passed`

- [ ] **Step 5: Commit**

```bash
git add cli/src/serve/routes/uploads.rs cli/src/serve/routes/mod.rs
git commit -m "feat(cli): add POST /api/v1/uploads multipart endpoint"
```

---

## Task 4: CLI — 注册路由 + 修复 AppState::new 调用

**Files:**
- Modify: `cli/src/serve/mod.rs`
- Modify: `cli/src/serve/auth.rs` (tests 中的 `AppState::new`)

这个 task 让整个 CLI 再次编译通过。

- [ ] **Step 1: 找所有 AppState::new 调用**

```bash
cd cli && grep -rn "AppState::new" src/
```

期望输出示例：
```
src/serve/state.rs:...       (tests)
src/serve/auth.rs:...        (tests)
src/serve/routes/uploads.rs:... (tests)
src/commands/serve.rs:...    (main call)
```

- [ ] **Step 2: 修复 auth.rs 中的测试 AppState::new 调用**

在 `auth.rs` 的 `make_app` 函数，将：
```rust
let state = AppState::new(conn, token.to_string());
```
改为：
```rust
let state = AppState::new(conn, token.to_string(), dir.path().join("uploads"));
```

- [ ] **Step 3: 修复 serve 命令中的 AppState::new 调用**

在 `cli/src/commands/serve.rs`（或 `main.rs`，按实际路径）找到 `AppState::new` 调用，添加 `uploads_dir` 参数：

```rust
// 找到类似：
// let state = AppState::new(conn, token.clone());
// 改为：
let config_dir = dirs::config_dir()
    .unwrap_or_else(|| std::path::PathBuf::from("."))
    .join("msctl");
let uploads_dir = config_dir.join("uploads");
std::fs::create_dir_all(&uploads_dir).ok();
let state = AppState::new(conn, token.clone(), uploads_dir);
```

- [ ] **Step 4: 在 serve/mod.rs 中注册 uploads 路由**

在 `build_router` 函数中，在现有路由之后添加（在 `.layer(...)` 之前）：

```rust
.route(
    "/api/v1/uploads",
    axum::routing::post(uploads::upload_image),
)
```

完整 `build_router` 函数后，`use routes::*;` 已经 glob-imports `uploads`。

- [ ] **Step 5: 验证编译通过**

```bash
cd cli && cargo build 2>&1 | tail -10
```

期望：`Finished dev ...`（无错误）

- [ ] **Step 6: Commit**

```bash
git add cli/src/serve/mod.rs cli/src/serve/auth.rs
git add -p  # 选择 serve.rs/main.rs 中的相关修改
git commit -m "feat(cli): register uploads route and fix AppState::new callers"
```

---

## Task 5: CLI — claude.rs 更新 session channel + write_user_message_with_image

**Files:**
- Modify: `cli/src/serve/runtime/claude.rs`

这是核心 runtime 修改：接收 `SessionMessage`（含 `file_id`）并以正确格式发给 Claude。

- [ ] **Step 1: 写测试**

在 `claude.rs` 底部的 `#[cfg(test)]` 块里添加（替换现有 tests 块）：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tempfile::tempdir;

    /// 检测 stale session 错误（已有测试，保留）
    #[test]
    fn detects_claude_stale_resume_session_error() {
        let raw = serde_json::json!({
            "type": "result",
            "subtype": "error_during_execution",
            "is_error": true,
            "errors": ["No conversation found with session ID: 382eb2d5-0809-4899-83ec-bcde02c4b62b"]
        });
        assert!(is_stale_session_error(&raw));
    }

    /// write_user_message 写入正确的 stream-json 格式（纯文本）。
    ///
    /// 数据构造：
    ///   user_text = "hello"
    ///
    /// 执行过程：
    ///   1. 用 Cursor<Vec<u8>> 替代 ChildStdin 作为 sink
    ///   2. 调用 write_user_message
    ///   3. 解析写入的 JSON，验证结构
    ///
    /// 预期结果：
    ///   - type == "user"
    ///   - message.role == "user"
    ///   - content[0].type == "text"
    ///   - content[0].text == "hello"
    #[test]
    fn test_write_user_message_text_format() {
        let mut buf = Cursor::new(Vec::<u8>::new());
        write_user_message(&mut buf, "hello").unwrap();
        let written = String::from_utf8(buf.into_inner()).unwrap();
        let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();
        assert_eq!(json["type"].as_str(), Some("user"), "type should be 'user'");
        assert_eq!(
            json["message"]["role"].as_str(),
            Some("user"),
            "role should be 'user'"
        );
        let content = &json["message"]["content"][0];
        assert_eq!(content["type"].as_str(), Some("text"), "content type should be 'text'");
        assert_eq!(content["text"].as_str(), Some("hello"), "text should be 'hello'");
    }

    /// write_user_message_with_image 写入图片 + 文本 content blocks。
    ///
    /// 数据构造：
    ///   file_path = 临时 JPEG 文件（内容 b"fake_jpeg"）
    ///   user_text = "look at this"
    ///
    /// 执行过程：
    ///   1. 创建临时文件，写入 fake_jpeg 字节
    ///   2. 调用 write_user_message_with_image
    ///   3. 解析 JSON，验证 content array
    ///
    /// 预期结果：
    ///   - content[0].type == "image"
    ///   - content[0].source.type == "base64"
    ///   - content[0].source.media_type == "image/jpeg"
    ///   - content[0].source.data == base64("fake_jpeg")
    ///   - content[1].type == "text"
    ///   - content[1].text == "look at this"
    #[test]
    fn test_write_user_message_with_image_format() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.jpg");
        std::fs::write(&file_path, b"fake_jpeg").unwrap();

        let mut buf = Cursor::new(Vec::<u8>::new());
        write_user_message_with_image(&mut buf, "look at this", &file_path).unwrap();

        let written = String::from_utf8(buf.into_inner()).unwrap();
        let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();

        let content = &json["message"]["content"];
        assert_eq!(content.as_array().map(|a| a.len()), Some(2), "should have 2 content blocks");

        // Image block
        let img = &content[0];
        assert_eq!(img["type"].as_str(), Some("image"), "first block should be image");
        assert_eq!(img["source"]["type"].as_str(), Some("base64"), "source type should be base64");
        assert_eq!(
            img["source"]["media_type"].as_str(),
            Some("image/jpeg"),
            "media_type should be image/jpeg"
        );
        let expected_b64 = STANDARD.encode(b"fake_jpeg");
        assert_eq!(
            img["source"]["data"].as_str(),
            Some(expected_b64.as_str()),
            "base64 data should match"
        );

        // Text block
        let txt = &content[1];
        assert_eq!(txt["type"].as_str(), Some("text"), "second block should be text");
        assert_eq!(txt["text"].as_str(), Some("look at this"), "text should match");
    }

    /// write_user_message_with_image で text が空でも image block だけ送信できること。
    ///
    /// 期待結果：
    ///   - content array に image block のみ（len == 1）
    #[test]
    fn test_write_user_message_with_image_no_text() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("test.png");
        std::fs::write(&file_path, b"fake_png").unwrap();

        let mut buf = Cursor::new(Vec::<u8>::new());
        write_user_message_with_image(&mut buf, "", &file_path).unwrap();

        let written = String::from_utf8(buf.into_inner()).unwrap();
        let json: serde_json::Value = serde_json::from_str(written.trim()).unwrap();
        let content = json["message"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 1, "should have only image block when text is empty");
        assert_eq!(content[0]["type"].as_str(), Some("image"), "block should be image type");
        assert_eq!(
            content[0]["source"]["media_type"].as_str(),
            Some("image/png"),
            "png file should have image/png media_type"
        );
    }
}
```

- [ ] **Step 2: 运行确认 fail**

```bash
cd cli && cargo test serve::runtime::claude::tests 2>&1 | tail -15
```

期望：`write_user_message_with_image not found` 等编译错误。

- [ ] **Step 3: 更新 claude.rs**

在 `claude.rs` 中做以下修改：

**3a. 顶部添加 import：**
```rust
use base64::{engine::general_purpose::STANDARD, Engine};
use std::path::Path;
```

**3b. 将 `send_to_session` 签名改为接受 `SessionMessage`：**

```rust
use crate::serve::state::{AppState, SessionMessage};
```

将 `send_to_session` 函数改为：
```rust
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    project_path: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        let msg = SessionMessage {
            user_text: user_text.to_string(),
            file_id: file_id.map(str::to_string),
        };
        if tx.send(msg).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    let (tx, rx) = std::sync::mpsc::channel::<SessionMessage>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions);

    let msg = SessionMessage {
        user_text: user_text.to_string(),
        file_id: file_id.map(str::to_string),
    };
    let _ = tx.send(msg);

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path = project_path.to_string();
    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path, rx);
    });
}
```

**3c. 更新 `session_worker` 接收 `SessionMessage`：**

```rust
fn session_worker(
    state: AppState,
    conv_id: String,
    project_path: String,
    rx: std::sync::mpsc::Receiver<SessionMessage>,
) {
    // ... 现有代码不变，只修改 rx.recv() 处 ...
    loop {
        let msg = match rx.recv() {
            Ok(m) => m,
            Err(_) => {
                info!("session_channel_closed_shutting_down");
                let _ = child.kill();
                return;
            }
        };
        let text_preview = logging::truncate(&msg.user_text, 200);
        info!(
            user_text_len = msg.user_text.chars().count(),
            user_text_preview = %text_preview,
            file_id = ?msg.file_id,
            "turn_start"
        );

        let uploads_dir = state.uploads_dir.clone();
        let file_id_ref = msg.file_id.as_deref();

        let mut ok = false;
        for attempt in 1..=3 {
            match process_turn(
                &mut stdin,
                &mut reader,
                &state,
                &conv_id,
                &msg.user_text,
                file_id_ref,
                &uploads_dir,
                &answer_rx,
            ) {
                Ok(()) => {
                    ok = true;
                    // Cleanup temp file after successful turn
                    if let Some(fid) = &msg.file_id {
                        let path = uploads_dir.join(fid);
                        if let Err(e) = std::fs::remove_file(&path) {
                            warn!(path = %path.display(), error = %e, "upload_cleanup_failed");
                        }
                    }
                    info!(attempt, "turn_end");
                    break;
                }
                Err(e) => {
                    // ... 现有重试逻辑不变 ...
                }
            }
        }
        // ...
    }
}
```

**3d. 将 `write_user_message` 改为接受 `impl Write`：**

```rust
pub(super) fn write_user_message(sink: &mut impl Write, user_text: &str) -> Result<(), String> {
    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": user_text }] }
    });
    let line = format!("{}\n", msg);
    sink.write_all(line.as_bytes())
        .map_err(|e| format!("stdin write: {}", e))?;
    sink.flush()
        .map_err(|e| format!("stdin flush (user_message): {}", e))
}
```

**3e. 添加 `write_user_message_with_image`：**

```rust
/// Write a user message with an image content block (and optional text) to Claude's stdin.
/// The image is read from `file_path`, base64-encoded, and media_type derived from extension.
/// If `user_text` is non-empty, a text block is appended after the image block.
pub(super) fn write_user_message_with_image(
    sink: &mut impl Write,
    user_text: &str,
    file_path: &Path,
) -> Result<(), String> {
    let media_type = match file_path.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        other => return Err(format!("unsupported image extension: {:?}", other)),
    };

    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("read image file {}: {}", file_path.display(), e))?;
    let data_b64 = STANDARD.encode(&bytes);

    let mut content = vec![serde_json::json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media_type,
            "data": data_b64,
        }
    })];

    if !user_text.is_empty() {
        content.push(serde_json::json!({ "type": "text", "text": user_text }));
    }

    let msg = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": content }
    });
    let line = format!("{}\n", msg);
    sink.write_all(line.as_bytes())
        .map_err(|e| format!("stdin write (image): {}", e))?;
    sink.flush()
        .map_err(|e| format!("stdin flush (image): {}", e))
}
```

- [ ] **Step 4: 运行测试**

```bash
cd cli && cargo test serve::runtime::claude::tests 2>&1 | tail -15
```

期望：`4 passed`（含原有的 stale session 测试）

- [ ] **Step 5: Commit**

```bash
git add cli/src/serve/runtime/claude.rs
git commit -m "feat(cli): add SessionMessage channel + write_user_message_with_image"
```

---

## Task 6: CLI — claude_stream.rs + codex.rs + messages.rs + runtime/mod.rs 更新

**Files:**
- Modify: `cli/src/serve/runtime/claude_stream.rs`
- Modify: `cli/src/serve/runtime/codex.rs`
- Modify: `cli/src/serve/runtime/mod.rs`
- Modify: `cli/src/serve/routes/messages.rs`

将 `file_id` 参数串联完整链路。

- [ ] **Step 1: 更新 claude_stream.rs::process_turn 签名**

在 `process_turn` 函数中添加 `file_id: Option<&str>` 和 `uploads_dir: &std::path::Path` 参数，并在写用户消息时按需选择：

```rust
pub(super) fn process_turn(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<std::process::ChildStdout>,
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    uploads_dir: &std::path::Path,
    answer_rx: &std::sync::mpsc::Receiver<AnswerPayload>,
) -> Result<(), String> {
    // Update conversation status → running
    {
        let db = state.db.lock().unwrap();
        let _ = db.execute(
            "UPDATE conversations SET status = 'running' WHERE id = ?1",
            [conv_id],
        );
    }

    // Write user message — with image if file_id is provided
    match file_id {
        Some(fid) => {
            let file_path = uploads_dir.join(fid);
            write_user_message_with_image(stdin, user_text, &file_path)?;
        }
        None => {
            write_user_message(stdin, user_text)?;
        }
    }
    debug!("claude_user_message_written");

    // ... 其余代码不变 ...
}
```

- [ ] **Step 2: 更新 codex.rs — 使用 SessionMessage channel，忽略 file_id**

在 `codex.rs` 中：

**2a. 在文件顶部加 import：**
```rust
use crate::serve::state::SessionMessage;
```

**2b. 将 `send_to_session` 中的 channel 类型改为 `SessionMessage`：**
```rust
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    project_path: &str,
    mode: &str,
) {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(tx) = sessions.get(conv_id) {
        let msg = SessionMessage { user_text: user_text.to_string(), file_id: None };
        if tx.send(msg).is_ok() {
            debug!(conv_id = %conv_id, "runtime_message_queued");
            return;
        }
        warn!(conv_id = %conv_id, "runtime_channel_broken_respawning");
    }

    let (tx, rx) = std::sync::mpsc::channel::<SessionMessage>();
    sessions.insert(conv_id.to_string(), tx.clone());
    drop(sessions);

    let msg = SessionMessage { user_text: user_text.to_string(), file_id: None };
    let _ = tx.send(msg);

    let state2 = state.clone();
    let conv_id2 = conv_id.to_string();
    let project_path2 = project_path.to_string();
    let mode2 = mode.to_string();

    tokio::task::spawn_blocking(move || {
        session_worker(state2, conv_id2, project_path2, mode2, rx);
    });
}
```

**2c. 更新 `session_worker` 接收 `SessionMessage`（只用 user_text）：**

将 `rx: std::sync::mpsc::Receiver<String>` 改为 `rx: std::sync::mpsc::Receiver<SessionMessage>`，并将 `rx.recv()` 得到的值用 `.user_text` 获取文本内容。

- [ ] **Step 3: 更新 runtime/mod.rs — 传递 file_id**

```rust
pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    user_text: &str,
    file_id: Option<&str>,
    project_path: &str,
    runtime: &str,
    mode: &str,
) {
    match runtime {
        "codex" => codex::send_to_session(state, conv_id, user_text, project_path, mode),
        _ => claude::send_to_session(state, conv_id, user_text, file_id, project_path),
    }
}
```

- [ ] **Step 4: 更新 messages.rs — PostMessageBody 加 file_id**

```rust
#[derive(Deserialize)]
pub struct PostMessageBody {
    pub text: String,
    pub file_id: Option<String>,
}
```

在 `post_message` 函数中，将 `runtime::send_to_session` 调用改为：

```rust
if let Some((path, rt, mode)) = agent_info {
    runtime::send_to_session(
        &state,
        &conv_id,
        &body.text,
        body.file_id.as_deref(),
        &path,
        &rt,
        &mode,
    );
}
```

同时将 payload 改为包含 `file_id`（如有）：

```rust
let payload = if let Some(ref fid) = body.file_id {
    serde_json::json!({ "text": body.text, "file_id": fid })
} else {
    serde_json::json!({ "text": body.text })
};
```

- [ ] **Step 5: 编译 + 全量测试**

```bash
cd cli && cargo build 2>&1 | tail -10 && cargo test 2>&1 | tail -20
```

期望：编译成功，所有现有测试通过，新测试通过。

- [ ] **Step 6: Commit**

```bash
git add cli/src/serve/runtime/claude_stream.rs \
        cli/src/serve/runtime/codex.rs \
        cli/src/serve/runtime/mod.rs \
        cli/src/serve/routes/messages.rs
git commit -m "feat(cli): wire file_id through message routing to Claude runtime"
```

---

## Task 7: Mobile — 安装包 + 更新类型

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/src/types.ts`

- [ ] **Step 1: 安装 expo 图片相关包**

```bash
cd mobile && pnpm add expo-image-picker expo-image-manipulator
```

期望：`dependencies` 中出现两个新包。

- [ ] **Step 2: 更新 UserTextPayload 类型**

在 `mobile/src/types.ts` 中，将：
```ts
export interface UserTextPayload {
  text: string;
}
```
改为：
```ts
export interface UserTextPayload {
  text: string;
  file_id?: string;
}
```

- [ ] **Step 3: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -10
```

期望：`Found 0 errors.`

- [ ] **Step 4: Commit**

```bash
git add mobile/package.json mobile/pnpm-lock.yaml mobile/src/types.ts
git commit -m "feat(mobile): add expo-image-picker/manipulator deps; extend UserTextPayload"
```

---

## Task 8: Mobile — chatService 添加 uploadImage + 扩展 postMessage

**Files:**
- Modify: `mobile/src/features/chat/services/chatService.ts`

- [ ] **Step 1: 写测试**

在 `mobile/src/features/chat/services/` 目录新建 `chatService.test.ts`：

```ts
import { uploadImage, postMessage } from './chatService';

// Mock axios client
jest.mock('@/api/endpointClient', () => ({
  getEndpointClient: () => ({
    post: jest.fn(),
  }),
}));

describe('chatService', () => {
  describe('postMessage', () => {
    it('sends text-only payload when no file_id provided', async () => {
      const { getEndpointClient } = require('@/api/endpointClient');
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      getEndpointClient.mockReturnValue({ post: mockPost });

      await postMessage('http://localhost', 'tok', 'conv1', 'hello');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/conversations/conv1/messages',
        { text: 'hello' },
      );
    });

    it('includes file_id when provided', async () => {
      const { getEndpointClient } = require('@/api/endpointClient');
      const mockPost = jest.fn().mockResolvedValue({ data: {} });
      getEndpointClient.mockReturnValue({ post: mockPost });

      await postMessage('http://localhost', 'tok', 'conv1', 'check this', 'abc.jpg');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/conversations/conv1/messages',
        { text: 'check this', file_id: 'abc.jpg' },
      );
    });
  });
});
```

- [ ] **Step 2: 运行确认 fail**

```bash
cd mobile && pnpm test -- --testPathPattern="chatService.test" --watchAll=false 2>&1 | tail -15
```

期望：`postMessage` 测试 pass（现有逻辑），`file_id` 测试 fail（未支持）。

- [ ] **Step 3: 实现 uploadImage + 扩展 postMessage**

修改 `chatService.ts`：

```ts
import { getEndpointClient } from '@/api/endpointClient';
import { type Conversation, type WsMessage } from '@/types';
import FormData from 'form-data'; // React Native 环境中 FormData 是全局可用的

// ... 保留现有 fetchConversations, createConversation, fetchMessages 不变 ...

export async function uploadImage(
  base_url: string,
  token: string,
  localUri: string,
): Promise<{ file_id: string }> {
  const client = getEndpointClient(base_url, token);

  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    type: 'image/jpeg',
    name: 'upload.jpg',
  } as unknown as Blob);

  const res = await client.post<{ file_id: string }>('/api/v1/uploads', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function postMessage(
  base_url: string,
  token: string,
  conv_id: string,
  text: string,
  file_id?: string,
): Promise<void> {
  const client = getEndpointClient(base_url, token);
  const body: { text: string; file_id?: string } = { text };
  if (file_id) body.file_id = file_id;
  await client.post(`/api/v1/conversations/${conv_id}/messages`, body);
}

// ... 保留现有 sendConversationAnswer, deleteConversation 不变 ...
```

- [ ] **Step 4: 运行测试**

```bash
cd mobile && pnpm test -- --testPathPattern="chatService.test" --watchAll=false 2>&1 | tail -10
```

期望：`2 passed`

- [ ] **Step 5: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

期望：`Found 0 errors.`

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/chat/services/chatService.ts \
        mobile/src/features/chat/services/chatService.test.ts
git commit -m "feat(mobile): add uploadImage() and extend postMessage() with file_id"
```

---

## Task 9: Mobile — chat.tsx 图片选择 + 上传 + 发送流程

**Files:**
- Modify: `mobile/app/agent/[id]/chat.tsx`

- [ ] **Step 1: 在文件顶部添加 imports**

```tsx
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image, Modal, TouchableWithoutFeedback } from 'react-native';
import { ImageIcon, X } from 'lucide-react-native';
import { uploadImage } from '../../../src/features/chat/services/chatService';
```

- [ ] **Step 2: 添加 pending image 状态和 fileId map**

在 `AgentChatRoute` 函数体内（现有 `useState` 声明之后）添加：

```tsx
const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
// file_id → localUri 映射（仅本 session，丢图后显示附件占位符）
const imageMapRef = useRef<Map<string, string>>(new Map());
const [isUploading, setIsUploading] = useState(false);
```

- [ ] **Step 3: 添加 pickImage 函数**

在 `handleSend` 之前添加：

```tsx
async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled || !result.assets[0]) return;

  const asset = result.assets[0];
  // Compress to ≤2 MB JPEG
  const compressed = await ImageManipulator.manipulateAsync(
    asset.uri,
    [],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
  );
  setPendingImageUri(compressed.uri);
}
```

- [ ] **Step 4: 更新 handleSend 以包含图片上传**

将现有 `handleSend` 替换为：

```tsx
const handleSend = async () => {
  const text = input.trim();
  if ((!text && !pendingImageUri) || !endpoint || !convId) return;
  lastSeenAgentActivitySeqRef.current = getLatestAgentActivitySeq(displayMessages);
  lastAnimatedAgentTextSeqRef.current = getLatestAgentTextSeq(displayMessages);
  hasLoadedInitialMessagesRef.current = true;
  setInput('');
  setIsAwaitingResponse(true);
  setTypewriterSeq(null);

  let file_id: string | undefined;
  const capturedUri = pendingImageUri;
  setPendingImageUri(null);

  try {
    if (capturedUri) {
      setIsUploading(true);
      const result = await uploadImage(endpoint.base_url, endpoint.token, capturedUri);
      file_id = result.file_id;
      imageMapRef.current.set(file_id, capturedUri);
      setIsUploading(false);
    }
    await postMessage(endpoint.base_url, endpoint.token, convId, text, file_id);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  } catch {
    setIsUploading(false);
    setIsAwaitingResponse(false);
  }
};
```

- [ ] **Step 5: 在输入栏添加图片按钮 + 待发预览**

在 `<View style={s.inputBar}>` 内的 `TextInput` 之前添加：

```tsx
{/* Pending image preview above input bar */}
{pendingImageUri && (
  <View style={s.pendingImageWrap}>
    <Image source={{ uri: pendingImageUri }} style={s.pendingThumb} />
    <Pressable style={s.pendingRemove} onPress={() => setPendingImageUri(null)}>
      <X size={12} color="#040D04" />
    </Pressable>
  </View>
)}
```

在 `TextInput` 之前，输入栏添加图片按钮：

```tsx
<TouchableOpacity
  onPress={() => { void pickImage(); }}
  disabled={composerDisabled || isUploading}
  style={s.imageBtn}
>
  <ImageIcon size={16} color={composerDisabled ? '#2D8B2D' : '#20C20E'} />
</TouchableOpacity>
```

- [ ] **Step 6: 添加 styles**

在 `StyleSheet.create` 中添加：

```tsx
pendingImageWrap: {
  position: 'absolute',
  bottom: '100%',
  left: 12,
  marginBottom: 4,
},
pendingThumb: {
  width: 60,
  height: 60,
  borderRadius: 2,
  borderWidth: 1,
  borderColor: '#0F2B0F',
},
pendingRemove: {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  borderRadius: 8,
  backgroundColor: '#20C20E',
  alignItems: 'center',
  justifyContent: 'center',
},
imageBtn: {
  width: 36,
  height: 36,
  alignItems: 'center',
  justifyContent: 'center',
},
```

- [ ] **Step 7: 同时将 imageMapRef 传给 MessageBubble（通过内联属性）**

在 `<MessageBubble>` 的渲染处添加 `imageUri` prop：

```tsx
{displayMessages.map((msg) => (
  <MessageBubble
    key={`${msg.seq}`}
    msg={msg}
    typewriter={msg.seq === activeTypewriterSeq}
    onAnswer={sendAnswer}
    onAnswerMulti={sendAnswerMulti}
    imageUri={
      msg.role === 'user_text' && (msg.payload as { file_id?: string }).file_id
        ? imageMapRef.current.get((msg.payload as { file_id?: string }).file_id!)
        : undefined
    }
  />
))}
```

- [ ] **Step 8: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -10
```

期望：`Found 0 errors.`（MessageBubble 还不接受 imageUri prop，会报错 — 先留着，Task 10 修复）

- [ ] **Step 9: Commit（先不 typecheck 通过，Task 10 后再做最终验证）**

```bash
git add mobile/app/agent/[id]/chat.tsx
git commit -m "feat(mobile): add image picker and upload flow to chat screen"
```

---

## Task 10: Mobile — MessageBubble 图片缩略图渲染

**Files:**
- Modify: `mobile/src/features/chat/components/MessageBubble.tsx`

- [ ] **Step 1: 写测试**

在 `MessageBubble.test.tsx` 中添加：

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MessageBubble } from './MessageBubble';
import type { WsMessage } from '@/types';

// --- 现有测试保持不变 ---

describe('MessageBubble image rendering', () => {
  const makeMsg = (payload: object, role = 'user_text'): WsMessage => ({
    type: 'message',
    seq: 1,
    role: role as WsMessage['role'],
    payload: payload as WsMessage['payload'],
    created_at: 0,
  });

  it('renders image thumbnail when localImageUri is provided', () => {
    const msg = makeMsg({ text: '', file_id: 'abc.jpg' });
    render(<MessageBubble msg={msg} imageUri="file:///local/photo.jpg" />);
    expect(screen.getByTestId('user-image-thumb')).toBeTruthy();
  });

  it('renders attachment placeholder when file_id present but no imageUri', () => {
    const msg = makeMsg({ text: '', file_id: 'abc.jpg' });
    render(<MessageBubble msg={msg} />);
    expect(screen.getByText('📎 Image')).toBeTruthy();
  });

  it('renders plain text bubble when no file_id', () => {
    const msg = makeMsg({ text: 'hello' });
    render(<MessageBubble msg={msg} />);
    expect(screen.getByText('hello')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认 fail**

```bash
cd mobile && pnpm test -- --testPathPattern="MessageBubble.test" --watchAll=false 2>&1 | tail -15
```

期望：`imageUri` prop 不存在，测试编译 fail。

- [ ] **Step 3: 更新 MessageBubble.tsx**

**3a. 修改 Props 接口：**

```tsx
interface Props {
  msg: WsMessage;
  onAnswer?: (ask_id: string, choice_id?: string, freeform?: string) => void;
  onAnswerMulti?: (ask_id: string, choice_ids: Record<string, string>) => void;
  typewriter?: boolean;
  waiting?: boolean;
  imageUri?: string;       // 本地图片 URI（仅当前 session 有效）
}
```

**3b. 在 import 中添加：**

```tsx
import { Image, Modal, Pressable } from 'react-native';
```

**3c. 在组件函数体内添加全屏预览 state：**

```tsx
const [previewVisible, setPreviewVisible] = useState(false);
```

**3d. 更新 `user_text` case：**

```tsx
case 'user_text': {
  const payload = msg.payload as UserTextPayload;
  const hasImage = !!payload.file_id;

  return (
    <View style={s.userWrap}>
      {/* 全屏预览 Modal */}
      {hasImage && imageUri && (
        <Modal visible={previewVisible} transparent animationType="fade">
          <Pressable
            style={s.modalOverlay}
            onPress={() => setPreviewVisible(false)}
          >
            <Image
              source={{ uri: imageUri }}
              style={s.previewImage}
              resizeMode="contain"
            />
          </Pressable>
        </Modal>
      )}

      <View style={s.userBubble}>
        {/* 图片区域 */}
        {hasImage && (
          imageUri ? (
            <Pressable onPress={() => setPreviewVisible(true)}>
              <Image
                testID="user-image-thumb"
                source={{ uri: imageUri }}
                style={s.thumbImage}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <Text style={s.attachmentPlaceholder}>📎 Image</Text>
          )
        )}
        {/* 文本区域（如有） */}
        {payload.text ? (
          <Text style={[s.userText, hasImage && s.imageCaption]}>
            {payload.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
```

**3e. 添加 styles：**

```tsx
thumbImage: {
  width: 120,
  height: 120,
  borderRadius: 2,
  marginBottom: 4,
},
attachmentPlaceholder: {
  fontFamily: 'Geist',
  fontSize: 12,
  color: '#040D04',
  marginBottom: 4,
},
imageCaption: {
  marginTop: 4,
},
modalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.9)',
  alignItems: 'center',
  justifyContent: 'center',
},
previewImage: {
  width: '100%',
  height: '80%',
},
```

- [ ] **Step 4: 运行测试**

```bash
cd mobile && pnpm test -- --testPathPattern="MessageBubble.test" --watchAll=false 2>&1 | tail -15
```

期望：`3 passed`（新增 3 个），现有测试继续通过。

- [ ] **Step 5: typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

期望：`Found 0 errors.`

- [ ] **Step 6: Commit**

```bash
git add mobile/src/features/chat/components/MessageBubble.tsx \
        mobile/src/features/chat/components/MessageBubble.test.tsx
git commit -m "feat(mobile): render image thumbnail in user_text message bubble"
```

---

## Task 11: 全量验证

- [ ] **Step 1: CLI 全量测试**

```bash
cd cli && cargo test 2>&1 | tail -20
```

期望：所有测试通过，`0 failed`。

- [ ] **Step 2: CLI 编译**

```bash
cd cli && cargo build 2>&1 | tail -5
```

期望：`Finished dev ...`

- [ ] **Step 3: Mobile typecheck**

```bash
cd mobile && pnpm typecheck 2>&1 | tail -5
```

期望：`Found 0 errors.`

- [ ] **Step 4: Mobile 全量测试**

```bash
cd mobile && pnpm test -- --watchAll=false 2>&1 | tail -20
```

期望：所有测试通过，`0 failed`。

- [ ] **Step 5: 端到端冒烟测试（可选但推荐）**

1. 启动 `msctl serve`
2. 打开手机 app，进入 agent 对话
3. 点击图片按钮，选择一张截图
4. 发送
5. 确认 Claude 回复中提到了图片内容
6. 检查 `~/.config/msctl/uploads/` 目录：turn 结束后文件已被清理

---

## 已知风险（执行前确认）

> **重要：** Claude CLI `--input-format stream-json` 接受 image content block 是合理假设，但需要在 Task 5 完成后、Task 11 前用真实 Claude 进程做一次 spike 验证：
>
> ```bash
> echo '{"type":"user","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"<tiny-b64>"}},{"type":"text","text":"what is this?"}]}}' | claude --output-format stream-json --input-format stream-json --print
> ```
>
> 若 Claude CLI 不支持，需要改为先将图片保存到 project_path 下的临时文件，并在发给 Claude 的文本消息里说明文件路径（纯文本回退方案）。
