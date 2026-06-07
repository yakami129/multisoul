use crate::logging;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::{error, info, warn};

const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";

#[derive(Serialize, Debug)]
pub struct PushPayload {
    pub to: String,
    pub title: String,
    pub body: String,
    pub data: serde_json::Value,
    pub priority: String,
    #[serde(rename = "channelId")]
    pub channel_id: String,
}

pub struct TaskStatusPush {
    pub title: String,
    pub body: String,
    pub data: serde_json::Value,
}

#[derive(Deserialize, Debug)]
struct ExpoResponse {
    data: Vec<ExpoTicket>,
}

#[derive(Deserialize, Debug)]
struct ExpoTicket {
    status: String,
    #[serde(default)]
    message: Option<String>,
}

fn build_payloads_for_tokens(db: &rusqlite::Connection, push: &TaskStatusPush) -> Vec<PushPayload> {
    let tokens: Vec<(String, Option<String>)> = {
        let mut stmt = match db.prepare(
            "SELECT expo_push_token, endpoint_id
             FROM push_tokens
             ORDER BY registered_at DESC",
        ) {
            Ok(s) => s,
            Err(e) => {
                error!(error = %e, "push_db_error");
                return vec![];
            }
        };
        let x = match stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                error!(error = %e, "push_query_error");
                vec![]
            }
        };
        x
    };

    if tokens.is_empty() {
        return vec![];
    }

    let mut seen_tokens = HashSet::new();
    tokens
        .into_iter()
        .filter(|(token, _)| seen_tokens.insert(token.clone()))
        .map(|(token, endpoint_id)| {
            let mut data = push.data.clone();
            if let Some(endpoint_id) = endpoint_id {
                data["endpointId"] = serde_json::Value::String(endpoint_id.clone());
                data["endpoint_id"] = serde_json::Value::String(endpoint_id);
            }
            PushPayload {
                to: token,
                title: push.title.clone(),
                body: push.body.clone(),
                data,
                priority: "high".to_string(),
                channel_id: "multisoul-default".to_string(),
            }
        })
        .collect()
}

fn send_payloads(payloads: Vec<PushPayload>) {
    let client = reqwest::blocking::Client::new();
    for payload in payloads {
        let token_hash = logging::token_hash(&payload.to);
        match client.post(EXPO_PUSH_URL).json(&payload).send() {
            Ok(resp) => {
                if let Ok(er) = resp.json::<ExpoResponse>() {
                    for ticket in er.data {
                        if ticket.status != "ok" {
                            warn!(
                                token_hash = %token_hash,
                                error_type = ticket.message.as_deref().unwrap_or(""),
                                "push_failed"
                            );
                        } else {
                            info!(token_hash = %token_hash, "push_send");
                        }
                    }
                }
            }
            Err(e) => warn!(
                token_hash = %token_hash,
                error = %e,
                "push_failed"
            ),
        }
    }
}

fn send_push_to_tokens_async(db: &rusqlite::Connection, push: &TaskStatusPush) {
    let payloads = build_payloads_for_tokens(db, push);
    if payloads.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        send_payloads(payloads);
    });
}

#[cfg(test)]
pub fn build_task_status_push_payloads(
    db: &rusqlite::Connection,
    conv_id: &str,
    status: &str,
    summary: &str,
) -> rusqlite::Result<Vec<PushPayload>> {
    match build_task_status_push(db, conv_id, status, summary)? {
        Some(push) => Ok(build_payloads_for_tokens(db, &push)),
        None => Ok(vec![]),
    }
}

#[cfg(test)]
mod token_payload_tests {
    use super::*;

    #[test]
    fn inserts_endpoint_id_per_payload() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE push_tokens (
                id TEXT PRIMARY KEY,
                expo_push_token TEXT NOT NULL,
                device_label TEXT NOT NULL,
                endpoint_id TEXT,
                registered_at INTEGER NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
             VALUES ('tok-1', 'ExponentPushToken[abc]', 'iPhone', 'ep-1', 1)",
            [],
        )
        .unwrap();
        let push = TaskStatusPush {
            title: "Done".to_string(),
            body: "Body".to_string(),
            data: serde_json::json!({ "type": "task_completed" }),
        };

        let payloads = build_payloads_for_tokens(&conn, &push);

        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].data["endpointId"], "ep-1");
    }
}

