use crate::serve::interactive::AnswerPayload;
use serde_json::Value;

pub fn is_cancelled_answer(answer: &AnswerPayload) -> bool {
    answer.choice_id.as_deref() == Some("__cancelled__")
        || answer
            .choice_ids
            .as_ref()
            .is_some_and(|ids| ids.values().any(|value| value == "__cancelled__"))
}

pub fn render_answer_markdown(ask_payload: &Value, answer: &AnswerPayload) -> String {
    let questions = ask_payload
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut lines = vec!["用户已回答问题卡片：".to_string(), String::new()];

    for (index, question) in questions.iter().enumerate() {
        let question_id = question
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| index.to_string());
        let question_text = question
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        lines.push(format!("{}. {}", index + 1, question_text));

        let raw_answer = answer_for_question(answer, &question_id, index);
        let (choices, custom_inputs) = classify_answer_parts(question, raw_answer.as_deref());
        if !choices.is_empty() {
            lines.push(format!("   - 选择：{}", choices.join("、")));
        }
        for custom in custom_inputs {
            lines.push(format!("   - 输入：{custom}"));
        }
        if index + 1 < questions.len() {
            lines.push(String::new());
        }
    }

    if let Some(freeform) = answer.freeform.as_ref().map(|value| value.trim()) {
        if !freeform.is_empty() {
            if questions.is_empty() {
                lines.push("1. 补充输入".to_string());
            }
            lines.push(format!("   - 输入：{freeform}"));
        }
    }

    lines.join("\n")
}

fn answer_for_question(answer: &AnswerPayload, question_id: &str, index: usize) -> Option<String> {
    if let Some(choice_ids) = &answer.choice_ids {
        return choice_ids
            .get(question_id)
            .cloned()
            .or_else(|| choice_ids.get(&index.to_string()).cloned());
    }
    if index == 0 {
        answer.choice_id.clone()
    } else {
        None
    }
}

fn classify_answer_parts(question: &Value, raw_answer: Option<&str>) -> (Vec<String>, Vec<String>) {
    let Some(raw_answer) = raw_answer else {
        return (Vec::new(), Vec::new());
    };
    let mut choices = Vec::new();
    let mut custom_inputs = Vec::new();
    for part in raw_answer
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        if part == "__cancelled__" {
            continue;
        }
        if let Some(label) = option_label(question, part) {
            choices.push(label);
        } else {
            custom_inputs.push(part.to_string());
        }
    }
    (choices, custom_inputs)
}

fn option_label(question: &Value, option_id: &str) -> Option<String> {
    question
        .get("options")
        .and_then(Value::as_array)?
        .iter()
        .find(|option| option.get("id").and_then(Value::as_str) == Some(option_id))
        .and_then(|option| option.get("label").and_then(Value::as_str))
        .map(str::to_string)
}
