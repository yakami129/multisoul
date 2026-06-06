use super::activity_events::{
    emit_activity_changed, emit_spec_changed, REASON_CONVERSATION_CREATED, REASON_USER_MESSAGE,
};
use crate::{
    db::now_ms,
    serve::{
        routes::messages::PostMessageBody,
        runtime,
        spec_assets::{
            get_spec_artifact_detail, list_spec_artifacts, save_spec_from_path,
            SaveSpecFromPathInput,
        },
        state::AppState,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path as FsPath, PathBuf},
};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct DispatchSpecBody {
    pub title: String,
    pub slug: String,
    pub markdown: String,
}

#[derive(Debug, Serialize)]
pub struct DispatchSpecResponse {
    pub conversation_id: String,
    pub repo_spec_path: String,
}

#[derive(Deserialize)]
pub struct SaveSpecFromPathBody {
    pub path: String,
    pub conversation_id: String,
}

struct DispatchSpecOptions {
    date_prefix: String,
    conversation_id: String,
    dispatch_runtime: bool,
}

struct AgentDispatchInfo {
    project_path: String,
    runtime: String,
    mode: String,
}

pub async fn dispatch_spec(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<DispatchSpecBody>,
) -> Result<(StatusCode, Json<DispatchSpecResponse>), StatusCode> {
    dispatch_spec_core(
        state,
        agent_id,
        body,
        DispatchSpecOptions {
            date_prefix: chrono::Utc::now().format("%Y-%m-%d").to_string(),
            conversation_id: Uuid::new_v4().to_string(),
            dispatch_runtime: true,
        },
    )
    .await
}

pub async fn save_from_path(
    State(state): State<AppState>,
    Json(body): Json<SaveSpecFromPathBody>,
) -> Result<
    Json<crate::serve::spec_assets::SaveSpecFromPathResult>,
    (StatusCode, Json<serde_json::Value>),
> {
    let conversation_id = body.conversation_id.clone();
    match save_spec_from_path(
        &state,
        SaveSpecFromPathInput {
            repo_spec_path: body.path,
            conversation_id: body.conversation_id,
        },
    ) {
        Ok(result) => {
            emit_spec_changed(&state, &result.spec_id, &conversation_id);
            Ok(Json(result))
        }
        Err(err) => Err((
            err.status_code(),
            Json(serde_json::json!({ "error": err.code() })),
        )),
    }
}

pub async fn list_specs(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    list_spec_artifacts(&state)
        .map(|specs| Json(serde_json::json!({ "specs": specs })))
        .map_err(|err| {
            (
                err.status_code(),
                Json(serde_json::json!({ "error": err.code() })),
            )
        })
}

pub async fn get_spec(
    State(state): State<AppState>,
    Path(spec_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match get_spec_artifact_detail(&state, &spec_id) {
        Ok(Some(detail)) => Ok(Json(detail)),
        Ok(None) => Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "not_found" })),
        )),
        Err(err) => Err((
            err.status_code(),
            Json(serde_json::json!({ "error": err.code() })),
        )),
    }
}

