//! Interactive tool abstraction.
//!
//! When Claude calls an interactive tool (e.g. AskUserQuestion), the runtime:
//!   1. Emits an `ask_question` WS message instead of `tool_call`
//!   2. Blocks waiting for the user's answer via an `answer_rx` channel
//!   3. Writes a `tool_result` back to Claude's stdin
//!
//! To add a new interactive tool, implement `InteractiveTool` and register it
//! in `is_interactive` / `dispatch` below.

use serde_json::Value;
use std::collections::HashMap;

// ─── Answer payload (sent from WS handler → session_worker) ──────────────────

#[derive(Debug)]
pub struct AnswerPayload {
    pub ask_id:     String,
    pub choice_id:  Option<String>,
    pub choice_ids: Option<HashMap<String, String>>,  // multi-question: questionId → optionId
    pub freeform:   Option<String>,
}

// ─── Trait ────────────────────────────────────────────────────────────────────

pub trait InteractiveTool {
    /// The exact tool name Claude emits in the `tool_use` event.
    const TOOL_NAME: &'static str;

    /// Build the `ask_question` message payload broadcast to mobile.
    /// `call_id` is the Claude tool call id (used as `ask_id`).
    fn build_ask_payload(call_id: &str, args: &Value) -> Value;

    /// Convert the user's answer into the string content for Claude's `tool_result`.
    fn format_tool_result(args: &Value, answer: &AnswerPayload) -> String;
}

// ─── AskUserQuestion ──────────────────────────────────────────────────────────

pub struct AskUserQuestion;

impl InteractiveTool for AskUserQuestion {
    const TOOL_NAME: &'static str = "AskUserQuestion";

    fn build_ask_payload(call_id: &str, args: &Value) -> Value {
        // Claude Code emits:
        // { "questions": [{ "question": "...", "header": "...", "multiSelect": false,
        //                   "options": [{"label": "...", "description": "..."}, ...] }] }
        // We normalize ALL questions to mobile's AskQuestionPayload.
        let questions: Vec<Value> = args["questions"]
            .as_array()
            .map(|arr| {
                arr.iter().enumerate().map(|(qi, q)| {
                    let text = q["question"].as_str().unwrap_or("").to_string();
                    // Options have no id — use array index as id
                    let options: Vec<Value> = q["options"]
                        .as_array()
                        .map(|opts| {
                            opts.iter().enumerate().map(|(oi, opt)| {
                                let label = opt["label"].as_str().unwrap_or_default().to_string();
                                serde_json::json!({ "id": oi.to_string(), "label": label })
                            }).collect()
                        })
                        .unwrap_or_default();
                    serde_json::json!({ "id": qi.to_string(), "text": text, "options": options })
                }).collect()
            })
            .unwrap_or_default();

        serde_json::json!({
            "ask_id":         call_id,
            "questions":      questions,
            "allow_freeform": false,
        })
    }

    fn format_tool_result(args: &Value, answer: &AnswerPayload) -> String {
        if let Some(freeform) = &answer.freeform {
            if !freeform.is_empty() {
                return freeform.clone();
            }
        }

        // Multi-question case: choice_ids is {"questionIdx": "optionIdx", ...}
        if let Some(choice_ids) = &answer.choice_ids {
            if choice_ids.is_empty() {
                return "__cancelled__".to_string();
            }
            let mut indices: Vec<usize> = choice_ids.keys()
                .filter_map(|k| k.parse::<usize>().ok())
                .collect();
            indices.sort_unstable();
            let labels: Vec<String> = indices.iter().map(|&qi| {
                let opt_id_str = match choice_ids.get(&qi.to_string()) {
                    Some(s) => s.as_str(),
                    None    => return format!("Q{}: (no answer)", qi + 1),
                };
                if let Ok(oi) = opt_id_str.parse::<usize>() {
                    if let Some(label) = args["questions"][qi]["options"][oi]["label"].as_str() {
                        return format!("Q{}: {}", qi + 1, label);
                    }
                }
                format!("Q{}: {}", qi + 1, opt_id_str)
            }).collect();
            return labels.join("\n");
        }

        // Single-question case: choice_id is the option index string ("0", "1", …)
        if let Some(choice_id) = &answer.choice_id {
            if choice_id == "__cancelled__" {
                return "__cancelled__".to_string();
            }
            if let Ok(idx) = choice_id.parse::<usize>() {
                if let Some(label) = args["questions"][0]["options"][idx]["label"].as_str() {
                    return label.to_string();
                }
            }
            return choice_id.clone();
        }

        "__cancelled__".to_string()
    }
}

// ─── Dispatch helpers (extend here when adding new interactive tools) ─────────

/// Returns true if this tool_use event requires interactive handling.
pub fn is_interactive(tool_name: &str) -> bool {
    tool_name == AskUserQuestion::TOOL_NAME
}

/// Build the `ask_question` payload for any interactive tool.
/// Returns `None` if the tool is not recognized.
pub fn build_ask_payload(tool_name: &str, call_id: &str, args: &Value) -> Option<Value> {
    match tool_name {
        AskUserQuestion::TOOL_NAME => Some(AskUserQuestion::build_ask_payload(call_id, args)),
        _ => None,
    }
}

/// Format the tool_result content for any interactive tool.
/// Returns `None` if the tool is not recognized.
pub fn format_tool_result(tool_name: &str, args: &Value, answer: &AnswerPayload) -> Option<String> {
    match tool_name {
        AskUserQuestion::TOOL_NAME => Some(AskUserQuestion::format_tool_result(args, answer)),
        _ => None,
    }
}
