use crate::commands::{
    json_input::JsonInputArgs,
    server_client::{normalize_required, OutputFormat, ServerClient, ServerOptions},
};
use anyhow::Result;
use clap::{Args, Subcommand};
use serde_json::Value;
use std::io::{self, Write};

#[derive(Subcommand)]
pub enum SpecIdeaCommands {
    /// List spec ideas
    List(ListIdeasArgs),
    /// Create a spec idea from a JSON body
    Create(WriteIdeaArgs),
    /// Update a spec idea from a JSON body
    Update(UpdateIdeaArgs),
    /// Archive a spec idea
    Archive(ArchiveIdeaArgs),
    /// Restore an archived spec idea
    Restore(RestoreIdeaArgs),
    /// Delete an archived spec idea
    Delete(DeleteIdeaArgs),
    /// Start or reopen the interview conversation for an idea
    Interview(InterviewIdeaArgs),
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec idea list --output json

  msctl spec idea list --output text")]
pub struct ListIdeasArgs {
    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
JSON body shape follows SpecIdeaMutation.

Examples:

  msctl spec idea create \\
    --json-file /tmp/spec-idea.json \\
    --output json

  msctl spec idea create \\
    --json '{\"title\":\"PR merge guardrail\",\"target_agent_id\":\"agent_uuid\",\"body\":\"Need merge policy automation.\"}' \\
    --output json

  msctl spec idea create \\
    --json-file - \\
    --output text < /tmp/spec-idea.json")]
pub struct WriteIdeaArgs {
    #[command(flatten)]
    pub input: JsonInputArgs,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec idea update \\
    --idea-id \"$IDEA_ID\" \\
    --json-file /tmp/spec-idea-update.json \\
    --output json

  msctl spec idea update \\
    --idea-id \"$IDEA_ID\" \\
    --json '{\"status\":\"open\",\"title\":\"PR merge guardrail v2\"}' \\
    --output text")]
pub struct UpdateIdeaArgs {
    /// Idea id to update.
    #[arg(long)]
    pub idea_id: String,

    #[command(flatten)]
    pub input: JsonInputArgs,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
pub struct IdeaIdArgs {
    /// Idea id.
    #[arg(long)]
    pub idea_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Example:

  msctl spec idea archive \\
    --idea-id \"$IDEA_ID\" \\
    --output text")]
pub struct ArchiveIdeaArgs {
    /// Idea id to archive.
    #[arg(long)]
    pub idea_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Example:

  msctl spec idea restore \\
    --idea-id \"$IDEA_ID\" \\
    --output text")]
pub struct RestoreIdeaArgs {
    /// Idea id to restore.
    #[arg(long)]
    pub idea_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec idea interview \\
    --idea-id \"$IDEA_ID\" \\
    --output json

  msctl spec idea interview \\
    --idea-id \"$IDEA_ID\" \\
    --output text")]
pub struct InterviewIdeaArgs {
    /// Idea id to interview.
    #[arg(long)]
    pub idea_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec idea delete \\
    --idea-id \"$IDEA_ID\"

  msctl spec idea delete \\
    --idea-id \"$IDEA_ID\" \\
    --yes \\
    --output text")]
pub struct DeleteIdeaArgs {
    /// Idea id to delete.
    #[arg(long)]
    pub idea_id: String,

    /// Skip interactive confirmation.
    #[arg(long)]
    pub yes: bool,

