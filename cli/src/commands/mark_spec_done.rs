use crate::config::{load_config, Config};
use anyhow::{Context, Result};
use clap::Args;
use std::time::Duration;

#[derive(Args, Debug)]
#[command(after_help = "\
Requires a running `msctl serve` and Bearer token (`msctl auth login` or --token).
Marks the given SpecArtifact as implementation-complete and broadcasts a
spec_changed event so connected mobile clients refresh immediately.

Example:

  msctl spec mark-done \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda")]
pub struct MarkSpecDoneArgs {
    /// UUID of the SpecArtifact to mark as done.
    #[arg(long)]
    pub spec_id: String,

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

pub fn handle(args: MarkSpecDoneArgs) -> Result<()> {
    let spec_id = normalize_required(&args.spec_id, "--spec-id")?;
    let config = config_for(&args)?;
    let token = resolve_token(args.token, config.as_ref())?;
    let port = args.port.unwrap_or_else(|| {
        config
            .as_ref()
            .map(|cfg| cfg.serve_port)
            .unwrap_or(Config::default().serve_port)
    });
    let url = format!(
        "http://{}:{}/api/v1/specs/{}/done",
        args.host.trim(),
        port,
        spec_id
    );

    eprintln!("[mark-spec-done] posting spec_id={spec_id} url={url}");
    let response = build_http_client()?
        .post(&url)
        .bearer_auth(token)
        .send()
        .with_context(|| format!("failed to POST mark-spec-done to {url}"))?;
    let status = response.status();
    let body = response
        .text()
        .context("failed to read mark-spec-done response body")?;
    if !status.is_success() {
        eprintln!("[mark-spec-done] failed spec_id={spec_id} status={status} body={body}");
        anyhow::bail!("mark-spec-done request failed with HTTP {status}: {body}");
    }

    println!("marked done: {spec_id} status=done");
    Ok(())
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
        .context("failed to build mark-spec-done HTTP client")
}

fn config_for(args: &MarkSpecDoneArgs) -> Result<Option<Config>> {
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
