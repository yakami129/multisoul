// bugfix-bot/src/worktree.rs
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 为 feishu_issue_id 生成分支名
pub fn branch_name_for(feishu_issue_id: &str) -> String {
    format!("fix/bug-{}", feishu_issue_id)
}

/// 在 repo_path 下生成 worktree 路径（repo_path/.worktrees/<feishu_issue_id>）
pub fn worktree_path_for(repo_path: &str, feishu_issue_id: &str) -> PathBuf {
    Path::new(repo_path)
        .join(".worktrees")
        .join(feishu_issue_id)
}

/// 创建 git worktree，返回 worktree 路径
pub fn create(repo_path: &str, feishu_issue_id: &str) -> Result<PathBuf> {
    let branch = branch_name_for(feishu_issue_id);
    let wt_path = worktree_path_for(repo_path, feishu_issue_id);

    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let output = Command::new("git")
        .args(["worktree", "add", "-b", &branch, wt_path.to_str().ok_or_else(|| anyhow::anyhow!("non-UTF-8 worktree path"))?])
        .current_dir(repo_path)
        .output()
        .context("git worktree add failed")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git worktree add failed: {}", stderr);
    }

    Ok(wt_path)
}

/// 删除 git worktree 并删除对应分支
pub fn remove(repo_path: &str, wt_path: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["worktree", "remove", "--force", wt_path])
        .current_dir(repo_path)
        .output()
        .context("git worktree remove failed")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("is not a working tree") {
            anyhow::bail!("git worktree remove failed: {}", stderr);
        }
    }

    let path = Path::new(wt_path);
    if path.exists() {
        std::fs::remove_dir_all(path).ok();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// branch_name_for 生成正确格式
    ///
    /// 预期：fix/bug-feishu-001
    #[test]
    fn test_branch_name_for() {
        let name = branch_name_for("feishu-001");
        assert_eq!(name, "fix/bug-feishu-001", "branch name format must match");
    }

    /// worktree_path_for 生成正确路径
    ///
    /// 预期：路径包含 feishu_issue_id
    #[test]
    fn test_worktree_path_for() {
        let path = worktree_path_for("/tmp/repo", "feishu-001");
        assert!(path.to_string_lossy().contains("feishu-001"), "path must contain issue id");
    }
}