pub fn build_task_status_push(
    db: &rusqlite::Connection,
    conv_id: &str,
    status: &str,
    summary: &str,
) -> rusqlite::Result<Option<TaskStatusPush>> {
    if has_ask_question_in_current_turn(db, conv_id)? {
        return Ok(None);
    }

    let (agent_id, agent_name): (String, String) = db.query_row(
        "SELECT a.id, a.name
         FROM conversations c
         JOIN agents a ON a.id = c.agent_id
         WHERE c.id = ?1",
        [conv_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let (title, kind) = match status {
        "completed" => (format!("{} 任务完成", agent_name), "task_completed"),
        "failed" => (format!("{} 任务失败", agent_name), "task_failed"),
        _ => return Ok(None),
    };
    let body = if summary.is_empty() {
        "点击查看详情".to_string()
    } else if summary.chars().count() > 100 {
        summary.chars().take(100).collect::<String>() + "..."
    } else {
        summary.to_string()
    };
    Ok(Some(TaskStatusPush {
        title,
        body,
        data: serde_json::json!({
            "type": kind,
            "agentId": agent_id,
            "agent_id": agent_id,
            "convId": conv_id,
            "conversation_id": conv_id,
        }),
    }))
}

fn has_ask_question_in_current_turn(
    db: &rusqlite::Connection,
    conv_id: &str,
) -> rusqlite::Result<bool> {
    let count: i64 = db.query_row(
        "SELECT COUNT(*)
         FROM messages
         WHERE conversation_id = ?1
           AND role = 'ask_question'
           AND seq > COALESCE((
             SELECT MAX(seq)
             FROM messages
             WHERE conversation_id = ?1
               AND role = 'user_text'
           ), 0)",
        [conv_id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn build_ask_question_push(
    db: &rusqlite::Connection,
    conv_id: &str,
    ask_payload: &serde_json::Value,
) -> rusqlite::Result<TaskStatusPush> {
    let (agent_id, agent_name): (String, String) = db.query_row(
        "SELECT a.id, a.name
         FROM conversations c
         JOIN agents a ON a.id = c.agent_id
         WHERE c.id = ?1",
        [conv_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let ask_id = ask_payload["ask_id"].as_str().unwrap_or(conv_id);
    let first_question = ask_payload["questions"]
        .as_array()
        .and_then(|questions| questions.first())
        .and_then(|q| q["text"].as_str())
        .unwrap_or("点击查看问题");
    let body = if first_question.chars().count() > 100 {
        first_question.chars().take(100).collect::<String>() + "..."
    } else {
        first_question.to_string()
    };

    Ok(TaskStatusPush {
        title: format!("{} 需要你确认", agent_name),
        body,
        data: serde_json::json!({
            "type": "ask_question",
            "kind": "pending_question",
            "inbox_id": ask_id,
            "endpoint_id": "",
            "agentId": agent_id,
            "agent_id": agent_id,
            "convId": conv_id,
            "conversation_id": conv_id,
            "payload": ask_payload.to_string(),
        }),
    })
}

pub fn send_ask_question_push(
    db: &rusqlite::Connection,
    conv_id: &str,
    ask_payload: &serde_json::Value,
) {
    match build_ask_question_push(db, conv_id, ask_payload) {
        Ok(push) => send_push_to_tokens_async(db, &push),
        Err(e) => error!(conv_id = %conv_id, error = %e, "push_build_failed"),
    }
}

pub fn send_task_status_push(
    db: &rusqlite::Connection,
    conv_id: &str,
    status: &str,
    summary: &str,
) {
    match build_task_status_push(db, conv_id, status, summary) {
        Ok(Some(push)) => send_push_to_tokens_async(db, &push),
        Ok(None) => {}
        Err(e) => error!(conv_id = %conv_id, error = %e, "push_build_failed"),
    }
}

pub fn send_watch_completion_push(
    db: &rusqlite::Connection,
    workflow_name: &str,
    workflow_id: &str,
    stop_status: &str,
    run_count: i64,
) {
    let body = match stop_status {
        "completed" => format!("Completed {} run(s)", run_count),
        "expired" => format!("Watch window expired ({} run(s))", run_count),
        "stopped" => "Watch stopped by user".to_string(),
        "failed" => "Watch failed".to_string(),
        _ => format!("Watch ended after {} run(s)", run_count),
    };
    let push = TaskStatusPush {
        title: format!("Watch completed \u{2014} {}", workflow_name),
        body,
        data: serde_json::json!({
            "type": "watch_completed",
            "workflow_id": workflow_id,
            "watch_status": stop_status,
        }),
    };
    send_push_to_tokens_async(db, &push);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// send_push: serializes payload correctly for Expo API.
    ///
    /// Data construction:
    ///   to    = "ExponentPushToken[abc]"
    ///   title = "Task done"
    ///   body  = "3 files changed"
    ///   data  = { kind: "complex_done", inbox_id: "ib-1" }
    ///
    /// Expected:
    ///   - serialized JSON has "to", "title", "body", "data", "priority":"high"
    #[test]
    fn test_push_payload_serializes_correctly() {
        let payload = PushPayload {
            to: "ExponentPushToken[abc]".to_string(),
            title: "Task done".to_string(),
            body: "3 files changed".to_string(),
            data: serde_json::json!({ "kind": "complex_done", "inbox_id": "ib-1" }),
            priority: "high".to_string(),
            channel_id: "multisoul-default".to_string(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["to"], "ExponentPushToken[abc]", "to field must be set");
        assert_eq!(json["priority"], "high", "priority must be high");
        assert_eq!(
            json["data"]["kind"], "complex_done",
            "data.kind must be set"
        );
    }
}
