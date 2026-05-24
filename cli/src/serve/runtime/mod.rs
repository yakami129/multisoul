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
    match runtime {
        "codex" => {
            codex::send_to_session(state, conv_id, message, project_path, mode);
        }
        "cursor-cli" => {
            let effective_text = match message.file_id {
                Some(fid) => inject_image_prefix(message.text, fid, &state.uploads_dir),
                None => message.text.to_string(),
            };
            let cursor_message = DispatchMessage {
                text: &effective_text,
                file_id: None,
                model_id: message.model_id,
                seq: message.seq,
            };
            cursor::send_to_session(state, conv_id, cursor_message, project_path, mode);
        }
        _ => claude::send_to_session(state, conv_id, message, project_path),
    }
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
}
