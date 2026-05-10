use anyhow::{Context, Result};
use std::path::Path;

/// Returns the target filename based on runtime type.
/// claude-code → CLAUDE.md; everything else → AGENTS.md
pub fn resolve_inject_target(runtime: &str) -> &'static str {
    if runtime == "claude-code" {
        "CLAUDE.md"
    } else {
        "AGENTS.md"
    }
}

/// Injects the msctl command reference block into the workspace's AGENTS.md or CLAUDE.md.
///
/// - Picks target file based on runtime
/// - Creates the file if it doesn't exist
/// - Skips if the inject marker is already present (idempotent)
/// - Appends to end of file, preserving existing content
pub fn inject_context(runtime: &str, project_path: &Path) -> Result<()> {
    let filename = resolve_inject_target(runtime);
    let target = project_path.join(filename);

    let existing = if target.exists() {
        std::fs::read_to_string(&target)
            .with_context(|| format!("Cannot read {}", target.display()))?
    } else {
        String::new()
    };

    if existing.contains("<!-- msctl-inject-start -->") {
        println!("msctl context already injected into {}. Skipping.", filename);
        return Ok(());
    }

    let block = include_str!("../templates/commands.md");

    let content = if existing.is_empty() {
        block.to_string()
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

    /// inject_context: creates target file when missing and writes inject block
    ///
    /// Data:
    ///   project dir = temp dir (no AGENTS.md / CLAUDE.md)
    ///   runtime = "codex" → target = AGENTS.md
    ///
    /// Execution:
    ///   1. Call inject_context("codex", &dir)
    ///   2. Read dir/AGENTS.md
    ///
    /// Expected:
    ///   - AGENTS.md exists (auto-created)
    ///   - contains "<!-- msctl-inject-start -->"
    ///   - contains "<!-- msctl-inject-end -->"
    #[test]
    fn test_inject_creates_file_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("codex", dir.path()).unwrap();

        let target = dir.path().join("AGENTS.md");
        assert!(target.exists(), "AGENTS.md should be created automatically");

        let content = std::fs::read_to_string(&target).unwrap();
        assert!(
            content.contains("<!-- msctl-inject-start -->"),
            "injected block must have start marker"
        );
        assert!(
            content.contains("<!-- msctl-inject-end -->"),
            "injected block must have end marker"
        );
    }

    /// inject_context: claude-code runtime routes to CLAUDE.md
    ///
    /// Execution:
    ///   1. Call inject_context("claude-code", &dir)
    ///   2. Check CLAUDE.md exists, AGENTS.md does not
    ///
    /// Expected:
    ///   - CLAUDE.md exists
    ///   - AGENTS.md does not exist (routing is correct)
    #[test]
    fn test_inject_routes_claude_code_to_claude_md() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("claude-code", dir.path()).unwrap();

        assert!(
            dir.path().join("CLAUDE.md").exists(),
            "CLAUDE.md should be created for claude-code runtime"
        );
        assert!(
            !dir.path().join("AGENTS.md").exists(),
            "AGENTS.md must NOT be created for claude-code runtime"
        );
    }

    /// inject_context: idempotent — second call does not modify the file
    ///
    /// Execution:
    ///   1. First call inject_context("codex", &dir)
    ///   2. Record file content
    ///   3. Second call inject_context("codex", &dir)
    ///   4. Read file content again
    ///
    /// Expected:
    ///   - Both reads are identical
    ///   - "<!-- msctl-inject-start -->" appears exactly once
    #[test]
    fn test_inject_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        inject_context("codex", dir.path()).unwrap();
        let content_first = std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap();

        inject_context("codex", dir.path()).unwrap();
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

    /// inject_context: appends to existing file without destroying existing content
    ///
    /// Data:
    ///   AGENTS.md already contains "# Existing Content\n\nSome text.\n"
    ///
    /// Execution:
    ///   1. Write existing content to AGENTS.md
    ///   2. Call inject_context("codex", &dir)
    ///
    /// Expected:
    ///   - File still contains "# Existing Content" (not destroyed)
    ///   - File contains "<!-- msctl-inject-start -->" (block appended)
    ///   - "# Existing Content" appears before "<!-- msctl-inject-start -->"
    #[test]
    fn test_inject_appends_without_destroying_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("AGENTS.md");
        std::fs::write(&target, "# Existing Content\n\nSome text.\n").unwrap();

        inject_context("codex", dir.path()).unwrap();

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

    /// resolve_inject_target: unknown runtime defaults to AGENTS.md
    ///
    /// Expected:
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
