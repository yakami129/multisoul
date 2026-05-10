//! echo-agent: msctl plugin agent 协议验收用参考实现
//!
//! 协议：
//!   stdin  — 每行一个 JSON，格式为 TaskMessage（msctl → agent）
//!   stdout — 每行一个 JSON，格式为 AgentEvent（agent → msctl）
//!   stderr — 自由格式日志（msctl 透传到 serve 日志）
//!
//! 行为：
//!   收到 TaskMessage 后：
//!     1. 输出 progress 事件（"echo-agent received: <event>"）
//!     2. 将 payload 原样回显，输出 result 事件（status: "ok"）
//!   收到 EOF 后退出（exit 0）

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

// ── 协议类型（与 cli/src/serve/plugin/protocol.rs 保持一致）──────────────

#[derive(Debug, Deserialize)]
struct TaskMessage {
    task_id: String,
    conversation_id: String,
    event: String,
    payload: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AgentEvent {
    Progress {
        task_id: String,
        conversation_id: String,
        message: String,
    },
    Result {
        task_id: String,
        conversation_id: String,
        status: String,
        data: serde_json::Value,
    },
    Error {
        task_id: String,
        conversation_id: String,
        code: String,
        message: String,
    },
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    eprintln!("[echo-agent] started, waiting for tasks on stdin");

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => l,
            Err(e) => {
                eprintln!("[echo-agent] stdin read error: {}", e);
                break;
            }
        };

        let msg: TaskMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[echo-agent] parse error: {} — line: {}", e, line);
                continue;
            }
        };

        eprintln!(
            "[echo-agent] task={} conv={} event={}",
            msg.task_id, msg.conversation_id, msg.event
        );

        // 1. progress
        emit(
            &mut out,
            &AgentEvent::Progress {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                message: format!("echo-agent received: {}", msg.event),
            },
        );

        // 2. result — echo payload back
        emit(
            &mut out,
            &AgentEvent::Result {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                status: "ok".to_string(),
                data: serde_json::json!({
                    "echo": msg.payload,
                    "event": msg.event,
                }),
            },
        );
    }

    eprintln!("[echo-agent] stdin closed, exiting");
}

fn emit(out: &mut impl Write, event: &AgentEvent) {
    if let Ok(json) = serde_json::to_string(event) {
        let _ = writeln!(out, "{}", json);
        let _ = out.flush();
    }
}
