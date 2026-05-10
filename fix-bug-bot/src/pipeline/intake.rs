use anyhow::Result;

#[derive(Debug, Clone)]
pub struct IssueContext {
    pub title: String,
    pub description: String,
    pub reproduce_steps: String,
    pub logs: String,
    pub assignee: String,
    pub module: String,
}

pub struct SufficiencyResult {
    pub is_sufficient: bool,
    pub missing_fields: Vec<String>,
    pub reason: String,
}

/// 从飞书 Webhook payload 提取缺陷上下文
pub fn extract_issue_context(payload: &serde_json::Value) -> Result<IssueContext> {
    let issue = payload
        .pointer("/event/issue")
        .ok_or_else(|| anyhow::anyhow!("Missing /event/issue in payload"))?;

    let get_str = |key: &str| -> String {
        issue.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let assignee = issue
        .pointer("/assignee/name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(IssueContext {
        title: get_str("summary"),
        description: get_str("description"),
        reproduce_steps: get_str("reproduce_steps"),
        logs: get_str("logs"),
        assignee,
        module: get_str("module"),
    })
}

/// 构造信息充分性评估 prompt
pub fn build_sufficiency_prompt(ctx: &IssueContext) -> String {
    format!(
        r#"你是一个代码 bug 分析助手。请判断以下缺陷信息是否足够定位到代码层面的根因。

缺陷标题：{}
缺陷描述：{}
复现步骤：{}
日志/错误信息：{}
所属模块：{}

判断标准：
- 必须有明确的错误现象描述
- 必须有可操作的复现步骤或错误日志
- 信息需要足够定位到具体代码文件或函数

请以以下格式回复：
如果信息充足：SUFFICIENT: <简短理由>
如果信息不足：INSUFFICIENT: <简短理由>
MISSING: <缺失字段1>, <缺失字段2>, ..."#,
        ctx.title, ctx.description, ctx.reproduce_steps, ctx.logs, ctx.module
    )
}

/// 解析 claude 返回的充分性结论
pub fn parse_sufficiency_result(text: &str) -> SufficiencyResult {
    let is_sufficient = text.trim_start().starts_with("SUFFICIENT");
    let mut missing_fields = Vec::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MISSING:") {
            missing_fields = rest
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }

    SufficiencyResult {
        is_sufficient,
        missing_fields,
        reason: text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_issue_context() {
        let payload = serde_json::json!({
            "event": {
                "issue": {
                    "summary": "登录失败",
                    "description": "点击登录按钮后报错",
                    "reproduce_steps": "1. 打开 App\n2. 点击登录",
                    "logs": "NullPointerException at LoginActivity.java:42",
                    "assignee": { "name": "张三" },
                    "module": "用户中心"
                }
            }
        });
        let ctx = extract_issue_context(&payload).unwrap();
        assert_eq!(ctx.title, "登录失败", "title must match");
        assert_eq!(ctx.assignee, "张三", "assignee must match");
        assert_eq!(ctx.module, "用户中心", "module must match");
    }

    #[test]
    fn test_build_sufficiency_prompt() {
        let ctx = IssueContext {
            title: "登录失败".to_string(),
            description: "报错".to_string(),
            reproduce_steps: "1. 打开 App".to_string(),
            logs: "NPE at line 42".to_string(),
            assignee: "张三".to_string(),
            module: "用户中心".to_string(),
        };
        let prompt = build_sufficiency_prompt(&ctx);
        assert!(prompt.contains("登录失败"), "prompt must contain title");
        assert!(prompt.contains("1. 打开 App"), "prompt must contain steps");
    }

    #[test]
    fn test_parse_sufficiency_result_sufficient() {
        let result = parse_sufficiency_result("SUFFICIENT: 信息完整，可以定位根因");
        assert!(result.is_sufficient, "SUFFICIENT must return true");
    }

    #[test]
    fn test_parse_sufficiency_result_insufficient() {
        let result = parse_sufficiency_result("INSUFFICIENT: 缺少复现步骤和日志\nMISSING: 复现步骤, 日志");
        assert!(!result.is_sufficient, "INSUFFICIENT must return false");
        assert!(result.missing_fields.contains(&"复现步骤".to_string()), "must list missing fields");
    }
}
