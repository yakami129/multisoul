use super::super::{build_codex_args, extract_text_from_array, mode_flags, resume_mode_flags};
use serde_json::json;

/// extract_text_from_array: agent_message with content array.
///
/// Execution:
///   1. Build item JSON with content: [{type: output_text, text: "Hello"}, {type: output_text, text: "world"}]
///   2. Call extract_text_from_array(&item, "content", "output_text")
///
/// Expected:
///   - returns "Hello\nworld"
#[test]
fn test_extract_text_from_agent_message() {
    let v = json!({
        "type": "agent_message",
        "content": [
            {"type": "output_text", "text": "Hello"},
            {"type": "output_text", "text": "world"}
        ]
    });
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(
        text, "Hello\nworld",
        "should join output_text elements with newline"
    );
}

/// extract_text_from_array: filters out non-matching element types.
///
/// Execution:
///   1. Build item with mixed content types
///   2. Call extract_text_from_array filtering for "output_text"
///
/// Expected:
///   - only "output_text" elements included
#[test]
fn test_extract_text_filters_by_type() {
    let v = json!({
        "content": [
            {"type": "other", "text": "ignored"},
            {"type": "output_text", "text": "kept"}
        ]
    });
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(text, "kept", "should exclude non-output_text elements");
}

/// extract_text_from_array: fallback to top-level text field.
///
/// Execution:
///   1. Build item with no content array but a top-level text field
///   2. Call extract_text_from_array
///
/// Expected:
///   - returns the top-level text value
#[test]
fn test_extract_text_fallback_to_text_field() {
    let v = json!({"text": "fallback value"});
    let item = v.as_object().unwrap();
    let text = extract_text_from_array(item, "content", "output_text");
    assert_eq!(
        text, "fallback value",
        "should fall back to top-level text field"
    );
}

/// mode_flags: maps fresh exec mode strings to Codex CLI top-level flags.
///
/// Data construction:
///   full-auto / auto-edit = danger-full-access sandbox + non-interactive approval
///   yolo                  = bypass approvals and sandbox
///   suggest / ""          = no runtime overrides
///
/// Execution:
///   1. Call mode_flags for each mode
///   2. Compare each exact argv fragment
///   3. Check unsupported modes return no flags
///
/// Expected:
///   - full-auto uses top-level `codex -s danger-full-access -a never`
///   - full-auto does not use `-c approval_policy=...` for fresh exec
///   - auto-edit matches full-auto
///   - yolo uses bypass flag
///   - suggest and empty mode add no flags
#[test]
fn test_mode_flags() {
    assert_eq!(
        mode_flags("full-auto"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "fresh full-auto should use top-level Codex sandbox and approval flags"
    );
    assert!(
        !mode_flags("full-auto").contains(&"approval_policy=\"never\""),
        "fresh full-auto should not rely on config override when -a never is available"
    );
    assert_eq!(
        mode_flags("auto-edit"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "fresh auto-edit should match full-auto top-level Codex flags"
    );
    assert_eq!(
        mode_flags("yolo"),
        vec!["--dangerously-bypass-approvals-and-sandbox"],
        "yolo must bypass approvals and sandbox explicitly"
    );
    assert!(
        mode_flags("suggest").is_empty(),
        "suggest should add no flags"
    );
    assert!(mode_flags("").is_empty(), "empty mode should add no flags");
}

/// resume_mode_flags: maps resume mode strings to Codex CLI top-level flags.
///
/// Data construction:
///   `codex -s danger-full-access -a never exec resume ...` parses successfully.
///   Therefore resume can use the same top-level sandbox and approval flags as fresh exec.
///
/// Execution:
///   1. Call resume_mode_flags("full-auto")
///   2. Call resume_mode_flags("auto-edit")
///   3. Call resume_mode_flags("suggest")
///
/// Expected:
///   - full-auto includes -s danger-full-access
///   - full-auto includes -a never
///   - full-auto does not include config overrides
///   - auto-edit matches full-auto
///   - suggest returns no flags
#[test]
fn test_resume_mode_flags() {
    assert_eq!(
        resume_mode_flags("full-auto"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "resume full-auto should use top-level Codex sandbox and approval flags"
    );
    assert!(
        !resume_mode_flags("full-auto").contains(&"-c"),
        "resume full-auto should not need config overrides"
    );
    assert_eq!(
        resume_mode_flags("auto-edit"),
        vec!["-s", "danger-full-access", "-a", "never"],
        "resume auto-edit should match resume full-auto"
    );
    assert!(
        resume_mode_flags("suggest").is_empty(),
        "resume suggest should add no flags"
    );
}

/// build_codex_args: 默认 full-auto 新会话用 Codex 顶层 flags 启动。
///
/// 数据构造（含关键数值的推导过程）：
///   project_path = "/repo"（只作为 --cd 参数，无 token/预算/阈值计算）
///   thread_id    = None（表示新会话，因此应追加 exec 而不是 exec resume）
///   mode         = "full-auto"（agent register 默认值）
///
/// 执行过程：
///   1. 调用 build_codex_args("/repo", None, "full-auto")
///   2. mode_flags 先产出 ["-s", "danger-full-access", "-a", "never"]
///   3. 新会话分支追加 ["exec", "--skip-git-repo-check", "--json", "--cd", "/repo", "-"]
///
/// 预期结果：
///   - 正断言：argv 前四项是 `codex -s danger-full-access -a never` 的参数部分
///   - 正断言：随后进入 `exec` 非交互 JSON 模式
///   - 负断言：不再出现 approval_policy 配置覆盖
///   - 负断言：不再出现 sandbox_mode 配置覆盖
#[test]
fn test_build_codex_args_full_auto_fresh_uses_top_level_defaults() {
    let args = build_codex_args("/repo", None, "full-auto", None);

    assert_eq!(
        args,
        vec![
            "-s",
            "danger-full-access",
            "-a",
            "never",
            "exec",
            "--skip-git-repo-check",
            "--json",
            "--cd",
            "/repo",
            "-"
        ],
        "fresh full-auto should start as `codex -s danger-full-access -a never exec ...`"
    );
    assert!(
        !args.iter().any(|arg| arg == "approval_policy=\"never\""),
        "fresh full-auto should not pass approval_policy config override"
    );
    assert!(
        !args
            .iter()
            .any(|arg| arg == "sandbox_mode=\"danger-full-access\""),
        "fresh full-auto should not pass sandbox_mode config override"
    );
}