    #[command(flatten)]
    pub server: ServerOptions,
}

pub fn handle(cmd: SpecIdeaCommands) -> Result<()> {
    match cmd {
        SpecIdeaCommands::List(args) => list(args),
        SpecIdeaCommands::Create(args) => create(args),
        SpecIdeaCommands::Update(args) => update(args),
        SpecIdeaCommands::Archive(args) => archive(args),
        SpecIdeaCommands::Restore(args) => restore(args),
        SpecIdeaCommands::Delete(args) => delete(args),
        SpecIdeaCommands::Interview(args) => interview(args),
    }
}

fn list(args: ListIdeasArgs) -> Result<()> {
    let client = ServerClient::from_options(&args.server)?;
    let value = client.get_json("/api/v1/spec-ideas")?;
    println!("{}", render_ideas_output(args.server.output, &value)?);
    Ok(())
}

fn create(args: WriteIdeaArgs) -> Result<()> {
    let body = args.input.parse_value()?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_json("/api/v1/spec-ideas", &body)?;
    println!("{}", render_idea_output(args.server.output, &value)?);
    Ok(())
}

fn update(args: UpdateIdeaArgs) -> Result<()> {
    let idea_id = normalize_required(&args.idea_id, "--idea-id")?;
    let body = args.input.parse_value()?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.patch_json(&format!("/api/v1/spec-ideas/{idea_id}"), &body)?;
    println!("{}", render_idea_output(args.server.output, &value)?);
    Ok(())
}

fn archive(args: ArchiveIdeaArgs) -> Result<()> {
    let args = IdeaIdArgs {
        idea_id: args.idea_id,
        server: args.server,
    };
    patch_status(args, "archived")
}

fn restore(args: RestoreIdeaArgs) -> Result<()> {
    let args = IdeaIdArgs {
        idea_id: args.idea_id,
        server: args.server,
    };
    patch_status(args, "open")
}

fn patch_status(args: IdeaIdArgs, status: &str) -> Result<()> {
    let idea_id = normalize_required(&args.idea_id, "--idea-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let body = serde_json::json!({ "status": status });
    let value = client.patch_json(&format!("/api/v1/spec-ideas/{idea_id}"), &body)?;
    println!("{}", render_idea_output(args.server.output, &value)?);
    Ok(())
}

fn delete(args: DeleteIdeaArgs) -> Result<()> {
    let idea_id = normalize_required(&args.idea_id, "--idea-id")?;
    confirm(args.yes, &format!("Delete idea {idea_id}? [y/N]: "))?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.delete(&format!("/api/v1/spec-ideas/{idea_id}"))?;
    println!(
        "{}",
        render_delete_output(args.server.output, &idea_id, value.as_ref())?
    );
    Ok(())
}

fn interview(args: InterviewIdeaArgs) -> Result<()> {
    let idea_id = normalize_required(&args.idea_id, "--idea-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_empty_json(&format!("/api/v1/spec-ideas/{idea_id}/interview"))?;
    println!("{}", render_interview_output(args.server.output, &value)?);
    Ok(())
}

fn confirm(skip: bool, prompt: &str) -> Result<()> {
    if skip {
        return Ok(());
    }
    print!("{prompt}");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    if input.trim().to_lowercase() != "y" {
        anyhow::bail!("cancelled");
    }
    Ok(())
}

fn render_ideas_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let ideas = value
        .get("ideas")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if ideas.is_empty() {
        return Ok("No spec ideas.".to_string());
    }
    Ok(ideas
        .iter()
        .map(summary_from_idea)
        .collect::<Vec<_>>()
        .join("\n"))
}

fn render_idea_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let idea = value.get("idea").unwrap_or(value);
    Ok(summary_from_idea(idea))
}

fn render_delete_output(format: OutputFormat, id: &str, value: Option<&Value>) -> Result<String> {
    if format == OutputFormat::Json {
        return Ok(value
            .map(|json| json.to_string())
            .unwrap_or_else(|| serde_json::json!({ "id": id, "status": "deleted" }).to_string()));
    }
    Ok(format!("idea deleted: {id}"))
}

fn render_interview_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let idea = value.get("idea").unwrap_or(&Value::Null);
    Ok(format!(
        "interview conversation: {} idea={} status={}",
        text_field(value, "conversation_id"),
        text_field(idea, "id"),
        text_field(idea, "status")
    ))
}

fn summary_from_idea(idea: &Value) -> String {
    format!(
        "{} {} {}",
        text_field(idea, "id"),
        text_field(idea, "status"),
        text_field(idea, "title")
    )
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}
