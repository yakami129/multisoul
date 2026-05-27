use super::*;
use crate::commands::agent::AgentCommands;
use clap::{Command, FromArgMatches, Subcommand};

fn open_temp_db(dir: &tempfile::TempDir) -> rusqlite::Connection {
    crate::db::open_at(&dir.path().join("test.db")).expect("temp DB should open")
}

fn parse_agent_args(args: &[&str]) -> AgentCommands {
    let command = AgentCommands::augment_subcommands(Command::new("agent"));
    let matches = command
        .try_get_matches_from(args)
        .expect("agent args should parse");
    AgentCommands::from_arg_matches(&matches).expect("matches should map to AgentCommands")
}

/// quick register runtime validation: accepts supported runtimes and rejects unknown values.
///
/// 数据构造：
///   accepted = codex / claude-code / cursor-cli
///   rejected = unknown
///
/// 执行过程：
///   1. 分别校验三个支持的 runtime → Ok
///   2. 校验 unknown → Err，错误文案列出合法值
///
/// 预期结果：
///   - 正断言：三个支持 runtime 都可通过
///   - 负断言：unknown 不可通过，且错误文案可诊断
#[test]
fn test_quick_register_accepts_all_current_runtimes() {
    assert!(
        validate_quick_register_runtime("codex").is_ok(),
        "quick register should accept codex runtime"
    );
    assert!(
        validate_quick_register_runtime("claude-code").is_ok(),
        "quick register should accept claude-code runtime"
    );
    assert!(
        validate_quick_register_runtime("cursor-cli").is_ok(),
        "quick register should accept cursor-cli runtime"
    );
    let message = validate_quick_register_runtime("unknown")
        .expect_err("unknown runtime should be rejected")
        .to_string();
    assert!(
        message.contains("claude-code, codex, cursor-cli"),
        "invalid runtime error should list every supported runtime"
    );
}

/// quick register clap parsing: runtime shortcuts become external-subcommand args.
///
/// 数据构造：
///   argv1 = ["agent", "codex"]
///   argv2 = ["agent", "claude-code"]
///   argv3 = ["agent", "cursor-cli"]
///
/// 执行过程：
///   1. 解析 codex → AgentCommands::QuickRegister(["codex"])
///   2. 解析 claude-code → AgentCommands::QuickRegister(["claude-code"])
///   3. 解析 cursor-cli → AgentCommands::QuickRegister(["cursor-cli"])
///
/// 预期结果：
///   - 正断言：三条快捷命令均进入 QuickRegister
///   - 负断言：三条快捷命令均不应误解析为传统子命令
#[test]
fn test_quick_register_clap_parses_runtime_shortcuts() {
    match parse_agent_args(&["agent", "codex"]) {
        AgentCommands::QuickRegister(args) => assert_eq!(
            args,
            vec!["codex".to_string()],
            "codex shortcut should parse as the sole quick-register arg"
        ),
        _ => panic!("codex shortcut must not parse as a traditional subcommand"),
    }
    match parse_agent_args(&["agent", "claude-code"]) {
        AgentCommands::QuickRegister(args) => assert_eq!(
            args,
            vec!["claude-code".to_string()],
            "claude-code shortcut should parse as the sole quick-register arg"
        ),
        _ => panic!("claude-code shortcut must not parse as a traditional subcommand"),
    }
    match parse_agent_args(&["agent", "cursor-cli"]) {
        AgentCommands::QuickRegister(args) => assert_eq!(
            args,
            vec!["cursor-cli".to_string()],
            "cursor-cli shortcut should parse as the sole quick-register arg"
        ),
        _ => panic!("cursor-cli shortcut must not parse as a traditional subcommand"),
    }
}

