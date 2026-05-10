use anyhow::{Context, Result};
use std::path::Path;

/// 根据 runtime 类型决定注入目标文件名
/// claude-code → CLAUDE.md；其他（codex / cursor-cli / 未知）→ AGENTS.md
pub fn resolve_inject_target(runtime: &str) -> &'static str {
    if runtime == "claude-code" {
        "CLAUDE.md"
    } else {
        "AGENTS.md"
    }
}

/// 将模版中的占位符替换为实际值
fn render_template(agent_id: &str, endpoint: &str, token: &str) -> String {
    include_str!("../templates/commands.md")
        .replace("{{agent_id}}", agent_id)
        .replace("{{endpoint}}", endpoint)
        .replace("{{token}}", token)
}

/// 将 msctl 命令速查注入到工作空间的 AGENTS.md 或 CLAUDE.md
///
/// - 根据 runtime 选择目标文件
/// - 文件不存在时自动创建
/// - 已有注入标记时跳过（幂等）
/// - 注入块追加到文件末尾
pub fn inject_context(agent_id: &str, runtime: &str, project_path: &Path) -> Result<()> {
    let filename = resolve_inject_target(runtime);
    let target = project_path.join(filename);

    // 读取已有内容（文件不存在时为空字符串）
    let existing = if target.exists() {
        std::fs::read_to_string(&target)
            .with_context(|| format!("Cannot read {}", target.display()))?
    } else {
        String::new()
    };

    // 幂等检测：已有注入标记则跳过
    if existing.contains("<!-- msctl-inject-start -->") {
        println!("msctl context already injected into {}. Skipping.", filename);
        return Ok(());
    }

    // 读取 config 获取 endpoint 和 token
    let config = crate::config::load_config().unwrap_or_default();
    let endpoint = format!("http://localhost:{}", config.serve_port);
    let token = if config.serve_token.is_empty() {
        "<your-token>".to_string()
    } else {
        config.serve_token.clone()
    };

    let block = render_template(agent_id, &endpoint, &token);

    // 追加到文件末尾（已有内容时先加换行分隔）
    let content = if existing.is_empty() {
        block
    } else {
        format!("{}\n{}", existing.trim_end(), block)
    };

    std::fs::write(&target, content)
        .with_context(|| format!("Cannot write to {}", target.display()))?;

    println!("Injected msctl context into {}.", filename);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// inject_context：目标文件不存在时自动创建并写入注入块
    ///
    /// 数据构造：
    ///   工作目录 = 临时目录（无 AGENTS.md / CLAUDE.md）
    ///   runtime  = "codex" → 目标文件 = AGENTS.md
    ///
    /// 执行过程：
    ///   1. 调用 inject_context("agent-id-1", "codex", &dir)
    ///   2. 读取 dir/AGENTS.md
    ///
    /// 预期结果：
    ///   - AGENTS.md 存在（自动创建）
    ///   - 文件包含 "<!-- msctl-inject-start -->"
    ///   - 文件包含 "agent-id-1"（动态 agent_id 已替换）
    ///   - 文件包含 "<!-- msctl-inject-end -->"
    #[test]
    fn test_inject_creates_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("agent-id-1", "codex", dir.path()).unwrap();

        let target = dir.path().join("AGENTS.md");
        assert!(target.exists(), "AGENTS.md should be created automatically");

        let content = std::fs::read_to_string(&target).unwrap();
        assert!(
            content.contains("<!-- msctl-inject-start -->"),
            "injected block must have start marker"
        );
        assert!(
            content.contains("agent-id-1"),
            "agent_id must be substituted in injected content"
        );
        assert!(
            content.contains("<!-- msctl-inject-end -->"),
            "injected block must have end marker"
        );
    }

    /// inject_context：claude-code runtime 注入到 CLAUDE.md
    ///
    /// 执行过程：
    ///   1. 调用 inject_context("agent-id-2", "claude-code", &dir)
    ///   2. 检查 CLAUDE.md 存在，AGENTS.md 不存在
    ///
    /// 预期结果：
    ///   - CLAUDE.md 存在
    ///   - AGENTS.md 不存在（runtime 路由正确）
    #[test]
    fn test_inject_routes_claude_code_to_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("agent-id-2", "claude-code", dir.path()).unwrap();

        assert!(
            dir.path().join("CLAUDE.md").exists(),
            "CLAUDE.md should be created for claude-code runtime"
        );
        assert!(
            !dir.path().join("AGENTS.md").exists(),
            "AGENTS.md must NOT be created for claude-code runtime"
        );
    }

    /// inject_context：幂等性 — 第二次调用不重复注入
    ///
    /// 执行过程：
    ///   1. 第一次调用 inject_context("agent-id-3", "codex", &dir)
    ///   2. 记录文件内容
    ///   3. 第二次调用 inject_context("agent-id-3", "codex", &dir)
    ///   4. 再次读取文件内容
    ///
    /// 预期结果：
    ///   - 两次内容完全相同（第二次调用无副作用）
    ///   - "<!-- msctl-inject-start -->" 只出现一次
    #[test]
    fn test_inject_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("agent-id-3", "codex", dir.path()).unwrap();
        let content_first = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();

        inject_context("agent-id-3", "codex", dir.path()).unwrap();
        let content_second = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();

        assert_eq!(
            content_first, content_second,
            "second inject call must not modify the file"
        );

        let marker_count = content_second
            .matches("<!-- msctl-inject-start -->")
            .count();
        assert_eq!(
            marker_count, 1,
            "start marker must appear exactly once, got {}",
            marker_count
        );
    }

    /// inject_context：已有内容的文件，注入块追加到末尾，不破坏已有内容
    ///
    /// 数据构造：
    ///   AGENTS.md 已有内容 "# Existing Content\n\nSome text.\n"
    ///
    /// 执行过程：
    ///   1. 写入已有内容到 AGENTS.md
    ///   2. 调用 inject_context("agent-id-4", "codex", &dir)
    ///
    /// 预期结果：
    ///   - 文件仍包含 "# Existing Content"（已有内容未被破坏）
    ///   - 文件包含 "<!-- msctl-inject-start -->"（注入块已追加）
    ///   - "# Existing Content" 在 "<!-- msctl-inject-start -->" 之前出现
    #[test]
    fn test_inject_appends_without_destroying_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("AGENTS.md");
        std::fs::write(&target, "# Existing Content\n\nSome text.\n").unwrap();

        inject_context("agent-id-4", "codex", dir.path()).unwrap();

        let content = std::fs::read_to_string(&target).unwrap();
        assert!(
            content.contains("# Existing Content"),
            "existing content must be preserved"
        );
        assert!(
            content.contains("<!-- msctl-inject-start -->"),
            "inject block must be appended"
        );

        let existing_pos = content.find("# Existing Content").unwrap();
        let inject_pos = content.find("<!-- msctl-inject-start -->").unwrap();
        assert!(
            existing_pos < inject_pos,
            "existing content must appear before the injected block"
        );
    }

    /// resolve_inject_target：未知 runtime 默认返回 AGENTS.md
    ///
    /// 预期结果：
    ///   - "cursor-cli" → "AGENTS.md"
    ///   - "unknown-runtime" → "AGENTS.md"
    #[test]
    fn test_resolve_inject_target_defaults_to_agents_md() {
        assert_eq!(
            resolve_inject_target("cursor-cli"),
            "AGENTS.md",
            "cursor-cli should default to AGENTS.md"
        );
        assert_eq!(
            resolve_inject_target("unknown-runtime"),
            "AGENTS.md",
            "unknown runtime should default to AGENTS.md"
        );
    }
}
