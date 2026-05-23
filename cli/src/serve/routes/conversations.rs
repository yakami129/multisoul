use crate::{db::now_ms, serve::state::AppState};
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
            "SELECT c.id, c.agent_id, c.title, c.created_at, c.last_message_at, c.status,
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
                first_user_message: r.get(6)?,
                last_ai_reply: r.get(7)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Json(rows))
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

    Ok((
        StatusCode::CREATED,
        Json(ConversationRow {
            id,
            agent_id,
            title,
            created_at: now,
            last_message_at: now,
            status: "idle".into(),
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
        Ok(StatusCode::NO_CONTENT)
    }
}

#[cfg(test)]
#[path = "conversations_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "conversations_abort_tests.rs"]
mod abort_tests;
