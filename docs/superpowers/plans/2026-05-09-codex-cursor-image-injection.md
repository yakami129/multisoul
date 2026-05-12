# Codex / Cursor-CLI 图片路径注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当用户向 codex 或 cursor-cli runtime 发送带图片的消息时，将图片绝对路径注入到 prompt 文本前缀，让 agent 自行用文件读取工具查看图片。

**Architecture:** 在 `runtime/mod.rs` 的 dispatch 层新增 `inject_image_prefix` 辅助函数，在转发给 codex/cursor-cli 之前将 `file_id` 解析为绝对路径并拼入 prompt。codex 和 cursor-cli 的 `send_to_session` 签名保持不变，claude 路径完全不动。

**Tech Stack:** Rust, `std::path::Path`, `std::path::PathBuf`

---

### Task 1: 在 `runtime/mod.rs` 新增 `inject_image_prefix` 并更新 dispatch

**Files:**
- Modify: `cli/src/serve/runtime/mod.rs`

- [ ] **Step 1: 读当前文件内容**

确认当前 `mod.rs` 内容（已在上下文中，无需重读）：

```rust
// 当前内容（完整）：
mod claude;
pub mod codex;
mod cursor;

use crate::serve::state::AppState;

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
        "cursor-cli" => cursor::send_to_session(state, conv_id, user_text, project_path, mode),
        _ => claude::send_to_session(state, conv_id, user_text, file_id, project_path),
    }
}
```

- [ ] **Step 2: 写失败测试**

在 `cli/src/serve/runtime/mod.rs` 末尾追加测试模块：

```rust
#[cfg(test)]
mod tests {
    use super::inject_image_prefix;
    use std::path::Path;

    /// inject_image_prefix: file_id 存在时，在 user_text 前注入图片路径提示。
    ///
    /// 数据构造：
    ///   uploads_dir = /tmp/uploads
    ///   file_id     = abc.jpg
    ///   user_text   = "请分析这张图"
    ///
    /// 执行过程：
    ///   1. 调用 inject_image_prefix("请分析这张图", "abc.jpg", Path::new("/tmp/uploads"))
    ///   2. 检查返回值包含绝对路径前缀
    ///
    /// 预期结果：
    ///   - 返回值以 "[Attached image: /tmp/uploads/abc.jpg" 开头
    ///   - 返回值包含 "use your file reading tool to view it"
    ///   - 返回值包含原始 user_text
    #[test]
    fn test_inject_image_prefix_with_file_id() {
        let result = inject_image_prefix(
            "请分析这张图",
            "abc.jpg",
            Path::new("/tmp/uploads"),
        );
        assert!(
            result.starts_with("[Attached image: /tmp/uploads/abc.jpg"),
            "should start with absolute image path: got {:?}",
            result
        );
        assert!(
            result.contains("use your file reading tool to view it"),
            "should contain instruction for agent: got {:?}",
            result
        );
        assert!(
            result.contains("请分析这张图"),
            "should contain original user_text: got {:?}",
            result
        );
    }

    /// inject_image_prefix: user_text 为空时，仍然正确注入路径前缀。
    ///
    /// 预期结果：
    ///   - 返回值包含路径前缀
    ///   - 不崩溃
    #[test]
    fn test_inject_image_prefix_empty_user_text() {
        let result = inject_image_prefix("", "img.png", Path::new("/uploads"));
        assert!(
            result.contains("[Attached image: /uploads/img.png"),
            "should contain path even with empty user_text: got {:?}",
            result
        );
    }
}
```

- [ ] **Step 3: 运行测试，确认失败**

```bash
cd cli && cargo test inject_image_prefix 2>&1 | head -30
```

预期：编译错误 `cannot find function inject_image_prefix`

- [ ] **Step 4: 实现 `inject_image_prefix` 并更新 dispatch**

将 `cli/src/serve/runtime/mod.rs` 完整替换为：

