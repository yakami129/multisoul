use serde_json::Value;

#[derive(Debug, PartialEq)]
pub(super) enum InfcodeEvent {
    AgentText(String),
    ToolCall {
        call_id: String,
        tool: String,
        args: Value,
    },
    ToolResult {
        call_id: String,
        ok: bool,
        summary: String,
    },
    Completed,
    Failed(String),
    Ignored,
}

pub(super) fn parse_json_event(v: &Value) -> InfcodeEvent {
    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match event_type {
        "text" | "text.delta" => text_from_fields(v, &["text", "content", "delta"])
            .map(InfcodeEvent::AgentText)
            .unwrap_or(InfcodeEvent::Ignored),
        "assistant" | "message" if is_assistant(v) => assistant_text(v)
            .map(InfcodeEvent::AgentText)
            .unwrap_or(InfcodeEvent::Ignored),
        "thinking" | "thinking.delta" => {
            text_from_fields(v, &["text", "thinking", "content", "delta"])
                .map(InfcodeEvent::AgentText)
                .unwrap_or(InfcodeEvent::Ignored)
        }
        "thinking.end" => text_from_fields(v, &["thinking", "text", "content"])
            .map(InfcodeEvent::AgentText)
            .unwrap_or(InfcodeEvent::Ignored),
        "tool.start" => parse_tool_start(v),
        "tool.result" => parse_tool_result(v),
        "complete" => InfcodeEvent::Completed,
        "run.result" => {
            if v.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
                InfcodeEvent::Completed
            } else {
                InfcodeEvent::Failed(error_message(v, "infcode run failed"))
            }
        }
        "error" => InfcodeEvent::Failed(error_message(v, "infcode error")),
        _ => InfcodeEvent::Ignored,
    }
}

fn parse_tool_start(v: &Value) -> InfcodeEvent {
    let Some(call_id) = string_field(v, &["id", "call_id", "toolId"]) else {
        return InfcodeEvent::Ignored;
    };
    let tool = string_field(v, &["name", "tool", "toolName"]).unwrap_or_else(|| "tool".to_string());
    let args = v
        .get("input")
        .or_else(|| v.get("args"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    InfcodeEvent::ToolCall {
        call_id,
        tool,
        args,
    }
}

fn parse_tool_result(v: &Value) -> InfcodeEvent {
    let Some(call_id) = string_field(v, &["id", "call_id", "toolId"]) else {
        return InfcodeEvent::Ignored;
    };
    let ok = v
        .get("ok")
        .and_then(|ok| ok.as_bool())
        .or_else(|| v.get("success").and_then(|success| success.as_bool()))
        .unwrap_or_else(|| {
            !matches!(
                string_field(v, &["status"]).as_deref(),
                Some("error" | "failure" | "failed")
            )
        });
    let summary = text_from_fields(v, &["summary", "content", "output", "text", "message"])
        .unwrap_or_default();
    InfcodeEvent::ToolResult {
        call_id,
        ok,
        summary,
    }
}

fn is_assistant(v: &Value) -> bool {
    v.get("role").and_then(|r| r.as_str()) == Some("assistant")
        || v.get("message")
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            == Some("assistant")
}

fn assistant_text(v: &Value) -> Option<String> {
    if let Some(text) = text_from_fields(v, &["text", "content", "delta"]) {
        return Some(text);
    }
    let message = v.get("message")?;
    if let Some(text) = message.as_str().filter(|s| !s.is_empty()) {
        return Some(text.to_string());
    }
    if let Some(text) = text_from_fields(message, &["text", "content", "delta"]) {
        return Some(text);
    }
    let arr = message.get("content")?.as_array()?;
    let parts: Vec<&str> = arr
        .iter()
        .filter(|block| block.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|block| block.get("text").and_then(|text| text.as_str()))
        .filter(|text| !text.is_empty())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(""))
    }
}

fn text_from_fields(v: &Value, fields: &[&str]) -> Option<String> {
    for field in fields {
        let Some(value) = v.get(*field) else {
            continue;
        };
        if let Some(text) = value.as_str().filter(|s| !s.is_empty()) {
            return Some(text.to_string());
        }
        if let Some(array) = value.as_array() {
            let parts: Vec<&str> = array
                .iter()
                .filter_map(|item| {
                    item.as_str()
                        .or_else(|| item.get("text").and_then(|t| t.as_str()))
                })
                .filter(|text| !text.is_empty())
                .collect();
            if !parts.is_empty() {
                return Some(parts.join(""));
            }
        }
    }
    None
}

fn string_field(v: &Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| {
        v.get(*field)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(ToString::to_string)
    })
}

fn error_message(v: &Value, fallback: &str) -> String {
    text_from_fields(v, &["message", "error", "signalReason", "reason"])
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_text_and_thinking_events_as_agent_text() {
        assert_eq!(
            parse_json_event(&json!({"type":"text.delta","text":"hello"})),
            InfcodeEvent::AgentText("hello".to_string())
        );
        assert_eq!(
            parse_json_event(&json!({"type":"thinking.end","thinking":"plan"})),
            InfcodeEvent::AgentText("plan".to_string())
        );
        assert_eq!(
            parse_json_event(&json!({
                "type":"assistant",
                "message":{"role":"assistant","content":[{"type":"text","text":"done"}]}
            })),
            InfcodeEvent::AgentText("done".to_string())
        );
    }

    #[test]
    fn parses_tool_start_and_result_events() {
        assert_eq!(
            parse_json_event(&json!({
                "type":"tool.start",
                "id":"tool-1",
                "name":"bash",
                "input":{"command":"pwd"}
            })),
            InfcodeEvent::ToolCall {
                call_id: "tool-1".to_string(),
                tool: "bash".to_string(),
                args: json!({"command":"pwd"}),
            }
        );
        assert_eq!(
            parse_json_event(&json!({
                "type":"tool.result",
                "id":"tool-1",
                "content":"/repo"
            })),
            InfcodeEvent::ToolResult {
                call_id: "tool-1".to_string(),
                ok: true,
                summary: "/repo".to_string(),
            }
        );
    }

    #[test]
    fn parses_completion_and_failure_events() {
        assert_eq!(
            parse_json_event(&json!({"type":"complete"})),
            InfcodeEvent::Completed
        );
        assert_eq!(
            parse_json_event(&json!({"type":"run.result","success":true})),
            InfcodeEvent::Completed
        );
        assert_eq!(
            parse_json_event(
                &json!({"type":"run.result","success":false,"signalReason":"blocked"})
            ),
            InfcodeEvent::Failed("blocked".to_string())
        );
    }
}
