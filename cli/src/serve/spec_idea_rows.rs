use crate::serve::{
    spec_assets::SaveSpecError,
    spec_ideas::{SpecIdeaAttachmentMutation, SpecIdeaNoteMutation},
};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub(super) struct AgentTarget {
    pub id: String,
    pub name: String,
    pub project_path: String,
}

#[derive(Debug, Clone)]
pub(super) struct IdeaBase {
    pub id: String,
    pub title: String,
    pub status: String,
    pub target_agent_id: String,
    pub target_endpoint_id: String,
    pub target_repo_path: String,
    pub target_agent_name: String,
    pub body: String,
    pub interview_conversation_id: Option<String>,
    pub converted_spec_id: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

pub(super) fn idea_detail_json(
    db: &Connection,
    idea_id: &str,
) -> Result<Option<serde_json::Value>, SaveSpecError> {
    let Some(base) = load_idea_base(db, idea_id)? else {
        return Ok(None);
    };
    Ok(Some(serde_json::json!({
        "id": base.id,
        "title": base.title,
        "status": base.status,
        "target_agent_id": base.target_agent_id,
        "target_endpoint_id": base.target_endpoint_id,
        "target_repo_path": base.target_repo_path,
        "target_agent_name": base.target_agent_name,
        "body": base.body,
        "notes": load_notes(db, idea_id)?,
        "attachments": load_attachments(db, idea_id)?,
        "interview_conversation_id": base.interview_conversation_id,
        "converted_spec_id": base.converted_spec_id,
        "error_message": base.error_message,
        "created_at": base.created_at,
        "updated_at": base.updated_at,
        "archived_at": base.archived_at,
    })))
}

pub(super) fn load_idea_base(
    db: &Connection,
    idea_id: &str,
) -> Result<Option<IdeaBase>, SaveSpecError> {
    db.query_row(
        "SELECT id, title, status, target_agent_id, target_endpoint_id, target_repo_path,
                target_agent_name, body, interview_conversation_id, converted_spec_id,
                error_message, created_at, updated_at, archived_at
         FROM spec_ideas WHERE id = ?1",
        [idea_id],
        |row| {
            Ok(IdeaBase {
                id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                target_agent_id: row.get(3)?,
                target_endpoint_id: row.get(4)?,
                target_repo_path: row.get(5)?,
                target_agent_name: row.get(6)?,
                body: row.get(7)?,
                interview_conversation_id: row.get(8)?,
                converted_spec_id: row.get(9)?,
                error_message: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
                archived_at: row.get(13)?,
            })
        },
    )
    .optional()
    .map_err(|_| SaveSpecError::Internal)
}

pub(super) fn load_agent_target(
    db: &Connection,
    agent_id: &str,
) -> Result<AgentTarget, SaveSpecError> {
    db.query_row(
        "SELECT id, name, project_path FROM agents WHERE id = ?1",
        [agent_id],
        |row| {
            Ok(AgentTarget {
                id: row.get(0)?,
                name: row.get(1)?,
                project_path: row.get(2)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => SaveSpecError::NotFound,
        _ => SaveSpecError::Internal,
    })
}

pub(super) fn load_note_bodies(
    db: &Connection,
    idea_id: &str,
) -> Result<Vec<String>, SaveSpecError> {
    let mut stmt = db
        .prepare("SELECT body FROM spec_idea_notes WHERE idea_id = ?1 ORDER BY created_at ASC")
        .map_err(|_| SaveSpecError::Internal)?;
    let rows = stmt
        .query_map([idea_id], |row| row.get(0))
        .map_err(|_| SaveSpecError::Internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SaveSpecError::Internal)?;
    Ok(rows)
}

pub(super) fn load_attachment_summaries(
    db: &Connection,
    idea_id: &str,
) -> Result<Vec<String>, SaveSpecError> {
    Ok(load_attachments(db, idea_id)?
        .into_iter()
        .map(|value| {
            let kind = value
                .get("kind")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("log");
            let title = value
                .get("title")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let uri = value
                .get("uri")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let text = value
                .get("text")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            format!("{kind}: {title} {uri} {text}").trim().to_string()
        })
        .collect())
}

pub(super) fn replace_notes(
    db: &Connection,
    idea_id: &str,
    notes: Vec<SpecIdeaNoteMutation>,
    now: i64,
) -> Result<(), SaveSpecError> {
    db.execute("DELETE FROM spec_idea_notes WHERE idea_id = ?1", [idea_id])
        .map_err(|_| SaveSpecError::Internal)?;
    for note in notes {
        let body = clean_required(Some(&note.body))?;
        db.execute(
            "INSERT INTO spec_idea_notes (id, idea_id, body, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![
                note.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                idea_id,
                body,
                now
            ],
        )
        .map_err(|_| SaveSpecError::Internal)?;
    }
    Ok(())
}

pub(super) fn replace_attachments(
    db: &Connection,
    idea_id: &str,
    attachments: Vec<SpecIdeaAttachmentMutation>,
    now: i64,
) -> Result<(), SaveSpecError> {
    db.execute(
        "DELETE FROM spec_idea_attachments WHERE idea_id = ?1",
        [idea_id],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    for attachment in attachments {
        let kind = normalize_attachment_kind(&attachment.kind)?;
        db.execute(
            "INSERT INTO spec_idea_attachments
             (id, idea_id, kind, title, uri, text, file_id, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '{}', ?8)",
            params![
                attachment.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                idea_id,
                kind,
                attachment.title.map(|value| clean_string(&value)),
                attachment.uri.map(|value| clean_string(&value)),
                attachment.text.map(|value| clean_string(&value)),
                attachment.file_id.map(|value| clean_string(&value)),
                now
            ],
        )
        .map_err(|_| SaveSpecError::Internal)?;
    }
    Ok(())
}

pub(super) fn clean_required(value: Option<&str>) -> Result<String, SaveSpecError> {
    let cleaned = value.map(clean_string).unwrap_or_default();
    if cleaned.is_empty() {
        return Err(SaveSpecError::BadRequest);
    }
    Ok(cleaned)
}

pub(super) fn clean_string(value: &str) -> String {
    value.trim().to_string()
}

pub(super) fn clean_title(title: Option<&str>, body: &str) -> String {
    title
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            body.lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(|line| line.chars().take(80).collect())
        })
        .unwrap_or_else(|| "Untitled idea".to_string())
}

pub(super) fn normalize_idea_status(status: &str) -> Result<&'static str, SaveSpecError> {
    match status {
        "open" => Ok("open"),
        "interviewing" => Ok("interviewing"),
        "converted" => Ok("converted"),
        "archived" => Ok("archived"),
        "failed" => Ok("failed"),
        _ => Err(SaveSpecError::BadRequest),
    }
}

