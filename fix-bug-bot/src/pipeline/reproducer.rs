use anyhow::Result;

pub struct ReproducerResult {
    pub reproduced: bool,
    pub test_path: String,
    pub run_cmd: String,
    pub reason: String,
}

pub fn build_reproducer_prompt(bug_title: &str, logs: &str, project_path: &str) -> String {
    format!(
        r#"你是一个 TDD 专家。请在以下项目中找到或新增一个能复现此 bug 的失败测试。

项目路径：{}
Bug 标题：{}
错误日志：{}

要求：
1. 优先搜索现有测试文件，找到能复现此 bug 的测试
2. 如果没有现有测试，新增一个最小化的失败测试
3. 测试必须在修复前按预期失败（不是因为编译错误失败）
4. 不要修改任何业务代码

请以以下格式回复：
TEST_PATH: <测试文件相对路径>
RUN_CMD: <运行该测试的命令>
STATUS: REPRODUCED 或 CANNOT_REPRODUCE
REASON: <说明>"#,
        project_path, bug_title, logs
    )
}

pub fn parse_reproducer_result(text: &str) -> Result<ReproducerResult> {
    let mut test_path = String::new();
    let mut run_cmd = String::new();
    let mut reproduced = false;
    let mut reason = String::new();

    for line in text.lines() {
        if let Some(v) = line.strip_prefix("TEST_PATH:") {
            test_path = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("RUN_CMD:") {
            run_cmd = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("STATUS:") {
            reproduced = v.trim() == "REPRODUCED";
        } else if let Some(v) = line.strip_prefix("REASON:") {
            reason = v.trim().to_string();
        }
    }

    Ok(ReproducerResult { reproduced, test_path, run_cmd, reason })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_reproducer_prompt() {
        let prompt = build_reproducer_prompt("登录失败", "NPE at LoginActivity:42", "/tmp/repo");
        assert!(prompt.contains("登录失败"), "must contain bug title");
        assert!(prompt.contains("失败测试"), "must mention failing test");
        assert!(prompt.contains("/tmp/repo"), "must contain project path");
    }

    #[test]
    fn test_parse_reproducer_result() {
        let text = "TEST_PATH: tests/login_test.rs\nRUN_CMD: cargo test test_login_fails\nSTATUS: REPRODUCED\nREASON: found existing test";
        let result = parse_reproducer_result(text).unwrap();
        assert_eq!(result.test_path, "tests/login_test.rs");
        assert_eq!(result.run_cmd, "cargo test test_login_fails");
        assert!(result.reproduced, "status REPRODUCED must set reproduced=true");
    }

    #[test]
    fn test_parse_reproducer_result_cannot_reproduce() {
        let text = "STATUS: CANNOT_REPRODUCE\nREASON: 无法在本地环境复现此问题";
        let result = parse_reproducer_result(text).unwrap();
        assert!(!result.reproduced, "CANNOT_REPRODUCE must set reproduced=false");
        assert!(result.reason.contains("无法"), "must contain reason");
    }
}
