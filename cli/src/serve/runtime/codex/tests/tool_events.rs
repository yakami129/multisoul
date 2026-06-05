use super::super::events::parse_tool_item;
use serde_json::{json, Value};

fn parse(value: Value) -> super::super::events::CodexToolItem {
    parse_tool_item(value.as_object().expect("object")).expect("tool item")
}

#[test]
fn parses_legacy_command_execution_as_bash_card() {
    let item = parse(json!({
        "id": "item-1",
        "type": "command_execution",
        "command": "pwd",
        "aggregated_output": "/repo\n",
        "exit_code": 0,
        "status": "completed"
    }));

    assert_eq!(item.native_id.as_deref(), Some("item-1"));
    assert_eq!(item.tool, "Bash");
    assert_eq!(item.args, "pwd");
    assert_eq!(item.ok, Some(true));
    assert_eq!(item.summary, "/repo");
}

#[test]
fn parses_mcp_tool_call_with_stable_mcp_tool_name() {
    let item = parse(json!({
        "id": "item-2",
        "type": "mcp_tool_call",
        "server": "figma",
        "tool": "use_figma",
        "arguments": {"fileKey": "abc", "nodeId": "1:2"},
        "status": "completed",
        "result": {
            "content": [{"type": "text", "text": "created frame"}],
            "structured_content": null
        }
    }));

    assert_eq!(item.native_id.as_deref(), Some("item-2"));
    assert_eq!(item.tool, "mcp__figma__use_figma");
    assert!(item.args.contains("\"fileKey\":\"abc\""));
    assert_eq!(item.ok, Some(true));
    assert_eq!(item.summary, "created frame");
}

#[test]
fn parses_file_change_completed_only_item() {
    let item = parse(json!({
        "id": "item-3",
        "type": "file_change",
        "changes": [
            {"path": "src/main.rs", "kind": "update"},
            {"path": "src/lib.rs", "kind": "add"}
        ],
        "status": "completed"
    }));

    assert_eq!(item.tool, "apply_patch");
    assert!(item.args.contains("src/main.rs"));
    assert_eq!(item.ok, Some(true));
    assert_eq!(item.summary, "2 files changed");
}

#[test]
fn parses_todo_list_as_tool_call_row_todos_payload() {
    let item = parse(json!({
        "id": "item-4",
        "type": "todo_list",
        "items": [
            {"text": "inspect schema", "status": "completed"},
            {"text": "patch parser", "status": "in_progress"},
            {"text": "verify fallback", "completed": false}
        ]
    }));

    assert_eq!(item.tool, "todo_list");
    assert!(item.args.contains("\"content\":\"inspect schema\""));
    assert!(item.args.contains("\"status\":\"completed\""));
    assert!(item.args.contains("\"content\":\"patch parser\""));
    assert!(item.args.contains("\"status\":\"in_progress\""));
    assert_eq!(item.summary, "1/3 tasks");
}

#[test]
fn parses_web_search_as_search_tool() {
    let item = parse(json!({
        "id": "item-5",
        "type": "web_search",
        "query": "Codex exec JSONL item.completed",
        "action": {"type": "search", "query": "Codex exec JSONL item.completed"}
    }));

    assert_eq!(item.tool, "web_search");
    assert!(item.args.contains("Codex exec JSONL"));
    assert_eq!(item.summary, "Codex exec JSONL item.completed");
}

#[test]
fn parses_raw_function_call_fallback() {
    let item = parse(json!({
        "type": "function_call",
        "call_id": "call-6",
        "name": "exec_command",
        "arguments": "{\"cmd\":\"rg tool_call\"}",
        "status": "completed"
    }));

    assert_eq!(item.native_id.as_deref(), Some("call-6"));
    assert_eq!(item.tool, "exec_command");
    assert_eq!(item.args, "{\"cmd\":\"rg tool_call\"}");
    assert_eq!(item.ok, Some(true));
}

#[test]
fn parses_raw_tool_output_fallback() {
    let item = parse(json!({
        "type": "tool_search_output",
        "call_id": "call-7",
        "execution": "tool_search",
        "status": "completed",
        "tools": [{"name": "search_design_system"}]
    }));

    assert_eq!(item.native_id.as_deref(), Some("call-7"));
    assert_eq!(item.tool, "tool_search");
    assert!(item.args.contains("search_design_system"));
    assert_eq!(item.ok, Some(true));
}
