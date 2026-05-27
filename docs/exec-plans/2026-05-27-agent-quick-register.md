# Agent Quick Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Before writing code for any task, add or update the failing tests first.

**Spec:** [`docs/product-specs/SPEC-agent-quick-register.md`](../product-specs/SPEC-agent-quick-register.md)

**Goal:** Add `msctl agent <runtime>` as a quick registration path that supports `codex`, `claude-code`, and `cursor-cli` while preserving every existing `msctl agent register` behavior.

**Architecture:** Keep the existing `agents` schema unchanged and implement quick registration inside `cli/src/commands/agent.rs`. Add small helper functions for runtime validation, workspace name inference, global name conflict resolution, and shared runtime-agent registration; the old `register` path calls the shared helper so its output and `--project` requirement stay unchanged. Update the injected command reference and CLI reference docs so users can discover the new shortcut.

**Tech Stack:** Rust 2021, clap 4 derive, rusqlite, anyhow, tempfile, existing `msctl` CLI docs.

---

## Task 0: Baseline And Scope Check

**Files:**
- Reference: `docs/product-specs/SPEC-agent-quick-register.md`
- Reference: `cli/src/commands/agent.rs`
- Reference: `cli/src/commands/inject.rs`
- Reference: `cli/src/templates/commands.md`
- Reference: `docs/references/cli-commands.md`
- Reference: `docs/references/msctl-inject.md`

- [ ] **Step 1: Confirm the working tree before implementation**

Run:

```bash
git status --short
```

Expected: note pre-existing user changes before editing. Do not revert unrelated files.

- [ ] **Step 2: Run baseline CLI tests**

Run:

```bash
cd cli && cargo test commands::agent::tests
```

Expected: current `commands::agent` tests pass before the feature tests are added.

- [ ] **Step 3: Run baseline CLI build**

Run:

```bash
cd cli && cargo build
```

Expected: build succeeds before implementation.

## Task 1: Add Quick Registration Unit Tests First

**Files:**
- Modify: `cli/src/commands/agent.rs`

- [ ] **Step 1: Add failing tests to the existing `#[cfg(test)] mod tests`**

Append these tests inside `cli/src/commands/agent.rs`'s existing test module. These tests intentionally call helpers that do not exist yet; that is the RED state.

