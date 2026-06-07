use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
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

pub fn message_select_sql(where_clause: &str, suffix: &str) -> String {
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
          AND aa.ask_id = CASE
                WHEN json_valid(m.payload) THEN json_extract(m.payload, '$.ask_id')
                ELSE NULL
              END
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

pub fn collect_message_rows<P>(
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
