mod config;
mod db;
mod protocol;
mod claude;
mod gitlab;
mod feishu;
mod worktree;
mod pipeline;

use protocol::{AgentEvent, TaskMessage};
use std::io::BufRead;

fn main() {
    eprintln!("[fix-bug-bot] starting, reading from stdin");
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(l) if l.trim().is_empty() => continue,
            Ok(l) => {
                match serde_json::from_str::<TaskMessage>(&l) {
                    Ok(msg) => dispatch_event(&msg),
                    Err(e) => eprintln!("[fix-bug-bot] parse error: {} — line: {}", e, l),
                }
            }
            Err(e) => {
                eprintln!("[fix-bug-bot] stdin read error: {}", e);
                break;
            }
        }
    }
    eprintln!("[fix-bug-bot] stdin closed, exiting");
}

pub fn dispatch_event(msg: &TaskMessage) {
    match msg.event.as_str() {
        "feishu.issue.updated" => handle_feishu_issue(msg),
        "gitlab.merge_request_hook" => handle_gitlab_mr(msg),
        other => eprintln!("[fix-bug-bot] unknown event: {}", other),
    }
}

fn handle_feishu_issue(msg: &TaskMessage) {
    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: "received feishu.issue.updated, starting pipeline".to_string(),
    }.emit();

    let cfg = match config::Config::load() {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "config_error".to_string(),
                message: format!("Failed to load config: {}", e),
            }.emit();
            return;
        }
    };

    let db_path = match config::db_path() {
        Ok(p) => p,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "db_error".to_string(),
                message: format!("Failed to get db path: {}", e),
            }.emit();
            return;
        }
    };
    let conn = match db::open_at(&db_path) {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "db_error".to_string(),
                message: format!("Failed to open db: {}", e),
            }.emit();
            return;
        }
    };

    let ctx = match pipeline::intake::extract_issue_context(&msg.payload) {
        Ok(c) => c,
        Err(e) => {
            AgentEvent::Error {
                task_id: msg.task_id.clone(),
                conversation_id: msg.conversation_id.clone(),
                code: "payload_error".to_string(),
                message: format!("Failed to extract issue context: {}", e),
            }.emit();
            return;
        }
    };

    let existing = db::find_by_feishu_id(&conn, &ctx.title).ok().flatten();
    if let Some(ref task) = existing {
        match pipeline::idempotency_check(&task.status) {
            pipeline::IdempotencyAction::Skip => {
                AgentEvent::Result {
                    task_id: msg.task_id.clone(),
                    conversation_id: msg.conversation_id.clone(),
                    status: "skipped".to_string(),
                    data: None,
                    error: None,
                }.emit();
                return;
            }
            pipeline::IdempotencyAction::Reprocess => {
                eprintln!("[fix-bug-bot] reprocessing blocked task: {}", task.id);
            }
            pipeline::IdempotencyAction::Process => {}
        }
    }

    let task_id = if let Some(ref task) = existing {
        task.id.clone()
    } else {
        match db::insert_bug_task(&conn, &ctx.title) {
            Ok(id) => id,
            Err(e) => {
                AgentEvent::Error {
                    task_id: msg.task_id.clone(),
                    conversation_id: msg.conversation_id.clone(),
                    code: "db_error".to_string(),
                    message: format!("Failed to insert bug task: {}", e),
                }.emit();
                return;
            }
        }
    };

    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: format!("bug_task_id={} status=analyzing", task_id),
    }.emit();

    let _ = cfg;
    eprintln!("[fix-bug-bot] pipeline started for bug_task={}", task_id);
}

fn handle_gitlab_mr(msg: &TaskMessage) {
    let action = msg.payload
        .pointer("/object_attributes/action")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    AgentEvent::Progress {
        task_id: msg.task_id.clone(),
        conversation_id: msg.conversation_id.clone(),
        message: format!("gitlab MR event action={}", action),
    }.emit();

    if action == "merge" || action == "close" {
        let source_branch = msg.payload
            .pointer("/object_attributes/source_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        eprintln!("[fix-bug-bot] MR {} on branch {}, cleanup pending", action, source_branch);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// dispatch 对未知事件类型不 panic
    #[test]
    fn test_dispatch_unknown_event_is_safe() {
        let msg = TaskMessage {
            protocol_version: "1".to_string(),
            task_id: "t1".to_string(),
            conversation_id: "c1".to_string(),
            event: "unknown.event".to_string(),
            payload: serde_json::json!({}),
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dispatch_event(&msg);
        }));
        assert!(result.is_ok(), "unknown event must not panic");
    }
}
