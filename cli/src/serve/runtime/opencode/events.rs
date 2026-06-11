use serde_json::Value;

/// Represents a completed tool call parsed from an opencode `tool_use` event.
pub(super) struct OpenCodeToolEvent {
    pub call_id: String,
    pub tool: String,
    /// JSON-serialized input object
    pub args: String,
    pub ok: bool,
    /// Truncated tool output for display
    pub summary: String,
}

/// Extract the session ID from the top-level `sessionID` field of any opencode event.
pub(super) fn extract_session_id(v: &Value) -> Option<&str> {
    v["sessionID"].as_str().filter(|s| !s.is_empty())
}

/// Extract streamed text from a `text` event: `part.text`.
pub(super) fn extract_text(v: &Value) -> Option<&str> {
    v["part"]["text"].as_str()
}

/// Parse a `tool_use` event into a completed tool call, or `None` if incomplete / unparseable.
/// Only handles `state.status == "completed"`.
pub(super) fn parse_tool_event(v: &Value) -> Option<OpenCodeToolEvent> {
    let part = v.get("part")?;
    let call_id = part["callID"].as_str()?.to_string();
    let tool = part["tool"].as_str()?.to_string();
    let state = part.get("state")?;

    let status = state["status"].as_str().unwrap_or("");
    if status != "completed" {
        return None;
    }

    let input = state.get("input").unwrap_or(&Value::Null);
    let args = if input.is_null() {
        String::new()
    } else {
        input.to_string()
    };

    let ok = state.get("error").map_or(true, |e| e.is_null());
    let raw_output = state["output"].as_str().unwrap_or("");
    let summary = truncate_output(raw_output, 500);

    Some(OpenCodeToolEvent {
        call_id,
        tool,
        args,
        ok,
        summary,
    })
}

/// Keep only the first `max_chars` characters of the output (avoids bloating the DB).
fn truncate_output(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{}…", truncated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// extract_session_id: returns the sessionID string from any top-level event.
    ///
    /// Data: `{"type":"step_start","sessionID":"ses_abc","part":{}}`
    ///
    /// Expected: Some("ses_abc")
    #[test]
    fn test_extract_session_id_present() {
        let v = json!({"type":"step_start","sessionID":"ses_abc","part":{}});
        assert_eq!(extract_session_id(&v), Some("ses_abc"));
    }

    /// extract_session_id: returns None when sessionID field is absent.
    #[test]
    fn test_extract_session_id_absent() {
        let v = json!({"type":"step_start"});
        assert_eq!(extract_session_id(&v), None);
    }

    /// extract_session_id: returns None for empty string sessionID.
    #[test]
    fn test_extract_session_id_empty() {
        let v = json!({"type":"step_start","sessionID":""});
        assert_eq!(extract_session_id(&v), None);
    }

    /// extract_text: returns text from part.text of a `text` event.
    ///
    /// Data: `{"type":"text","part":{"text":"hello"}}`
    ///
    /// Expected: Some("hello")
    #[test]
    fn test_extract_text_present() {
        let v = json!({"type":"text","part":{"text":"hello"}});
        assert_eq!(extract_text(&v), Some("hello"));
    }

    /// extract_text: returns None when part.text is absent.
    #[test]
    fn test_extract_text_absent() {
        let v = json!({"type":"step_start","part":{}});
        assert_eq!(extract_text(&v), None);
    }

    /// parse_tool_event: parses a completed bash tool_use event correctly.
    ///
    /// Data: real-world shaped event from opencode run output.
    ///
    /// Expected:
    ///   - call_id = "call_00_abc"
    ///   - tool = "bash"
    ///   - args contains "ls /tmp"
    ///   - ok = true
    ///   - summary contains tool output
    #[test]
    fn test_parse_tool_event_completed() {
        let v = json!({
            "type": "tool_use",
            "sessionID": "ses_abc",
            "part": {
                "type": "tool",
                "callID": "call_00_abc",
                "tool": "bash",
                "state": {
                    "status": "completed",
                    "input": {"command": "ls /tmp", "description": "List files"},
                    "output": "file1\nfile2\n",
                    "title": "List files"
                }
            }
        });
        let event = parse_tool_event(&v).expect("should parse completed tool event");
        assert_eq!(event.call_id, "call_00_abc");
        assert_eq!(event.tool, "bash");
        assert!(
            event.args.contains("ls /tmp"),
            "args should contain input command"
        );
        assert!(event.ok, "no error field means ok=true");
        assert!(
            event.summary.contains("file1"),
            "summary should contain output"
        );
    }

    /// parse_tool_event: returns None for non-completed status.
    ///
    /// Data: tool_use event with status="running".
    ///
    /// Expected: None (incomplete tools are skipped)
    #[test]
    fn test_parse_tool_event_running_skipped() {
        let v = json!({
            "type": "tool_use",
            "part": {
                "callID": "call_01",
                "tool": "bash",
                "state": {"status": "running", "input": {}}
            }
        });
        assert!(
            parse_tool_event(&v).is_none(),
            "running status should return None"
        );
    }

    /// parse_tool_event: returns None when part field is missing.
    #[test]
    fn test_parse_tool_event_missing_part() {
        let v = json!({"type": "tool_use"});
        assert!(parse_tool_event(&v).is_none());
    }

    /// truncate_output: long output is truncated to max_chars with ellipsis.
    ///
    /// Data: 600-character string, max_chars=500.
    ///
    /// Expected: result length <= 501 (500 chars + ellipsis char)
    #[test]
    fn test_truncate_output_long() {
        let long = "a".repeat(600);
        let result = truncate_output(&long, 500);
        assert!(
            result.chars().count() <= 502,
            "truncated output should not exceed max_chars+ellipsis"
        );
        assert!(
            result.ends_with('…'),
            "truncated output should end with ellipsis"
        );
    }

    /// truncate_output: short output is returned unchanged.
    #[test]
    fn test_truncate_output_short() {
        let short = "hello";
        let result = truncate_output(short, 500);
        assert_eq!(result, "hello");
    }
}
