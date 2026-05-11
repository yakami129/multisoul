// bugfix-bot/src/claude.rs
use anyhow::{Context, Result};
use std::process::Command;

/// claude CLI 调用结果
pub struct ClaudeOutput {
    pub result_text: String,
    pub session_id: Option<String>,
    pub raw: String,
}

/// 调用 claude CLI，返回解析后的输出
pub fn run(
    prompt: &str,
    project_path: &str,
    resume_session_id: Option<&str>,
) -> Result<ClaudeOutput> {
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "-p".to_string(),
        prompt.to_string(),
    ];
    if let Some(sid) = resume_session_id {
        args.push("--resume".to_string());
        args.push(sid.to_string());
    }

    let output = Command::new("claude")
        .args(&args)
        .current_dir(project_path)
        .output()
        .context("Failed to run claude CLI — is it installed and in PATH?")?;

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        anyhow::bail!("claude exited with {}: {}", output.status, stderr);
    }

    let result_text = extract_result_text(&raw)?;
    let session_id = extract_session_id(&raw).ok();

    Ok(ClaudeOutput { result_text, session_id, raw })
}

/// 从 stream-json 输出中提取 result 行的 result 字段
pub fn extract_result_text(output: &str) -> Result<String> {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                if let Some(text) = v.get("result").and_then(|r| r.as_str()) {
                    return Ok(text.to_string());
                }
            }
        }
    }
    anyhow::bail!("No result line found in claude output")
}

/// 从 stream-json 输出中提取 session_id
pub fn extract_session_id(output: &str) -> Result<String> {
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                if let Some(sid) = v.get("session_id").and_then(|s| s.as_str()) {
                    return Ok(sid.to_string());
                }
            }
        }
    }
    anyhow::bail!("No session_id found in claude output")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// extract_result_text 从 stream-json 输出中提取 result 文本
    #[test]
    fn test_extract_result_text_from_stream_json() {
        let output = "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"thinking...\"}]}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"The root cause is in foo.rs line 42.\",\"session_id\":\"sess-1\",\"is_error\":false}\n";
        let text = extract_result_text(output).unwrap();
        assert_eq!(text, "The root cause is in foo.rs line 42.", "must extract result text");
    }

    /// extract_result_text 在没有 result 行时返回 Err
    #[test]
    fn test_extract_result_text_missing_returns_err() {
        let output = r#"{"type":"assistant","message":{"content":[]}}"#;
        let result = extract_result_text(output);
        assert!(result.is_err(), "missing result line must return Err");
    }

    /// extract_session_id 从 stream-json 输出中提取 session_id
    #[test]
    fn test_extract_session_id() {
        let output = r#"{"type":"result","subtype":"success","result":"done","session_id":"sess-1","is_error":false}"#;
        let sid = extract_session_id(output).unwrap();
        assert_eq!(sid, "sess-1", "must extract session_id");
    }
}
