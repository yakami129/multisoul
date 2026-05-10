use serde::{Deserialize, Serialize};

/// msctl → agent（stdin 每行一个 JSON）
#[derive(Debug, Serialize)]
pub struct TaskMessage {
    pub protocol_version: String,
    pub task_id: String,
    pub conversation_id: String,
    pub event: String,
    pub payload: serde_json::Value,
}

impl TaskMessage {
    pub fn new(
        task_id: &str,
        conversation_id: &str,
        event: &str,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            protocol_version: "1".to_string(),
            task_id: task_id.to_string(),
            conversation_id: conversation_id.to_string(),
            event: event.to_string(),
            payload,
        }
    }
}

/// agent → msctl（stdout 每行一个 JSON）
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Progress {
        task_id: String,
        conversation_id: String,
        message: String,
    },
    Result {
        task_id: String,
        conversation_id: String,
        status: String,
        #[serde(default)]
        data: Option<serde_json::Value>,
        #[serde(default)]
        error: Option<String>,
    },
    Error {
        task_id: String,
        conversation_id: String,
        code: String,
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TaskMessage 序列化包含所有必要字段
    ///
    /// 预期：JSON 包含 protocol_version, task_id, conversation_id, event, payload
    #[test]
    fn test_task_message_serializes_all_fields() {
        let msg = TaskMessage::new(
            "t1",
            "c1",
            "feishu.issue.updated",
            serde_json::json!({"k": "v"}),
        );
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            json.contains("\"protocol_version\":\"1\""),
            "must have protocol_version"
        );
        assert!(json.contains("\"task_id\":\"t1\""), "must have task_id");
        assert!(
            json.contains("\"conversation_id\":\"c1\""),
            "must have conversation_id"
        );
        assert!(
            json.contains("\"event\":\"feishu.issue.updated\""),
            "must have event"
        );
    }

    /// AgentEvent::Progress 反序列化正确
    ///
    /// 预期：type=progress 解析为 AgentEvent::Progress，message 字段正确
    #[test]
    fn test_agent_event_progress_deserializes() {
        let json =
            r#"{"type":"progress","task_id":"t1","conversation_id":"c1","message":"analyzing"}"#;
        let event: AgentEvent = serde_json::from_str(json).unwrap();
        match event {
            AgentEvent::Progress { message, .. } => {
                assert_eq!(message, "analyzing", "message should match");
            }
            _ => panic!("expected Progress variant"),
        }
    }
}
