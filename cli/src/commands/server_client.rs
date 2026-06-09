use crate::config::{load_config, Config};
use anyhow::{Context, Result};
use clap::{Args, ValueEnum};
use reqwest::blocking::Client;
use reqwest::{Method, StatusCode};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    Json,
    Text,
}

impl OutputFormat {
    pub fn render_json(self, value: &Value) -> Result<String> {
        match self {
            OutputFormat::Json => serde_json::to_string(value).map_err(Into::into),
            OutputFormat::Text => Ok(value.to_string()),
        }
    }
}

#[derive(Args, Debug, Clone)]
pub struct ServerOptions {
    /// Output format: json or text.
    #[arg(long, value_enum, default_value_t = OutputFormat::Json)]
    pub output: OutputFormat,

    /// Override the saved bearer token.
    #[arg(long)]
    pub token: Option<String>,

    /// Override the saved server port.
    #[arg(long)]
    pub port: Option<u16>,

    /// Server host.
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,
}

pub struct ServerClient {
    client: Client,
    base_url: String,
    token: String,
}

impl ServerClient {
    pub fn from_options(options: &ServerOptions) -> Result<Self> {
        let config = config_for(options)?;
        let token = resolve_token(options.token.clone(), config.as_ref())?;
        let port = options.port.unwrap_or_else(|| {
            config
                .as_ref()
                .map(|cfg| cfg.serve_port)
                .unwrap_or(Config::default().serve_port)
        });
        let host = options.host.trim();
        if host.is_empty() {
            anyhow::bail!("--host must be non-empty");
        }
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .context("failed to build HTTP client")?,
            base_url: format!("http://{host}:{port}"),
            token,
        })
    }

    pub fn get_json(&self, path: &str) -> Result<Value> {
        self.request_json(Method::GET, path, Option::<&()>::None)
    }

    pub fn post_empty_json(&self, path: &str) -> Result<Value> {
        self.request_json(Method::POST, path, Option::<&()>::None)
    }

    pub fn post_json<T: Serialize>(&self, path: &str, body: &T) -> Result<Value> {
        self.request_json(Method::POST, path, Some(body))
    }

    pub fn patch_json<T: Serialize>(&self, path: &str, body: &T) -> Result<Value> {
        self.request_json(Method::PATCH, path, Some(body))
    }

    pub fn delete(&self, path: &str) -> Result<Option<Value>> {
        let (status, body) = self.request(Method::DELETE, path, Option::<&()>::None)?;
        if status == StatusCode::NO_CONTENT || body.trim().is_empty() {
            return Ok(None);
        }
        serde_json::from_str(&body)
            .with_context(|| format!("server returned non-JSON success response: {body}"))
            .map(Some)
    }

    fn request_json<T: Serialize>(
        &self,
        method: Method,
        path: &str,
        body: Option<&T>,
    ) -> Result<Value> {
        let (_status, body) = self.request(method, path, body)?;
        if body.trim().is_empty() {
            return Ok(serde_json::json!({}));
        }
        serde_json::from_str(&body)
            .with_context(|| format!("server returned non-JSON success response: {body}"))
    }

    fn request<T: Serialize>(
        &self,
        method: Method,
        path: &str,
        body: Option<&T>,
    ) -> Result<(StatusCode, String)> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self
            .client
            .request(method.clone(), &url)
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .with_context(|| format!("failed to {} {url}", method.as_str()))?;
        let status = response.status();
        let text = response
            .text()
            .with_context(|| format!("failed to read {} response body", method.as_str()))?;
        if !status.is_success() {
            anyhow::bail!(
                "{} {url} failed with HTTP {status}: {text}",
                method.as_str()
            );
        }
        Ok((status, text))
    }
}

pub fn normalize_required(value: &str, field: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{field} must be non-empty");
    }
    Ok(value.to_string())
}

fn config_for(options: &ServerOptions) -> Result<Option<Config>> {
    let has_token_override = options
        .token
        .as_ref()
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false);
    if has_token_override && options.port.is_some() {
        return Ok(None);
    }
    Ok(Some(load_config()?))
}

fn resolve_token(token: Option<String>, config: Option<&Config>) -> Result<String> {
    if let Some(token) = token {
        let token = token.trim();
        if !token.is_empty() {
            return Ok(token.to_string());
        }
    }
    let Some(config) = config else {
        anyhow::bail!("missing bearer token; pass --token or run `msctl auth login` first");
    };
    let token = config.serve_token.trim();
    if token.is_empty() {
        anyhow::bail!("missing bearer token; pass --token or run `msctl auth login` first");
    }
    Ok(token.to_string())
}
