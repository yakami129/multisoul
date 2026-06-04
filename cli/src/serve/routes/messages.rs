use super::activity_events::{emit_activity_changed, REASON_USER_MESSAGE};
use crate::serve::runtime;
use crate::{db::now_ms, serve::state::AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Serialize)]
pub struct MessageRow {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub payload: serde_json::Value,
    pub created_at: i64,
    pub seq: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answered: Option<bool>,
    #[serde(rename = "answeredChoiceId", skip_serializing_if = "Option::is_none")]
    pub answered_choice_id: Option<String>,
    #[serde(rename = "answeredChoiceIds", skip_serializing_if = "Option::is_none")]
    pub answered_choice_ids: Option<HashMap<String, String>>,
}

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

fn message_select_sql(where_clause: &str, suffix: &str) -> String {
    format!(
        "SELECT
            m.id,
            m.conversation_id,
            m.role,
            m.payload,
            m.created_at,
            m.seq,
            CASE WHEN aa.ask_id IS NULL THEN 0 ELSE 1 END AS answered,
            aa.choice_id,
            aa.choice_ids
         FROM messages m
         LEFT JOIN ask_answers aa
           ON m.role = 'ask_question'
          AND aa.conversation_id = m.conversation_id
          AND aa.ask_id = json_extract(m.payload, '$.ask_id')
         WHERE {where_clause}
         {suffix}"
    )
}

struct MessageDbRow {
    id: String,
    conversation_id: String,
    role: String,
    payload_str: String,
    created_at: i64,
    seq: i64,
    answered_flag: i64,
    answered_choice_id: Option<String>,
    answered_choice_ids_json: Option<String>,
}

fn collect_message_rows<P>(
    stmt: &mut rusqlite::Statement<'_>,
    params: P,
) -> Result<Vec<MessageRow>, StatusCode>
where
    P: rusqlite::Params,
{
    let rows = stmt
        .query_map(params, read_message_db_row)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(rows.into_iter().map(message_db_row_to_api).collect())
}

fn read_message_db_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<MessageDbRow> {
    Ok(MessageDbRow {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        role: r.get(2)?,
        payload_str: r.get(3)?,
        created_at: r.get(4)?,
        seq: r.get(5)?,
        answered_flag: r.get(6)?,
        answered_choice_id: r.get(7)?,
        answered_choice_ids_json: r.get(8)?,
    })
}

fn message_db_row_to_api(row: MessageDbRow) -> MessageRow {
    let is_ask = row.role == "ask_question";
    let answered = is_ask.then_some(row.answered_flag != 0);
    let answered_choice_ids = row
        .answered_choice_ids_json
        .and_then(|json| serde_json::from_str::<HashMap<String, String>>(&json).ok());
    MessageRow {
        id: row.id,
        conversation_id: row.conversation_id,
        role: row.role,
        payload: serde_json::from_str(&row.payload_str).unwrap_or(serde_json::Value::Null),
        created_at: row.created_at,
        seq: row.seq,
        answered,
        answered_choice_id: row.answered_choice_id,
        answered_choice_ids,
    }
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
