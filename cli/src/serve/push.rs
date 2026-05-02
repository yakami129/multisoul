#![allow(dead_code)]

use crate::logging;
use serde::{Deserialize, Serialize};
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

#[allow(dead_code)]
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

/// Send a push notification to all registered Expo tokens.
/// Fire-and-forget: logs warnings on failure but never returns an error.
pub fn send_push_to_all(
    db: &rusqlite::Connection,
    title: &str,
    body: &str,
    data: serde_json::Value,
) {
    let tokens: Vec<String> = {
        let mut stmt = match db.prepare("SELECT expo_push_token FROM push_tokens") {
            Ok(s) => s,
            Err(e) => {
                error!(error = %e, "push_db_error");
                return;
            }
        };
        let x = match stmt.query_map([], |r| r.get(0)) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => {
                error!(error = %e, "push_query_error");
                vec![]
            }
        };
        x
    };

    if tokens.is_empty() {
        return;
    }

    let payloads = tokens
        .into_iter()
        .map(|token| PushPayload {
            to: token.clone(),
            title: title.to_string(),
            body: body.to_string(),
            data: data.clone(),
            priority: "high".to_string(),
            channel_id: "multisoul-default".to_string(),
        })
        .collect();
    send_payloads(payloads);
}

fn build_payloads_for_tokens(db: &rusqlite::Connection, push: &TaskStatusPush) -> Vec<PushPayload> {
    let tokens: Vec<(String, Option<String>)> = {
        let mut stmt = match db.prepare("SELECT expo_push_token, endpoint_id FROM push_tokens") {
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

    tokens
        .into_iter()
        .map(|(token, endpoint_id)| {
            let mut data = push.data.clone();
            if let Some(endpoint_id) = endpoint_id {
                data["endpointId"] = serde_json::Value::String(endpoint_id);
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

#[allow(dead_code)]
fn send_push_to_tokens(db: &rusqlite::Connection, push: &TaskStatusPush) {
    let payloads = build_payloads_for_tokens(db, push);
    send_payloads(payloads);
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
            "convId": conv_id,
        }),
    }))
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
