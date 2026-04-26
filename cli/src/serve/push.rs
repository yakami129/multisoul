use serde::{Deserialize, Serialize};

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
            Err(e) => { eprintln!("[push] DB error: {}", e); return; }
        };
        let x = match stmt.query_map([], |r| r.get(0)) {
            Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
            Err(e) => { eprintln!("[push] query error: {}", e); vec![] }
        }; x
    };

    if tokens.is_empty() { return; }

    let client = reqwest::blocking::Client::new();
    for token in tokens {
        let payload = PushPayload {
            to: token.clone(),
            title: title.to_string(),
            body: body.to_string(),
            data: data.clone(),
            priority: "high".to_string(),
            channel_id: "multisoul-default".to_string(),
        };
        match client.post(EXPO_PUSH_URL).json(&payload).send() {
            Ok(resp) => {
                if let Ok(er) = resp.json::<ExpoResponse>() {
                    for ticket in er.data {
                        if ticket.status != "ok" {
                            eprintln!("[push] Expo error for {}: {:?}", token, ticket.message);
                        }
                    }
                }
            }
            Err(e) => eprintln!("[push] Failed to send to {}: {}", token, e),
        }
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
        assert_eq!(json["data"]["kind"], "complex_done", "data.kind must be set");
    }
}
