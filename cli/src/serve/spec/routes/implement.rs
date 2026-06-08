use crate::{
    db::now_ms,
    serve::{
        routes::{
            activity_events::{
                emit_activity_changed, emit_spec_changed, REASON_CONVERSATION_CREATED,
                REASON_USER_MESSAGE,
            },
            messages::PostMessageBody,
        },
        runtime,
        spec::assets::{get_spec_artifact_detail, SaveSpecError},
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
pub struct StartImplementationResponse {
    pub conversation_id: String,
    pub spec: serde_json::Value,
}

struct ImplementationContext {
    spec_id: String,
    title: String,
    status: String,
    target_agent_id: String,
    target_repo_path: String,
    repo_spec_path: String,
    source_idea_id: Option<String>,
    interview_conversation_id: String,
    revision: Option<i64>,
    markdown_sha256: Option<String>,
    agent_project_path: String,
    runtime: String,
    mode: String,
}

pub async fn start_implementation(
    State(state): State<AppState>,
    Path(spec_id): Path<String>,
) -> Result<Json<StartImplementationResponse>, (StatusCode, Json<serde_json::Value>)> {
    start_implementation_core(state, spec_id, Uuid::new_v4().to_string(), true).await
}

async fn start_implementation_core(
    state: AppState,
    spec_id: String,
    conversation_id: String,
    dispatch_runtime: bool,
) -> Result<Json<StartImplementationResponse>, (StatusCode, Json<serde_json::Value>)> {
    let context = load_context(&state, &spec_id).map_err(error_response)?;
    if context.agent_project_path != context.target_repo_path {
        return Err(error_response(SaveSpecError::BadRequest));
    }
    let instruction = build_implementation_instruction(&context, &conversation_id);
    let (next_seq, created_at, payload) = create_conversation(
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
    update_latest_implementation(&state, &context.spec_id, &conversation_id)
        .map_err(error_response)?;

    if dispatch_runtime {
        runtime::send_to_session(
            &state,
            &conversation_id,
            runtime::DispatchMessage {
                text: &instruction,
                file_id: None,
                model_id: None,
                seq: next_seq,
            },
            &context.agent_project_path,
            &context.runtime,
            &context.mode,
        );
    }
    crate::serve::routes::messages::broadcast_user_message(
        &state,
        &conversation_id,
        next_seq,
        &payload,
        created_at,
    );
    emit_activity_changed(&state, &conversation_id, REASON_CONVERSATION_CREATED);
    emit_activity_changed(&state, &conversation_id, REASON_USER_MESSAGE);
    emit_spec_changed(&state, &context.spec_id, &conversation_id);

    let detail = get_spec_artifact_detail(&state, &context.spec_id)
        .map_err(error_response)?
        .ok_or_else(|| error_response(SaveSpecError::NotFound))?;
    let spec = detail
        .get("spec")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "id": context.spec_id }));
    Ok(Json(StartImplementationResponse {
        conversation_id,
        spec,
    }))
}

