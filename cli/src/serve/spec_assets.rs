use crate::db::now_ms;
use crate::serve::sha256::sha256_hex;
use crate::serve::state::AppState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SaveSpecFromPathInput {
    pub repo_spec_path: String,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SaveSpecFromPathResult {
    pub spec_id: String,
    pub version_id: String,
    pub repo_spec_path: String,
    pub revision: i64,
    pub status: &'static str,
}

struct ConversationSpecContext {
    agent_id: String,
    project_path: String,
}

struct ExistingSpec {
    id: String,
}

pub fn save_spec_from_path(
    state: &AppState,
    input: SaveSpecFromPathInput,
) -> Result<SaveSpecFromPathResult, SaveSpecError> {
    let repo_spec_path = normalize_spec_path(&input.repo_spec_path)?;
    let conversation_id = normalize_id(&input.conversation_id)?;
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let context = load_conversation_spec_context(&db, &conversation_id)?;
    let markdown = read_repo_markdown(&context.project_path, &repo_spec_path)?;
    let title = extract_title(&markdown)?;
    let slug = slug_from_spec_path(&repo_spec_path)?;
    let markdown_sha256 = sha256_hex(&markdown);
    let now = now_ms();
    let source_idea_id = find_source_idea_id(&db, &conversation_id)?;

    let existing = find_spec_by_path(&db, &repo_spec_path)?;
    let (spec_id, revision) = match existing {
        Some(existing) => {
            let revision = next_revision(&db, &existing.id)?;
            db.execute(
                "UPDATE spec_artifacts
                 SET title = ?1, slug = ?2, status = 'ready', updated_at = ?3
                 WHERE id = ?4",
                params![title, slug, now, existing.id],
            )
            .map_err(|_| SaveSpecError::Internal)?;
            (existing.id, revision)
        }
        None => {
            let spec_id = Uuid::new_v4().to_string();
            db.execute(
                "INSERT INTO spec_artifacts (
                    id, title, slug, status, target_agent_id, target_endpoint_id,
                    target_repo_path, repo_spec_path, latest_version_id, source_idea_id,
                    interview_conversation_id, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'ready', ?4, '', ?5, ?6, '', ?7, ?8, ?9, ?9)",
                params![
                    spec_id,
                    title,
                    slug,
                    context.agent_id,
                    context.project_path,
                    repo_spec_path,
                    source_idea_id,
                    conversation_id,
                    now
                ],
            )
            .map_err(|_| SaveSpecError::Internal)?;
            (spec_id, 1)
        }
    };

    let version_id = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO spec_artifact_versions (
            id, spec_id, revision, repo_spec_path, markdown, markdown_sha256,
            source_conversation_id, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            version_id,
            spec_id,
            revision,
            repo_spec_path,
            markdown,
            markdown_sha256,
            conversation_id,
            now
        ],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    db.execute(
        "UPDATE spec_artifacts SET latest_version_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![version_id, now, spec_id],
    )
    .map_err(|_| SaveSpecError::Internal)?;

    if let Some(source_idea_id) = source_idea_id.as_deref() {
        db.execute(
            "UPDATE spec_ideas
             SET status = 'converted', converted_spec_id = ?1, archived_at = ?2, updated_at = ?2
             WHERE id = ?3",
            params![spec_id, now, source_idea_id],
        )
        .map_err(|_| SaveSpecError::Internal)?;
    }

    Ok(SaveSpecFromPathResult {
        spec_id,
        version_id,
        repo_spec_path,
        revision,
        status: "saved",
    })
}

