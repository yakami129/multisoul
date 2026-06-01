use super::workflows::{
    create_workflow, disable_workflow, enable_workflow, list_workflow_runs, list_workflows,
    update_workflow,
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

async fn make_workflow_app(token: &str) -> (axum::Router, String) {
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
            axum::routing::patch(update_workflow),
        )
        .route(
            "/api/v1/workflows/:id/disable",
            axum::routing::post(disable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/enable",
            axum::routing::post(enable_workflow),
        )
        .route(
            "/api/v1/workflows/:id/runs",
            axum::routing::get(list_workflow_runs),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            bearer_auth,
        ))
        .with_state(state);
    (app, agent_id)
}

/// PATCH /api/v1/workflows/:id updates editable schedule fields and preserves enabled state.
///
/// Data construction:
///   existing workflow = daily 09:15, enabled=true, prompt="Summarize repository state"
///   patch payload      = weekly Monday 17:45, prompt="Send weekly digest"
///
/// Execution process:
///   1. Create a valid daily workflow through the public POST route.
///   2. PATCH the same workflow id with a weekly schedule and changed prompt.
///   3. Parse the returned workflow row.
///
/// Expected results:
///   - Positive: editable fields reflect the PATCH payload.
///   - Positive: enabled remains true because edit is not pause/resume.
///   - Positive: next_run_at is recomputed to a positive timestamp.
///   - Negative: stale daily schedule values are not retained.
#[tokio::test]
async fn update_workflow_replaces_editable_fields_and_preserves_enabled_state() {
    let (app, agent_id) = make_workflow_app("tok").await;
    let (status, created) = post_workflow(app.clone(), &agent_id).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "test setup must create a workflow before editing it"
    );
    let id = created["id"]
        .as_str()
        .expect("created workflow should include id");
    let body = serde_json::json!({
        "name": "Weekly digest",
        "agent_id": agent_id,
        "prompt": "Send weekly digest",
        "schedule_kind": "weekly",
        "time_of_day": "17:45",
        "day_of_week": 1
    });

    let resp = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/api/v1/workflows/{id}"))
                .header("Authorization", "Bearer tok")
                .header("Content-Type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "editing a valid workflow should return the updated row"
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    let updated: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        updated["name"], "Weekly digest",
        "workflow name should come from the PATCH payload"
    );
    assert_eq!(
        updated["prompt"], "Send weekly digest",
        "workflow prompt should come from the PATCH payload"
    );
    assert_eq!(
        updated["schedule_kind"], "weekly",
        "workflow schedule_kind should be changed to weekly"
    );
    assert_eq!(
        updated["day_of_week"], 1,
        "weekly workflow should persist the selected weekday"
    );
    assert_eq!(
        updated["enabled"], true,
        "editing an enabled workflow should not pause it"
    );
    assert!(
        updated["next_run_at"].as_i64().unwrap_or_default() > 0,
        "editing an enabled workflow should recompute next_run_at"
    );
    assert_ne!(
        updated["time_of_day"], "09:15",
        "stale daily time should not remain after editing the schedule"
    );
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
    let json = if bytes.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, json)
}

/// Workflow routes require Bearer auth before listing user schedules.
///
/// Data construction:
///   token      = "tok"
///   request    = GET /api/v1/workflows without Authorization
///   workflows  = none required; auth should reject before route state matters
///
/// Execution process:
///   1. Build a router with workflow routes under bearer_auth middleware.
///   2. Send GET /api/v1/workflows without a token.
///   3. Inspect the HTTP status.
///
/// Expected results:
///   - Positive: status is 401 because workflow APIs reuse existing Bearer auth.
///   - Negative: status is not 200, so workflow metadata is not public.
#[tokio::test]
async fn workflows_list_requires_bearer_token() {
    let (app, _agent_id) = make_workflow_app("tok").await;

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/workflows")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "workflow list must require Bearer auth"
    );
    assert_ne!(
        resp.status(),
        StatusCode::OK,
        "workflow list must not be publicly readable"
    );
}

