use crate::config::{load_config, Config};
use anyhow::{Context, Result};
use clap::{Args, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
pub enum OutputFormat {
    Json,
    Text,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Requires a running `msctl serve` and Bearer token (`msctl auth login` or --token).
Returns {\"ask_id\":\"...\",\"status\":\"pending\"} immediately. iOS answers inject
into the same conversation as Markdown user_text; do not poll for answers.

Question JSON shape: non-empty array of
  {id, text, options:[{id,label}], multi_select?}

Examples:

  # Single choice (omit --ask-id to auto-generate UUID)
  msctl ask-question \\
    --conversation-id \"$CONV_ID\" \\
    --questions '[{\"id\":\"0\",\"text\":\"Pick an approach\",\"options\":[{\"id\":\"0\",\"label\":\"A\"},{\"id\":\"1\",\"label\":\"B\"}],\"multi_select\":false}]'

  # Single choice with explicit runtime tool call id
  msctl ask-question \\
    --ask-id \"$TOOL_CALL_ID\" \\
    --conversation-id \"$CONV_ID\" \\
    --questions '[{\"id\":\"0\",\"text\":\"Pick an approach\",\"options\":[{\"id\":\"0\",\"label\":\"A\"},{\"id\":\"1\",\"label\":\"B\"}],\"multi_select\":false}]'

  # Multi-select
  msctl ask-question \\
    --conversation-id \"$CONV_ID\" \\
    --questions '[{\"id\":\"0\",\"text\":\"Which checks before merge?\",\"options\":[{\"id\":\"lint\",\"label\":\"Lint\"},{\"id\":\"test\",\"label\":\"Unit tests\"}],\"multi_select\":true}]'

  # Multiple questions in one card
  msctl ask-question \\
    --conversation-id \"$CONV_ID\" \\
    --questions '[{\"id\":\"env\",\"text\":\"Target environment?\",\"options\":[{\"id\":\"dev\",\"label\":\"Dev\"},{\"id\":\"prod\",\"label\":\"Prod\"}]},{\"id\":\"risk\",\"text\":\"Continue migration?\",\"options\":[{\"id\":\"yes\",\"label\":\"Continue\"},{\"id\":\"no\",\"label\":\"Stop\"}]}]'")]
pub struct AskQuestionArgs {
    /// Stable ask id used to match the eventual mobile answer. Auto-generated when omitted.
    #[arg(long)]
    pub ask_id: Option<String>,

    /// JSON array of question objects to render in the mobile question card.
    #[arg(long)]
    pub questions: String,

    /// Conversation id that should receive the pending question.
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
struct AskQuestionRequest {
    ask_id: String,
    questions: Vec<Value>,
    conversation_id: String,
}

#[derive(Deserialize)]
struct AskQuestionResponse {
    ask_id: String,
    status: String,
}

pub fn handle(args: AskQuestionArgs) -> Result<()> {
    println!("{}", run(args)?);
    Ok(())
}

fn run(args: AskQuestionArgs) -> Result<String> {
    let questions = parse_questions(&args.questions)?;
    let config = config_for(&args)?;
    let ask_id = resolve_ask_id(args.ask_id);
    let conversation_id = args.conversation_id.trim().to_string();
    let token = resolve_token(args.token, config.as_ref())?;
    let port = args.port.unwrap_or_else(|| {
        config
            .as_ref()
            .map(|cfg| cfg.serve_port)
            .unwrap_or(Config::default().serve_port)
    });
    let url = format!("http://{}:{}/api/v1/ask-question", args.host.trim(), port);
    let request = AskQuestionRequest {
        ask_id: ask_id.clone(),
        questions,
        conversation_id: conversation_id.clone(),
    };

    eprintln!(
        "[ask-question] posting conv={conversation_id} ask_id={ask_id} questions={} url={url}",
        request.questions.len()
    );

    let response = build_http_client()?
        .post(&url)
        .bearer_auth(token)
        .json(&request)
        .send()
        .with_context(|| format!("failed to POST ask-question to {url}"))?;
    let status = response.status();
    let body = response
        .text()
        .context("failed to read ask-question response body")?;

    if !status.is_success() {
        eprintln!(
            "[ask-question] failed conv={conversation_id} ask_id={ask_id} status={status} body={body}"
        );
        anyhow::bail!("ask-question request failed with HTTP {status}: {body}");
    }

    let value: Value = serde_json::from_str(&body)
        .with_context(|| format!("server returned non-JSON success response: {body}"))?;
    let output = match args.output {
        OutputFormat::Json => serde_json::to_string(&value)?,
        OutputFormat::Text => {
            let response: AskQuestionResponse = serde_json::from_value(value)
                .context("server response is missing ask_id/status")?;
            format!("{} {}", response.ask_id, response.status)
        }
    };
    eprintln!(
        "[ask-question] pending conv={conversation_id} ask_id={ask_id} output={}",
        match args.output {
            OutputFormat::Json => "json",
            OutputFormat::Text => "text",
        }
    );
    Ok(output)
}

fn resolve_ask_id(ask_id: Option<String>) -> String {
    if let Some(ask_id) = ask_id {
        let trimmed = ask_id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let generated = Uuid::new_v4().to_string();
    eprintln!("[ask-question] auto-generated ask_id={generated}");
    generated
}

fn build_http_client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .context("failed to build ask-question HTTP client")
}

fn parse_questions(raw: &str) -> Result<Vec<Value>> {
    let value: Value =
        serde_json::from_str(raw).context("--questions must be a valid JSON array")?;
    let Value::Array(questions) = value else {
        anyhow::bail!("--questions must be a JSON array");
    };
    if questions.is_empty() {
        anyhow::bail!("--questions must be a non-empty JSON array");
    }
    for (question_index, question) in questions.iter().enumerate() {
        validate_question(question, question_index)?;
    }
    Ok(questions)
}

fn validate_question(question: &Value, question_index: usize) -> Result<()> {
    let Some(object) = question.as_object() else {
        anyhow::bail!("questions[{question_index}] must be a question object");
    };
    require_non_empty_string(object.get("id"), &format!("questions[{question_index}].id"))?;
    require_non_empty_string(
        object.get("text"),
        &format!("questions[{question_index}].text"),
    )?;
    let Some(options) = object.get("options").and_then(Value::as_array) else {
        anyhow::bail!("questions[{question_index}].options must be an array");
    };
    for (option_index, option) in options.iter().enumerate() {
        validate_option(option, question_index, option_index)?;
    }
    if let Some(multi_select) = object.get("multi_select") {
        if !multi_select.is_boolean() {
            anyhow::bail!("questions[{question_index}].multi_select must be a boolean");
        }
    }
    Ok(())
}

fn validate_option(option: &Value, question_index: usize, option_index: usize) -> Result<()> {
    let Some(object) = option.as_object() else {
        anyhow::bail!("questions[{question_index}].options[{option_index}] must be an object");
    };
    require_non_empty_string(
        object.get("id"),
        &format!("questions[{question_index}].options[{option_index}].id"),
    )?;
    require_non_empty_string(
        object.get("label"),
        &format!("questions[{question_index}].options[{option_index}].label"),
    )?;
    Ok(())
}

fn require_non_empty_string(value: Option<&Value>, field: &str) -> Result<()> {
    let Some(text) = value.and_then(Value::as_str) else {
        anyhow::bail!("{field} must be a non-empty string");
    };
    if text.trim().is_empty() {
        anyhow::bail!("{field} must be a non-empty string");
    }
    Ok(())
}

fn config_for(args: &AskQuestionArgs) -> Result<Option<Config>> {
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

#[cfg(test)]
#[path = "ask_question_tests.rs"]
mod tests;
