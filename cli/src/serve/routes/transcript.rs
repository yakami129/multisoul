use crate::serve::{
    message_rows::{collect_message_rows, message_select_sql, MessageRow},
    state::AppState,
    transcript as transcript_domain,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct TranscriptQuery {
    pub limit: Option<i64>,
    pub before_turn: Option<String>,
    pub around_ask_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HiddenMessagesResponse {
    pub conversation_id: String,
    pub turn_id: String,
    pub messages: Vec<MessageRow>,
}

pub async fn list_transcript_turns(
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
    Query(q): Query<TranscriptQuery>,
) -> Result<Json<transcript_domain::TranscriptPage>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let status = conversation_status(&db, &conv_id)?;
    let messages = conversation_messages(&db, &conv_id)?;
    let page = transcript_domain::build_transcript_page(
        &conv_id,
        &status,
        messages,
        normalized_limit(q.limit),
        q.before_turn.as_deref(),
        q.around_ask_id.as_deref(),
    );
    Ok(Json(page))
}

pub async fn list_hidden_messages(
    State(state): State<AppState>,
    Path((conv_id, turn_id)): Path<(String, String)>,
) -> Result<Json<HiddenMessagesResponse>, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _status = conversation_status(&db, &conv_id)?;
    let messages = conversation_messages(&db, &conv_id)?;
    if !transcript_domain::has_turn(&messages, &turn_id) {
        return Err(StatusCode::NOT_FOUND);
    }
    let hidden = transcript_domain::hidden_messages_for_turn(messages, &turn_id);
    Ok(Json(HiddenMessagesResponse {
        conversation_id: conv_id,
        turn_id,
        messages: hidden,
    }))
}

fn normalized_limit(limit: Option<i64>) -> usize {
    limit.unwrap_or(20).clamp(1, 50) as usize
}

fn conversation_status(db: &rusqlite::Connection, conv_id: &str) -> Result<String, StatusCode> {
    db.query_row(
        "SELECT status FROM conversations WHERE id = ?1",
        [conv_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)
}

fn conversation_messages(
    db: &rusqlite::Connection,
    conv_id: &str,
) -> Result<Vec<MessageRow>, StatusCode> {
    let mut stmt = db
        .prepare(&message_select_sql(
            "m.conversation_id = ?1",
            "ORDER BY m.seq ASC",
        ))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    collect_message_rows(&mut stmt, [conv_id])
}