```rust
    /// quick register runtime validation: current runtime set is accepted and unknown values are rejected.
    ///
    /// 数据构造：
    ///   accepted_runtime_codex       = "codex"
    ///   accepted_runtime_claude_code = "claude-code"
    ///   accepted_runtime_cursor_cli  = "cursor-cli"
    ///   rejected_runtime             = "unknown"
    ///
    /// 执行过程：
    ///   1. 分别校验 codex / claude-code / cursor-cli → 都应通过
    ///   2. 校验 unknown → 应返回错误，且错误文案列出全部合法 runtime
    ///
    /// 预期结果：
    ///   - codex 应被接受
    ///   - claude-code 应被接受
    ///   - cursor-cli 应被接受
    ///   - unknown 不应被接受
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

        let result = validate_quick_register_runtime("unknown");
        assert!(
            result.is_err(),
            "quick register must reject unknown runtime values"
        );
        let message = result.unwrap_err().to_string();
        assert!(
            message.contains("claude-code, codex, cursor-cli"),
            "invalid runtime error should list every supported runtime"
        );
    }

    /// quick register name inference: workspace basename becomes the agent name and root-like paths fail.
    ///
    /// 数据构造：
    ///   workspace = "/Users/alan/projects/multisoul" → basename "multisoul"
    ///   root      = "/" → no usable basename
    ///
    /// 执行过程：
    ///   1. 调用 infer_agent_name_from_workspace(workspace) → 返回 "multisoul"
    ///   2. 调用 infer_agent_name_from_workspace(root) → 返回错误
    ///
    /// 预期结果：
    ///   - 正断言：普通 workspace 应推断出 multisoul
    ///   - 负断言：根路径不应被注册成空名称或 "/"
    #[test]
    fn test_quick_register_infers_name_from_workspace_basename() {
        let name = infer_agent_name_from_workspace(std::path::Path::new(
            "/Users/alan/projects/multisoul",
        ))
        .unwrap();
        assert_eq!(
            name, "multisoul",
            "workspace basename should become the quick-register agent name"
        );

        let root_result = infer_agent_name_from_workspace(std::path::Path::new("/"));
        assert!(
            root_result.is_err(),
            "root path must not infer an empty or slash agent name"
        );
    }

    /// quick register conflict resolution: names are globally unique, not scoped by project_path.
    ///
    /// 数据构造：
    ///   existing agent A: name="demo",   project_path="/repo-a"
    ///   existing agent B: name="demo-2", project_path="/repo-b"
    ///   candidate base:   "demo"
    ///
    /// 执行过程：
    ///   1. 插入 demo 和 demo-2，且二者 project_path 不同
    ///   2. 调用 find_available_agent_name(&conn, "demo")
    ///   3. 查询 demo-3 在调用前是否已经存在
    ///
    /// 预期结果：
    ///   - 正断言：候选名应为 demo-3
    ///   - 负断言：find_available_agent_name 只选名，不应插入 demo-3
    #[test]
    fn test_quick_register_name_conflict_is_global() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        insert_agent(&conn, "demo", "/repo-a", "codex", "full-auto").unwrap();
        insert_agent(&conn, "demo-2", "/repo-b", "claude-code", "full-auto").unwrap();

        let candidate = find_available_agent_name(&conn, "demo").unwrap();
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
            .unwrap();
        assert_eq!(
            demo3_count, 0,
            "name conflict helper must not insert the selected candidate"
        );
    }

    /// quick register: codex path writes a runtime agent, default mode, and AGENTS.md context.
    ///
    /// 数据构造：
    ///   workspace dir = temp/quick-demo
    ///   runtime       = "codex"
    ///   expected name = "quick-demo"
    ///   expected mode = "full-auto"
    ///
    /// 执行过程：
    ///   1. 创建 temp/quick-demo 目录
    ///   2. 调用 quick_register_in_workspace(&conn, "codex", &workspace)
    ///   3. 查询 agents 表中的 name/project_path/runtime/mode
    ///   4. 检查 workspace 中的注入文件
    ///
    /// 预期结果：
    ///   - 正断言：DB 中存在 quick-demo/codex/full-auto
    ///   - 正断言：codex 注入 AGENTS.md
    ///   - 负断言：codex 不应注入 CLAUDE.md
    #[test]
    fn test_quick_register_codex_writes_agent_and_injects_context() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        let workspace = dir.path().join("quick-demo");
        std::fs::create_dir_all(&workspace).unwrap();

        let result = quick_register_in_workspace(&conn, "codex", &workspace).unwrap();
        assert_eq!(
            result.name, "quick-demo",
            "quick register should use workspace basename as agent name"
        );
        assert_eq!(
            result.runtime, "codex",
            "quick register result should preserve the requested runtime"
        );
        assert_eq!(
            result.project_path,
            workspace.to_str().unwrap(),
            "quick register should persist the current workspace path"
        );

        let mode: String = conn
            .query_row(
                "SELECT mode FROM agents WHERE name = 'quick-demo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            mode, "full-auto",
            "quick register should store the runtime-agent default mode"
        );
        assert!(
            workspace.join("AGENTS.md").exists(),
            "codex quick register should inject AGENTS.md context"
        );
        assert!(
            !workspace.join("CLAUDE.md").exists(),
            "codex quick register must not inject CLAUDE.md"
        );
    }

    /// quick register: claude-code and cursor-cli both use the quick path with runtime-specific injection targets.
    ///
    /// 数据构造：
    ///   claude workspace = temp/claude-demo, runtime "claude-code"
    ///   cursor workspace = temp/cursor-demo, runtime "cursor-cli"
    ///
    /// 执行过程：
    ///   1. 分别调用 quick_register_in_workspace 注册 claude-code 与 cursor-cli
    ///   2. 查询两条 agent 记录的 runtime
    ///   3. 检查注入目标文件
    ///
    /// 预期结果：
    ///   - claude-code 入库并注入 CLAUDE.md
    ///   - cursor-cli 入库并注入 AGENTS.md
    ///   - cursor-cli 不应注入 CLAUDE.md
    #[test]
    fn test_quick_register_supports_claude_code_and_cursor_cli() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        let claude_workspace = dir.path().join("claude-demo");
        let cursor_workspace = dir.path().join("cursor-demo");
        std::fs::create_dir_all(&claude_workspace).unwrap();
        std::fs::create_dir_all(&cursor_workspace).unwrap();

        let claude = quick_register_in_workspace(&conn, "claude-code", &claude_workspace).unwrap();
        let cursor = quick_register_in_workspace(&conn, "cursor-cli", &cursor_workspace).unwrap();

        assert_eq!(
            claude.runtime, "claude-code",
            "quick register should support claude-code runtime"
        );
        assert_eq!(
            cursor.runtime, "cursor-cli",
            "quick register should support cursor-cli runtime"
        );
        assert!(
            claude_workspace.join("CLAUDE.md").exists(),
            "claude-code quick register should inject CLAUDE.md"
        );
        assert!(
            !claude_workspace.join("AGENTS.md").exists(),
            "claude-code quick register must not inject AGENTS.md"
        );
        assert!(
            cursor_workspace.join("AGENTS.md").exists(),
            "cursor-cli quick register should inject AGENTS.md"
        );
        assert!(
            !cursor_workspace.join("CLAUDE.md").exists(),
            "cursor-cli quick register must not inject CLAUDE.md"
        );
    }

    /// legacy register helper: explicit mode is preserved and not overwritten by quick-register defaults.
    ///
    /// 数据构造：
    ///   name         = "legacy-mode"
    ///   project_path = temp/legacy-project
    ///   runtime      = "codex"
    ///   explicit mode = "suggest"
    ///
    /// 执行过程：
    ///   1. 调用 register_runtime_agent(..., mode="suggest")
    ///   2. 查询 agents.mode
    ///   3. 检查 codex 注入目标
    ///
    /// 预期结果：
    ///   - 正断言：mode 仍为 suggest
    ///   - 负断言：mode 不应被 quick register 的 full-auto 默认值覆盖
    #[test]
    fn test_quick_register_does_not_change_legacy_mode_registration() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        let workspace = dir.path().join("legacy-project");
        std::fs::create_dir_all(&workspace).unwrap();

        let id = register_runtime_agent(
            &conn,
            "legacy-mode",
            workspace.to_str().unwrap(),
            "codex",
            "suggest",
        )
        .unwrap();
        assert!(
            !id.trim().is_empty(),
            "legacy runtime registration should still return a generated id"
        );

        let mode: String = conn
            .query_row(
                "SELECT mode FROM agents WHERE name = 'legacy-mode'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            mode, "suggest",
            "legacy register explicit mode must not be overwritten by quick-register defaults"
        );
        assert!(
            workspace.join("AGENTS.md").exists(),
            "legacy codex registration should still inject AGENTS.md context"
        );
    }
```

