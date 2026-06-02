use crate::commands::agent::insert_agent;
use crate::commands::inject::inject_context;
use crate::db::open;
use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::{Path, PathBuf};

const QUICK_REGISTER_RUNTIMES: &[&str] = &["claude-code", "codex", "cursor-cli", "kodax"];
const DEFAULT_RUNTIME_MODE: &str = "full-auto";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QuickRegisterResult {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) project_path: String,
    pub(crate) runtime: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QuickRegisterPreflight {
    pub(crate) runtime: String,
    pub(crate) workspace: PathBuf,
}

pub(crate) fn valid_runtime_values() -> &'static str {
    "claude-code, codex, cursor-cli, kodax"
}

pub(crate) fn validate_quick_register_runtime(runtime: &str) -> Result<()> {
    if QUICK_REGISTER_RUNTIMES.contains(&runtime) {
        Ok(())
    } else {
        anyhow::bail!(
            "Invalid runtime '{}'. Valid values: {}",
            runtime,
            valid_runtime_values()
        );
    }
}

pub(crate) fn infer_agent_name_from_workspace(workspace: &Path) -> Result<String> {
    workspace
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(ToOwned::to_owned)
        .context("Cannot infer agent name from current directory")
}

pub(crate) fn workspace_to_project_path(workspace: &Path) -> Result<String> {
    workspace
        .to_str()
        .map(ToOwned::to_owned)
        .context("Workspace path must be valid UTF-8")
}

pub(crate) fn agent_name_exists(conn: &Connection, name: &str) -> Result<bool> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM agents WHERE name = ?1", [name], |r| {
            r.get(0)
        })
        .context("Failed to check existing agent name")?;
    Ok(count > 0)
}

pub(crate) fn find_available_agent_name(conn: &Connection, base: &str) -> Result<String> {
    if !agent_name_exists(conn, base)? {
        return Ok(base.to_string());
    }

    let mut suffix = 2;
    loop {
        let candidate = format!("{}-{}", base, suffix);
        if !agent_name_exists(conn, &candidate)? {
            return Ok(candidate);
        }
        suffix += 1;
    }
}

fn insert_and_inject_quick_agent(
    conn: &Connection,
    name: &str,
    project: &str,
    runtime: &str,
) -> Result<String> {
    let id = insert_agent(conn, name, project, runtime, DEFAULT_RUNTIME_MODE)?;
    if let Err(inject_err) = inject_context(runtime, Path::new(project)) {
        if let Err(rollback_err) = conn.execute("DELETE FROM agents WHERE id = ?1", [&id]) {
            return Err(inject_err).context(format!(
                "Context injection failed and rollback failed: {rollback_err}"
            ));
        }
        return Err(inject_err);
    }
    Ok(id)
}

pub(crate) fn quick_register_in_workspace(
    conn: &Connection,
    runtime: &str,
    workspace: &Path,
) -> Result<QuickRegisterResult> {
    validate_quick_register_runtime(runtime)?;
    let base_name = infer_agent_name_from_workspace(workspace)?;
    let name = find_available_agent_name(conn, &base_name)?;
    let project_path = workspace_to_project_path(workspace)?;
    let id = insert_and_inject_quick_agent(conn, &name, &project_path, runtime)?;

    Ok(QuickRegisterResult {
        id,
        name,
        project_path,
        runtime: runtime.to_string(),
    })
}

pub(crate) fn quick_register_preflight(
    args: Vec<String>,
    workspace: PathBuf,
) -> Result<QuickRegisterPreflight> {
    if args.len() != 1 {
        anyhow::bail!(
            "Quick register expects exactly one runtime. Valid values: {}",
            valid_runtime_values()
        );
    }

    let runtime = args
        .into_iter()
        .next()
        .context("Quick register expects exactly one runtime")?;
    validate_quick_register_runtime(&runtime)?;
    infer_agent_name_from_workspace(&workspace)?;
    workspace_to_project_path(&workspace)?;

    Ok(QuickRegisterPreflight { runtime, workspace })
}

pub(crate) fn quick_register(args: Vec<String>) -> Result<()> {
    let workspace = std::env::current_dir().context("Failed to access current directory")?;
    let preflight = quick_register_preflight(args, workspace)?;
    let conn = open()?;
    let result = quick_register_in_workspace(&conn, &preflight.runtime, &preflight.workspace)?;

    println!("Agent '{}' registered successfully", result.name);
    println!("ID: {}", result.id);
    println!("Workspace: {}", result.project_path);
    println!("Runtime: {}", result.runtime);
    Ok(())
}

#[cfg(test)]
#[path = "agent_quick_register_tests.rs"]
mod tests;
