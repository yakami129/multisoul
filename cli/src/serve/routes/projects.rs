use super::activity_events::{emit_activity_changed, REASON_CONVERSATION_CREATED};
use crate::{
    db::now_ms,
    serve::{
        projects::{load_project_by_id, ProjectRecord},
        state::AppState,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub normalized_project_path: String,
    pub default_resource_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_activity_at: i64,
    pub session_counts: ProjectSessionCounts,
    pub resource_count: i64,
}

#[derive(Serialize)]
pub struct ProjectSessionCounts {
    pub idle: i64,
    pub running: i64,
    pub awaiting_question: i64,
    pub completed: i64,
    pub failed: i64,
}

#[derive(Serialize)]
pub struct ProjectResourceRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub project_path: String,
    pub runtime: String,
    pub created_at: i64,
    pub is_default: bool,
}

#[derive(Serialize)]
pub struct ProjectConversationRow {
    pub id: String,
    pub agent_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub created_at: i64,
    pub last_message_at: i64,
    pub status: String,
    pub model_id: Option<String>,
    pub first_user_message: Option<String>,
    pub last_ai_reply: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateProjectConversationBody {
    pub title: Option<String>,
    pub resource_id: Option<String>,
    pub agent_id: Option<String>,
}

pub async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectSummary>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    load_project_summaries(&db, None).map(Json)
}

pub async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectSummary>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut rows = load_project_summaries(&db, Some(&project_id))?;
    rows.pop().map(Json).ok_or(StatusCode::NOT_FOUND)
}