- [ ] **Step 2: Verify RED**

Run:

```bash
cd cli && cargo test quick_register -- --nocapture
```

Expected: FAIL to compile with unresolved helper names such as `validate_quick_register_runtime`, `infer_agent_name_from_workspace`, `find_available_agent_name`, `quick_register_in_workspace`, and `register_runtime_agent`.

## Task 2: Implement Shared Runtime Registration Helpers

**Files:**
- Modify: `cli/src/commands/agent.rs`

- [ ] **Step 1: Add imports, constants, result type, and helper functions**

In `cli/src/commands/agent.rs`, update imports and add the following code below `AgentRow`:

```rust
use std::path::Path;
```

```rust
const QUICK_REGISTER_RUNTIMES: &[&str] = &["claude-code", "codex", "cursor-cli"];
const DEFAULT_RUNTIME_MODE: &str = "full-auto";

#[derive(Debug, Clone, PartialEq, Eq)]
struct QuickRegisterResult {
    id: String,
    name: String,
    project_path: String,
    runtime: String,
}

fn valid_runtime_values() -> &'static str {
    "claude-code, codex, cursor-cli"
}

fn validate_quick_register_runtime(runtime: &str) -> Result<()> {
    if QUICK_REGISTER_RUNTIMES.contains(&runtime) {
        Ok(())
    } else {
        anyhow::bail!(
            "Invalid runtime '{}'. Valid values: {}",
            runtime,
            valid_runtime_values()
        );
    }
}

fn infer_agent_name_from_workspace(workspace: &Path) -> Result<String> {
    workspace
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(ToOwned::to_owned)
        .context("Cannot infer agent name from current directory")
}

fn workspace_to_project_path(workspace: &Path) -> Result<String> {
    workspace
        .to_str()
        .map(ToOwned::to_owned)
        .context("Workspace path must be valid UTF-8")
}

fn agent_name_exists(conn: &Connection, name: &str) -> Result<bool> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE name = ?1",
            [name],
            |r| r.get(0),
        )
        .context("Failed to check existing agent name")?;
    Ok(count > 0)
}

fn find_available_agent_name(conn: &Connection, base: &str) -> Result<String> {
    if !agent_name_exists(conn, base)? {
        return Ok(base.to_string());
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{}-{}", base, suffix);
        if !agent_name_exists(conn, &candidate)? {
            return Ok(candidate);
        }
        suffix += 1;
    }
}
```

