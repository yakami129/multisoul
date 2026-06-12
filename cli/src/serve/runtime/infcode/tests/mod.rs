mod test_support;

use super::cli_compat::{
    build_infcode_args, build_legacy_args, legacy_fallback_invocation, sanitize_legacy_output,
    should_retry_same_bin_in_legacy_mode, split_provider_model, InfcodeInvocation,
    InfcodeOutputMode,
};
use super::*;
use std::time::{Duration, Instant};
use tempfile::tempdir;
use test_support::{
    conversation_status, make_infcode_state, messages_for, write_fake_infcode, InfcodeBinGuard,
};

#[test]
fn build_infcode_args_uses_json_session_agent_mode_and_provider_model() {
    let args = build_infcode_args("conv-1", "hello", Some("openai:gpt-5.4")).unwrap();

    assert_eq!(
        args,
        vec![
            "--mode",
            "json",
            "--session",
            "conv-1",
            "--agent-mode",
            "ama",
            "-m",
            "openai",
            "--model",
            "gpt-5.4",
            "hello",
        ],
        "InfCode argv should use JSON mode, MultiSoul conversation id, AMA mode, provider, model, then prompt"
    );
}

#[test]
fn build_infcode_args_omits_provider_model_for_default() {
    let args = build_infcode_args("conv-1", "hello", None).unwrap();

    assert_eq!(
        args,
        vec![
            "--mode",
            "json",
            "--session",
            "conv-1",
            "--agent-mode",
            "ama",
            "hello",
        ],
        "Default InfCode model should not pass provider/model flags"
    );
    assert!(
        !args.iter().any(|arg| arg == "-m" || arg == "--model"),
        "None model_id must not add InfCode provider/model args"
    );
}

#[test]
fn split_provider_model_requires_non_empty_provider_and_model() {
    assert_eq!(
        split_provider_model("anthropic:claude-sonnet-4-6").unwrap(),
        ("anthropic", "claude-sonnet-4-6")
    );
    assert!(
        split_provider_model("gpt-5.4").is_err(),
        "InfCode model ids must be encoded as provider:model"
    );
    assert!(
        split_provider_model(":gpt-5.4").is_err(),
        "provider cannot be empty"
    );
    assert!(
        split_provider_model("openai:").is_err(),
        "model cannot be empty"
    );
}

#[test]
fn process_turn_maps_jsonl_events_into_messages_and_completion() {
    let state = make_infcode_state();
    let dir = tempdir().unwrap();
    let fake_infcode = write_fake_infcode(
        dir.path(),
        r#"#!/bin/sh
printf '%s
' '{"type":"session.start","provider":"openai","sessionId":"conv-1"}'
printf '%s
' '{"type":"text.delta","text":"hello"}'
printf '%s
' '{"type":"thinking.delta","text":"thinking"}'
printf '%s
' '{"type":"tool.start","id":"tool-1","name":"bash","input":{"command":"pwd"}}'
printf '%s
' '{"type":"tool.result","id":"tool-1","name":"bash","content":"/repo"}'
printf '%s
' '{"type":"run.result","success":true,"sessionId":"conv-1"}'
"#,
        r#"@echo off
echo {"type":"session.start","provider":"openai","sessionId":"conv-1"}
echo {"type":"text.delta","text":"hello"}
echo {"type":"thinking.delta","text":"thinking"}
echo {"type":"tool.start","id":"tool-1","name":"bash","input":{"command":"pwd"}}
echo {"type":"tool.result","id":"tool-1","name":"bash","content":"/repo"}
echo {"type":"run.result","success":true,"sessionId":"conv-1"}
"#,
    );
    let _env_guard = InfcodeBinGuard::set(&fake_infcode);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    process_turn(
        &state,
        "conv-1",
        InfcodeTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("fake JSONL InfCode run should complete");

    assert_eq!(conversation_status(&state), "completed");
    let messages = messages_for(&state);
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str()) == Some("hello")),
        "text.delta should be stored as agent_text"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str()) == Some("thinking")),
        "thinking.delta should use the available agent_text role"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "tool_call"
            && payload.get("call_id").and_then(|id| id.as_str()) == Some("tool-1")
            && payload
                .get("args")
                .and_then(|args| args.get("command"))
                .and_then(|c| c.as_str())
                == Some("pwd")),
        "tool.start should be stored as a tool_call with structured args"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "tool_result"
            && payload.get("call_id").and_then(|id| id.as_str()) == Some("tool-1")
            && payload.get("summary").and_then(|summary| summary.as_str()) == Some("/repo")),
        "tool.result should be stored as tool_result"
    );
    assert!(
        messages.iter().any(|(role, payload)| role == "task_status"
            && payload.get("status").and_then(|status| status.as_str()) == Some("completed")),
        "run.result success=true should emit completed task_status"
    );
}

