use crate::serve::runtime;
use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    pub file_id: Option<String>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<SinceSeqQuery>,
) -> Result<Json<Vec<MessageRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let since = q.since_seq.unwrap_or(0);
    let mut stmt = db
        .prepare(
            "SELECT id, conversation_id, role, payload, created_at, seq
         FROM messages WHERE conversation_id = ?1 AND seq > ?2 ORDER BY seq ASC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows: Vec<MessageRow> = stmt
        .query_map(rusqlite::params![conv_id, since], |r| {
            let payload_str: String = r.get(3)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                payload_str,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .filter_map(|r| r.ok())
        .map(
            |(id, conversation_id, role, payload_str, created_at, seq)| MessageRow {
                id,
                conversation_id,
                role,
                payload: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
                created_at,
                seq,
            },
        )
        .collect();
    Ok(Json(rows))
}

pub async fn post_message(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Json(body): Json<PostMessageBody>,
) -> Result<(StatusCode, Json<MessageRow>), StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let next_seq: i64 = db
        .query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
            [&conv_id],
            |r| r.get(0),
        )
        .map_err(|_| StatusCode::NOT_FOUND)?;

    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let payload = if let Some(ref fid) = body.file_id {
        serde_json::json!({ "text": body.text, "file_id": fid })
    } else {
        serde_json::json!({ "text": body.text })
    };
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES (?1,?2,'user_text',?3,?4,?5)",
        rusqlite::params![id, conv_id, payload.to_string(), now, next_seq],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    db.execute(
        "UPDATE conversations SET last_message_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    // Fetch project_path, runtime, and mode; trigger runtime adapter
    let agent_info: Option<(String, String, String)> = {
        let db2 = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db2.query_row(
            "SELECT a.project_path, a.runtime, a.mode FROM agents a
             JOIN conversations c ON c.agent_id = a.id
             WHERE c.id = ?1",
            [&conv_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok()
    };
    if let Some((path, rt, mode)) = agent_info {
        runtime::send_to_session(
            &state,
            &conv_id,
            &body.text,
            body.file_id.as_deref(),
            &path,
            &rt,
            &mode,
        );
    }

    let envelope = serde_json::json!({
        "type": "message", "seq": next_seq, "role": "user_text",
        "payload": payload, "created_at": now
    });
    let sender = state.get_or_create_sender(&conv_id);
    let _ = sender.send(envelope.to_string());

    Ok((
        StatusCode::CREATED,
        Json(MessageRow {
            id,
            conversation_id: conv_id,
            role: "user_text".into(),
            payload,
            created_at: now,
            seq: next_seq,
        }),
    ))
}