- [ ] **Step 2: Extract shared registration without changing old output**

Replace the existing `register` function with this pair:

```rust
fn register_runtime_agent(
    conn: &Connection,
    name: &str,
    project: &str,
    runtime: &str,
    mode: &str,
) -> Result<String> {
    let id = insert_agent(conn, name, project, runtime, mode)?;
    inject_context(runtime, Path::new(project))?;
    Ok(id)
}

fn register(conn: &Connection, name: &str, project: &str, runtime: &str, mode: &str) -> Result<()> {
    let id = register_runtime_agent(conn, name, project, runtime, mode)?;
    println!("Agent registered. ID: {}", id);
    Ok(())
}
```

- [ ] **Step 3: Implement quick registration core without CLI printing**

Add this function below `register`:

```rust
fn quick_register_in_workspace(
    conn: &Connection,
    runtime: &str,
    workspace: &Path,
) -> Result<QuickRegisterResult> {
    validate_quick_register_runtime(runtime)?;
    let base_name = infer_agent_name_from_workspace(workspace)?;
    let name = find_available_agent_name(conn, &base_name)?;
    let project_path = workspace_to_project_path(workspace)?;
    let id = register_runtime_agent(conn, &name, &project_path, runtime, DEFAULT_RUNTIME_MODE)?;

    Ok(QuickRegisterResult {
        id,
        name,
        project_path,
        runtime: runtime.to_string(),
    })
}
```

- [ ] **Step 4: Verify helper tests GREEN**

Run:

```bash
cd cli && cargo test quick_register -- --nocapture
```

Expected: PASS for the new quick-register tests.

## Task 3: Wire Clap External Subcommand And CLI Output

**Files:**
- Modify: `cli/src/commands/agent.rs`

- [ ] **Step 1: Add the external subcommand variant**

Add this variant at the end of `AgentCommands`, after `Restart { id: String },`:

```rust
    /// Quick register current directory with a runtime: codex | claude-code | cursor-cli
    #[command(external_subcommand)]
    QuickRegister(Vec<String>),
```

- [ ] **Step 2: Route the new variant in `handle`**

Add this match arm after the existing `Restart` arm:

```rust
        AgentCommands::QuickRegister(args) => quick_register(&conn, args),
```

