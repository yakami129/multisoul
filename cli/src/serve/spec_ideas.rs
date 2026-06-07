use crate::db::now_ms;
use crate::serve::{
    spec_assets::SaveSpecError,
    spec_idea_rows::{
        clean_required, clean_string, clean_title, idea_detail_json, load_agent_target,
        load_attachment_summaries, load_idea_base, load_note_bodies, normalize_idea_status,
        replace_attachments, replace_notes,
    },
    state::AppState,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Deserialize)]
pub struct SpecIdeaMutation {
    pub id: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub target_agent_id: Option<String>,
    pub target_endpoint_id: Option<String>,
    pub target_repo_path: Option<String>,
    pub target_agent_name: Option<String>,
    pub body: Option<String>,
    pub notes: Option<Vec<SpecIdeaNoteMutation>>,
    pub attachments: Option<Vec<SpecIdeaAttachmentMutation>>,
    pub interview_conversation_id: Option<String>,
    pub converted_spec_id: Option<String>,
    pub error_message: Option<String>,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpecIdeaNoteMutation {
    pub id: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpecIdeaAttachmentMutation {
    pub id: Option<String>,
    pub kind: String,
    pub title: Option<String>,
    pub uri: Option<String>,
    pub text: Option<String>,
    pub file_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InterviewIdeaContext {
    pub id: String,
    pub title: String,
    pub target_agent_id: String,
    pub target_repo_path: String,
    pub body: String,
    pub notes: Vec<String>,
    pub attachment_summaries: Vec<String>,
    pub interview_conversation_id: Option<String>,
}

pub fn list_spec_ideas(state: &AppState) -> Result<Vec<serde_json::Value>, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let mut stmt = db
        .prepare("SELECT id FROM spec_ideas ORDER BY updated_at DESC")
        .map_err(|_| SaveSpecError::Internal)?;
    let ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|_| SaveSpecError::Internal)?
        .filter_map(Result::ok)
        .collect();
    ids.into_iter()
        .map(|id| idea_detail_json(&db, &id)?.ok_or(SaveSpecError::NotFound))
        .collect()
}

pub fn get_spec_idea(
    state: &AppState,
    idea_id: &str,
) -> Result<Option<serde_json::Value>, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    idea_detail_json(&db, idea_id)
}

pub fn get_interview_context(
    state: &AppState,
    idea_id: &str,
) -> Result<InterviewIdeaContext, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let base = load_idea_base(&db, idea_id)?.ok_or(SaveSpecError::NotFound)?;
    let notes = load_note_bodies(&db, idea_id)?;
    let attachment_summaries = load_attachment_summaries(&db, idea_id)?;
    Ok(InterviewIdeaContext {
        id: base.id,
        title: base.title,
        target_agent_id: base.target_agent_id,
        target_repo_path: base.target_repo_path,
        body: base.body,
        notes,
        attachment_summaries,
        interview_conversation_id: base.interview_conversation_id,
    })
}

pub fn create_spec_idea(
    state: &AppState,
    mutation: SpecIdeaMutation,
) -> Result<serde_json::Value, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let now = now_ms();
    let body = clean_required(mutation.body.as_deref())?;
    let agent_id = clean_required(mutation.target_agent_id.as_deref())?;
    let agent = load_agent_target(&db, &agent_id)?;
    let target_repo_path = mutation
        .target_repo_path
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| agent.project_path.clone());
    if target_repo_path != agent.project_path {
        return Err(SaveSpecError::BadRequest);
    }
    let id = mutation
        .id
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let title = clean_title(mutation.title.as_deref(), &body);
    let status = normalize_idea_status(mutation.status.as_deref().unwrap_or("open"))?;
    let endpoint_id = mutation
        .target_endpoint_id
        .as_deref()
        .map(clean_string)
        .unwrap_or_default();
    let agent_name = mutation
        .target_agent_name
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| agent.name.clone());
    db.execute(
        "INSERT INTO spec_ideas (
            id, title, status, target_agent_id, target_endpoint_id, target_repo_path,
            target_agent_name, body, interview_conversation_id, converted_spec_id,
            error_message, created_at, updated_at, archived_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)",
        params![
            id,
            title,
            status,
            agent.id,
            endpoint_id,
            target_repo_path,
            agent_name,
            body,
            mutation.interview_conversation_id,
            mutation.converted_spec_id,
            mutation.error_message,
            now,
            mutation.archived_at
        ],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    replace_notes(&db, &id, mutation.notes.unwrap_or_default(), now)?;
    replace_attachments(&db, &id, mutation.attachments.unwrap_or_default(), now)?;
    idea_detail_json(&db, &id)?.ok_or(SaveSpecError::Internal)
}

