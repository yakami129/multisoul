use super::activity_events::{
    emit_activity_changed, emit_spec_changed, REASON_CONVERSATION_CREATED, REASON_USER_MESSAGE,
};
use crate::{
    db::now_ms,
    serve::{
        routes::messages::PostMessageBody,
        runtime,
        spec_assets::SaveSpecError,
        spec_ideas::{
            create_spec_idea, delete_spec_idea, get_interview_context, get_spec_idea,
            list_spec_ideas, mark_idea_interviewing, update_spec_idea, InterviewIdeaContext,
            SpecIdeaMutation,
        },
        state::AppState,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct StartInterviewResponse {
    pub conversation_id: String,
    pub idea: serde_json::Value,
}

struct AgentRuntimeInfo {
    project_path: String,
    runtime: String,
    mode: String,
}

pub async fn list(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    list_spec_ideas(&state)
        .map(|ideas| Json(serde_json::json!({ "ideas": ideas })))
        .map_err(error_response)
}

pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<SpecIdeaMutation>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let idea = create_spec_idea(&state, body).map_err(error_response)?;
    let idea_id = idea
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    emit_spec_changed(&state, idea_id, "");
    Ok(Json(serde_json::json!({ "idea": idea })))
}

pub async fn patch(
    State(state): State<AppState>,
    Path(idea_id): Path<String>,
    Json(body): Json<SpecIdeaMutation>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let idea = update_spec_idea(&state, &idea_id, body).map_err(error_response)?;
    emit_spec_changed(&state, &idea_id, "");
    Ok(Json(serde_json::json!({ "idea": idea })))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(idea_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    delete_spec_idea(&state, &idea_id).map_err(error_response)?;
    emit_spec_changed(&state, &idea_id, "");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn start_interview(
    State(state): State<AppState>,
    Path(idea_id): Path<String>,
) -> Result<Json<StartInterviewResponse>, (StatusCode, Json<serde_json::Value>)> {
    let context = get_interview_context(&state, &idea_id).map_err(error_response)?;
    if let Some(conversation_id) = context.interview_conversation_id.clone() {
        let idea = get_spec_idea(&state, &idea_id)
            .map_err(error_response)?
            .ok_or_else(|| error_response(SaveSpecError::NotFound))?;
        return Ok(Json(StartInterviewResponse {
            conversation_id,
            idea,
        }));
    }

    let agent =
        load_agent_runtime_info(&state, &context.target_agent_id).map_err(error_response)?;
    if agent.project_path != context.target_repo_path {
        return Err(error_response(SaveSpecError::BadRequest));
    }
    let conversation_id = Uuid::new_v4().to_string();
    let instruction = build_interview_instruction(&context, &conversation_id);
    let (next_seq, created_at, payload) = create_interview_conversation(
        &state,
        &context.target_agent_id,
        &conversation_id,
        &context.title,
        &instruction,
    )
    .map_err(|status| {
        (
            status,
            Json(serde_json::json!({ "error": "conversation_create_failed" })),
        )
    })?;

    runtime::send_to_session(
        &state,
        &conversation_id,
        runtime::DispatchMessage {
            text: &instruction,
            file_id: None,
            model_id: None,
            seq: next_seq,
        },
        &agent.project_path,
        &agent.runtime,
        &agent.mode,
    );
    super::messages::broadcast_user_message(
        &state,
        &conversation_id,
        next_seq,
        &payload,
        created_at,
    );
    emit_activity_changed(&state, &conversation_id, REASON_CONVERSATION_CREATED);
    emit_activity_changed(&state, &conversation_id, REASON_USER_MESSAGE);

    let idea =
        mark_idea_interviewing(&state, &idea_id, &conversation_id).map_err(error_response)?;
    emit_spec_changed(&state, &idea_id, &conversation_id);
    Ok(Json(StartInterviewResponse {
        conversation_id,
        idea,
    }))
}

fn create_interview_conversation(
    state: &AppState,
    agent_id: &str,
    conversation_id: &str,
    title: &str,
    instruction: &str,
) -> Result<(i64, i64, serde_json::Value), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = now_ms();
    db.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1, ?2, ?3, ?4, ?4, 'idle')",
        rusqlite::params![conversation_id, agent_id, format!("Idea: {title}"), now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (next_seq, _id, created_at, payload) =
        super::messages::insert_user_message_and_mark_running(
            &db,
            conversation_id,
            &PostMessageBody {
                text: instruction.to_string(),
                file_id: None,
            },
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((next_seq, created_at, payload))
}

fn load_agent_runtime_info(
    state: &AppState,
    agent_id: &str,
) -> Result<AgentRuntimeInfo, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    db.query_row(
        "SELECT project_path, runtime, mode FROM agents WHERE id = ?1",
        [agent_id],
        |row| {
            Ok(AgentRuntimeInfo {
                project_path: row.get(0)?,
                runtime: row.get(1)?,
                mode: row.get(2)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => SaveSpecError::NotFound,
        _ => SaveSpecError::Internal,
    })
}

fn build_interview_instruction(context: &InterviewIdeaContext, conversation_id: &str) -> String {
    let notes = if context.notes.is_empty() {
        "None".to_string()
    } else {
        context
            .notes
            .iter()
            .enumerate()
            .map(|(index, note)| format!("{}. {}", index + 1, note))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let attachments = if context.attachment_summaries.is_empty() {
        "None".to_string()
    } else {
        context.attachment_summaries.join("\n")
    };
    format!(
        "Use the Idea below as interview material. Conduct a normal conversation to clarify requirements and produce an executable product spec.\n\n\
         ## Context\n\
         - Idea: {title}\n\
         - Repo: {repo}\n\
         - Conversation: {conversation_id}\n\n\
         ### Body\n\
         {body}\n\n\
         ### Notes\n\
         {notes}\n\n\
         ### Attachments\n\
         {attachments}\n\n\
         ## Workflow\n\
         1. Clarify background, goals, scope, non-goals, main flows, edge cases, UI/UX, and acceptance criteria.\n\
         2. For structured decisions, use AskUserQuestion; if unavailable, run `msctl ask-question`.\n\
         3. When information is sufficient, ask the user to confirm before generating the spec.\n\
         4. After confirmation, write `docs/product-specs/YYYY-MM-DD-SPEC-<slug>.md` in the target repo, then run:\n\
            `msctl save-spec --path <repo-relative-path> --conversation-id {conversation_id}`\n\
         5. Do not save the spec without user confirmation.\n\n\
         Respond in the user's language unless they prefer English.",
        title = context.title,
        repo = context.target_repo_path,
        conversation_id = conversation_id,
        body = context.body,
        notes = notes,
        attachments = attachments,
    )
}

fn error_response(err: SaveSpecError) -> (StatusCode, Json<serde_json::Value>) {
    (
        err.status_code(),
        Json(serde_json::json!({ "error": err.code() })),
    )
}