pub fn list_spec_artifacts(state: &AppState) -> Result<Vec<serde_json::Value>, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let mut stmt = db
        .prepare(
            "SELECT id, title, slug, status, target_agent_id, target_endpoint_id,
                    target_repo_path, repo_spec_path, latest_version_id, source_idea_id,
                    interview_conversation_id, latest_implementation_conversation_id,
                    linked_activity_item_id, created_at, updated_at, v.revision,
                    v.repo_spec_path, v.markdown_sha256, v.source_conversation_id, v.created_at
             FROM spec_artifacts s
             LEFT JOIN spec_artifact_versions v ON v.id = s.latest_version_id
             ORDER BY s.updated_at DESC",
        )
        .map_err(|_| SaveSpecError::Internal)?;
    let rows = stmt
        .query_map([], |row| {
            let latest_version_id = row.get::<_, Option<String>>(8)?.unwrap_or_default();
            let latest_version = row.get::<_, Option<i64>>(15)?.map(|revision| {
                serde_json::json!({
                    "id": latest_version_id.clone(),
                    "spec_id": row.get::<_, String>(0).unwrap_or_default(),
                    "revision": revision,
                    "repo_spec_path": row.get::<_, Option<String>>(16).unwrap_or(None).unwrap_or_default(),
                    "markdown": "",
                    "markdown_sha256": row.get::<_, Option<String>>(17).unwrap_or(None).unwrap_or_default(),
                    "source_conversation_id": row.get::<_, Option<String>>(18).unwrap_or(None).unwrap_or_default(),
                    "created_at": row.get::<_, Option<i64>>(19).unwrap_or(None).unwrap_or_default(),
                })
            });
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "slug": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "target_agent_id": row.get::<_, String>(4)?,
                "target_endpoint_id": row.get::<_, String>(5)?,
                "target_repo_path": row.get::<_, String>(6)?,
                "repo_spec_path": row.get::<_, String>(7)?,
                "latest_version_id": latest_version_id,
                "latest_version": latest_version,
                "source_idea_id": row.get::<_, Option<String>>(9)?,
                "interview_conversation_id": row.get::<_, String>(10)?,
                "latest_implementation_conversation_id": row.get::<_, Option<String>>(11)?,
                "linked_activity_item_id": row.get::<_, Option<String>>(12)?,
                "created_at": row.get::<_, i64>(13)?,
                "updated_at": row.get::<_, i64>(14)?,
            }))
        })
        .map_err(|_| SaveSpecError::Internal)?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}

pub fn get_spec_artifact_detail(
    state: &AppState,
    spec_id: &str,
) -> Result<Option<serde_json::Value>, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let spec = db
        .query_row(
            "SELECT id, title, slug, status, target_agent_id, target_endpoint_id,
                    target_repo_path, repo_spec_path, latest_version_id, source_idea_id,
                    interview_conversation_id, latest_implementation_conversation_id,
                    linked_activity_item_id, created_at, updated_at
             FROM spec_artifacts WHERE id = ?1",
            [spec_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "slug": row.get::<_, String>(2)?,
                    "status": row.get::<_, String>(3)?,
                    "target_agent_id": row.get::<_, String>(4)?,
                    "target_endpoint_id": row.get::<_, String>(5)?,
                    "target_repo_path": row.get::<_, String>(6)?,
                    "repo_spec_path": row.get::<_, String>(7)?,
                    "latest_version_id": row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    "source_idea_id": row.get::<_, Option<String>>(9)?,
                    "interview_conversation_id": row.get::<_, String>(10)?,
                    "latest_implementation_conversation_id": row.get::<_, Option<String>>(11)?,
                    "linked_activity_item_id": row.get::<_, Option<String>>(12)?,
                    "created_at": row.get::<_, i64>(13)?,
                    "updated_at": row.get::<_, i64>(14)?,
                }))
            },
        )
        .optional()
        .map_err(|_| SaveSpecError::Internal)?;
    let Some(spec) = spec else {
        return Ok(None);
    };
    let mut stmt = db
        .prepare(
            "SELECT id, spec_id, revision, repo_spec_path, markdown, markdown_sha256,
                    source_conversation_id, created_at
             FROM spec_artifact_versions
             WHERE spec_id = ?1
             ORDER BY revision DESC",
        )
        .map_err(|_| SaveSpecError::Internal)?;
    let versions: Vec<serde_json::Value> = stmt
        .query_map([spec_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "spec_id": row.get::<_, String>(1)?,
                "revision": row.get::<_, i64>(2)?,
                "repo_spec_path": row.get::<_, String>(3)?,
                "markdown": row.get::<_, String>(4)?,
                "markdown_sha256": row.get::<_, String>(5)?,
                "source_conversation_id": row.get::<_, String>(6)?,
                "created_at": row.get::<_, i64>(7)?,
            }))
        })
        .map_err(|_| SaveSpecError::Internal)?
        .filter_map(Result::ok)
        .collect();
    let latest_version_id = spec
        .get("latest_version_id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let latest_version = versions
        .iter()
        .find(|version| {
            version.get("id").and_then(serde_json::Value::as_str) == Some(latest_version_id)
        })
        .cloned()
        .or_else(|| versions.first().cloned());
    Ok(Some(serde_json::json!({
        "spec": spec,
        "latest_version": latest_version,
        "versions": versions,
    })))
}

