//! Interactive tool abstraction.
//!
//! When Claude calls AskUserQuestion, the runtime intercepts the `control_request`
//! (permission prompt), broadcasts `ask_question` to mobile, waits for the user's
//! answer, then responds with `control_response` containing the answers in
//! `updatedInput` — matching the cc-connect reference implementation.
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

}

impl AskUserQuestion {
    /// Build the `updatedInput` for the `control_response` to Claude Code.
    /// This embeds the user's answers into the original tool input so Claude Code
    /// can process them — matching the cc-connect reference implementation.
    pub fn build_updated_input(original_args: &Value, answer: &AnswerPayload) -> Value {
        let mut result = original_args.clone();
        let obj = result.as_object_mut().expect("args must be object");

        // Build answers map: { "questionIdx": "option label" }
        let mut answers = serde_json::Map::new();

        if let Some(freeform) = &answer.freeform {
            if !freeform.is_empty() {
                answers.insert("0".to_string(), serde_json::Value::String(freeform.clone()));
                obj.insert("answers".to_string(), serde_json::Value::Object(answers));
                return result;
            }
        }

        if let Some(choice_ids) = &answer.choice_ids {
            // Multi-question: choice_ids = { "questionIdx": "optionIdx" }
            let mut indices: Vec<usize> = choice_ids.keys()
                .filter_map(|k| k.parse::<usize>().ok())
                .collect();
            indices.sort_unstable();
            for qi in indices {
                let opt_id_str = match choice_ids.get(&qi.to_string()) {
                    Some(s) => s.as_str(),
                    None    => continue,
                };
                let label = if let Ok(oi) = opt_id_str.parse::<usize>() {
                    original_args["questions"][qi]["options"][oi]["label"]
                        .as_str()
                        .unwrap_or(opt_id_str)
                        .to_string()
                } else {
                    opt_id_str.to_string()
                };
                answers.insert(qi.to_string(), serde_json::Value::String(label));
            }
        } else if let Some(choice_id) = &answer.choice_id {
            // Single-question: choice_id = "optionIdx"
            if choice_id != "__cancelled__" {
                let label = if let Ok(idx) = choice_id.parse::<usize>() {
                    original_args["questions"][0]["options"][idx]["label"]
                        .as_str()
                        .unwrap_or(choice_id)
                        .to_string()
                } else {
                    choice_id.clone()
                };
                answers.insert("0".to_string(), serde_json::Value::String(label));
            }
        }

        obj.insert("answers".to_string(), serde_json::Value::Object(answers));
        result
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


/// Build the `updatedInput` for the `control_response` to Claude Code.
/// Returns `None` if the tool is not recognized.
pub fn build_updated_input(tool_name: &str, original_args: &Value, answer: &AnswerPayload) -> Option<Value> {
    match tool_name {
        AskUserQuestion::TOOL_NAME => Some(AskUserQuestion::build_updated_input(original_args, answer)),
        _ => None,
    }
}
