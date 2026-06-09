use crate::commands::server_client::{
    normalize_required, OutputFormat, ServerClient, ServerOptions,
};
use anyhow::Result;
use clap::Args;
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec list --output json

  msctl spec list --output text")]
pub struct ListSpecsArgs {
    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec get \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --output json

  msctl spec get \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --output text")]
pub struct GetSpecArgs {
    /// UUID of the SpecArtifact to inspect.
    #[arg(long)]
    pub spec_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Requires a running `msctl serve` and Bearer token (`msctl auth login` or --token).
Reads a repo-relative product spec path through the conversation's target repo,
saves an immutable artifact snapshot, and returns the spec/version ids.

Example:

  msctl spec save \\
    --path docs/product-specs/2026-06-09-SPEC-demo.md \\
    --conversation-id \"$CONV_ID\" \\
    --output json")]
pub struct SaveSpecArgs {
    /// Repo-relative product spec path under docs/product-specs/.
    #[arg(long)]
    pub path: String,

    /// Interview conversation id used to resolve the target repo and source idea.
    #[arg(long)]
    pub conversation_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec delete \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda

  msctl spec delete \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --yes \\
    --output text")]
pub struct DeleteSpecArgs {
    /// UUID of the SpecArtifact to delete.
    #[arg(long)]
    pub spec_id: String,

    /// Skip interactive confirmation.
    #[arg(long)]
    pub yes: bool,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Examples:

  msctl spec implement \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --output json

  msctl spec implement \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --output text")]
pub struct ImplementSpecArgs {
    /// UUID of the SpecArtifact to implement.
    #[arg(long)]
    pub spec_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Args, Debug)]
#[command(after_help = "\
Marks the given SpecArtifact as implementation-complete and broadcasts a
spec_changed event so connected mobile clients refresh immediately.

Examples:

  msctl spec mark-done \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda

  msctl spec mark-done \\
    --spec-id 05521d4e-021e-43eb-9f7e-fa97d8b91fda \\
    --output json")]
pub struct MarkSpecDoneArgs {
    /// UUID of the SpecArtifact to mark as done.
    #[arg(long)]
    pub spec_id: String,

    #[command(flatten)]
    pub server: ServerOptions,
}

#[derive(Serialize)]
struct SaveSpecRequest {
    path: String,
    conversation_id: String,
}

pub fn list(args: ListSpecsArgs) -> Result<()> {
    let client = ServerClient::from_options(&args.server)?;
    let value = client.get_json("/api/v1/specs")?;
    println!("{}", render_specs_output(args.server.output, &value)?);
    Ok(())
}

pub fn get(args: GetSpecArgs) -> Result<()> {
    let spec_id = normalize_required(&args.spec_id, "--spec-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.get_json(&format!("/api/v1/specs/{spec_id}"))?;
    println!("{}", render_spec_detail_output(args.server.output, &value)?);
    Ok(())
}

pub fn save(args: SaveSpecArgs) -> Result<()> {
    let path = normalize_required(&args.path, "--path")?;
    let conversation_id = normalize_required(&args.conversation_id, "--conversation-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_json(
        "/api/v1/specs/save-from-path",
        &SaveSpecRequest {
            path,
            conversation_id,
        },
    )?;
    println!("{}", render_save_output(args.server.output, &value)?);
    Ok(())
}

pub fn delete(args: DeleteSpecArgs) -> Result<()> {
    let spec_id = normalize_required(&args.spec_id, "--spec-id")?;
    confirm(args.yes, &format!("Delete spec {spec_id}? [y/N]: "))?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.delete(&format!("/api/v1/specs/{spec_id}"))?;
    println!(
        "{}",
        render_delete_output(args.server.output, "spec", &spec_id, value.as_ref())?
    );
    Ok(())
}

pub fn implement(args: ImplementSpecArgs) -> Result<()> {
    let spec_id = normalize_required(&args.spec_id, "--spec-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_empty_json(&format!("/api/v1/specs/{spec_id}/implement"))?;
    println!(
        "{}",
        render_implementation_output(args.server.output, &value)?
    );
    Ok(())
}

pub fn mark_done(args: MarkSpecDoneArgs) -> Result<()> {
    let spec_id = normalize_required(&args.spec_id, "--spec-id")?;
    let client = ServerClient::from_options(&args.server)?;
    let value = client.post_empty_json(&format!("/api/v1/specs/{spec_id}/done"))?;
    println!(
        "{}",
        render_mark_done_output(args.server.output, &value, &spec_id)?
    );
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

fn render_specs_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let specs = value
        .get("specs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if specs.is_empty() {
        return Ok("No specs saved.".to_string());
    }
    Ok(specs
        .iter()
        .map(|spec| {
            format!(
                "{} {} {} {}",
                text_field(spec, "id"),
                text_field(spec, "status"),
                text_field(spec, "title"),
                text_field(spec, "repo_spec_path")
            )
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

fn render_spec_detail_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let spec = value.get("spec").unwrap_or(value);
    Ok(format!(
        "{} {} {} {}",
        text_field(spec, "id"),
        text_field(spec, "status"),
        text_field(spec, "title"),
        text_field(spec, "repo_spec_path")
    ))
}

fn render_save_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    Ok(format!(
        "{} {} {} rev={} {}",
        text_field(value, "spec_id"),
        text_field(value, "version_id"),
        text_field(value, "repo_spec_path"),
        value
            .get("revision")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        text_field(value, "status")
    ))
}

fn render_delete_output(
    format: OutputFormat,
    kind: &str,
    id: &str,
    value: Option<&Value>,
) -> Result<String> {
    if format == OutputFormat::Json {
        return Ok(value
            .map(|json| json.to_string())
            .unwrap_or_else(|| serde_json::json!({ "id": id, "status": "deleted" }).to_string()));
    }
    Ok(format!("{kind} deleted: {id}"))
}

fn render_implementation_output(format: OutputFormat, value: &Value) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    Ok(format!(
        "implementation conversation: {} spec={} status={}",
        text_field(value, "conversation_id"),
        nested_text_field(value, "spec", "id"),
        nested_text_field(value, "spec", "status")
    ))
}

fn render_mark_done_output(
    format: OutputFormat,
    value: &Value,
    fallback_id: &str,
) -> Result<String> {
    if format == OutputFormat::Json {
        return format.render_json(value);
    }
    let spec_id = value
        .get("spec_id")
        .and_then(Value::as_str)
        .unwrap_or(fallback_id);
    Ok(format!(
        "marked done: {} status={}",
        spec_id,
        text_field(value, "status")
    ))
}

fn text_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}

fn nested_text_field(value: &Value, object_key: &str, key: &str) -> String {
    value
        .get(object_key)
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .unwrap_or("-")
        .to_string()
}
