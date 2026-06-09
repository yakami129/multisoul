use super::*;
use clap::{Command, FromArgMatches, Subcommand};

fn spec_command() -> Command {
    SpecCommands::augment_subcommands(Command::new("spec"))
}

fn parse_spec_args(args: &[&str]) -> SpecCommands {
    let command = spec_command();
    let matches = command
        .try_get_matches_from(args)
        .expect("spec args should parse");
    SpecCommands::from_arg_matches(&matches).expect("matches should map to SpecCommands")
}

/// `msctl spec --help` must list grouped spec subcommands.
///
/// 数据构造：
///   clap tree = SpecCommands augmented under `spec`
///
/// 执行过程：
///   1. 渲染 long help
///   2. 检查子命令名称是否出现在 help 文本中
///
/// 预期结果：
///   - 断言 A：help 包含 save
///   - 断言 B：help 包含 mark-done
#[test]
fn spec_help_lists_save_and_mark_done_subcommands() {
    let mut cmd = spec_command();
    let help = cmd.render_help().to_string();

    for subcommand in [
        "list",
        "get",
        "save",
        "delete",
        "implement",
        "mark-done",
        "dispatch",
        "idea",
    ] {
        assert!(
            help.contains(subcommand),
            "spec --help should list {subcommand}, got: {help}"
        );
    }
}

/// `msctl spec save` parses required flags without HTTP.
///
/// 数据构造：
///   argv = spec save --path docs/product-specs/SPEC.md --conversation-id cnv_abc
///
/// 执行过程：
///   1. clap 解析 argv
///   2. 映射到 SpecCommands::Save
///
/// 预期结果：
///   - 断言 A：variant 为 Save
///   - 断言 B：path 与 conversation_id 原样保留
#[test]
fn spec_clap_parses_save_subcommand() {
    match parse_spec_args(&[
        "spec",
        "save",
        "--path",
        "docs/product-specs/SPEC.md",
        "--conversation-id",
        "cnv_abc",
    ]) {
        SpecCommands::Save(args) => {
            assert_eq!(args.path, "docs/product-specs/SPEC.md");
            assert_eq!(args.conversation_id, "cnv_abc");
        }
        _ => panic!("expected SpecCommands::Save"),
    }
}

/// `msctl spec mark-done` parses required flags without HTTP.
///
/// 数据构造：
///   argv = spec mark-done --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda
///
/// 执行过程：
///   1. clap 解析 argv
///   2. 映射到 SpecCommands::MarkDone
///
/// 预期结果：
///   - 断言 A：variant 为 MarkDone
///   - 断言 B：spec_id 原样保留
#[test]
fn spec_clap_parses_mark_done_subcommand() {
    match parse_spec_args(&[
        "spec",
        "mark-done",
        "--spec-id",
        "05521d4e-021e-43eb-9f7e-fa97d8b91fda",
    ]) {
        SpecCommands::MarkDone(args) => {
            assert_eq!(args.spec_id, "05521d4e-021e-43eb-9f7e-fa97d8b91fda");
        }
        _ => panic!("expected SpecCommands::MarkDone"),
    }
}

/// `msctl spec dispatch` parses JSON body inputs without HTTP.
///
/// 数据构造：
///   argv = spec dispatch --agent-id agent-1 --json {"title":"Demo","slug":"demo","markdown":"# Demo"}
///
/// 执行过程：
///   1. clap 解析 argv
///   2. 映射到 SpecCommands::Dispatch
///
/// 预期结果：
///   - 断言 A：variant 为 Dispatch
///   - 断言 B：agent_id 与 inline json 原样保留
#[test]
fn spec_clap_parses_dispatch_json_subcommand() {
    match parse_spec_args(&[
        "spec",
        "dispatch",
        "--agent-id",
        "agent-1",
        "--json",
        r##"{"title":"Demo","slug":"demo","markdown":"# Demo"}"##,
    ]) {
        SpecCommands::Dispatch(args) => {
            assert_eq!(args.agent_id, "agent-1");
            assert!(args.input.json.unwrap().contains("\"slug\":\"demo\""));
        }
        _ => panic!("expected SpecCommands::Dispatch"),
    }
}

/// `msctl spec idea update` parses nested idea commands without HTTP.
///
/// 数据构造：
///   argv = spec idea update --idea-id idea-1 --json {"status":"open"}
///
/// 执行过程：
///   1. clap 解析 argv
///   2. 映射到 SpecCommands::Idea -> SpecIdeaCommands::Update
///
/// 预期结果：
///   - 断言 A：outer variant 为 Idea
///   - 断言 B：inner variant 为 Update
#[test]
fn spec_clap_parses_idea_update_subcommand() {
    match parse_spec_args(&[
        "spec",
        "idea",
        "update",
        "--idea-id",
        "idea-1",
        "--json",
        r#"{"status":"open"}"#,
    ]) {
        SpecCommands::Idea { subcommand } => match subcommand {
            crate::commands::spec_idea::SpecIdeaCommands::Update(args) => {
                assert_eq!(args.idea_id, "idea-1");
                assert_eq!(args.input.json.as_deref(), Some(r#"{"status":"open"}"#));
            }
            _ => panic!("expected SpecIdeaCommands::Update"),
        },
        _ => panic!("expected SpecCommands::Idea"),
    }
}

/// `--json` and `--json-file` are mutually exclusive for JSON body commands.
///
/// 数据构造：
///   argv = spec dispatch --agent-id agent-1 --json {...} --json-file body.json
///
/// 执行过程：
///   1. clap 尝试解析 argv
///
/// 预期结果：
///   - 断言 A：解析失败
#[test]
fn spec_clap_rejects_json_and_json_file_together() {
    let command = spec_command();
    let result = command.try_get_matches_from([
        "spec",
        "dispatch",
        "--agent-id",
        "agent-1",
        "--json",
        r#"{"title":"Demo"}"#,
        "--json-file",
        "body.json",
    ]);
    assert!(
        result.is_err(),
        "--json and --json-file should be mutually exclusive"
    );
}
