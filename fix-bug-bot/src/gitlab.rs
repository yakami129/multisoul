// fix-bug-bot/src/gitlab.rs
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub struct GitlabClient {
    pub base_url: String,
    pub token: String,
    client: reqwest::blocking::Client,
}

#[derive(Debug, Deserialize)]
pub struct GitlabIssue {
    pub id: i64,
    pub iid: i64,
    pub web_url: String,
}

#[derive(Debug, Deserialize)]
pub struct GitlabMr {
    pub id: i64,
    pub iid: i64,
    pub web_url: String,
}

impl GitlabClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            token: token.to_string(),
            client: reqwest::blocking::Client::new(),
        }
    }

    pub fn issues_url(&self, project_id: i64) -> String {
        format!("{}/api/v4/projects/{}/issues", self.base_url, project_id)
    }

    pub fn create_issue(
        &self,
        project_id: i64,
        title: &str,
        description: &str,
        labels: &[&str],
    ) -> Result<GitlabIssue> {
        #[derive(Serialize)]
        struct Body<'a> {
            title: &'a str,
            description: &'a str,
            labels: String,
        }
        let body = Body { title, description, labels: labels.join(",") };
        let resp = self.client
            .post(&self.issues_url(project_id))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&body)
            .send()
            .context("GitLab create_issue request failed")?;
        let issue: GitlabIssue = resp.json().context("GitLab create_issue parse failed")?;
        Ok(issue)
    }

    pub fn add_label(&self, project_id: i64, issue_iid: i64, label: &str) -> Result<()> {
        #[derive(Serialize)]
        struct Body<'a> { add_labels: &'a str }
        self.client
            .put(&format!("{}/api/v4/projects/{}/issues/{}", self.base_url, project_id, issue_iid))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&Body { add_labels: label })
            .send()
            .context("GitLab add_label failed")?;
        Ok(())
    }

    pub fn create_draft_mr(
        &self,
        project_id: i64,
        source_branch: &str,
        target_branch: &str,
        title: &str,
        description: &str,
    ) -> Result<GitlabMr> {
        #[derive(Serialize)]
        struct Body<'a> {
            source_branch: &'a str,
            target_branch: &'a str,
            title: String,
            description: &'a str,
        }
        let body = Body {
            source_branch,
            target_branch,
            title: format!("Draft: {}", title),
            description,
        };
        let resp = self.client
            .post(&format!("{}/api/v4/projects/{}/merge_requests", self.base_url, project_id))
            .header("PRIVATE-TOKEN", &self.token)
            .json(&body)
            .send()
            .context("GitLab create_draft_mr failed")?;
        let mr: GitlabMr = resp.json().context("GitLab create_draft_mr parse failed")?;
        Ok(mr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gitlab_client_new() {
        let client = GitlabClient::new("https://gl.example.com", "glpat-xxx");
        assert_eq!(client.base_url, "https://gl.example.com");
        assert_eq!(client.token, "glpat-xxx");
    }

    #[test]
    fn test_issue_url() {
        let client = GitlabClient::new("https://gl.example.com", "tok");
        let url = client.issues_url(42);
        assert_eq!(url, "https://gl.example.com/api/v4/projects/42/issues");
    }
}
