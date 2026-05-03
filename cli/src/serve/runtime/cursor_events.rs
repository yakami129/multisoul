use serde_json::Value;

pub(super) enum CursorToolEvent {
    Started {
        call_id: String,
        tool: String,
        args: String,
    },
    Completed {
        call_id: String,
        ok: bool,
        summary: String,
    },
}

pub(super) fn parse_tool_event(v: &Value) -> Option<CursorToolEvent> {
    if v.get("type").and_then(|t| t.as_str()) != Some("tool_call") {
        return None;
    }

    match v.get("subtype").and_then(|s| s.as_str()).unwrap_or("") {
        "started" => {
            let call_id = call_id(v)?;
            let shell = v.get("tool_call")?.get("shellToolCall")?;
            let args = shell.get("args")?;
            let command = args
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            if command.is_empty() {
                return None;
            }
            Some(CursorToolEvent::Started {
                call_id,
                tool: "Bash".to_string(),
                args: command,
            })
        }
        "completed" => {
            let call_id = call_id(v)?;
            let shell = v.get("tool_call")?.get("shellToolCall")?;
            let result = shell.get("result")?;
            let (ok, summary) = parse_shell_result(result);
            Some(CursorToolEvent::Completed {
                call_id,
                ok,
                summary,
            })
        }
        _ => None,
    }
}

fn call_id(v: &Value) -> Option<String> {
    v.get("call_id")
        .and_then(|c| c.as_str())
        .filter(|c| !c.is_empty())
        .map(ToString::to_string)
}

fn parse_shell_result(result: &Value) -> (bool, String) {
    if let Some(success) = result.get("success") {
        let stdout = success.get("stdout").and_then(|s| s.as_str()).unwrap_or("");
        let stderr = success.get("stderr").and_then(|s| s.as_str()).unwrap_or("");
        let interleaved = success
            .get("interleavedOutput")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let exit_code = success
            .get("exitCode")
            .and_then(|c| c.as_i64())
            .unwrap_or(0);
        let summary = if !interleaved.trim().is_empty() {
            interleaved
        } else if !stdout.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return (exit_code == 0, summary.trim().to_string());
    }

    if let Some(error) = result.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .or_else(|| error.get("stderr").and_then(|m| m.as_str()))
            .or_else(|| error.get("output").and_then(|m| m.as_str()))
            .unwrap_or("");
        return (false, message.trim().to_string());
    }

    (false, String::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_shell_tool_started_as_tool_call_payload() {
        let raw = json!({
            "type": "tool_call",
            "subtype": "started",
            "call_id": "tool-1",
            "tool_call": {
                "shellToolCall": {
                    "args": {
                        "command": "pwd",
                        "workingDirectory": "",
                        "toolCallId": "tool-1"
                    },
                    "description": "Print current working directory"
                }
            }
        });

        let event = parse_tool_event(&raw).expect("tool event");
        match event {
            CursorToolEvent::Started {
                call_id,
                tool,
                args,
            } => {
                assert_eq!(call_id, "tool-1");
                assert_eq!(tool, "Bash");
                assert_eq!(args, "pwd");
            }
            CursorToolEvent::Completed { .. } => panic!("expected started event"),
        }
    }

    #[test]
    fn parses_shell_tool_completed_as_tool_result_payload() {
        let raw = json!({
            "type": "tool_call",
            "subtype": "completed",
            "call_id": "tool-1",
            "tool_call": {
                "shellToolCall": {
                    "args": { "command": "pwd" },
                    "result": {
                        "success": {
                            "command": "pwd",
                            "exitCode": 0,
                            "stdout": "/tmp\n",
                            "stderr": "",
                            "interleavedOutput": "/tmp\n"
                        },
                        "isBackground": false
                    }
                }
            }
        });

        let event = parse_tool_event(&raw).expect("tool event");
        match event {
            CursorToolEvent::Completed {
                call_id,
                ok,
                summary,
            } => {
                assert_eq!(call_id, "tool-1");
                assert!(ok);
                assert_eq!(summary, "/tmp");
            }
            CursorToolEvent::Started { .. } => panic!("expected completed event"),
        }
    }
}
