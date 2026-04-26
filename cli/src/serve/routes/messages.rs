use axum::{extract::{Path, Query, State}, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{db::now_ms, serve::state::AppState};
use crate::serve::runtime;

#[derive(Serialize)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
    pub seq: i64,
}

#[derive(Deserialize)]
pub struct SinceSeqQuery {
    pub since_seq: Option<i64>,
}

#[derive(Deserialize)]
pub struct PostMessageBody {
    pub text: String,
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<SinceSeqQuery>,
) -> Result<Json<Vec<MessageRow>>, StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let since = q.since_seq.unwrap_or(0);
    let mut stmt = db.prepare(
        "SELECT id, conversation_id, role, payload, created_at, seq
         FROM messages WHERE conversation_id = ?1 AND seq > ?2 ORDER BY seq ASC"
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<MessageRow> = stmt.query_map(rusqlite::params![conv_id, since], |r| {
        let payload_str: String = r.get(3)?;
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, payload_str, r.get(4)?, r.get(5)?))
    }).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .filter_map(|r| r.ok())
    .map(|(id, conversation_id, role, payload_str, created_at, seq)| MessageRow {
        id, conversation_id, role,
        payload: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
        created_at, seq,
    })
    .collect();
    Ok(Json(rows))
}

pub async fn post_message(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Json(body): Json<PostMessageBody>,
) -> Result<(StatusCode, Json<MessageRow>), StatusCode> {
    let db = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let next_seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [&conv_id], |r| r.get(0),
    ).map_err(|_| StatusCode::NOT_FOUND)?;

    let id      = Uuid::new_v4().to_string();
    let now     = now_ms();
    let payload = serde_json::json!({ "text": body.text });
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,'user_text',?3,?4,?5)",
        rusqlite::params![id, conv_id, payload.to_string(), now, next_seq],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    // Fetch project_path and trigger runtime adapter
    let project_path: Option<String> = {
        let db2 = state.db.lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db2.query_row(
            "SELECT a.project_path FROM agents a
             JOIN conversations c ON c.agent_id = a.id
             WHERE c.id = ?1",
            [&conv_id],
            |r| r.get(0),
        ).ok()
    };
    if let Some(path) = project_path {
        runtime::run_agent_turn(state.clone(), conv_id.clone(), path);
    }

    let envelope = serde_json::json!({
        "type": "message", "seq": next_seq, "role": "user_text",
        "payload": payload, "created_at": now
    });
    let sender = state.get_or_create_sender(&conv_id);
    let _ = sender.send(envelope.to_string());

    Ok((StatusCode::CREATED, Json(MessageRow {
        id, conversation_id: conv_id, role: "user_text".into(),
        payload, created_at: now, seq: next_seq,
    })))
}