- [ ] **Step 3: Add CLI-facing quick-register function**

Add this function below `quick_register_in_workspace`:

```rust
fn quick_register(conn: &Connection, args: Vec<String>) -> Result<()> {
    if args.len() != 1 {
        anyhow::bail!(
            "Quick register expects exactly one runtime. Valid values: {}",
            valid_runtime_values()
        );
    }

    let runtime = &args[0];
    let workspace =
        std::env::current_dir().context("Failed to access current directory")?;
    let result = quick_register_in_workspace(conn, runtime, &workspace)?;

    println!("Agent '{}' registered successfully", result.name);
    println!("ID: {}", result.id);
    println!("Workspace: {}", result.project_path);
    println!("Runtime: {}", result.runtime);
    Ok(())
}
```

- [ ] **Step 4: Verify existing register tests still pass**

Run:

```bash
cd cli && cargo test commands::agent::tests -- --nocapture
```

Expected: PASS. Existing tests for `insert_agent`, duplicate-name behavior, cursor runtime storage, and plugin registration still pass.

## Task 4: Update User-Facing Command References

**Files:**
- Modify: `cli/src/templates/commands.md`
- Modify: `docs/references/msctl-inject.md`
- Modify: `docs/references/cli-commands.md`

- [ ] **Step 1: Update injected quick reference**

In both `cli/src/templates/commands.md` and `docs/references/msctl-inject.md`, add quick-register examples under `### Agent` before the long-form register examples:

```markdown
msctl agent codex            # Quick register current project with Codex
msctl agent claude-code      # Quick register current project with Claude Code
msctl agent cursor-cli       # Quick register current project with Cursor
```

Also add the missing long-form cursor example next to the existing long-form examples:

```markdown
msctl agent register --name <name> --project <path> --runtime cursor-cli
```

- [ ] **Step 2: Update CLI command reference**

In `docs/references/cli-commands.md`, add an `agent <runtime>` row before `agent register`:

```markdown
| `agent <runtime>` | `codex` \| `claude-code` \| `cursor-cli` | 快速注册当前目录为 agent |
```

Update the `--runtime` row in the `agent register` parameter table to include cursor:

```markdown
| `--runtime` | `claude-code` | 运行时：`claude-code` \| `codex` \| `cursor-cli` |
```

- [ ] **Step 3: Verify docs contain all three runtimes**

Run:

```bash
rg -n "msctl agent (codex|claude-code|cursor-cli)|claude-code.*codex.*cursor-cli" cli/src/templates docs/references
```

Expected: output includes quick-register examples for all three runtimes and the long-form runtime list with cursor.

## Task 5: Full Verification And Smoke Checks

**Files:**
- Verify: `cli/src/commands/agent.rs`
- Verify: `cli/src/templates/commands.md`
- Verify: `docs/references/msctl-inject.md`
- Verify: `docs/references/cli-commands.md`
- Verify: `docs/exec-plans/index.json`

- [ ] **Step 1: Run targeted tests**

Run:

```bash
cd cli && cargo test quick_register -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Run full CLI test suite**

Run:

```bash
cd cli && cargo test
```

Expected: PASS.

- [ ] **Step 3: Run CLI build**

Run:

```bash
cd cli && cargo build
```

Expected: PASS.

- [ ] **Step 4: Smoke test quick mode without touching user config**

Run from repository root:

```bash
repo="$PWD"
tmp_home="$(mktemp -d)"
codex_project="$(mktemp -d)"
claude_project="$(mktemp -d)"
cursor_project="$(mktemp -d)"

