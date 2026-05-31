mod claude;
pub mod codex;
mod cursor;
pub mod models;

use crate::serve::state::AppState;

/// Dispatch a user message to the appropriate runtime backend.
/// `runtime` matches the agent's `runtime` column (`claude-code` | `codex` | `cursor-cli` | …).
/// `mode` is the agent's `mode` column (codex flags; cursor-cli maps `ask` / `plan`).
pub struct DispatchMessage<'a> {
    pub text: &'a str,
    pub file_id: Option<&'a str>,
    pub model_id: Option<&'a str>,
    pub seq: i64,
}

pub fn send_to_session(
    state: &AppState,
    conv_id: &str,
    message: DispatchMessage<'_>,
    project_path: &str,
    runtime: &str,
    mode: &str,
) {
    let runtime_text = match (runtime, message.file_id) {
        ("cursor-cli", Some(fid)) => inject_image_prefix(message.text, fid, &state.uploads_dir),
        _ => message.text.to_string(),
    };
    let context_text = inject_runtime_context(&runtime_text, conv_id);
    let runtime_message = DispatchMessage {
        text: &context_text,
        file_id: if runtime == "cursor-cli" {
            None
        } else {
            message.file_id
        },
        model_id: message.model_id,
        seq: message.seq,
    };

    match runtime {
        "codex" => {
            codex::send_to_session(state, conv_id, runtime_message, project_path, mode);
        }
        "cursor-cli" => {
            cursor::send_to_session(state, conv_id, runtime_message, project_path, mode);
        }
        _ => claude::send_to_session(state, conv_id, runtime_message, project_path),
    }
}

fn inject_runtime_context(user_text: &str, conv_id: &str) -> String {
    format!(
        "<multisoul-context>\n  <conversation-id>{}</conversation-id>\n</multisoul-context>\n\n{}",
        xml_escape_text(conv_id),
        user_text
    )
}

fn xml_escape_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Prepend an image path hint to the prompt for runtimes that cannot natively
/// receive image content blocks (cursor-cli).
/// Format: "[Attached image: <abs_path> — use your file reading tool to view it]\n\n<user_text>"
///
/// Path is rendered with forward slashes so the same string is stable across Windows and Unix.
fn inject_image_prefix(user_text: &str, file_id: &str, uploads_dir: &std::path::Path) -> String {
    let path = uploads_dir.join(file_id);
    let path_str = path.to_string_lossy().replace('\\', "/");
    format!(
        "[Attached image: {} — use your file reading tool to view it]\n\n{}",
        path_str, user_text
    )
}

#[cfg(test)]
mod tests {
    use super::{inject_image_prefix, inject_runtime_context};
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
        let result = inject_image_prefix("请分析这张图", "abc.jpg", Path::new("/tmp/uploads"));
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

    /// runtime context injection: wraps user input with the current MultiSoul conversation id.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation_id = "conv-123"（由 MultiSoul conversations.id 提供，无 token/预算/阈值计算）
    ///   user_text       = "请继续实现 ask-question"
    ///   expected_prefix = XML context block + blank line
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 调用 inject_runtime_context(user_text, conversation_id)
    ///   2. helper 生成 multisoul-context XML 块
    ///   3. helper 在 XML 块后追加一个空行，再追加原始 user_text
    ///
    /// 预期结果：
    ///   - 断言 A：返回值精确等于 XML 上下文 + 用户原文，保证 runtime 能读取 conversation-id
    ///   - 断言 B：返回值不改变用户原文内容，保证 DB/UI 原文语义不被污染
    #[test]
    fn test_inject_runtime_context_wraps_conversation_id_and_preserves_user_text() {
        let result = inject_runtime_context("请继续实现 ask-question", "conv-123");

        assert_eq!(
            result,
            "<multisoul-context>\n  <conversation-id>conv-123</conversation-id>\n</multisoul-context>\n\n请继续实现 ask-question",
            "runtime prompt should prepend the exact XML context block before user text"
        );
        assert!(
            result.ends_with("请继续实现 ask-question"),
            "runtime context injection must preserve the original user text suffix"
        );
    }

    /// runtime context injection: XML-escapes conversation-id while leaving user input untouched.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation_id = "conv<&\"'&>"（人工构造，覆盖 XML 5 类敏感字符）
    ///   user_text       = "保留 <raw-user-text> & 原样"
    ///   escaped_id      = "conv&lt;&amp;&quot;&apos;&amp;&gt;"
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 调用 inject_runtime_context(user_text, conversation_id)
    ///   2. helper 只 escape XML 字段值 conversation-id
    ///   3. helper 将 user_text 放在 XML 块之后，不对用户原文做 XML 转义
    ///
    /// 预期结果：
    ///   - 断言 A：XML 块中出现 escaped_id，说明 conversation-id 可被 XML 安全解析
    ///   - 断言 B：XML 块中不出现未转义 conversation-id，说明没有注入非法 XML 字符
    ///   - 断言 C：用户原文保持 raw 形式，说明 prompt 本体不被误处理
    #[test]
    fn test_inject_runtime_context_escapes_xml_id_without_escaping_user_text() {
        let result = inject_runtime_context("保留 <raw-user-text> & 原样", "conv<&\"'&>");

        assert!(
            result
                .contains("<conversation-id>conv&lt;&amp;&quot;&apos;&amp;&gt;</conversation-id>"),
            "conversation-id should be XML-escaped inside the context block"
        );
        assert!(
            !result.contains("<conversation-id>conv<&\"'&></conversation-id>"),
            "raw XML-sensitive conversation-id must not appear inside the context block"
        );
        assert!(
            result.ends_with("保留 <raw-user-text> & 原样"),
            "user text should remain raw after the XML context block"
        );
    }

    /// cursor runtime prompt: image hint remains after the XML context block.
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   conversation_id = "conv-image"
    ///   uploads_dir     = /tmp/uploads
    ///   file_id         = "photo.png" → image_path = /tmp/uploads/photo.png
    ///   user_text       = "看图回答"
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 先调用 inject_image_prefix(user_text, file_id, uploads_dir) 生成 Cursor 图片提示
    ///   2. 再调用 inject_runtime_context(image_prompt, conversation_id)
    ///   3. 检查最终 prompt 的 context、图片提示、用户原文顺序
    ///
    /// 预期结果：
    ///   - 断言 A：最终 prompt 以 multisoul-context 开头，Agent 优先看到 conversation-id
    ///   - 断言 B：图片提示仍存在，Cursor 带图能力不被破坏
    ///   - 断言 C：用户原文仍在末尾，实际任务文本不丢失
    #[test]
    fn test_runtime_context_wraps_cursor_image_prompt_first() {
        let image_prompt = inject_image_prefix("看图回答", "photo.png", Path::new("/tmp/uploads"));
        let result = inject_runtime_context(&image_prompt, "conv-image");

        assert!(
            result.starts_with("<multisoul-context>\n  <conversation-id>conv-image</conversation-id>\n</multisoul-context>\n\n"),
            "runtime context must be the first block in the Cursor prompt"
        );
        assert!(
            result.contains("[Attached image: /tmp/uploads/photo.png"),
            "Cursor image path hint should remain after context injection"
        );
        assert!(
            result.ends_with("看图回答"),
            "Cursor prompt should still end with the original user text"
        );
    }
}
