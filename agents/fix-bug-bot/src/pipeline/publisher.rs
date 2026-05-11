// fix-bug-bot/src/pipeline/publisher.rs
use anyhow::Result;
use std::process::Command;

/// 生成 MR 标题
pub fn build_mr_title(feishu_issue_id: &str, bug_title: &str) -> String {
    format!("[AutoFix] {} - {}", feishu_issue_id, bug_title)
}

/// 生成 Draft MR 描述（固定模板）
pub fn build_mr_description(
    feishu_issue_id: &str,
    bug_title: &str,
    root_cause: &str,
    fix_summary: &str,
    test_path: &str,
    test_name: &str,
    gitlab_issue_id: i64,
) -> String {
    format!(
        r#"## [AutoFix] {} - {}

### 根因分析
{}

### 修复摘要
{}

### 新增测试
- [ ] `{}` - `{}`：验证 bug 复现场景

### 关联
- 飞书缺陷：{}
- GitLab Issue：#{}

---
> 此 MR 由 fix-bug-bot 自动生成，请 Review 后去掉 Draft 标记。"#,
        feishu_issue_id, bug_title,
        root_cause,
        fix_summary,
        test_path, test_name,
        feishu_issue_id,
        gitlab_issue_id,
    )
}

/// 提交 worktree 分支上的所有变更
pub fn commit_worktree(worktree_path: &str, message: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["add", "-A"])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git add failed: {}", String::from_utf8_lossy(&output.stderr));
    }

    let output = Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("nothing to commit") {
            return Ok(());
        }
        anyhow::bail!("git commit failed: {}", stderr);
    }

    Ok(())
}

/// 推送 worktree 分支到远端
pub fn push_branch(worktree_path: &str, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .args(["push", "origin", branch])
        .current_dir(worktree_path)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("git push failed: {}", String::from_utf8_lossy(&output.stderr));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// build_mr_description 生成包含所有必要段落的 MR 描述
    #[test]
    fn test_build_mr_description() {
        let desc = build_mr_description(
            "feishu-001",
            "登录失败",
            "LoginActivity 未处理 null token",
            "在 checkToken() 中增加 null 检查",
            "tests/login_test.rs",
            "test_login_fails",
            42,
        );
        assert!(desc.contains("LoginActivity"), "must contain root cause");
        assert!(desc.contains("null 检查"), "must contain fix summary");
        assert!(desc.contains("tests/login_test.rs"), "must contain test path");
        assert!(desc.contains("feishu-001"), "must contain feishu issue id");
        assert!(desc.contains("#42"), "must contain gitlab issue id");
    }

    /// build_mr_title 生成正确格式
    #[test]
    fn test_build_mr_title() {
        let title = build_mr_title("feishu-001", "登录失败");
        assert_eq!(title, "[AutoFix] feishu-001 - 登录失败");
    }
}