#[test]
fn process_turn_falls_back_to_plain_text_stdout() {
    let state = make_infcode_state();
    let dir = tempdir().unwrap();
    let fake_infcode = write_fake_infcode(
        dir.path(),
        "#!/bin/sh\nprintf '%s\\n' 'plain line one'\nprintf '%s\\n' 'plain line two'\n",
        "@echo off\necho plain line one\necho plain line two\n",
    );
    let _env_guard = InfcodeBinGuard::set(&fake_infcode);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    process_turn(
        &state,
        "conv-1",
        InfcodeTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("plain text fallback should complete on zero exit");

    assert_eq!(conversation_status(&state), "completed");
    let messages = messages_for(&state);
    assert!(
        messages.iter().any(|(role, payload)| role == "agent_text"
            && payload.get("text").and_then(|text| text.as_str())
                == Some("plain line one\nplain line two")),
        "non-JSON stdout should be merged into one agent_text message"
    );
}

#[test]
fn legacy_args_use_print_mode_and_disable_session() {
    let args = build_legacy_args("hello", Some("openai:gpt-5.4")).unwrap();

    assert_eq!(
        args,
        vec![
            "-m",
            "openai",
            "--model",
            "gpt-5.4",
            "-p",
            "hello",
            "--no-session",
        ],
        "legacy InfCode fallback must use provider/model flags plus -p/--no-session"
    );
}

#[test]
fn legacy_fallback_switches_missing_infcode_to_kodax() {
    let _env_guard = InfcodeBinGuard::clear();
    let primary = InfcodeInvocation {
        bin: "infcode".to_string(),
        args: build_infcode_args("conv-1", "hello", None).unwrap(),
        output_mode: InfcodeOutputMode::JsonEvents,
    };

    let fallback = legacy_fallback_invocation(
        &primary,
        "hello",
        None,
        "spawn infcode: No such file or directory (os error 2)",
    )
    .expect("missing infcode binary should fall back to kodax");

    assert_eq!(fallback.bin, "kodax");
    assert_eq!(fallback.output_mode, InfcodeOutputMode::LegacyPrint);
    assert_eq!(fallback.args, vec!["-p", "hello", "--no-session"]);
}

#[test]
fn sanitize_legacy_output_strips_cli_noise() {
    let raw = "\u{1b}[2K[KodaX] Provider: infplacex\r\n\
[Assistant]\r\n\
  useful answer  \r\n\
\u{1b}[2K⠋ Thinking...\r\n\
[KodaX] Done!\r\n\
[Thinking] hidden trace\r\n";

    assert_eq!(sanitize_legacy_output(raw), "useful answer");
}

#[test]
fn process_turn_retries_same_bin_in_legacy_mode_on_argument_error() {
    let state = make_infcode_state();
    let dir = tempdir().unwrap();
    let fake_infcode = write_fake_infcode(
        dir.path(),
        r#"#!/bin/sh
if [ "$1" = "--mode" ]; then
  echo "error: too many arguments. Expected 0 arguments but got 1." >&2
  exit 1
fi
printf '%s\n' '[KodaX] Provider: infplacex'
printf '%s\n' '[Assistant]'
printf '%s\n' 'legacy ok'
printf '%s\n' '[KodaX] Done!'
"#,
        r#"@echo off
if "%1"=="--mode" (
  echo error: too many arguments. Expected 0 arguments but got 1. 1>&2
  exit /b 1
)
echo [KodaX] Provider: infplacex
echo [Assistant]
echo legacy ok
echo [KodaX] Done!
"#,
    );
    let _env_guard = InfcodeBinGuard::set(&fake_infcode);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    process_turn(
        &state,
        "conv-1",
        InfcodeTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("argument mismatch should retry same binary in legacy mode");

    assert_eq!(conversation_status(&state), "completed");
    assert!(
        messages_for(&state)
            .iter()
            .any(|(role, payload)| role == "agent_text"
                && payload.get("text").and_then(|text| text.as_str()) == Some("legacy ok")),
        "legacy retry output should be emitted as agent_text"
    );
}

#[test]
fn process_turn_drains_large_stderr_without_deadlock() {
    let state = make_infcode_state();
    let dir = tempdir().unwrap();
    let fake_infcode = write_fake_infcode(
        dir.path(),
        r#"#!/bin/sh
for i in $(seq 1 2000); do
  printf 'stderr-line-%04d abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz\n' "$i" >&2
done
printf '%s\n' '{"type":"text.delta","text":"done"}'
printf '%s\n' '{"type":"run.result","success":true,"sessionId":"conv-1"}'
"#,
        r#"@echo off
for /l %%i in (1,1,2000) do echo stderr-line-%%i abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz 1>&2
echo {"type":"text.delta","text":"done"}
echo {"type":"run.result","success":true,"sessionId":"conv-1"}
"#,
    );
    let _env_guard = InfcodeBinGuard::set(&fake_infcode);
    let (tx, _rx) = std::sync::mpsc::channel();
    let handle = SessionHandle::new(tx);

    let started = Instant::now();
    process_turn(
        &state,
        "conv-1",
        InfcodeTurn {
            prompt: "hello",
            user_seq: 1,
            project_path: dir.path().to_str().unwrap(),
            model_id: None,
        },
        &handle,
    )
    .expect("large stderr output should be drained while stdout is read");

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "InfCode stderr drain should prevent pipe deadlock"
    );
    assert_eq!(conversation_status(&state), "completed");
    assert!(
        messages_for(&state)
            .iter()
            .any(|(role, payload)| role == "agent_text"
                && payload.get("text").and_then(|text| text.as_str()) == Some("done")),
        "stdout JSONL should still be processed while stderr is drained"
    );
}

#[test]
fn same_bin_legacy_retry_triggers_on_mode_and_print_conflict() {
    assert!(should_retry_same_bin_in_legacy_mode(
        "[Error] `--mode json` cannot be combined with `-p/--print`."
    ));
}