```rust
mod claude;
pub mod codex;
mod cursor;

use crate::serve::state::AppState;

/// Dispatch a user message to the appropriate runtime backend.
/// `runtime` matches the agent's `runtime` column (`claude-code` | `codex` | `cursor-cli` | …).
/// `mode` is the agent's `mode` column (codex flags; cursor-cli maps `ask` / `plan`).
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
        "codex" => {
            let effective_text = match file_id {
                Some(fid) => inject_image_prefix(user_text, fid, &state.uploads_dir),
                None => user_text.to_string(),
            };
            codex::send_to_session(state, conv_id, &effective_text, project_path, mode);
        }
        "cursor-cli" => {
            let effective_text = match file_id {
                Some(fid) => inject_image_prefix(user_text, fid, &state.uploads_dir),
                None => user_text.to_string(),
            };
            cursor::send_to_session(state, conv_id, &effective_text, project_path, mode);
        }
        _ => claude::send_to_session(state, conv_id, user_text, file_id, project_path),
    }
}

/// Prepend an image path hint to the prompt for runtimes that cannot natively
/// receive image content blocks (codex, cursor-cli).
/// Format: "[Attached image: <abs_path> — use your file reading tool to view it]\n\n<user_text>"
fn inject_image_prefix(
    user_text: &str,
    file_id: &str,
    uploads_dir: &std::path::Path,
) -> String {
    let path = uploads_dir.join(file_id);
    format!(
        "[Attached image: {} — use your file reading tool to view it]\n\n{}",
        path.display(),
        user_text
    )
}

#[cfg(test)]
mod tests {
    use super::inject_image_prefix;
    use std::path::Path;

    /// inject_image_prefix: file_id 存在时，在 user_text 前注入图片路径提示。
    ///
    /// 数据构造：
    ///   uploads_dir = /tmp/uploads
    ///   file_id     = abc.jpg
    ///   user_text   = "请分析这张图"
    ///
    /// 执行过程：
    ///   1. 调用 inject_image_prefix("请分析这张图", "abc.jpg", Path::new("/tmp/uploads"))
    ///   2. 检查返回值包含绝对路径前缀
    ///
    /// 预期结果：
    ///   - 返回值以 "[Attached image: /tmp/uploads/abc.jpg" 开头
    ///   - 返回值包含 "use your file reading tool to view it"
    ///   - 返回值包含原始 user_text
    #[test]
    fn test_inject_image_prefix_with_file_id() {
        let result = inject_image_prefix(
            "请分析这张图",
            "abc.jpg",
            Path::new("/tmp/uploads"),
        );
        assert!(
            result.starts_with("[Attached image: /tmp/uploads/abc.jpg"),
            "should start with absolute image path: got {:?}",
            result
        );
        assert!(
            result.contains("use your file reading tool to view it"),
            "should contain instruction for agent: got {:?}",
            result
        );
        assert!(
            result.contains("请分析这张图"),
            "should contain original user_text: got {:?}",
            result
        );
    }

    /// inject_image_prefix: user_text 为空时，仍然正确注入路径前缀。
    ///
    /// 预期结果：
    ///   - 返回值包含路径前缀
    ///   - 不崩溃
    #[test]
    fn test_inject_image_prefix_empty_user_text() {
        let result = inject_image_prefix("", "img.png", Path::new("/uploads"));
        assert!(
            result.contains("[Attached image: /uploads/img.png"),
            "should contain path even with empty user_text: got {:?}",
            result
        );
    }
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
cd cli && cargo test inject_image_prefix 2>&1
```

预期：
```
test serve::runtime::tests::test_inject_image_prefix_with_file_id ... ok
test serve::runtime::tests::test_inject_image_prefix_empty_user_text ... ok
```

- [ ] **Step 6: 运行完整 cargo test + cargo build**

```bash
cd cli && cargo test 2>&1 | tail -20
cd cli && cargo build 2>&1 | tail -10
```

预期：所有测试通过，build 成功，无 warning。

- [ ] **Step 7: 更新 design doc 的 code hash**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul
python3 scripts/check-doc-code-hashes.py --update-doc 2026-05-09-codex-cursor-image-injection-design.md
```

- [ ] **Step 8: Commit**

```bash
cd /Users/alan/Documents/codes/yakami0129/multisoul
git add cli/src/serve/runtime/mod.rs docs/design-docs/2026-05-09-codex-cursor-image-injection-design.md docs/design-docs/index.json
git commit -m "feat(cli): inject image path into codex/cursor-cli prompts

When a user message includes a file_id, codex and cursor-cli runtimes
now receive a prompt prefix pointing to the uploaded image file, so the
agent can read it with its file-reading tool.

Claude runtime is unchanged — it continues to send base64 image blocks.

Fixes: codex/cursor-cli silently dropping file_id from dispatch layer."
```
