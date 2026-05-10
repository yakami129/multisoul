// fix-bug-bot/src/protocol.rs
use serde::{Deserialize, Serialize};

/// msctl → fix-bug-bot（stdin 每行一个 JSON）
#[derive(Debug, Deserialize)]
pub struct TaskMessage {
    pub protocol_version: String,
    pub task_id: String,
    pub conversation_id: String,
    pub event: String,
    pub payload: serde_json::Value,
}

/// fix-bug-bot → msctl（stdout 每行一个 JSON）
#[derive(Debug, Serialize)]
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
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Error {
        task_id: String,
        conversation_id: String,
        code: String,
        message: String,
    },
}

impl AgentEvent {
    /// 将事件序列化为 NDJSON 行并写入 stdout
    pub fn emit(&self) {
        if let Ok(line) = serde_json::to_string(self) {
            println!("{}", line);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TaskMessage 反序列化包含所有必要字段
    ///
    /// 数据构造：msctl 发来的 NDJSON 行
    /// 预期：protocol_version="1", event="feishu.issue.updated"
    #[test]
    fn test_task_message_deserializes() {
        let json = r#"{"protocol_version":"1","task_id":"t1","conversation_id":"c1","event":"feishu.issue.updated","payload":{"k":"v"}}"#;
        let msg: TaskMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.protocol_version, "1", "protocol_version must be 1");
        assert_eq!(msg.event, "feishu.issue.updated", "event must match");
        assert_eq!(msg.task_id, "t1", "task_id must match");
    }

    /// AgentEvent::Progress 序列化包含 type 字段
    ///
    /// 预期：JSON 包含 "type":"progress"
    #[test]
    fn test_agent_event_progress_serializes() {
        let ev = AgentEvent::Progress {
            task_id: "t1".to_string(),
            conversation_id: "c1".to_string(),
            message: "analyzing".to_string(),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("\"type\":\"progress\""), "must have type=progress");
        assert!(json.contains("\"message\":\"analyzing\""), "must have message");
    }
}