/// POST /api/v1/workflows creates an enabled daily workflow with a computed next run.
///
/// Data construction:
///   agent       = workflow-agent inserted into SQLite
///   name        = Morning report
///   prompt      = Summarize repository state
///   schedule    = daily 09:15
///
/// Execution process:
///   1. POST the workflow payload with valid Bearer auth.
///   2. Parse JSON response.
///   3. GET /api/v1/workflows to ensure the row is persisted.
///
/// Expected results:
///   - Create returns 201 and enabled=true.
///   - The returned agent_id matches the registered agent.
///   - next_run_at is a positive unix ms timestamp.
///   - The list endpoint contains the created workflow.
#[tokio::test]
async fn create_workflow_returns_enabled_row_and_list_persists_it() {
    let (app, agent_id) = make_workflow_app("tok").await;

    let (status, created) = post_workflow(app.clone(), &agent_id).await;

    assert_eq!(
        status,
        StatusCode::CREATED,
        "creating a valid workflow must return 201"
    );
    assert_eq!(
        created["agent_id"],
        agent_id.as_str(),
        "created workflow must bind the requested registered agent"
    );
    assert_eq!(
        created["enabled"], true,
        "new workflows should be enabled by default"
    );
    assert!(
        created["next_run_at"].as_i64().unwrap_or_default() > 0,
        "created workflow must include a computed next_run_at"
    );

    let resp = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/workflows")
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::OK,
        "listing workflows after create should succeed"
    );
    let bytes = axum::body::to_bytes(resp.into_body(), 8192).await.unwrap();
    let listed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        listed.as_array().map(Vec::len),
        Some(1),
        "workflow list should contain exactly the row created by this test"
    );
}

/// Disable and enable mutate only the workflow ON/OFF state.
///
/// Data construction:
///   workflow = valid daily workflow created through POST /api/v1/workflows
///   disable  = POST /api/v1/workflows/:id/disable
///   enable   = POST /api/v1/workflows/:id/enable
///
/// Execution process:
///   1. Create a valid workflow.
///   2. Disable it and inspect enabled/next_run_at.
///   3. Enable it again and inspect enabled/next_run_at.
///
/// Expected results:
///   - Disable sets enabled=false and next_run_at=null.
///   - Enable sets enabled=true and recomputes next_run_at.
///   - Neither mutation returns running/completed as workflow status.
#[tokio::test]
async fn disable_and_enable_workflow_toggle_enabled_only() {
    let (app, agent_id) = make_workflow_app("tok").await;
    let (status, created) = post_workflow(app.clone(), &agent_id).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "test setup must create the workflow before toggling"
    );
    let id = created["id"]
        .as_str()
        .expect("created workflow should include id");

    let disabled_resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{id}/disable"))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        disabled_resp.status(),
        StatusCode::OK,
        "disable should return the updated workflow row"
    );
    let disabled_bytes = axum::body::to_bytes(disabled_resp.into_body(), 8192)
        .await
        .unwrap();
    let disabled: serde_json::Value = serde_json::from_slice(&disabled_bytes).unwrap();
    assert_eq!(
        disabled["enabled"], false,
        "disabled workflow should expose enabled=false"
    );
    assert!(
        disabled["next_run_at"].is_null(),
        "disabled workflow should not keep a due next_run_at"
    );
    assert!(
        disabled.get("status").is_none(),
        "workflow response must not expose running/completed as workflow status"
    );

    let enabled_resp = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/v1/workflows/{id}/enable"))
                .header("Authorization", "Bearer tok")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        enabled_resp.status(),
        StatusCode::OK,
        "enable should return the updated workflow row"
    );
    let enabled_bytes = axum::body::to_bytes(enabled_resp.into_body(), 8192)
        .await
        .unwrap();
    let enabled: serde_json::Value = serde_json::from_slice(&enabled_bytes).unwrap();
    assert_eq!(
        enabled["enabled"], true,
        "enabled workflow should expose enabled=true"
    );
    assert!(
        enabled["next_run_at"].as_i64().unwrap_or_default() > 0,
        "re-enabled workflow should recompute next_run_at"
    );
}