async fn dispatch_spec_core(
    state: AppState,
    agent_id: String,
    body: DispatchSpecBody,
    options: DispatchSpecOptions,
) -> Result<(StatusCode, Json<DispatchSpecResponse>), StatusCode> {
    let title = normalize_title(&body.title)?;
    let slug = normalize_slug(&body.slug)?;
    let markdown = normalize_markdown(&body.markdown)?;
    let date_prefix = validate_date_prefix(&options.date_prefix)?;
    let repo_spec_path = format!("docs/product-specs/{date_prefix}-SPEC-{slug}.md");

    let agent = load_agent_dispatch_info(&state, &agent_id)?;
    write_spec_file(&agent.project_path, &repo_spec_path, &markdown)?;

    let instruction = build_dispatch_instruction(&title, &repo_spec_path);
    let message_body = PostMessageBody {
        text: instruction.clone(),
        file_id: None,
    };
    let (next_seq, payload) = create_spec_conversation_and_message(
        &state,
        &agent_id,
        &options.conversation_id,
        &title,
        &message_body,
    )?;

    if options.dispatch_runtime {
        runtime::send_to_session(
            &state,
            &options.conversation_id,
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
    }

    broadcast_initial_spec_message(&state, &options.conversation_id, next_seq, payload);
    emit_activity_changed(
        &state,
        &options.conversation_id,
        REASON_CONVERSATION_CREATED,
    );
    emit_activity_changed(&state, &options.conversation_id, REASON_USER_MESSAGE);

    Ok((
        StatusCode::CREATED,
        Json(DispatchSpecResponse {
            conversation_id: options.conversation_id,
            repo_spec_path,
        }),
    ))
}

fn normalize_title(title: &str) -> Result<String, StatusCode> {
    let title = title.trim();
    if title.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(title.to_string())
}

fn normalize_markdown(markdown: &str) -> Result<String, StatusCode> {
    if markdown.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(markdown.to_string())
}

fn normalize_slug(slug: &str) -> Result<String, StatusCode> {
    let slug = slug.trim();
    if !is_valid_spec_slug(slug) {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(slug.to_string())
}

fn is_valid_spec_slug(slug: &str) -> bool {
    if slug.is_empty() || slug.starts_with('-') || slug.ends_with('-') || slug.contains("--") {
        return false;
    }
    slug.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn validate_date_prefix(date_prefix: &str) -> Result<String, StatusCode> {
    let bytes = date_prefix.as_bytes();
    let valid = bytes.len() == 10
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit);
    if !valid {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    Ok(date_prefix.to_string())
}

fn load_agent_dispatch_info(
    state: &AppState,
    agent_id: &str,
) -> Result<AgentDispatchInfo, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT project_path, runtime, mode FROM agents WHERE id = ?1",
        [agent_id],
        |row| {
            Ok(AgentDispatchInfo {
                project_path: row.get(0)?,
                runtime: row.get(1)?,
                mode: row.get(2)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })
}

fn write_spec_file(
    project_path: &str,
    repo_spec_path: &str,
    markdown: &str,
) -> Result<(), StatusCode> {
    let full_path = repo_relative_path(project_path, repo_spec_path)?;
    let parent = full_path
        .parent()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
    std::fs::create_dir_all(parent).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&full_path)
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::AlreadyExists => StatusCode::CONFLICT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;
    file.write_all(markdown.as_bytes())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn repo_relative_path(project_path: &str, repo_spec_path: &str) -> Result<PathBuf, StatusCode> {
    if repo_spec_path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut full_path = PathBuf::from(project_path);
    for part in repo_spec_path.split('/') {
        full_path.push(FsPath::new(part));
    }
    Ok(full_path)
}

fn create_spec_conversation_and_message(
    state: &AppState,
    agent_id: &str,
    conversation_id: &str,
    title: &str,
    message_body: &PostMessageBody,
) -> Result<(i64, serde_json::Value), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = now_ms();
    let conversation_title = format!("Spec: {title}");
    db.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1, ?2, ?3, ?4, ?5, 'idle')",
        rusqlite::params![conversation_id, agent_id, conversation_title, now, now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (next_seq, _id, _created_at, payload) =
        super::messages::insert_user_message_and_mark_running(&db, conversation_id, message_body)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok((next_seq, payload))
}

fn build_dispatch_instruction(title: &str, repo_spec_path: &str) -> String {
    format!(
        "请根据仓库内的产品规格文档完成实现。\n\nSpec: {title}\nSpec path: {repo_spec_path}\n\n请先阅读项目协作规则和该 spec，然后生成实施计划并开始实现 Phase 1 最小范围。如果遇到阻塞或需要用户决策，请使用 AskUserQuestion 工具；完成后报告修改文件和验证结果。"
    )
}

fn broadcast_initial_spec_message(
    state: &AppState,
    conversation_id: &str,
    seq: i64,
    payload: serde_json::Value,
) {
    let envelope = serde_json::json!({
        "type": "message",
        "seq": seq,
        "role": "user_text",
        "payload": payload,
        "created_at": now_ms()
    });
    let sender = state.get_or_create_sender(conversation_id);
    let _ = sender.send(envelope.to_string());
}

#[cfg(test)]
#[path = "specs_tests.rs"]
mod tests;