pub fn update_spec_idea(
    state: &AppState,
    idea_id: &str,
    mutation: SpecIdeaMutation,
) -> Result<serde_json::Value, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let current = load_idea_base(&db, idea_id)?.ok_or(SaveSpecError::NotFound)?;
    let now = now_ms();
    let body = mutation
        .body
        .as_deref()
        .map(clean_string)
        .unwrap_or(current.body);
    let target_agent_id = mutation
        .target_agent_id
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or(current.target_agent_id);
    let agent = load_agent_target(&db, &target_agent_id)?;
    let target_repo_path = mutation
        .target_repo_path
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| current.target_repo_path.clone());
    if target_repo_path != agent.project_path {
        return Err(SaveSpecError::BadRequest);
    }
    let status = normalize_idea_status(mutation.status.as_deref().unwrap_or(&current.status))?;
    let archived_at = if status == "archived" {
        Some(
            mutation
                .archived_at
                .unwrap_or(current.archived_at.unwrap_or(now)),
        )
    } else if status == "open" && current.status == "archived" {
        None
    } else {
        mutation.archived_at.or(current.archived_at)
    };
    let title = mutation
        .title
        .as_deref()
        .map(clean_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| clean_title(None, &body));
    db.execute(
        "UPDATE spec_ideas
         SET title = ?1, status = ?2, target_agent_id = ?3, target_endpoint_id = ?4,
             target_repo_path = ?5, target_agent_name = ?6, body = ?7,
             interview_conversation_id = ?8, converted_spec_id = ?9,
             error_message = ?10, updated_at = ?11, archived_at = ?12
         WHERE id = ?13",
        params![
            title,
            status,
            agent.id,
            mutation
                .target_endpoint_id
                .as_deref()
                .map(clean_string)
                .unwrap_or(current.target_endpoint_id),
            target_repo_path,
            mutation
                .target_agent_name
                .as_deref()
                .map(clean_string)
                .filter(|value| !value.is_empty())
                .unwrap_or(agent.name),
            body,
            mutation
                .interview_conversation_id
                .or(current.interview_conversation_id),
            mutation.converted_spec_id.or(current.converted_spec_id),
            mutation.error_message.or(current.error_message),
            now,
            archived_at,
            idea_id
        ],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    if let Some(notes) = mutation.notes {
        replace_notes(&db, idea_id, notes, now)?;
    }
    if let Some(attachments) = mutation.attachments {
        replace_attachments(&db, idea_id, attachments, now)?;
    }
    idea_detail_json(&db, idea_id)?.ok_or(SaveSpecError::Internal)
}

pub fn delete_spec_idea(state: &AppState, idea_id: &str) -> Result<(), SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    let idea = load_idea_base(&db, idea_id)?.ok_or(SaveSpecError::NotFound)?;
    if idea.status != "archived" {
        return Err(SaveSpecError::Conflict);
    }
    db.execute("DELETE FROM spec_ideas WHERE id = ?1", [idea_id])
        .map_err(|_| SaveSpecError::Internal)?;
    Ok(())
}

pub fn mark_idea_interviewing(
    state: &AppState,
    idea_id: &str,
    conversation_id: &str,
) -> Result<serde_json::Value, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    db.execute(
        "UPDATE spec_ideas
         SET status = 'interviewing', interview_conversation_id = ?1, updated_at = ?2
         WHERE id = ?3",
        params![conversation_id, now_ms(), idea_id],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    idea_detail_json(&db, idea_id)?.ok_or(SaveSpecError::NotFound)
}

#[cfg(test)]
#[path = "spec_ideas_tests.rs"]
mod tests;