fn normalize_attachment_kind(kind: &str) -> Result<&'static str, SaveSpecError> {
    match kind {
        "link" => Ok("link"),
        "log" => Ok("log"),
        "image" => Ok("image"),
        _ => Err(SaveSpecError::BadRequest),
    }
}

fn load_notes(db: &Connection, idea_id: &str) -> Result<Vec<serde_json::Value>, SaveSpecError> {
    let mut stmt = db
        .prepare(
            "SELECT id, body, created_at, updated_at
             FROM spec_idea_notes WHERE idea_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|_| SaveSpecError::Internal)?;
    let rows = stmt
        .query_map([idea_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "body": row.get::<_, String>(1)?,
                "created_at": row.get::<_, i64>(2)?,
                "updated_at": row.get::<_, i64>(3)?,
            }))
        })
        .map_err(|_| SaveSpecError::Internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SaveSpecError::Internal)?;
    Ok(rows)
}

fn load_attachments(
    db: &Connection,
    idea_id: &str,
) -> Result<Vec<serde_json::Value>, SaveSpecError> {
    let mut stmt = db
        .prepare(
            "SELECT id, kind, title, uri, text, file_id, created_at
             FROM spec_idea_attachments WHERE idea_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|_| SaveSpecError::Internal)?;
    let rows = stmt
        .query_map([idea_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "title": row.get::<_, Option<String>>(2)?,
                "uri": row.get::<_, Option<String>>(3)?,
                "text": row.get::<_, Option<String>>(4)?,
                "file_id": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, i64>(6)?,
            }))
        })
        .map_err(|_| SaveSpecError::Internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| SaveSpecError::Internal)?;
    Ok(rows)
}