/// quick register preflight: invalid inputs fail before DB-backed work is needed.
///
/// 数据构造：
///   invalid runtime args = ["unknown"]
///   extra args           = ["codex", "extra"]
///   root workspace       = "/"（无法推断目录名）
///
/// 执行过程：
///   1. unknown + valid workspace → Err
///   2. codex extra + valid workspace → Err
///   3. codex + root workspace → Err
///
/// 预期结果：
///   - 负断言：非法 runtime、额外参数、无名称 workspace 都在 preflight 失败
///   - 正断言：错误信息说明具体失败原因
#[test]
fn test_quick_register_preflight_rejects_invalid_inputs_without_db() {
    let workspace = std::path::PathBuf::from("/tmp/demo-project");
    let invalid_runtime = quick_register_preflight(vec!["unknown".to_string()], workspace.clone());
    assert!(
        invalid_runtime.is_err(),
        "invalid runtime should fail during preflight before DB open"
    );
    assert!(
        invalid_runtime
            .expect_err("unknown runtime should be rejected")
            .to_string()
            .contains("Invalid runtime 'unknown'"),
        "invalid runtime error should identify the rejected runtime"
    );
    match parse_agent_args(&["agent", "codex", "extra"]) {
        AgentCommands::QuickRegister(args) => {
            assert_eq!(
                args,
                vec!["codex".to_string(), "extra".to_string()],
                "extra argv should remain quick-register args for preflight rejection"
            );
            let wrong_count = quick_register_preflight(args, workspace);
            assert!(
                wrong_count
                    .expect_err("extra args should be rejected by preflight")
                    .to_string()
                    .contains("expects exactly one runtime"),
                "wrong arg count error should explain the expected arity"
            );
        }
        _ => panic!("extra quick-register argv must not parse as a traditional subcommand"),
    }
    let root_workspace =
        quick_register_preflight(vec!["codex".to_string()], std::path::PathBuf::from("/"));
    assert!(
        root_workspace
            .expect_err("root workspace should be rejected")
            .to_string()
            .contains("Cannot infer agent name"),
        "root workspace error should explain name inference failure"
    );
}

/// quick register help: external runtime shortcuts are documented despite being hidden by clap.
///
/// 数据构造：
///   command = AgentCommands clap command
///   examples = codex / claude-code / cursor-cli quick-register lines
///
/// 执行过程：
///   1. 渲染 agent help
///   2. 检查三个示例和传统 register 子命令
///
/// 预期结果：
///   - 正断言：三个快捷示例均出现
///   - 负断言：help 不应遗漏传统 register 子命令
#[test]
fn test_quick_register_help_documents_runtime_shortcuts() {
    let mut command = AgentCommands::augment_subcommands(Command::new("agent"));
    let help = command.render_help().to_string();
    assert!(
        help.contains("msctl agent codex"),
        "agent help should document the codex quick-register shortcut"
    );
    assert!(
        help.contains("msctl agent claude-code"),
        "agent help should document the claude-code quick-register shortcut"
    );
    assert!(
        help.contains("msctl agent cursor-cli"),
        "agent help should document the cursor-cli quick-register shortcut"
    );
    assert!(
        help.contains("register"),
        "agent help should preserve existing traditional subcommands"
    );
}

