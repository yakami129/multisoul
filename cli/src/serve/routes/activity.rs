use crate::serve::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ActivityQuery {
    pub limit_per_section: Option<i64>,
}

#[derive(Serialize)]
pub struct ActivityResponse {
    pub items: Vec<ActivityItem>,
}

#[derive(Serialize)]
pub struct ActivityItem {
    pub id: String,
    pub section: String,
    pub conversation_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub title: String,
    pub subtitle: String,
    pub status_label: String,
    pub tone: String,
    pub timestamp: i64,
    pub ask_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<Option<i64>>,
}

pub async fn get_activity(
    State(state): State<AppState>,
    Query(query): Query<ActivityQuery>,
) -> Result<Json<ActivityResponse>, StatusCode> {
    let limit = query.limit_per_section.unwrap_or(50).max(0);
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut items = Vec::new();
    items.extend(load_attention_items(&db, limit)?);
    items.extend(load_running_items(&db, limit)?);
    items.extend(load_done_items(&db, limit)?);
    Ok(Json(ActivityResponse { items }))
}

pub async fn mark_done_read(
    State(state): State<AppState>,
    Path(conversation_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !is_done_conversation(&db, &conversation_id)? {
        return Err(StatusCode::NOT_FOUND);
    }
    db.execute(
        "INSERT OR REPLACE INTO activity_reads (conversation_id, read_at)
         VALUES (?1, ?2)",
        rusqlite::params![conversation_id, crate::db::now_ms()],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn mark_all_done_read(State(state): State<AppState>) -> Result<StatusCode, StatusCode> {
    let db = state
        .db
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let now = crate::db::now_ms();
    db.execute(
        "INSERT OR REPLACE INTO activity_reads (conversation_id, read_at)
         SELECT c.id, ?1
         FROM conversations c
         WHERE c.status IN ('completed', 'failed')
            OR (
                c.status = 'idle'
                AND EXISTS (
                    SELECT 1
                    FROM messages mt
                    WHERE mt.conversation_id = c.id
                      AND mt.role = 'task_status'
                      AND json_extract(mt.payload, '$.status') IN ('completed', 'failed')
                )
            )",
        rusqlite::params![now],
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

fn is_done_conversation(
    db: &rusqlite::Connection,
    conversation_id: &str,
) -> Result<bool, StatusCode> {
    db.query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM conversations c
            WHERE c.id = ?1
              AND (
                c.status IN ('completed', 'failed')
                OR (
                    c.status = 'idle'
                    AND EXISTS (
                        SELECT 1
                        FROM messages mt
                        WHERE mt.conversation_id = c.id
                          AND mt.role = 'task_status'
                          AND json_extract(mt.payload, '$.status') IN ('completed', 'failed')
                    )
                )
              )
        )",
        rusqlite::params![conversation_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count != 0)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn load_attention_items(
    db: &rusqlite::Connection,
    limit: i64,
) -> Result<Vec<ActivityItem>, StatusCode> {
    let mut stmt = db
        .prepare(
            "SELECT
                'attention:' || c.id || ':' || json_extract(m.payload, '$.ask_id') AS id,
                'attention' AS section,
                c.id AS conversation_id,
                c.agent_id,
                a.name AS agent_name,
                COALESCE(json_extract(m.payload, '$.questions[0].text'), c.title) AS title,
                COALESCE(
                    (SELECT json_extract(mu.payload, '$.text')
                     FROM messages mu
                     WHERE mu.conversation_id = c.id AND mu.role = 'user_text'
                     ORDER BY mu.seq ASC LIMIT 1),
                    (SELECT json_extract(ma.payload, '$.text')
                     FROM messages ma
                     WHERE ma.conversation_id = c.id AND ma.role = 'agent_text'
                     ORDER BY ma.seq DESC LIMIT 1),
                    c.title
                ) AS subtitle,
                'Pending' AS status_label,
                'attention' AS tone,
                m.created_at AS timestamp,
                json_extract(m.payload, '$.ask_id') AS ask_id
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN agents a ON a.id = c.agent_id
             LEFT JOIN ask_answers aa
               ON aa.conversation_id = c.id
              AND aa.ask_id = json_extract(m.payload, '$.ask_id')
             WHERE m.role = 'ask_question'
               AND c.status = 'awaiting_question'
               AND json_extract(m.payload, '$.ask_id') IS NOT NULL
               AND aa.ask_id IS NULL
             ORDER BY m.created_at DESC, m.seq DESC
             LIMIT ?1",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    map_items(stmt.query_map([limit], row_to_activity_item))
}

fn load_running_items(
    db: &rusqlite::Connection,
    limit: i64,
) -> Result<Vec<ActivityItem>, StatusCode> {
    let mut stmt = db
        .prepare(
            "SELECT
                'running:' || c.id AS id,
                'running' AS section,
                c.id AS conversation_id,
                c.agent_id,
                a.name AS agent_name,
                COALESCE(
                    (SELECT json_extract(mu.payload, '$.text')
                     FROM messages mu
                     WHERE mu.conversation_id = c.id AND mu.role = 'user_text'
                     ORDER BY mu.seq ASC LIMIT 1),
                    c.title
                ) AS title,
                COALESCE(
                    (SELECT json_extract(ma.payload, '$.text')
                     FROM messages ma
                     WHERE ma.conversation_id = c.id AND ma.role = 'agent_text'
                     ORDER BY ma.seq DESC LIMIT 1),
                    c.title
                ) AS subtitle,
                'Running' AS status_label,
                'running' AS tone,
                c.last_message_at AS timestamp,
                NULL AS ask_id
             FROM conversations c
             JOIN agents a ON a.id = c.agent_id
             WHERE c.status = 'running'
             ORDER BY c.last_message_at DESC
             LIMIT ?1",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    map_items(stmt.query_map([limit], row_to_activity_item))
}

fn load_done_items(db: &rusqlite::Connection, limit: i64) -> Result<Vec<ActivityItem>, StatusCode> {
    let mut stmt = db
        .prepare(
            "SELECT
                'done:' || c.id AS id,
                'done' AS section,
                c.id AS conversation_id,
                c.agent_id,
                a.name AS agent_name,
                COALESCE(
                    (SELECT json_extract(mu.payload, '$.text')
                     FROM messages mu
                     WHERE mu.conversation_id = c.id AND mu.role = 'user_text'
                     ORDER BY mu.seq ASC LIMIT 1),
                    c.title
                ) AS title,
                COALESCE(
                    (SELECT json_extract(mt.payload, '$.summary')
                     FROM messages mt
                     WHERE mt.conversation_id = c.id AND mt.role = 'task_status'
                     ORDER BY mt.seq DESC LIMIT 1),
                    (SELECT json_extract(ma.payload, '$.text')
                     FROM messages ma
                     WHERE ma.conversation_id = c.id AND ma.role = 'agent_text'
                     ORDER BY ma.seq DESC LIMIT 1),
                    c.title
                ) AS subtitle,
                CASE
                    WHEN c.status = 'failed'
                      OR (
                        SELECT json_extract(mt.payload, '$.status')
                        FROM messages mt
                        WHERE mt.conversation_id = c.id
                          AND mt.role = 'task_status'
                          AND json_extract(mt.payload, '$.status') IN ('completed', 'failed')
                        ORDER BY mt.seq DESC LIMIT 1
                      ) = 'failed'
                    THEN 'Failed'
                    ELSE 'Done'
                END AS status_label,
                CASE
                    WHEN c.status = 'failed'
                      OR (
                        SELECT json_extract(mt.payload, '$.status')
                        FROM messages mt
                        WHERE mt.conversation_id = c.id
                          AND mt.role = 'task_status'
                          AND json_extract(mt.payload, '$.status') IN ('completed', 'failed')
                        ORDER BY mt.seq DESC LIMIT 1
                      ) = 'failed'
                    THEN 'failed'
                    ELSE 'done'
                END AS tone,
                c.last_message_at AS timestamp,
                NULL AS ask_id,
                ar.read_at AS read_at
             FROM conversations c
             JOIN agents a ON a.id = c.agent_id
             LEFT JOIN activity_reads ar ON ar.conversation_id = c.id
             WHERE c.status IN ('completed', 'failed')
                OR (
                    c.status = 'idle'
                    AND EXISTS (
                        SELECT 1
                        FROM messages mt
                        WHERE mt.conversation_id = c.id
                          AND mt.role = 'task_status'
                          AND json_extract(mt.payload, '$.status') IN ('completed', 'failed')
                    )
                )
             ORDER BY c.last_message_at DESC
             LIMIT ?1",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    map_items(stmt.query_map([limit], row_to_done_activity_item))
}

type ActivityMappedRows<'stmt> =
    rusqlite::MappedRows<'stmt, fn(&rusqlite::Row<'_>) -> rusqlite::Result<ActivityItem>>;

fn map_items(
    rows: rusqlite::Result<ActivityMappedRows<'_>>,
) -> Result<Vec<ActivityItem>, StatusCode> {
    rows.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn row_to_activity_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityItem> {
    Ok(ActivityItem {
        id: row.get(0)?,
        section: row.get(1)?,
        conversation_id: row.get(2)?,
        agent_id: row.get(3)?,
        agent_name: row.get(4)?,
        title: row.get(5)?,
        subtitle: row.get(6)?,
        status_label: row.get(7)?,
        tone: row.get(8)?,
        timestamp: row.get(9)?,
        ask_id: row.get(10)?,
        read_at: None,
    })
}

fn row_to_done_activity_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ActivityItem> {
    Ok(ActivityItem {
        id: row.get(0)?,
        section: row.get(1)?,
        conversation_id: row.get(2)?,
        agent_id: row.get(3)?,
        agent_name: row.get(4)?,
        title: row.get(5)?,
        subtitle: row.get(6)?,
        status_label: row.get(7)?,
        tone: row.get(8)?,
        timestamp: row.get(9)?,
        ask_id: row.get(10)?,
        read_at: Some(row.get(11)?),
    })
}

#[cfg(test)]
mod tests;
