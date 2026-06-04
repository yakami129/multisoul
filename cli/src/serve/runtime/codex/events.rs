use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub(super) struct CodexToolItem {
    pub native_id: Option<String>,
    pub tool: String,
    pub args: String,
    pub ok: Option<bool>,
    pub summary: String,
}

pub(super) fn parse_tool_item(item: &Map<String, Value>) -> Option<CodexToolItem> {
    let item_type = item.get("type").and_then(Value::as_str)?;
    let kind = normalize_item_type(item_type);
    let native_id = string_field(
        item,
        &[
            "id",
            "call_id",
            "callId",
            "item_id",
            "itemId",
            "tool_call_id",
            "toolCallId",
        ],
    );
    let tool = tool_name(item, &kind)?;
    let args = args_for_kind(item, &kind);
    let ok = ok_from_item(item);
    let summary = summary_for_kind(item, &kind);

    Some(CodexToolItem {
        native_id,
        tool,
        args,
        ok,
        summary,
    })
}

fn normalize_item_type(raw: &str) -> String {
    raw.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn tool_name(item: &Map<String, Value>, kind: &str) -> Option<String> {
    match kind {
        "commandexecution" | "localshellcall" | "shellcommand" | "unifiedexec" => {
            Some("Bash".to_string())
        }
        "filechange" => Some("apply_patch".to_string()),
        "mcptoolcall" => {
            let server = string_field(item, &["server", "server_name", "serverName"]);
            let tool = string_field(item, &["tool", "tool_name", "toolName", "name"]);
            Some(match (server, tool) {
                (Some(server), Some(tool)) => format!("mcp__{server}__{tool}"),
                (None, Some(tool)) => format!("mcp__{tool}"),
                _ => "mcp_tool_call".to_string(),
            })
        }
        "collabtoolcall" => string_field(item, &["tool", "name"])
            .map(|tool| format!("subagent_{tool}"))
            .or_else(|| Some("subagent".to_string())),
        "websearch" | "websearchcall" => Some("web_search".to_string()),
        "imageview" => Some("view_image".to_string()),
        "imagegeneration" | "imagegenerationcall" => Some("image_generation".to_string()),
        "todolist" => Some("todo_list".to_string()),
        "functioncall"
        | "functioncalloutput"
        | "customtoolcall"
        | "customtoolcalloutput"
        | "dynamictoolcall"
        | "toolsearchcall"
        | "toolsearchoutput" => string_field(
            item,
            &[
                "name",
                "tool",
                "tool_name",
                "toolName",
                "execution",
                "display_name",
                "displayName",
            ],
        )
        .or_else(|| Some(item.get("type")?.as_str()?.to_string())),
        _ => None,
    }
}

fn args_for_kind(item: &Map<String, Value>, kind: &str) -> String {
    match kind {
        "commandexecution" | "localshellcall" | "shellcommand" | "unifiedexec" => {
            string_field(item, &["command", "cmd"])
                .or_else(|| nested_string_field(item, "action", &["command", "cmd"]))
                .unwrap_or_else(|| compact_json(&Value::Object(item.clone())))
        }
        "mcptoolcall"
        | "functioncall"
        | "functioncalloutput"
        | "customtoolcall"
        | "customtoolcalloutput"
        | "dynamictoolcall"
        | "toolsearchcall"
        | "toolsearchoutput" => first_value(
            item,
            &["arguments", "args", "input", "params", "output", "tools"],
        )
        .map(args_value_to_string)
        .unwrap_or_else(|| compact_json(&Value::Object(item.clone()))),
        "todolist" => todo_args(item),
        "websearch" | "websearchcall" => fields_json(item, &["query", "action"]),
        "collabtoolcall" => fields_json(
            item,
            &[
                "tool",
                "prompt",
                "sender_thread_id",
                "receiver_thread_ids",
                "agents_states",
                "status",
            ],
        ),
        "filechange" => fields_json(item, &["changes", "status", "auto_approved"]),
        "imageview" => fields_json(item, &["path"]),
        "imagegeneration" | "imagegenerationcall" => {
            fields_json(item, &["revised_prompt", "saved_path", "status"])
        }
        _ => compact_json(&Value::Object(item.clone())),
    }
}

fn args_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| compact_json(value))
}

fn summary_for_kind(item: &Map<String, Value>, kind: &str) -> String {
    match kind {
        "commandexecution" | "localshellcall" | "shellcommand" | "unifiedexec" => string_field(
            item,
            &["aggregated_output", "output", "stdout", "stderr", "summary"],
        )
        .or_else(|| nested_string_field(item, "result", &["output", "stdout", "stderr"]))
        .unwrap_or_default(),
        "mcptoolcall" => mcp_summary(item),
        "filechange" => string_field(item, &["stdout", "stderr", "summary"])
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| file_change_summary(item)),
        "collabtoolcall" => string_field(item, &["status", "message"])
            .unwrap_or_else(|| fields_json(item, &["agents_states"])),
        "websearch" | "websearchcall" => string_field(item, &["query"])
            .or_else(|| first_value(item, &["action"]).map(compact_json))
            .unwrap_or_default(),
        "imagegeneration" | "imagegenerationcall" => {
            string_field(item, &["saved_path", "result", "revised_prompt", "status"])
                .unwrap_or_default()
        }
        "imageview" => string_field(item, &["path"]).unwrap_or_default(),
        "todolist" => todo_summary(item),
        _ => first_value(
            item,
            &[
                "summary", "result", "output", "content", "text", "error", "message",
            ],
        )
        .map(summary_value_to_string)
        .unwrap_or_default(),
    }
}

