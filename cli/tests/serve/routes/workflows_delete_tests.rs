use super::workflows::{
    create_workflow, delete_workflow, list_workflow_runs, list_workflows, update_workflow,
};
use crate::{
    commands::agent::insert_agent,
    db,
    serve::{auth::bearer_auth, state::AppState},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tempfile::tempdir;
use tower::ServiceExt;

async fn make_workflow_app(token: &str) -> (axum::Router, String, AppState) {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let agent_id = insert_agent(&conn, "workflow-agent", "/p", "codex", "full-auto").unwrap();
    let state = AppState::new(
        conn,
        token.to_string(),
        std::path::PathBuf::from("/tmp/uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    let app = axum::Router::new()
        .route(
            "/api/v1/workflows",
            axum::routing::get(list_workflows).post(create_workflow),
        )
        .route(
            "/api/v1/workflows/:id",
            axum::routing::patch(update_workflow).delete(delete_workflow),
        )
        .route(
            "/api/v1/workflows/:id/runs",
            axum::routing::get(list_workflow_runs),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state.clone());
    (app, agent_id, state)
}

async fn post_workflow(app: axum::Router, agent_id: &str) -> (StatusCode, serde_json::Value) {
    let body = serde_json::json!({
        "name": "Morning report",
        "agent_id": agent_id,
        "prompt": "Summarize repository state",
        "schedule_kind": "daily",
        "time_of_day": "09:15"
    });
    let resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/workflows")
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

/// DELETE /api/v1/workflows/:id removes the workflow and its runs via CASCADE.
///
/// Data construction:
///   workflow = daily 09:15, enabled=true
///   workflow_run = completed, scheduled_for = 1_720_000_000_000
///
/// Execution process:
///   1. POST to create a workflow.
///   2. Insert one workflow_run row for that workflow.
///   3. DELETE /api/v1/workflows/:id.
///   4. GET /api/v1/workflows to confirm the workflow is absent.
///   5. Query workflow_runs to confirm the run row was cascade-deleted.
///   6. GET /api/v1/workflows/:id/runs to confirm 404 because the workflow is gone.
///
/// Expected results:
///   - Positive: DELETE returns 204 No Content.
///   - Positive: workflow_runs count for the workflow is 0 after deletion.
///   - Positive: runs endpoint returns 404.
///   - Negative: deleted workflow id is not present in the list response.
#[tokio::test]
async fn delete_workflow_removes_workflow_and_cascades_runs() {
    let (app, agent_id, state) = make_workflow_app("tok").await;
    let (status, created) = post_workflow(app.clone(), &agent_id).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "workflow creation must succeed"
    );
    let workflow_id = created["id"].as_str().unwrap().to_string();

    let now = 1_720_000_000_000_i64;
    {
        let db = state.db.lock().unwrap();
        db.execute(
            "INSERT INTO workflow_runs
             (id, workflow_id, conversation_id, status, scheduled_for, started_at, ended_at,
              summary, error_message, created_at)
             VALUES ('run-delete-cascade', ?1, NULL, 'completed', ?2, ?2, ?2, 'ok', NULL, ?2)",
            rusqlite::params![workflow_id, now],
        )
        .expect("seed workflow run should insert before deletion");
        let seeded_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?1",
                [&workflow_id],
                |row| row.get(0),
            )
            .expect("seeded workflow run count should be readable");
        assert_eq!(
            seeded_count, 1,
            "test setup must create exactly one workflow_run before deleting the workflow"
        );
    }

    let del_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/workflows/{workflow_id}"))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        del_resp.status(),
        StatusCode::NO_CONTENT,
        "DELETE must return 204"
    );

    let list_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/workflows")
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let list_bytes = axum::body::to_bytes(list_resp.into_body(), 8192)
        .await
        .unwrap();
    let list: serde_json::Value = serde_json::from_slice(&list_bytes).unwrap();
    assert_eq!(
        list.as_array().unwrap().len(),
        0,
        "workflow list must be empty after deletion"
    );
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .all(|row| row["id"] != workflow_id),
        "deleted workflow id must not remain in the list response"
    );

    let run_count_after_delete: i64 = state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?1",
            [&workflow_id],
            |row| row.get(0),
        )
        .expect("workflow run count after deletion should be readable");
    assert_eq!(
        run_count_after_delete, 0,
        "workflow_runs rows for the deleted workflow must be cascade-removed"
    );

    let runs_resp = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/workflows/{workflow_id}/runs"))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        runs_resp.status(),
        StatusCode::NOT_FOUND,
        "runs endpoint must return 404 for deleted workflow"
    );
}
