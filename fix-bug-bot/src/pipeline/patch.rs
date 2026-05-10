use anyhow::Result;

pub struct PatchResult {
    pub patched: bool,
    pub root_cause: String,
    pub changed_files: Vec<String>,
    pub reason: String,
}

pub fn build_patch_prompt(
    bug_title: &str,
    test_path: &str,
    run_cmd: &str,
    project_path: &str,
) -> String {
    format!(
        r#"你是一个 TDD 专家。请修复以下 bug，使失败测试通过。

项目路径：{}
Bug 标题：{}
失败测试文件：{}
运行测试命令：{}

要求：
1. 先运行失败测试，确认它确实失败
2. 定位根因（最小相关代码区域）
3. 生成最小修复 patch，只修 bug，不做顺手重构
4. 修复后运行测试，确认通过
5. 不要修改测试文件中的断言逻辑

请以以下格式回复：
ROOT_CAUSE: <根因描述>
CHANGED_FILES: <文件1>, <文件2>
STATUS: PATCHED 或 FAILED
REASON: <说明>"#,
        project_path, bug_title, test_path, run_cmd
    )
}

pub fn parse_patch_result(text: &str) -> Result<PatchResult> {
    let mut root_cause = String::new();
    let mut changed_files = Vec::new();
    let mut patched = false;
    let mut reason = String::new();

    for line in text.lines() {
        if let Some(v) = line.strip_prefix("ROOT_CAUSE:") {
            root_cause = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("CHANGED_FILES:") {
            changed_files = v
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if let Some(v) = line.strip_prefix("STATUS:") {
            patched = v.trim() == "PATCHED";
        } else if let Some(v) = line.strip_prefix("REASON:") {
            reason = v.trim().to_string();
        }
    }

    Ok(PatchResult { patched, root_cause, changed_files, reason })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_patch_prompt() {
        let prompt = build_patch_prompt(
            "登录失败",
            "tests/login_test.rs",
            "cargo test test_login_fails",
            "/tmp/repo",
        );
        assert!(prompt.contains("tests/login_test.rs"), "must contain test path");
        assert!(prompt.contains("最小"), "must mention minimal fix");
    }

    #[test]
    fn test_parse_patch_result() {
        let text = "ROOT_CAUSE: LoginActivity 未处理 null token\nCHANGED_FILES: src/login.rs, tests/login_test.rs\nSTATUS: PATCHED\nREASON: added null check";
        let result = parse_patch_result(text).unwrap();
        assert!(!result.root_cause.is_empty(), "root_cause must not be empty");
        assert!(
            result.changed_files.contains(&"src/login.rs".to_string()),
            "must list changed files"
        );
        assert!(result.patched, "STATUS PATCHED must set patched=true");
    }
}
