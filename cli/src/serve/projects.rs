use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub normalized_project_path: String,
    pub default_agent_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn normalize_project_path(project_path: &str) -> String {
    let trimmed = project_path.trim();
    let expanded = expand_home(trimmed);
    let raw_path = PathBuf::from(expanded);
    let absolute = if raw_path.is_absolute() {
        raw_path
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(&raw_path))
            .unwrap_or(raw_path)
    };
    let normalized = normalize_components(&absolute);
    let rendered = normalized.to_string_lossy().to_string();
    trim_trailing_slashes(&rendered)
}

pub fn derive_project_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| project_path.to_string())
}

pub fn upsert_project_for_path(
    conn: &Connection,
    project_path: &str,
    now: i64,
) -> Result<ProjectRecord> {
    let normalized = normalize_project_path(project_path);
    let name = derive_project_name(&normalized);
    conn.execute(
        "INSERT INTO projects (
            id, name, project_path, normalized_project_path, created_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(normalized_project_path) DO UPDATE SET
            name = excluded.name,
            project_path = excluded.project_path,
            updated_at = excluded.updated_at",
        params![
            Uuid::new_v4().to_string(),
            name,
            normalized,
            normalized,
            now
        ],
    )
    .context("Failed to upsert project")?;
    load_project_by_normalized_path(conn, &normalize_project_path(project_path))?
        .context("Project missing after upsert")
}

pub fn load_project_by_id(conn: &Connection, project_id: &str) -> Result<Option<ProjectRecord>> {
    conn.query_row(
        "SELECT id, name, project_path, normalized_project_path, default_agent_id, created_at, updated_at
         FROM projects
         WHERE id = ?1",
        [project_id],
        project_from_row,
    )
    .optional()
    .context("Failed to load project")
}

pub fn load_project_by_normalized_path(
    conn: &Connection,
    normalized_project_path: &str,
) -> Result<Option<ProjectRecord>> {
    conn.query_row(
        "SELECT id, name, project_path, normalized_project_path, default_agent_id, created_at, updated_at
         FROM projects
         WHERE normalized_project_path = ?1",
        [normalized_project_path],
        project_from_row,
    )
    .optional()
    .context("Failed to load project by normalized path")
}

pub fn set_default_resource_if_empty(
    conn: &Connection,
    project_id: &str,
    agent_id: &str,
) -> Result<()> {
    conn.execute(
        "UPDATE projects
         SET default_agent_id = ?1
         WHERE id = ?2 AND default_agent_id IS NULL",
        params![agent_id, project_id],
    )
    .context("Failed to set project default resource")?;
    Ok(())
}

pub fn ensure_project_for_agent(
    conn: &Connection,
    agent_id: &str,
    now: i64,
) -> Result<Option<ProjectRecord>> {
    let agent: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT project_id, project_path FROM agents WHERE id = ?1",
            [agent_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("Failed to load agent project ownership")?;
    let Some((existing_project_id, project_path)) = agent else {
        return Ok(None);
    };

    if let Some(project_id) = existing_project_id {
        return load_project_by_id(conn, &project_id);
    }

    let project = upsert_project_for_path(conn, &project_path, now)?;
    conn.execute(
        "UPDATE agents SET project_id = ?1 WHERE id = ?2",
        params![project.id, agent_id],
    )
    .context("Failed to backfill agent project_id")?;
    set_default_resource_if_empty(conn, &project.id, agent_id)?;
    Ok(Some(project))
}

pub fn project_id_for_agent(conn: &Connection, agent_id: &str, now: i64) -> Result<Option<String>> {
    Ok(ensure_project_for_agent(conn, agent_id, now)?.map(|project| project.id))
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectRecord> {
    Ok(ProjectRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        project_path: row.get(2)?,
        normalized_project_path: row.get(3)?,
        default_agent_id: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn expand_home(project_path: &str) -> String {
    if project_path == "~" {
        return dirs::home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| project_path.to_string());
    }
    if let Some(rest) = project_path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    project_path.to_string()
}

fn normalize_components(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push("..");
                }
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir => normalized.push(Path::new("/")),
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
        }
    }
    if normalized.as_os_str().is_empty() {
        PathBuf::from("/")
    } else {
        normalized
    }
}

fn trim_trailing_slashes(path: &str) -> String {
    if path == "/" {
        return path.to_string();
    }
    path.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_project_path_trims_trailing_slash() {
        assert_eq!(normalize_project_path("/tmp/multisoul/"), "/tmp/multisoul");
    }

    #[test]
    fn test_derive_project_name_uses_basename() {
        assert_eq!(derive_project_name("/tmp/multisoul"), "multisoul");
    }

    #[test]
    fn test_upsert_project_for_path_reuses_normalized_path() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open_at(&dir.path().join("test.db")).unwrap();
        let first = upsert_project_for_path(&conn, "/tmp/demo", 10).unwrap();
        let second = upsert_project_for_path(&conn, "/tmp/demo/", 20).unwrap();

        assert_eq!(
            first.id, second.id,
            "trailing slash variants should resolve to one project"
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "upsert should not duplicate projects");
    }
}
