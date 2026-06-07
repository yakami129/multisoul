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

/// `msctl spec --help` must list grouped subcommands `save` and `mark-done`.
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

    assert!(
        help.contains("save"),
        "spec --help should list the save subcommand, got: {help}"
    );
    assert!(
        help.contains("mark-done"),
        "spec --help should list the mark-done subcommand, got: {help}"
    );
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