(cd "$codex_project" && HOME="$tmp_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- agent codex)
(cd "$claude_project" && HOME="$tmp_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- agent claude-code)
(cd "$cursor_project" && HOME="$tmp_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- agent cursor-cli)
HOME="$tmp_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- agent list
```

Expected:
- codex output contains `Runtime: codex`
- claude output contains `Runtime: claude-code`
- cursor output contains `Runtime: cursor-cli`
- `agent list` shows all three runtime values
- no command touches the real `~/.config/msctl/*`

- [ ] **Step 5: Smoke test legacy register path without touching user config**

Run from repository root:

```bash
repo="$PWD"
legacy_home="$(mktemp -d)"
legacy_project="$(mktemp -d)"

HOME="$legacy_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- \
  agent register \
  --name legacy-codex \
  --project "$legacy_project" \
  --runtime codex \
  --mode suggest

HOME="$legacy_home" cargo run --manifest-path "$repo/cli/Cargo.toml" -- agent list
```

Expected:
- register output remains `Agent registered. ID: <uuid>`
- `agent list` shows `legacy-codex`
- `agent list` shows runtime `codex`
- explicit `--mode suggest` is preserved in DB; if the smoke test needs direct DB inspection, use the temp HOME DB only

- [ ] **Step 6: Run docs index check**

Run:

```bash
python3 scripts/check-docs-indices.py
```

Expected: PASS after this plan is registered in `docs/exec-plans/index.json`. If a pre-existing unrelated exec plan is still unregistered, register that plan separately or report it explicitly before commit.

- [ ] **Step 7: Run doc-code hash guard for tracked code changes**

Run:

```bash
python3 scripts/check-doc-code-hashes.py --check
```

Expected: PASS, or a specific design-doc hash error. If it reports a stale design doc, review the code diff, update the relevant design doc text if needed, then run the script's suggested `--update-doc <basename>.md` command for that single reviewed document.

## Task 6: Review, Commit, And Exec Plan Index Completion

**Files:**
- Modify: `docs/exec-plans/index.json`
- Modify after commit: `docs/exec-plans/index.json`

- [ ] **Step 1: Request code review before commit**

Use `superpowers:requesting-code-review`.

Expected: Critical and Important findings are either fixed or explicitly resolved before commit.

- [ ] **Step 2: Re-run verification after review fixes**

Run:

```bash
cd cli && cargo test
cd cli && cargo build
python3 scripts/check-docs-indices.py
```

Expected: all commands pass, except any explicitly documented unrelated pre-existing index issue.

- [ ] **Step 3: Commit once**

Run:

```bash
git add cli/src/commands/agent.rs \
  cli/src/commands/agent_quick_register.rs \
  cli/src/commands/agent_quick_register_tests.rs \
  cli/src/commands/mod.rs \
  cli/src/templates/commands.md \
  docs/references/msctl-inject.md \
  docs/references/cli-commands.md \
  docs/product-specs/SPEC-agent-quick-register.md \
  docs/product-specs/index.json \
  docs/exec-plans/2026-05-27-agent-quick-register.md \
  docs/exec-plans/index.json
git commit -m "feat(cli): add agent quick register"
```

Expected: one feature commit containing the implementation, tests, references, spec/index updates, and this plan.

- [ ] **Step 4: Record completed commit in exec plan index**

Run:

```bash
commit_sha="$(git rev-parse HEAD)"
```

Update this plan's entry in `docs/exec-plans/index.json` with:

```json
"lastCompletedCommit": "<40-character commit sha>"
```

Then run:

```bash
python3 scripts/check-docs-indices.py
git add docs/exec-plans/index.json
git commit -m "docs: record agent quick register completion"
```

Expected: index check passes, and the plan entry records the completed commit SHA.

## Self-Review

- Spec coverage: covered quick `codex`, `claude-code`, `cursor-cli`, current-directory workspace, basename naming, global suffix conflict resolution, `full-auto` quick mode, context injection, invalid runtime failure, old runtime register behavior, plugin register compatibility, docs, tests, and verification.
- Placeholder scan: no placeholder markers, no deferred implementation notes, no unspecified test commands.
- Type consistency: helper names used in tests match the final implementation: `validate_quick_register_runtime`, `infer_agent_name_from_workspace`, `find_available_agent_name`, `insert_and_inject_quick_agent`, and `quick_register_in_workspace`.
