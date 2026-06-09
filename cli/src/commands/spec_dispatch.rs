use crate::commands::{
    json_input::JsonInputArgs,
    server_client::{normalize_required, OutputFormat, ServerClient, ServerOptions},
};
use anyhow::Result;
use clap::Args;
use serde_json::Value;

#[derive(Args, Debug)]
#[command(after_help = "\
JSON body shape:
  {\"title\":\"...\",\"slug\":\"kebab-slug\",\"markdown\":\"# Spec\\n...\"}

Examples:

  msctl spec dispatch \\
    --agent-id \"$AGENT_ID\" \\
    --json-file /tmp/dispatch-spec.json \\
    --output json

  msctl spec dispatch \\
    --agent-id \"$AGENT_ID\" \\
    --json-file - \\
    --output text < /tmp/dispatch-spec.json")]
pub struct DispatchSpecArgs {
    /// Target agent id.
    #[arg(long)]
    pub agent_id: String,

    #[command(flatten)]
    pub input: JsonInputArgs,

    #[command(flatten)]
    pub server: ServerOptions,
}

pub fn handle(args: DispatchSpecArgs) -> Result<()> {
    let agent_id = normalize_required(&args.agent_id, "--agent-id")?;
    let body = args.input.parse_value()?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_json(&format!("/api/v1/agents/{agent_id}/specs/dispatch"), &body)?;
    println!("{}", render_output(args.server.output, &value)?);
    Ok(())
}

fn render_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    Ok(format!(
        "dispatch conversation: {} path={}",
        value
            .get("conversation_id")
            .and_then(Value::as_str)
            .unwrap_or("-"),
        value
            .get("repo_spec_path")
            .and_then(Value::as_str)
            .unwrap_or("-")
    ))
}
