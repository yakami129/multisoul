use super::activity_events::{
    emit_activity_changed, REASON_ABORTED, REASON_CONVERSATION_CREATED, REASON_DELETED,
};
use crate::{
    db::now_ms,
    serve::{
        routes::runtime_models::model_provider_status,
        runtime::models::{list_models, validate_model},
        state::AppState,
    },
};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ConversationRow {
    pub id: String,
    pub agent_id: String,
    pub title: String,
    pub created_at: i64,
    pub last_message_at: i64,
    pub status: String,
    pub model_id: Option<String>,
    pub first_user_message: Option<String>,
    pub last_ai_reply: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateConversationBody {
    pub title: Option<String>,
}

pub async fn list_conversations(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Vec<ConversationRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut stmt = db
        .prepare(
            "SELECT c.id, c.agent_id, c.title, c.created_at, c.last_message_at, c.status, c.model_id,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'user_text'
                 ORDER BY m.seq ASC LIMIT 1) AS first_user_message,
                (SELECT json_extract(m.payload, '$.text')
                 FROM messages m
                 WHERE m.conversation_id = c.id AND m.role = 'agent_text'
                 ORDER BY m.seq DESC LIMIT 1) AS last_ai_reply
         FROM conversations c WHERE c.agent_id = ?1 ORDER BY c.last_message_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<ConversationRow> = stmt
        .query_map([&agent_id], |r| {
            Ok(ConversationRow {
                id: r.get(0)?,
                agent_id: r.get(1)?,
                title: r.get(2)?,
                created_at: r.get(3)?,
                last_message_at: r.get(4)?,
                status: r.get(5)?,
                model_id: r.get(6)?,
                first_user_message: r.get(7)?,
                last_ai_reply: r.get(8)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Json(rows))
}

pub async fn patch_conversation_model(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<ConversationRow>, StatusCode> {
    let requested_model = normalize_model_id(body.get("model_id").ok_or(StatusCode::BAD_REQUEST)?)?;
    let runtime: String = {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.query_row(
            "SELECT a.runtime
             FROM conversations c
             JOIN agents a ON a.id = c.agent_id
             WHERE c.id = ?1",
            [&conv_id],
            |row| row.get(0),
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?
    };

    if let Some((seq, created_at, payload)) =
        apply_conversation_model_change(&state, &conv_id, &runtime, requested_model.as_deref())?
    {
        broadcast_system_event(&state, &conv_id, seq, created_at, payload);
    }

    load_conversation_row(&state, &conv_id).map(Json)
}

fn normalize_model_id(model_id: &serde_json::Value) -> Result<Option<String>, StatusCode> {
    if model_id.is_null() {
        return Ok(None);
    }
    let Some(model_id) = model_id.as_str() else {
        return Err(StatusCode::BAD_REQUEST);
    };
    let trimmed = model_id.trim();
    if trimmed.is_empty() || trimmed == "default" {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(Some(trimmed.to_string()))
}

fn model_label(runtime: &str, model_id: Option<&str>) -> Result<String, StatusCode> {
    let Some(model_id) = model_id else {
        return Ok("Default".to_string());
    };
    let models = list_models(runtime).map_err(model_provider_status)?;
    Ok(models
        .into_iter()
        .find(|model| model.id == model_id)
        .map(|model| model.label)
        .unwrap_or_else(|| model_id.to_string()))
}

fn apply_conversation_model_change(
    state: &AppState,
    conv_id: &str,
    runtime: &str,
    model_id: Option<&str>,
) -> Result<Option<(i64, i64, serde_json::Value)>, StatusCode> {
    let mut db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tx = db
        .transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let (status, current_model): (String, Option<String>) = tx
        .query_row(
            "SELECT status, model_id FROM conversations WHERE id = ?1",
            [conv_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })?;

    if status == "running" || status == "awaiting_question" {
        return Err(StatusCode::CONFLICT);
    }

    validate_model(runtime, model_id).map_err(model_provider_status)?;

    if current_model.as_deref() == model_id {
        tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Ok(None);
    }

    let from_label = model_label(runtime, current_model.as_deref())?;
    let to_label = model_label(runtime, model_id)?;
    let payload = serde_json::json!({
        "event": "model_changed",
        "from_model_id": current_model,
        "to_model_id": model_id,
        "from_label": from_label,
        "to_label": to_label,
    });
    let next_seq: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
            [conv_id],
            |row| row.get(0),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = now_ms();
    tx.execute(
        "UPDATE conversations SET model_id = ?1, last_message_at = ?2 WHERE id = ?3",
        rusqlite::params![model_id, now, conv_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1, ?2, 'system_event', ?3, ?4, ?5)",
        rusqlite::params![
            Uuid::new_v4().to_string(),
            conv_id,
            payload.to_string(),
            now,
            next_seq
        ],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Some((next_seq, now, payload)))
}

fn load_conversation_row(state: &AppState, conv_id: &str) -> Result<ConversationRow, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.query_row(
        "SELECT c.id, c.agent_id, c.title, c.created_at, c.last_message_at, c.status, c.model_id,
            (SELECT json_extract(m.payload, '$.text')
             FROM messages m
             WHERE m.conversation_id = c.id AND m.role = 'user_text'
             ORDER BY m.seq ASC LIMIT 1) AS first_user_message,
            (SELECT json_extract(m.payload, '$.text')
             FROM messages m
             WHERE m.conversation_id = c.id AND m.role = 'agent_text'
             ORDER BY m.seq DESC LIMIT 1) AS last_ai_reply
         FROM conversations c WHERE c.id = ?1",
        [conv_id],
        |row| {
            Ok(ConversationRow {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                last_message_at: row.get(4)?,
                status: row.get(5)?,
                model_id: row.get(6)?,
                first_user_message: row.get(7)?,
                last_ai_reply: row.get(8)?,
            })
        },
    )
    .map_err(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })
}

#[derive(Serialize)]
struct ModelChangedEnvelope {
    #[serde(rename = "type")]
    kind: &'static str,
    seq: i64,
    role: &'static str,
    payload: serde_json::Value,
    created_at: i64,
}

fn broadcast_system_event(
    state: &AppState,
    conv_id: &str,
    seq: i64,
    created_at: i64,
    payload: serde_json::Value,
) {
    let envelope = ModelChangedEnvelope {
        kind: "message",
        seq,
        role: "system_event",
        payload,
        created_at,
    };
    if let Ok(json) = serde_json::to_string(&envelope) {
        let tx = state.get_or_create_sender(conv_id);
        let _ = tx.send(json);
    }
}

pub async fn create_conversation(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<CreateConversationBody>,
) -> Result<(StatusCode, Json<ConversationRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let exists: bool = db
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE id = ?1",
            [&agent_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let title = body.title.unwrap_or_else(|| "New conversation".to_string());
    db.execute(
        "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
         VALUES (?1,?2,?3,?4,?5,'idle')",
        rusqlite::params![id, agent_id, title, now, now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(db);
    emit_activity_changed(&state, &id, REASON_CONVERSATION_CREATED);

    Ok((
        StatusCode::CREATED,
        Json(ConversationRow {
            id,
            agent_id,
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

/// POST /api/v1/conversations/:id/abort
/// 向正在运行的 session worker 发送中断信号（通过从 sessions map 中移除）。
/// 若 conversation 不存在，返回 404。若无对应 session，仍返回 200（幂等）。
pub async fn abort_conversation(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // 检查 conversation 是否存在
    let exists = {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.query_row(
            "SELECT COUNT(*) FROM conversations WHERE id = ?1",
            [&conv_id],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    };
    if !exists {
        return Err(StatusCode::NOT_FOUND);
    }

    let (removed_session, sessions_len_before_remove) = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let sessions_len_before_remove = sessions.len();
        let removed_session = sessions.remove(&conv_id);
        (removed_session, sessions_len_before_remove)
    };
    if let Some(session) = removed_session {
        let kill_return = session.abort_current_process();
        info!(
            target: "multisoul::abort",
            conv_id = %conv_id,
            phase = "http_layer",
            sessions_len_before_remove,
            kill_return,
            hint = "diagnose with target=multisoul::abort phase=handle logs (pid registration + syscall outcome)",
            "abort invoked on removed SessionHandle",
        );
    } else {
        warn!(
            target: "multisoul::abort",
            conv_id = %conv_id,
            phase = "http_layer",
            sessions_len_before_remove,
            "abort: no SessionHandle in map — SQLite idles to running=false but subprocess not signaled here",
        );
    }

    // 将 conversation status 更新为 idle
    {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.execute(
            "UPDATE conversations SET status = 'idle' WHERE id = ?1",
            [&conv_id],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    emit_activity_changed(&state, &conv_id, REASON_ABORTED);

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn delete_conversation(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let n = db
        .execute("DELETE FROM conversations WHERE id = ?1", [&conv_id])
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if n == 0 {
        Err(StatusCode::NOT_FOUND)
    } else {
        drop(db);
        emit_activity_changed(&state, &conv_id, REASON_DELETED);
        Ok(StatusCode::NO_CONTENT)
    }
}

#[cfg(test)]
#[path = "../../../tests/serve/routes/conversations_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../tests/serve/routes/conversations_abort_tests.rs"]
mod abort_tests;
