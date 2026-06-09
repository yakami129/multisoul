use anyhow::{Context, Result};
use clap::Args;
use serde_json::Value;
use std::io::Read;

#[derive(Args, Debug, Clone)]
#[group(required = true, multiple = false)]
pub struct JsonInputArgs {
    /// Inline JSON request body.
    #[arg(long)]
    pub json: Option<String>,

    /// JSON request body file. Use '-' to read stdin.
    #[arg(long)]
    pub json_file: Option<String>,
}

impl JsonInputArgs {
    pub fn parse_value(&self) -> Result<Value> {
        let raw = if let Some(json) = &self.json {
            json.clone()
        } else if let Some(path) = &self.json_file {
            if path == "-" {
                let mut input = String::new();
                std::io::stdin()
                    .read_to_string(&mut input)
                    .context("failed to read JSON from stdin")?;
                input
            } else {
                std::fs::read_to_string(path)
                    .with_context(|| format!("failed to read JSON file {path}"))?
            }
        } else {
            anyhow::bail!("pass --json or --json-file");
        };
        let value: Value = serde_json::from_str(&raw).context("request body must be valid JSON")?;
        if value.is_null() {
            anyhow::bail!("request body must not be null");
        }
        if value
            .as_object()
            .map(|object| object.is_empty())
            .unwrap_or(false)
        {
            anyhow::bail!("request body must not be an empty object");
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_inline_json_body() {
        let args = JsonInputArgs {
            json: Some(r#"{"title":"Demo"}"#.to_string()),
            json_file: None,
        };
        let value = args.parse_value().expect("inline JSON should parse");
        assert_eq!(value.get("title").and_then(Value::as_str), Some("Demo"));
    }

    #[test]
    fn parse_json_file_body() {
        let dir = tempfile::tempdir().expect("tempdir should be created");
        let path = dir.path().join("body.json");
        std::fs::write(&path, r#"{"slug":"demo"}"#).expect("json fixture should write");
        let args = JsonInputArgs {
            json: None,
            json_file: Some(path.to_string_lossy().to_string()),
        };
        let value = args.parse_value().expect("file JSON should parse");
        assert_eq!(value.get("slug").and_then(Value::as_str), Some("demo"));
    }

    #[test]
    fn reject_missing_json_body() {
        let args = JsonInputArgs {
            json: None,
            json_file: None,
        };
        let err = args
            .parse_value()
            .expect_err("missing body should return an error");
        assert!(
            err.to_string().contains("--json or --json-file"),
            "error should explain accepted inputs, got: {err}"
        );
    }

    #[test]
    fn reject_empty_json_object() {
        let args = JsonInputArgs {
            json: Some("{}".to_string()),
            json_file: None,
        };
        let err = args
            .parse_value()
            .expect_err("empty object should return an error");
        assert!(
            err.to_string().contains("empty object"),
            "error should explain empty object rejection, got: {err}"
        );
    }
}
