use crate::config::{load_config, Config};
use anyhow::{Context, Result};
use clap::{Args, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    Json,
    Text,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Requires a running `msctl serve` and Bearer token (`msctl auth login` or --token).
Reads a repo-relative product spec path through the conversation's target repo,
saves an immutable artifact snapshot, and returns the spec/version ids.

Example:

  msctl save-spec \\
    --path docs/product-specs/2026-06-06-SPEC-example.md \\
    --conversation-id \"$CONV_ID\" \\
    --output json")]
pub struct SaveSpecArgs {
    /// Repo-relative product spec path under docs/product-specs/.
    #[arg(long)]
    pub path: String,

    /// Interview conversation id used to resolve the target repo and source idea.
    #[arg(long)]
    pub conversation_id: String,

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

#[derive(Serialize)]
struct SaveSpecRequest {
    path: String,
    conversation_id: String,
}

#[derive(Deserialize)]
struct SaveSpecResponse {
    spec_id: String,
    version_id: String,
    repo_spec_path: String,
    revision: i64,
    status: String,
}

pub fn handle(args: SaveSpecArgs) -> Result<()> {
    println!("{}", run(args)?);
    Ok(())
}

fn run(args: SaveSpecArgs) -> Result<String> {
    let path = normalize_required(&args.path, "--path")?;
    let conversation_id = normalize_required(&args.conversation_id, "--conversation-id")?;
    let config = config_for(&args)?;
    let token = resolve_token(args.token, config.as_ref())?;
    let port = args.port.unwrap_or_else(|| {
        config
            .as_ref()
            .map(|cfg| cfg.serve_port)
            .unwrap_or(Config::default().serve_port)
    });
    let url = format!(
        "http://{}:{}/api/v1/specs/save-from-path",
        args.host.trim(),
        port
    );
    let request = SaveSpecRequest {
        path: path.clone(),
        conversation_id: conversation_id.clone(),
    };

    eprintln!("[save-spec] posting conv={conversation_id} path={path} url={url}");
    let response = build_http_client()?
        .post(&url)
        .bearer_auth(token)
        .json(&request)
        .send()
        .with_context(|| format!("failed to POST save-spec to {url}"))?;
    let status = response.status();
    let body = response
        .text()
        .context("failed to read save-spec response body")?;
    if !status.is_success() {
        eprintln!("[save-spec] failed conv={conversation_id} status={status} body={body}");
        anyhow::bail!("save-spec request failed with HTTP {status}: {body}");
    }

    let value: Value = serde_json::from_str(&body)
        .with_context(|| format!("server returned non-JSON success response: {body}"))?;
    match args.output {
        OutputFormat::Json => serde_json::to_string(&value).map_err(Into::into),
        OutputFormat::Text => {
            let response: SaveSpecResponse =
                serde_json::from_value(value).context("server response is missing save fields")?;
            Ok(format!(
                "{} {} {} rev={} {}",
                response.spec_id,
                response.version_id,
                response.repo_spec_path,
                response.revision,
                response.status
            ))
        }
    }
}

fn normalize_required(value: &str, field: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{field} must be non-empty");
    }
    Ok(value.to_string())
}

fn build_http_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .context("failed to build save-spec HTTP client")
}

fn config_for(args: &SaveSpecArgs) -> Result<Option<Config>> {
    let has_token_override = args
        .token
        .as_ref()
        .map(|token| !token.trim().is_empty())
        .unwrap_or(false);
    if has_token_override && args.port.is_some() {
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
