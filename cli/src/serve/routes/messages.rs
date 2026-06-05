use super::activity_events::{emit_activity_changed, REASON_USER_MESSAGE};
use crate::serve::message_rows::{collect_message_rows, message_select_sql, MessageRow};
use crate::serve::runtime;
use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct MessagesQuery {
    pub since_seq: Option<i64>,
    pub limit: Option<i64>,
    pub before_seq: Option<i64>,
    pub around_ask_id: Option<String>,
}

#[derive(Deserialize)]
pub struct PostMessageBody {
    pub text: String,
    pub file_id: Option<String>,
}

pub async fn list_messages(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<MessagesQuery>,
) -> Result<Json<Vec<MessageRow>>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let rows = if let Some(ask_id) = q.around_ask_id {
        let limit = normalized_limit(q.limit);
        let target_seq = db
            .query_row(
                "SELECT seq
                 FROM messages
                 WHERE conversation_id = ?1
                   AND role = 'ask_question'
                   AND json_extract(payload, '$.ask_id') = ?2",
                rusqlite::params![conv_id, ask_id],
                |r| r.get::<_, i64>(0),
            )
            .ok();
        if let Some(target_seq) = target_seq {
            let before_limit = limit / 2;
            let forward_limit = limit - before_limit;
            let mut before_stmt = db
                .prepare(&message_select_sql(
                    "m.conversation_id = ?1 AND m.seq < ?2",
                    "ORDER BY m.seq DESC LIMIT ?3",
                ))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            let mut rows = collect_message_rows(
                &mut before_stmt,
                rusqlite::params![conv_id, target_seq, before_limit],
            )?;
            let mut forward_stmt = db
                .prepare(&message_select_sql(
                    "m.conversation_id = ?1 AND m.seq >= ?2",
                    "ORDER BY m.seq ASC LIMIT ?3",
                ))
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            rows.extend(collect_message_rows(
                &mut forward_stmt,
                rusqlite::params![conv_id, target_seq, forward_limit],
            )?);
            rows.sort_by_key(|message| message.seq);
            rows.dedup_by_key(|message| message.seq);
            rows
        } else {
            Vec::new()
        }
    } else if let Some(before_seq) = q.before_seq {
        let limit = normalized_limit(q.limit);
        let sql = format!(
            "SELECT * FROM ({}) ORDER BY seq ASC",
            message_select_sql(
                "m.conversation_id = ?1 AND m.seq < ?2",
                "ORDER BY m.seq DESC LIMIT ?3",
            )
        );
        let mut stmt = db
            .prepare(&sql)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        collect_message_rows(&mut stmt, rusqlite::params![conv_id, before_seq, limit])?
    } else if q.limit.is_some() {
        let limit = normalized_limit(q.limit);
        let sql = format!(
            "SELECT * FROM ({}) ORDER BY seq ASC",
            message_select_sql("m.conversation_id = ?1", "ORDER BY m.seq DESC LIMIT ?2")
        );
        let mut stmt = db
            .prepare(&sql)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        collect_message_rows(&mut stmt, rusqlite::params![conv_id, limit])?
    } else {
        let since = q.since_seq.unwrap_or(0);
        let mut stmt = db
            .prepare(&message_select_sql(
                "m.conversation_id = ?1 AND m.seq > ?2",
                "ORDER BY m.seq ASC",
            ))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        collect_message_rows(&mut stmt, rusqlite::params![conv_id, since])?
    };

    Ok(Json(rows))
}

fn normalized_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(15).clamp(1, 100)
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
    let (next_seq, id, now, payload) = insert_user_message_and_mark_running(&db, &conv_id, &body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    drop(db);

    dispatch_user_message(
        &state,
        &conv_id,
        &body.text,
        body.file_id.as_deref(),
        next_seq,
    )?;

    broadcast_user_message(&state, &conv_id, next_seq, &payload, now);
    emit_activity_changed(&state, &conv_id, REASON_USER_MESSAGE);

    Ok((
        StatusCode::CREATED,
        Json(MessageRow {
            id,
            conversation_id: conv_id,
            role: "user_text".into(),
            payload,
            created_at: now,
            seq: next_seq,
            answered: None,
            answered_choice_id: None,
            answered_choice_ids: None,
        }),
    ))
}

pub(super) fn dispatch_user_message(
    state: &AppState,
    conv_id: &str,
    text: &str,
    file_id: Option<&str>,
    seq: i64,
) -> Result<(), StatusCode> {
    let agent_info: Option<(String, String, String, Option<String>)> = {
        let db = state
            .db
            .lock()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        db.query_row(
            "SELECT a.project_path, a.runtime, a.mode, c.model_id FROM agents a
             JOIN conversations c ON c.agent_id = a.id
             WHERE c.id = ?1",
            [conv_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()
    };
    if let Some((path, rt, mode, model_id)) = agent_info {
        runtime::send_to_session(
            state,
            conv_id,
            runtime::DispatchMessage {
                text,
                file_id,
                model_id: model_id.as_deref(),
                seq,
            },
            &path,
            &rt,
            &mode,
        );
    }
    Ok(())
}

pub(super) fn broadcast_user_message(
    state: &AppState,
    conv_id: &str,
    seq: i64,
    payload: &serde_json::Value,
    created_at: i64,
) {
    let envelope = serde_json::json!({
        "type": "message", "seq": seq, "role": "user_text",
        "payload": payload, "created_at": created_at
    });
    let sender = state.get_or_create_sender(conv_id);
    let _ = sender.send(envelope.to_string());
}

pub(super) fn insert_user_message_and_mark_running(
    db: &rusqlite::Connection,
    conv_id: &str,
    body: &PostMessageBody,
) -> rusqlite::Result<(i64, String, i64, serde_json::Value)> {
    let next_seq: i64 = db.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE conversation_id = ?1",
        [conv_id],
        |r| r.get(0),
    )?;

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
    )?;
    db.execute(
        "UPDATE conversations
         SET last_message_at = ?1, status = 'running'
         WHERE id = ?2",
        rusqlite::params![now, conv_id],
    )?;
    Ok((next_seq, id, now, payload))
}