/// quick register name selection: basename is inferred and conflicts are global.
///
/// 数据构造：
///   workspace = /Users/alan/projects/multisoul → multisoul
///   existing names = demo, demo-2 in different project paths
///
/// 执行过程：
///   1. 推断 workspace 名称
///   2. 插入 demo 和 demo-2
///   3. 查找 demo 可用名称
///
/// 预期结果：
///   - 正断言：workspace basename 为 multisoul，冲突后候选为 demo-3
///   - 负断言：根路径不可推断名称，demo-3 不应被 helper 插入
#[test]
fn test_quick_register_infers_name_and_resolves_global_conflicts() {
    let name =
        infer_agent_name_from_workspace(std::path::Path::new("/Users/alan/projects/multisoul"))
            .expect("workspace with basename should infer an agent name");
    assert_eq!(
        name, "multisoul",
        "workspace basename should become the quick-register agent name"
    );
    assert!(
        infer_agent_name_from_workspace(std::path::Path::new("/")).is_err(),
        "root path must not infer an empty or slash agent name"
    );

    let dir = tempfile::tempdir().expect("temp dir should be created for conflict test");
    let conn = open_temp_db(&dir);
    crate::commands::agent::insert_agent(&conn, "demo", "/repo-a", "codex", "full-auto")
        .expect("pre-existing demo agent should be inserted");
    crate::commands::agent::insert_agent(&conn, "demo-2", "/repo-b", "claude-code", "full-auto")
        .expect("pre-existing demo-2 agent should be inserted");
    let candidate = find_available_agent_name(&conn, "demo")
        .expect("conflict resolution should find an available name");
    assert_eq!(
        candidate, "demo-3",
        "quick register should skip globally existing demo and demo-2 names"
    );
    let demo3_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE name = 'demo-3'",
            [],
            |r| r.get(0),
        )
        .expect("demo-3 count query should succeed");
    assert_eq!(
        demo3_count, 0,
        "name conflict helper must not insert the selected candidate"
    );
}

/// quick register codex: writes DB row with default mode and injects AGENTS.md.
///
/// 数据构造：
///   workspace = temp/quick-demo
///   runtime = codex
///   default mode = full-auto
///
/// 执行过程：
///   1. 创建 workspace
///   2. quick_register_in_workspace(codex)
///   3. 查询 name/project_path/runtime/mode
///
/// 预期结果：
///   - 正断言：DB row 字段与默认 mode 正确，AGENTS.md 存在
///   - 负断言：codex 不应注入 CLAUDE.md
#[test]
fn test_quick_register_codex_writes_agent_and_injects_context() {
    let dir = tempfile::tempdir().expect("temp dir should be created for quick register");
    let conn = open_temp_db(&dir);
    let workspace = dir.path().join("quick-demo");
    std::fs::create_dir_all(&workspace).expect("quick-demo workspace should be created");
    let result = quick_register_in_workspace(&conn, "codex", &workspace)
        .expect("codex quick register should succeed");
    assert_eq!(
        result.name, "quick-demo",
        "result should use workspace basename as agent name"
    );
    let row: (String, String, String, String) = conn
        .query_row(
            "SELECT name, project_path, runtime, mode FROM agents WHERE name = 'quick-demo'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .expect("quick-demo row should be queryable");
    assert_eq!(row.0, "quick-demo", "DB name should match inferred name");
    assert_eq!(
        row.1,
        workspace.to_str().expect("workspace path should be UTF-8"),
        "DB project_path should match workspace"
    );
    assert_eq!(row.2, "codex", "DB runtime should match requested runtime");
    assert_eq!(
        row.3, "full-auto",
        "DB mode should use quick-register default"
    );
    assert!(
        workspace.join("AGENTS.md").exists(),
        "codex should inject AGENTS.md"
    );
    assert!(
        !workspace.join("CLAUDE.md").exists(),
        "codex must not inject CLAUDE.md"
    );
}

/// quick register injection failure: inserted row is rolled back before success output.
///
/// 数据构造：
///   workspace = temp/collision-demo
///   conflict = workspace/AGENTS.md directory, so AGENTS.md file write fails
///
/// 执行过程：
///   1. 创建 workspace 和 AGENTS.md 目录
///   2. quick_register_in_workspace(codex)
///   3. 查询 collision-demo row count
///
/// 预期结果：
///   - 负断言：注册返回 Err，DB row 被删除
///   - 正断言：冲突目录仍存在，证明失败来自注入目标冲突
#[test]
fn test_quick_register_rolls_back_agent_row_when_injection_fails() {
    let dir = tempfile::tempdir().expect("temp dir should be created for rollback test");
    let conn = open_temp_db(&dir);
    let workspace = dir.path().join("collision-demo");
    std::fs::create_dir_all(&workspace).expect("collision workspace should be created");
    std::fs::create_dir(workspace.join("AGENTS.md"))
        .expect("AGENTS.md directory should force inject write failure");
    assert!(
        quick_register_in_workspace(&conn, "codex", &workspace).is_err(),
        "quick register should fail when context injection cannot write AGENTS.md"
    );
    let row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE name = 'collision-demo'",
            [],
            |r| r.get(0),
        )
        .expect("collision-demo row count should be queryable");
    assert_eq!(
        row_count, 0,
        "quick register must remove the inserted agent row when injection fails"
    );
    assert!(
        workspace.join("AGENTS.md").is_dir(),
        "AGENTS.md directory should remain as the injection collision source"
    );
}