fn load_context(state: &AppState, spec_id: &str) -> Result<ImplementationContext, SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    db.query_row(
        "SELECT s.id, s.title, s.status, s.target_agent_id, s.target_repo_path,
                s.repo_spec_path, s.source_idea_id, s.interview_conversation_id,
                v.revision, v.markdown_sha256, a.project_path, a.runtime, a.mode
         FROM spec_artifacts s
         JOIN agents a ON a.id = s.target_agent_id
         LEFT JOIN spec_artifact_versions v ON v.id = s.latest_version_id
         WHERE s.id = ?1",
        [spec_id],
        |row| {
            Ok(ImplementationContext {
                spec_id: row.get(0)?,
                title: row.get(1)?,
                status: row.get(2)?,
                target_agent_id: row.get(3)?,
                target_repo_path: row.get(4)?,
                repo_spec_path: row.get(5)?,
                source_idea_id: row.get(6)?,
                interview_conversation_id: row.get(7)?,
                revision: row.get(8)?,
                markdown_sha256: row.get(9)?,
                agent_project_path: row.get(10)?,
                runtime: row.get(11)?,
                mode: row.get(12)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => SaveSpecError::NotFound,
        _ => SaveSpecError::Internal,
    })
}

fn create_conversation(
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
        rusqlite::params![
            conversation_id,
            agent_id,
            format!("Implement: {title}"),
            now
        ],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (next_seq, _id, created_at, payload) =
        crate::serve::routes::messages::insert_user_message_and_mark_running(
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

fn update_latest_implementation(
    state: &AppState,
    spec_id: &str,
    conversation_id: &str,
) -> Result<(), SaveSpecError> {
    let db = state.db.lock().map_err(|_| SaveSpecError::Internal)?;
    db.execute(
        "UPDATE spec_artifacts
         SET status = 'planning', latest_implementation_conversation_id = ?1, updated_at = ?2
         WHERE id = ?3",
        rusqlite::params![conversation_id, now_ms(), spec_id],
    )
    .map_err(|_| SaveSpecError::Internal)?;
    Ok(())
}

fn build_implementation_instruction(
    context: &ImplementationContext,
    conversation_id: &str,
) -> String {
    let hash = context.markdown_sha256.as_deref().unwrap_or("unknown");
    let revision = context
        .revision
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "Start implementation from the saved product spec below.\n\n\
         ## Context\n\
         - Spec: {title}\n\
         - Spec ID: {spec_id}\n\
         - Path: {repo_spec_path}\n\
         - Revision: {revision}\n\
         - SHA-256: {hash}\n\
         - Interview conversation: {interview_conversation_id}\n\
         - Source idea: {source_idea_id}\n\
         - Implementation conversation: {conversation_id}\n\
         - Status: {status}\n\n\
         ## Workflow\n\
         1. Read AGENTS.md, CLAUDE.md, and the spec file.\n\
         2. Write an implementation plan first — do not change code yet.\n\
         3. After the plan, use AskUserQuestion (or `msctl ask-question`) to confirm execution approach.\n\
         4. Implement only after confirmation.\n\
         5. Use question cards for blockers or trade-offs.\n\
         6. Report changed files and verification results when done.",
        title = context.title,
        spec_id = context.spec_id,
        repo_spec_path = context.repo_spec_path,
        revision = revision,
        hash = hash,
        interview_conversation_id = context.interview_conversation_id,
        source_idea_id = context.source_idea_id.as_deref().unwrap_or("none"),
        conversation_id = conversation_id,
        status = context.status,
    )
}

fn error_response(err: SaveSpecError) -> (StatusCode, Json<serde_json::Value>) {
    (
        err.status_code(),
        Json(serde_json::json!({ "error": err.code() })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        serve::{plugin::PluginManager, state::AppState},
    };
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    fn fixture() -> AppState {
        let project_dir = tempdir().expect("project tempdir should be created");
        let db_dir = tempdir().expect("db tempdir should be created");
        let conn = db::open_at(&db_dir.path().join("spec-implement.db"))
            .expect("test database should open");
        conn.execute(
            "INSERT INTO agents (id, name, project_path, runtime, created_at, mode)
             VALUES ('agent-1', 'Agent One', ?1, 'codex', 1, 'full-auto')",
            [project_dir.path().to_string_lossy().as_ref()],
        )
        .expect("agent should insert");
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('interview-1', 'agent-1', 'Interview', 1, 1, 'idle')",
            [],
        )
        .expect("interview conversation should insert");
        conn.execute(
            "INSERT INTO spec_artifacts (
                id, title, slug, status, target_agent_id, target_endpoint_id,
                target_repo_path, repo_spec_path, latest_version_id, source_idea_id,
                interview_conversation_id, created_at, updated_at
             ) VALUES (
                'spec-1', 'Demo Spec', 'demo', 'ready', 'agent-1', 'endpoint-1',
                ?1, 'docs/product-specs/2026-06-06-SPEC-demo.md', 'version-1',
                NULL, 'interview-1', 1, 1
             )",
            [project_dir.path().to_string_lossy().as_ref()],
        )
        .expect("spec should insert");
        conn.execute(
            "INSERT INTO spec_artifact_versions (
                id, spec_id, revision, repo_spec_path, markdown, markdown_sha256,
                source_conversation_id, created_at
             ) VALUES (
                'version-1', 'spec-1', 1,
                'docs/product-specs/2026-06-06-SPEC-demo.md',
                '# Demo Spec', 'abc123', 'interview-1', 1
             )",
            [],
        )
        .expect("version should insert");
        let plugin_db =
            db::open_at(&db_dir.path().join("plugins.db")).expect("plugin db should open");
        AppState::new(
            conn,
            "ms_v2_tok".to_string(),
            db_dir.path().join("uploads"),
            PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
        )
    }

    #[tokio::test]
    async fn start_implementation_core_creates_chat_and_marks_spec_planning() {
        let state = fixture();

        let Json(response) = start_implementation_core(
            state.clone(),
            "spec-1".to_string(),
            "impl-1".to_string(),
            false,
        )
        .await
        .expect("implementation should start without dispatching runtime");

        assert_eq!(response.conversation_id, "impl-1");
        let (status, latest_impl): (String, String) = state
            .db
            .lock()
            .expect("db mutex should be available")
            .query_row(
                "SELECT status, latest_implementation_conversation_id
                 FROM spec_artifacts WHERE id = 'spec-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("spec should be updated");
        assert_eq!(status, "planning");
        assert_eq!(latest_impl, "impl-1");

        let payload: String = state
            .db
            .lock()
            .expect("db mutex should be available")
            .query_row(
                "SELECT payload FROM messages WHERE conversation_id = 'impl-1' AND seq = 1",
                [],
                |row| row.get(0),
            )
            .expect("initial implementation message should be inserted");
        assert!(payload.contains("Write an implementation plan first"));
        assert!(payload.contains("msctl ask-question"));
        assert!(payload.contains("AGENTS.md"));
    }
}
