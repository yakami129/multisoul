// fix-bug-bot/src/feishu.rs
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub struct FeishuClient {
    pub app_id: String,
    pub app_secret: String,
    client: reqwest::blocking::Client,
}

#[derive(Deserialize)]
struct TokenResp {
    tenant_access_token: String,
}

impl FeishuClient {
    pub fn new(app_id: &str, app_secret: &str) -> Self {
        Self {
            app_id: app_id.to_string(),
            app_secret: app_secret.to_string(),
            client: reqwest::blocking::Client::new(),
        }
    }

    fn get_token(&self) -> Result<String> {
        #[derive(Serialize)]
        struct Body<'a> { app_id: &'a str, app_secret: &'a str }
        let resp: TokenResp = self.client
            .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
            .json(&Body { app_id: &self.app_id, app_secret: &self.app_secret })
            .send()
            .context("feishu get_token failed")?
            .json()
            .context("feishu get_token parse failed")?;
        Ok(resp.tenant_access_token)
    }

    pub fn send_message(&self, user_open_id: &str, text: &str) -> Result<()> {
        let token = self.get_token()?;
        #[derive(Serialize)]
        struct Body<'a> {
            receive_id: &'a str,
            msg_type: &'a str,
            content: String,
        }
        let content = serde_json::json!({"text": text}).to_string();
        self.client
            .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id")
            .bearer_auth(&token)
            .json(&Body { receive_id: user_open_id, msg_type: "text", content })
            .send()
            .context("feishu send_message failed")?;
        Ok(())
    }

    pub fn add_issue_comment(&self, issue_id: &str, text: &str) -> Result<()> {
        let token = self.get_token()?;
        #[derive(Serialize)]
        struct Body<'a> { content: &'a str }
        self.client
            .post(&format!(
                "https://open.feishu.cn/open-apis/project/v1/issues/{}/comments",
                issue_id
            ))
            .bearer_auth(&token)
            .json(&Body { content: text })
            .send()
            .context("feishu add_issue_comment failed")?;
        Ok(())
    }
}

pub fn build_missing_info_comment(missing_fields: &[&str], assignee: &str) -> String {
    let fields = missing_fields
        .iter()
        .map(|f| format!("- {}", f))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "🤖 fix-bug-bot 无法自动处理此缺陷，缺少以下信息：\n\n{}\n\n@{} 请补充后重新触发。",
        fields, assignee
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feishu_client_new() {
        let client = FeishuClient::new("app1", "sec1");
        assert_eq!(client.app_id, "app1");
        assert_eq!(client.app_secret, "sec1");
    }

    #[test]
    fn test_build_comment_text() {
        let text = build_missing_info_comment(&["复现步骤", "日志"], "张三");
        assert!(text.contains("复现步骤"), "must mention missing field");
        assert!(text.contains("张三"), "must mention assignee");
    }
}