pub async fn list_project_resources(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ProjectResourceRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let project = load_project_by_id(&db, &project_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let mut stmt = db
        .prepare(
            "SELECT id, project_id, name, project_path, runtime, created_at
             FROM agents
             WHERE project_id = ?1
             ORDER BY created_at ASC, name ASC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([&project_id], |row| {
            let id: String = row.get(0)?;
            Ok(ProjectResourceRow {
                is_default: project.default_agent_id.as_deref() == Some(id.as_str()),
                id,
                project_id: row.get(1)?,
                name: row.get(2)?,
                project_path: row.get(3)?,
                runtime: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(rows))
}

pub async fn list_project_conversations(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<ProjectConversationRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if load_project_by_id(&db, &project_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .is_none()
    {
        return Err(StatusCode::NOT_FOUND);
    }
    let rows = load_project_conversation_rows(&db, &project_id)?;
    Ok(Json(rows))
}

pub async fn create_project_conversation(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateProjectConversationBody>,
) -> Result<(StatusCode, Json<ProjectConversationRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let project = load_project_by_id(&db, &project_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let agent_id = resolve_resource_id(&db, &project, body.resource_id.or(body.agent_id))?;

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = body.title.unwrap_or_else(|| "New conversation".to_string());
    db.execute(
        "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
         VALUES (?1,?2,?3,?4,?5,?6,'idle')",
        params![id, agent_id, project_id, title, now, now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(db);
    emit_activity_changed(&state, &id, REASON_CONVERSATION_CREATED);

    Ok((
        StatusCode::CREATED,
        Json(ProjectConversationRow {
            id,
            agent_id,
            project_id: Some(project_id),
            title,
            created_at: now,
            last_message_at: now,
            status: "idle".into(),
            model_id: None,
            first_user_message: None,
            last_ai_reply: None,
        }),
    ))
}

fn load_project_summaries(
    db: &rusqlite::Connection,
    project_id: Option<&str>,
) -> Result<Vec<ProjectSummary>, StatusCode> {
    let where_clause = if project_id.is_some() {
        "WHERE p.id = ?1"
    } else {
        ""
    };
    let sql = format!(
        "SELECT
            p.id,
            p.name,
            p.project_path,
            p.normalized_project_path,
            p.default_agent_id,
            p.created_at,
            p.updated_at,
            COALESCE((SELECT MAX(c.last_message_at) FROM conversations c WHERE c.project_id = p.id), p.updated_at) AS last_activity_at,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.status = 'idle') AS idle_count,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.status = 'running') AS running_count,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.status = 'awaiting_question') AS awaiting_count,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.status = 'completed') AS completed_count,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id AND c.status = 'failed') AS failed_count,
            (SELECT COUNT(*) FROM agents a WHERE a.project_id = p.id) AS resource_count
         FROM projects p
         {where_clause}
         ORDER BY awaiting_count > 0 DESC, running_count > 0 DESC, last_activity_at DESC, p.name ASC"
    );
    let mut stmt = db
        .prepare(&sql)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(ProjectSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            project_path: row.get(2)?,
            normalized_project_path: row.get(3)?,
            default_resource_id: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            last_activity_at: row.get(7)?,
            session_counts: ProjectSessionCounts {
                idle: row.get(8)?,
                running: row.get(9)?,
                awaiting_question: row.get(10)?,
                completed: row.get(11)?,
                failed: row.get(12)?,
            },
            resource_count: row.get(13)?,
        })
    };

    let rows = if let Some(project_id) = project_id {
        stmt.query_map([project_id], |row| map_row(row))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .collect::<rusqlite::Result<Vec<_>>>()
    } else {
        stmt.query_map([], |row| map_row(row))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .collect::<rusqlite::Result<Vec<_>>>()
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(rows)
}

fn load_project_conversation_rows(
    db: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<ProjectConversationRow>, StatusCode> {
    let mut stmt = db
        .prepare(
            "SELECT c.id, c.agent_id, c.project_id, c.title, c.created_at, c.last_message_at, c.status, c.model_id,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'user_text'
                 ORDER BY m.seq ASC LIMIT 1) AS first_user_message,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'agent_text'
                 ORDER BY m.seq DESC LIMIT 1) AS last_ai_reply
             FROM conversations c
             WHERE c.project_id = ?1
             ORDER BY c.last_message_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = stmt
        .query_map([project_id], |row| {
            Ok(ProjectConversationRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                project_id: row.get(2)?,
                title: row.get(3)?,
                created_at: row.get(4)?,
                last_message_at: row.get(5)?,
                status: row.get(6)?,
                model_id: row.get(7)?,
                first_user_message: row.get(8)?,
                last_ai_reply: row.get(9)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(rows)
}

fn resolve_resource_id(
    db: &rusqlite::Connection,
    project: &ProjectRecord,
    requested_resource_id: Option<String>,
) -> Result<String, StatusCode> {
    let Some(agent_id) = requested_resource_id.or_else(|| project.default_agent_id.clone()) else {
        return Err(StatusCode::CONFLICT);
    };
    let belongs = db
        .query_row(
            "SELECT project_id FROM agents WHERE id = ?1",
            [&agent_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .as_deref()
        == Some(project.id.as_str());
    if belongs {
        Ok(agent_id)
    } else {
        Err(StatusCode::BAD_REQUEST)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    async fn make_projects_app(token: &str) -> (axum::Router, String, String, String) {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let first_agent = insert_agent(&conn, "codex-demo", "/repo/demo", "codex", "full-auto")
            .expect("first agent should insert");
        let second_agent = insert_agent(
            &conn,
            "claude-demo",
            "/repo/demo/",
            "claude-code",
            "full-auto",
        )
        .expect("second agent should insert");
        let project_id: String = conn
            .query_row(
                "SELECT project_id FROM agents WHERE id = ?1",
                [&first_agent],
                |row| row.get(0),
            )
            .expect("agent should have project_id");
        let now = db::now_ms();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
             VALUES ('conv-awaiting', ?1, ?2, 'Needs input', ?3, ?4, 'awaiting_question')",
            params![second_agent, project_id, now - 10, now],
        )
        .expect("conversation should insert");

        let state = AppState::new(
            conn,
            token.to_string(),
            dir.path().join("uploads"),
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
            ))),
        );
        let app = axum::Router::new()
            .route("/api/v1/projects", axum::routing::get(list_projects))
            .route("/api/v1/projects/:id", axum::routing::get(get_project))
            .route(
                "/api/v1/projects/:id/conversations",
                axum::routing::get(list_project_conversations).post(create_project_conversation),
            )
            .route(
                "/api/v1/projects/:id/resources",
                axum::routing::get(list_project_resources),
            )
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state);
        (app, project_id, first_agent, second_agent)
    }

    #[tokio::test]
    async fn test_list_projects_deduplicates_resources_by_project_path() {
        let (app, project_id, _, _) = make_projects_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/projects")
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let projects = json.as_array().expect("projects response should be array");
        assert_eq!(
            projects.len(),
            1,
            "two resources on same path should produce one project"
        );
        assert_eq!(projects[0]["id"], project_id);
        assert_eq!(projects[0]["resource_count"], 2);
        assert_eq!(projects[0]["session_counts"]["awaiting_question"], 1);
    }

    #[tokio::test]
    async fn test_project_resources_marks_default_resource() {
        let (app, project_id, first_agent, _) = make_projects_app("tok").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/projects/{project_id}/resources"))
                    .header("Authorization", "Bearer tok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let resources = json.as_array().expect("resources response should be array");
        assert_eq!(resources.len(), 2);
        let default = resources
            .iter()
            .find(|item| item["is_default"] == true)
            .expect("one resource should be marked default");
        assert_eq!(default["id"], first_agent);
    }

    #[tokio::test]
    async fn test_create_project_conversation_uses_default_resource() {
        let (app, project_id, first_agent, _) = make_projects_app("tok").await;
        let body = serde_json::json!({ "title": "Project thread" });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/projects/{project_id}/conversations"))
                    .header("Authorization", "Bearer tok")
                    .header("Content-Type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["project_id"], project_id);
        assert_eq!(json["agent_id"], first_agent);
    }

    #[tokio::test]
    async fn test_create_project_conversation_rejects_foreign_resource() {
        let (app, project_id, _, _) = make_projects_app("tok").await;
        let body = serde_json::json!({ "resource_id": "missing-agent" });
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/api/v1/projects/{project_id}/conversations"))
                    .header("Authorization", "Bearer tok")
                    .header("Content-Type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
