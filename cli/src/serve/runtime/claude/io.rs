//! I/O helpers: write stream-json messages to a Claude process stdin.

use std::io::Write;

/// Write a user message JSON line to claude's stdin.
pub fn write_user_message(sink: &mut impl Write, user_text: &str) -> Result<(), String> {
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

/// Write a user message with an image content block (and optional text) to Claude's stdin.
/// The image is read from `file_path`, base64-encoded, and media_type derived from extension.
/// If `user_text` is non-empty, a text block is appended after the image block.
pub fn write_user_message_with_image(
    sink: &mut impl Write,
    user_text: &str,
    file_path: &std::path::Path,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

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
