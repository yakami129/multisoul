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
    let conn = db::open_at(&db_dir.path().join("spec-ideas.db")).expect("test db should open");
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at, mode)
         VALUES ('agent-1', 'Agent One', ?1, 'codex', 1, 'full-auto')",
        [project_dir.path().to_string_lossy().as_ref()],
    )
    .expect("agent should insert");
    let plugin_db = db::open_at(&db_dir.path().join("plugins.db")).expect("plugin db should open");
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        db_dir.path().join("uploads"),
        PluginManager::empty(Arc::new(Mutex::new(plugin_db))),
    )
}

#[test]
fn create_update_and_read_interview_context_for_spec_idea() {
    let state = fixture();
    let repo_path: String = state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row(
            "SELECT project_path FROM agents WHERE id = 'agent-1'",
            [],
            |row| row.get(0),
        )
        .expect("agent path should query");

    let idea = create_spec_idea(
        &state,
        SpecIdeaMutation {
            id: Some("idea-1".to_string()),
            title: None,
            status: None,
            target_agent_id: Some("agent-1".to_string()),
            target_endpoint_id: Some("endpoint-1".to_string()),
            target_repo_path: Some(repo_path),
            target_agent_name: None,
            body: Some("Need a better specs workflow".to_string()),
            notes: Some(vec![SpecIdeaNoteMutation {
                id: Some("note-1".to_string()),
                body: "Clarify acceptance criteria".to_string(),
            }]),
            attachments: Some(vec![SpecIdeaAttachmentMutation {
                id: Some("att-1".to_string()),
                kind: "link".to_string(),
                title: Some("Reference".to_string()),
                uri: Some("https://example.test/spec".to_string()),
                text: None,
                file_id: None,
            }]),
            interview_conversation_id: None,
            converted_spec_id: None,
            error_message: None,
            archived_at: None,
        },
    )
    .expect("idea should create");

    assert_eq!(
        idea.get("id").and_then(serde_json::Value::as_str),
        Some("idea-1")
    );
    assert_eq!(
        idea.get("title").and_then(serde_json::Value::as_str),
        Some("Need a better specs workflow")
    );
    let context = get_interview_context(&state, "idea-1").expect("interview context should load");
    assert_eq!(
        context.notes,
        vec!["Clarify acceptance criteria".to_string()]
    );
    assert!(
        context.attachment_summaries[0].contains("https://example.test/spec"),
        "attachment summary should include the link URI"
    );

    let updated = update_spec_idea(
        &state,
        "idea-1",
        SpecIdeaMutation {
            id: None,
            title: Some("Workflow polish".to_string()),
            status: Some("archived".to_string()),
            target_agent_id: None,
            target_endpoint_id: None,
            target_repo_path: None,
            target_agent_name: None,
            body: None,
            notes: None,
            attachments: None,
            interview_conversation_id: None,
            converted_spec_id: None,
            error_message: None,
            archived_at: Some(123),
        },
    )
    .expect("idea should update");

    assert_eq!(
        updated.get("status").and_then(serde_json::Value::as_str),
        Some("archived")
    );
    assert_eq!(
        list_spec_ideas(&state).expect("ideas should list").len(),
        1,
        "created idea should be returned by list"
    );
}

fn make_idea(state: &AppState) -> String {
    let repo_path: String = state
        .db
        .lock()
        .expect("db mutex should be available")
        .query_row(
            "SELECT project_path FROM agents WHERE id = 'agent-1'",
            [],
            |row| row.get(0),
        )
        .expect("agent path should query");
    let idea = create_spec_idea(
        state,
        SpecIdeaMutation {
            id: Some("idea-del".to_string()),
            title: None,
            status: None,
            target_agent_id: Some("agent-1".to_string()),
            target_endpoint_id: None,
            target_repo_path: Some(repo_path),
            target_agent_name: None,
            body: Some("Idea to delete".to_string()),
            notes: None,
            attachments: None,
            interview_conversation_id: None,
            converted_spec_id: None,
            error_message: None,
            archived_at: None,
        },
    )
    .expect("idea should create");
    idea.get("id")
        .and_then(serde_json::Value::as_str)
        .expect("id should be present")
        .to_string()
}

#[test]
fn delete_archived_idea_succeeds() {
    let state = fixture();
    let id = make_idea(&state);
    update_spec_idea(
        &state,
        &id,
        SpecIdeaMutation {
            id: None,
            title: None,
            status: Some("archived".to_string()),
            target_agent_id: None,
            target_endpoint_id: None,
            target_repo_path: None,
            target_agent_name: None,
            body: None,
            notes: None,
            attachments: None,
            interview_conversation_id: None,
            converted_spec_id: None,
            error_message: None,
            archived_at: None,
        },
    )
    .expect("idea should archive");
    delete_spec_idea(&state, &id).expect("delete should succeed for archived idea");
    assert_eq!(
        list_spec_ideas(&state).expect("ideas should list").len(),
        0,
        "deleted idea should not appear in list"
    );
}

#[test]
fn delete_open_idea_returns_conflict() {
    let state = fixture();
    let id = make_idea(&state);
    let result = delete_spec_idea(&state, &id);
    assert_eq!(
        result,
        Err(SaveSpecError::Conflict),
        "deleting an open idea should return Conflict"
    );
}

#[test]
fn delete_nonexistent_idea_returns_not_found() {
    let state = fixture();
    let result = delete_spec_idea(&state, "nonexistent-id");
    assert_eq!(
        result,
        Err(SaveSpecError::NotFound),
        "deleting a nonexistent idea should return NotFound"
    );
}