fn load_conversation_spec_context(
    db: &Connection,
    conversation_id: &str,
) -> Result<ConversationSpecContext, SaveSpecError> {
    db.query_row(
        "SELECT a.id, a.project_path
         FROM conversations c
         JOIN agents a ON a.id = c.agent_id
         WHERE c.id = ?1",
        [conversation_id],
        |row| {
            Ok(ConversationSpecContext {
                agent_id: row.get(0)?,
                project_path: row.get(1)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => SaveSpecError::NotFound,
        _ => SaveSpecError::Internal,
    })
}

fn find_source_idea_id(
    db: &Connection,
    conversation_id: &str,
) -> Result<Option<String>, SaveSpecError> {
    db.query_row(
        "SELECT id FROM spec_ideas WHERE interview_conversation_id = ?1",
        [conversation_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|_| SaveSpecError::Internal)
}

fn find_spec_by_path(
    db: &Connection,
    repo_spec_path: &str,
) -> Result<Option<ExistingSpec>, SaveSpecError> {
    db.query_row(
        "SELECT id FROM spec_artifacts WHERE repo_spec_path = ?1",
        [repo_spec_path],
        |row| Ok(ExistingSpec { id: row.get(0)? }),
    )
    .optional()
    .map_err(|_| SaveSpecError::Internal)
}

fn next_revision(db: &Connection, spec_id: &str) -> Result<i64, SaveSpecError> {
    db.query_row(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM spec_artifact_versions WHERE spec_id = ?1",
        [spec_id],
        |row| row.get(0),
    )
    .map_err(|_| SaveSpecError::Internal)
}

fn read_repo_markdown(project_path: &str, repo_spec_path: &str) -> Result<String, SaveSpecError> {
    let root = PathBuf::from(project_path)
        .canonicalize()
        .map_err(|_| SaveSpecError::InvalidPath)?;
    let full_path = root.join(repo_spec_path);
    let canonical = full_path
        .canonicalize()
        .map_err(|_| SaveSpecError::FileNotFound)?;
    if !canonical.starts_with(&root) {
        return Err(SaveSpecError::InvalidPath);
    }
    let markdown = std::fs::read_to_string(canonical).map_err(|_| SaveSpecError::FileNotFound)?;
    if markdown.trim().is_empty() {
        return Err(SaveSpecError::EmptyMarkdown);
    }
    Ok(markdown)
}

fn normalize_spec_path(path: &str) -> Result<String, SaveSpecError> {
    let path = path.trim();
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || !path.starts_with("docs/product-specs/")
        || !path.ends_with(".md")
    {
        return Err(SaveSpecError::InvalidPath);
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(SaveSpecError::InvalidPath);
    }
    Ok(path.to_string())
}

fn normalize_id(value: &str) -> Result<String, SaveSpecError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(SaveSpecError::BadRequest);
    }
    Ok(value.to_string())
}

fn extract_title(markdown: &str) -> Result<String, SaveSpecError> {
    markdown
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .ok_or(SaveSpecError::MissingTitle)
}

fn slug_from_spec_path(repo_spec_path: &str) -> Result<String, SaveSpecError> {
    let file_name = Path::new(repo_spec_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(SaveSpecError::InvalidPath)?;
    let slug = file_name
        .strip_suffix(".md")
        .and_then(|name| name.split_once("-SPEC-").map(|(_, slug)| slug))
        .ok_or(SaveSpecError::InvalidPath)?;
    if !is_valid_slug(slug) {
        return Err(SaveSpecError::InvalidPath);
    }
    Ok(slug.to_string())
}

fn is_valid_slug(slug: &str) -> bool {
    if slug.is_empty() || slug.starts_with('-') || slug.ends_with('-') || slug.contains("--") {
        return false;
    }
    slug.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveSpecError {
    BadRequest,
    InvalidPath,
    FileNotFound,
    EmptyMarkdown,
    MissingTitle,
    NotFound,
    Internal,
}

impl SaveSpecError {
    pub fn status_code(self) -> axum::http::StatusCode {
        match self {
            SaveSpecError::BadRequest
            | SaveSpecError::InvalidPath
            | SaveSpecError::EmptyMarkdown
            | SaveSpecError::MissingTitle => axum::http::StatusCode::BAD_REQUEST,
            SaveSpecError::FileNotFound | SaveSpecError::NotFound => {
                axum::http::StatusCode::NOT_FOUND
            }
            SaveSpecError::Internal => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            SaveSpecError::BadRequest => "bad_request",
            SaveSpecError::InvalidPath => "invalid_path",
            SaveSpecError::FileNotFound => "file_not_found",
            SaveSpecError::EmptyMarkdown => "empty_markdown",
            SaveSpecError::MissingTitle => "missing_title",
            SaveSpecError::NotFound => "not_found",
            SaveSpecError::Internal => "internal",
        }
    }
}

#[cfg(test)]
#[path = "spec_assets_tests.rs"]
mod tests;