/// quick register alternate runtimes: claude-code and cursor-cli persist fields and route injection.
///
/// 数据构造：
///   claude workspace = temp/claude-demo
///   cursor workspace = temp/cursor-demo
///
/// 执行过程：
///   1. quick register claude-code
///   2. quick register cursor-cli
///   3. 查询两条 row 的 name/project_path/runtime/mode
///
/// 预期结果：
///   - 正断言：两条 DB row 字段完整且 mode=full-auto
///   - 负断言：claude-code 不写 AGENTS.md，cursor-cli 不写 CLAUDE.md
#[test]
fn test_quick_register_supports_claude_code_and_cursor_cli() {
    let dir = tempfile::tempdir().expect("temp dir should be created for runtime tests");
    let conn = open_temp_db(&dir);
    let claude_workspace = dir.path().join("claude-demo");
    let cursor_workspace = dir.path().join("cursor-demo");
    std::fs::create_dir_all(&claude_workspace).expect("claude workspace should be created");
    std::fs::create_dir_all(&cursor_workspace).expect("cursor workspace should be created");
    quick_register_in_workspace(&conn, "claude-code", &claude_workspace)
        .expect("claude-code quick register should succeed");
    quick_register_in_workspace(&conn, "cursor-cli", &cursor_workspace)
        .expect("cursor-cli quick register should succeed");

    let claude: (String, String, String, String) = conn
        .query_row(
            "SELECT name, project_path, runtime, mode FROM agents WHERE name = 'claude-demo'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .expect("claude-demo row should be queryable");
    assert_eq!(
        claude.0, "claude-demo",
        "claude DB name should match workspace"
    );
    assert_eq!(
        claude.1,
        claude_workspace
            .to_str()
            .expect("claude path should be UTF-8"),
        "claude DB project_path should match workspace"
    );
    assert_eq!(
        claude.2, "claude-code",
        "claude DB runtime should be claude-code"
    );
    assert_eq!(
        claude.3, "full-auto",
        "claude DB mode should use quick default"
    );
    assert!(
        claude_workspace.join("CLAUDE.md").exists(),
        "claude-code should inject CLAUDE.md"
    );
    assert!(
        !claude_workspace.join("AGENTS.md").exists(),
        "claude-code must not inject AGENTS.md"
    );

    let cursor: (String, String, String, String) = conn
        .query_row(
            "SELECT name, project_path, runtime, mode FROM agents WHERE name = 'cursor-demo'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .expect("cursor-demo row should be queryable");
    assert_eq!(
        cursor.0, "cursor-demo",
        "cursor DB name should match workspace"
    );
    assert_eq!(
        cursor.1,
        cursor_workspace
            .to_str()
            .expect("cursor path should be UTF-8"),
        "cursor DB project_path should match workspace"
    );
    assert_eq!(
        cursor.2, "cursor-cli",
        "cursor DB runtime should be cursor-cli"
    );
    assert_eq!(
        cursor.3, "full-auto",
        "cursor DB mode should use quick default"
    );
    assert!(
        cursor_workspace.join("AGENTS.md").exists(),
        "cursor-cli should inject AGENTS.md"
    );
    assert!(
        !cursor_workspace.join("CLAUDE.md").exists(),
        "cursor-cli must not inject CLAUDE.md"
    );
}