fn ok_from_item(item: &Map<String, Value>) -> Option<bool> {
    if let Some(code) = item.get("exit_code").and_then(Value::as_i64) {
        return Some(code == 0);
    }
    if let Some(code) = item.get("exitCode").and_then(Value::as_i64) {
        return Some(code == 0);
    }
    if let Some(is_error) = item.get("is_error").and_then(Value::as_bool) {
        return Some(!is_error);
    }
    if let Some(is_error) = item.get("isError").and_then(Value::as_bool) {
        return Some(!is_error);
    }
    if let Some(success) = item.get("success").and_then(Value::as_bool) {
        return Some(success);
    }
    let status = string_field(item, &["status"])?;
    match normalize_item_type(&status).as_str() {
        "failed" | "declined" | "cancelled" | "canceled" | "error" | "errored" => Some(false),
        "completed" | "success" | "succeeded" | "done" => Some(true),
        _ => None,
    }
}

fn mcp_summary(item: &Map<String, Value>) -> String {
    if let Some(message) = item
        .get("error")
        .and_then(Value::as_object)
        .and_then(|obj| string_field(obj, &["message"]))
    {
        return message;
    }

    let Some(result) = item.get("result").and_then(Value::as_object) else {
        return string_field(item, &["status"]).unwrap_or_default();
    };
    if let Some(structured) = result
        .get("structured_content")
        .filter(|value| !value.is_null())
    {
        return summary_value_to_string(structured);
    }
    if let Some(structured) = result
        .get("structuredContent")
        .filter(|value| !value.is_null())
    {
        return summary_value_to_string(structured);
    }
    if let Some(content) = result.get("content") {
        return summarize_content_array(content);
    }
    String::new()
}

fn summarize_content_array(value: &Value) -> String {
    let Some(items) = value.as_array() else {
        return summary_value_to_string(value);
    };
    let text = items
        .iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            string_field(obj, &["text"]).or_else(|| string_field(obj, &["content"]))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        compact_json(value)
    } else {
        text
    }
}

fn file_change_summary(item: &Map<String, Value>) -> String {
    let count = item
        .get("changes")
        .and_then(Value::as_array)
        .map(|changes| changes.len())
        .unwrap_or(0);
    if count == 0 {
        string_field(item, &["status"]).unwrap_or_default()
    } else if count == 1 {
        "1 file changed".to_string()
    } else {
        format!("{count} files changed")
    }
}

fn todo_args(item: &Map<String, Value>) -> String {
    let todos = item
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, raw)| {
                    let obj = raw.as_object();
                    let content = obj
                        .and_then(|todo| {
                            string_field(todo, &["text", "content", "title", "task", "summary"])
                        })
                        .unwrap_or_else(|| format!("Task {}", index + 1));
                    serde_json::json!({
                        "content": content,
                        "status": todo_status(obj)
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    compact_json(&serde_json::json!({ "todos": todos }))
}

fn todo_status(todo: Option<&Map<String, Value>>) -> &'static str {
    let Some(todo) = todo else {
        return "pending";
    };
    if let Some(status) = string_field(todo, &["status", "state"]) {
        return match normalize_item_type(&status).as_str() {
            "completed" | "complete" | "done" | "success" | "succeeded" => "completed",
            "inprogress" | "running" | "active" | "current" | "started" => "in_progress",
            _ => "pending",
        };
    }
    if todo
        .get("completed")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        "completed"
    } else {
        "pending"
    }
}

fn todo_summary(item: &Map<String, Value>) -> String {
    let Some(items) = item.get("items").and_then(Value::as_array) else {
        return String::new();
    };
    let done = items
        .iter()
        .filter(|raw| todo_status(raw.as_object()) == "completed")
        .count();
    format!("{done}/{} tasks", items.len())
}

fn fields_json(item: &Map<String, Value>, keys: &[&str]) -> String {
    let mut out = Map::new();
    for key in keys {
        if let Some(value) = item.get(*key) {
            out.insert((*key).to_string(), value.clone());
        }
    }
    compact_json(&Value::Object(out))
}

fn first_value<'a>(item: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| item.get(*key))
}

fn string_field(item: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        item.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    })
}

fn nested_string_field(
    item: &Map<String, Value>,
    object_key: &str,
    keys: &[&str],
) -> Option<String> {
    item.get(object_key)
        .and_then(Value::as_object)
        .and_then(|obj| string_field(obj, keys))
}

fn summary_value_to_string(value: &Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| compact_json(value))
}

fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_default()
}
