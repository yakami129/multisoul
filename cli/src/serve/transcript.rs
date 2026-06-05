use crate::serve::message_rows::MessageRow;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TranscriptPage {
    pub conversation_id: String,
    pub status: String,
    pub items: Vec<TranscriptItem>,
    pub page_info: TranscriptPageInfo,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TranscriptPageInfo {
    pub oldest_turn_id: Option<String>,
    pub has_older: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum TranscriptItem {
    #[serde(rename = "prelude_raw")]
    PreludeRaw { messages: Vec<MessageRow> },
    #[serde(rename = "turn_summary")]
    TurnSummary {
        #[serde(flatten)]
        summary: TurnSummary,
    },
    #[serde(rename = "current_turn_raw")]
    CurrentTurnRaw {
        #[serde(flatten)]
        current: CurrentTurnRaw,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct TurnSummary {
    pub turn_id: String,
    pub start_seq: i64,
    pub end_seq: i64,
    pub user: MessageRow,
    pub worked: Option<WorkedSummary>,
    pub asks: Vec<MessageRow>,
    pub final_agent: Option<MessageRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct WorkedSummary {
    pub id: String,
    pub label: String,
    pub duration_ms: i64,
    pub hidden_count: usize,
    pub first_hidden_seq: i64,
    pub last_hidden_seq: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct CurrentTurnRaw {
    pub turn_id: String,
    pub start_seq: i64,
    pub messages: Vec<MessageRow>,
}

struct Turn {
    id: String,
    user_seq: i64,
    messages: Vec<MessageRow>,
}

pub fn build_transcript_page(
    conversation_id: &str,
    status: &str,
    messages: Vec<MessageRow>,
    limit: usize,
    before_turn: Option<&str>,
    around_ask_id: Option<&str>,
) -> TranscriptPage {
    let (prelude, turns) = split_turns(messages);
    let limit = limit.clamp(1, 50);
    let Some((start, end)) = selected_turn_range(&turns, limit, before_turn, around_ask_id) else {
        return TranscriptPage {
            conversation_id: conversation_id.to_string(),
            status: status.to_string(),
            items: Vec::new(),
            page_info: TranscriptPageInfo {
                oldest_turn_id: None,
                has_older: false,
            },
        };
    };

    let mut items = Vec::new();
    if start == 0 && !prelude.is_empty() {
        items.push(TranscriptItem::PreludeRaw { messages: prelude });
    }

    let latest_index = turns.len().saturating_sub(1);
    for index in start..end {
        let turn = &turns[index];
        if is_current_raw_status(status) && index == latest_index {
            items.push(TranscriptItem::CurrentTurnRaw {
                current: CurrentTurnRaw {
                    turn_id: turn.id.clone(),
                    start_seq: turn.user_seq,
                    messages: turn.messages.clone(),
                },
            });
        } else {
            items.push(TranscriptItem::TurnSummary {
                summary: summarize_turn(turn),
            });
        }
    }

    TranscriptPage {
        conversation_id: conversation_id.to_string(),
        status: status.to_string(),
        items,
        page_info: TranscriptPageInfo {
            oldest_turn_id: turns.get(start).map(|turn| turn.id.clone()),
            has_older: start > 0,
        },
    }
}

pub fn hidden_messages_for_turn(messages: Vec<MessageRow>, turn_id: &str) -> Vec<MessageRow> {
    let (_prelude, turns) = split_turns(messages);
    let Some(turn) = turns.iter().find(|turn| turn.id == turn_id) else {
        return Vec::new();
    };
    hidden_messages_in_turn(turn)
}

pub fn has_turn(messages: &[MessageRow], turn_id: &str) -> bool {
    let Some(user_seq) = parse_turn_seq(turn_id) else {
        return false;
    };
    messages
        .iter()
        .any(|message| message.role == "user_text" && message.seq == user_seq)
}

fn selected_turn_range(
    turns: &[Turn],
    limit: usize,
    before_turn: Option<&str>,
    around_ask_id: Option<&str>,
) -> Option<(usize, usize)> {
    if turns.is_empty() {
        return None;
    }
    if let Some(ask_id) = around_ask_id {
        let target = turns.iter().position(|turn| turn_has_ask(turn, ask_id))?;
        let before_count = limit / 2;
        let mut start = target.saturating_sub(before_count);
        let mut end = (start + limit).min(turns.len());
        if target >= end {
            end = target + 1;
            start = end.saturating_sub(limit);
        }
        return Some((start, end));
    }

    let end = before_turn
        .and_then(parse_turn_seq)
        .and_then(|seq| turns.iter().position(|turn| turn.user_seq == seq))
        .unwrap_or(turns.len());
    if end == 0 {
        return None;
    }
    Some((end.saturating_sub(limit), end))
}

fn summarize_turn(turn: &Turn) -> TurnSummary {
    let user = turn.messages[0].clone();
    let asks = turn
        .messages
        .iter()
        .filter(|message| message.role == "ask_question")
        .cloned()
        .collect::<Vec<_>>();
    let final_agent = turn
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "agent_text")
        .cloned();
    let hidden = primary_hidden_messages(turn);
    let worked = worked_summary(turn.user_seq, &hidden);
    TurnSummary {
        turn_id: turn.id.clone(),
        start_seq: turn
            .messages
            .first()
            .map(|message| message.seq)
            .unwrap_or(0),
        end_seq: turn.messages.last().map(|message| message.seq).unwrap_or(0),
        user,
        worked,
        asks,
        final_agent,
    }
}

fn split_turns(mut messages: Vec<MessageRow>) -> (Vec<MessageRow>, Vec<Turn>) {
    messages.sort_by_key(|message| message.seq);
    let mut prelude = Vec::new();
    let mut turns = Vec::new();
    let mut current: Vec<MessageRow> = Vec::new();

    for message in messages {
        if message.role == "user_text" {
            push_turn(&mut turns, &mut current);
            current.push(message);
        } else if current.is_empty() {
            prelude.push(message);
        } else {
            current.push(message);
        }
    }
    push_turn(&mut turns, &mut current);
    (prelude, turns)
}

fn push_turn(turns: &mut Vec<Turn>, current: &mut Vec<MessageRow>) {
    if current.is_empty() {
        return;
    }
    let user_seq = current[0].seq;
    turns.push(Turn {
        id: turn_id(user_seq),
        user_seq,
        messages: std::mem::take(current),
    });
}

fn hidden_messages_in_turn(turn: &Turn) -> Vec<MessageRow> {
    let primary_hidden = primary_hidden_messages(turn);
    let hidden_call_ids = primary_hidden
        .iter()
        .filter(|message| message.role == "tool_call")
        .filter_map(call_id)
        .collect::<HashSet<_>>();
    let mut hidden_seqs = primary_hidden
        .iter()
        .map(|message| message.seq)
        .collect::<HashSet<_>>();
    let mut rows = primary_hidden;

    for message in &turn.messages {
        if message.role != "tool_result" {
            continue;
        }
        let Some(call_id) = call_id(message) else {
            continue;
        };
        if hidden_call_ids.contains(&call_id) && hidden_seqs.insert(message.seq) {
            rows.push(message.clone());
        }
    }

    rows.sort_by_key(|message| message.seq);
    rows
}

fn primary_hidden_messages(turn: &Turn) -> Vec<MessageRow> {
    let visible = visible_summary_seqs(turn);
    turn.messages
        .iter()
        .filter(|message| !visible.contains(&message.seq) && message.role != "tool_result")
        .cloned()
        .collect()
}

fn visible_summary_seqs(turn: &Turn) -> HashSet<i64> {
    let mut visible = HashSet::from([turn.user_seq]);
    for message in &turn.messages {
        if message.role == "ask_question" {
            visible.insert(message.seq);
        }
    }
    if let Some(final_agent) = turn
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "agent_text")
    {
        visible.insert(final_agent.seq);
    }
    visible
}

fn worked_summary(user_seq: i64, hidden: &[MessageRow]) -> Option<WorkedSummary> {
    if hidden.is_empty() {
        return None;
    }
    let first_hidden_seq = hidden
        .first()
        .map(|message| message.seq)
        .unwrap_or(user_seq);
    let last_hidden_seq = hidden.last().map(|message| message.seq).unwrap_or(user_seq);
    let earliest = hidden
        .iter()
        .map(|message| message.created_at)
        .min()
        .unwrap_or(0);
    let latest = hidden
        .iter()
        .map(|message| message.created_at)
        .max()
        .unwrap_or(earliest);
    let duration_ms = (latest - earliest).max(0);
    Some(WorkedSummary {
        id: format!("worked-turn-{user_seq}"),
        label: format_worked_label(duration_ms),
        duration_ms,
        hidden_count: hidden.len(),
        first_hidden_seq,
        last_hidden_seq,
    })
}

fn format_worked_label(duration_ms: i64) -> String {
    let duration_seconds = (duration_ms as f64 / 1000.0).round().max(1.0) as i64;
    let minutes = duration_seconds / 60;
    let seconds = duration_seconds % 60;
    let duration = if minutes > 0 && seconds > 0 {
        format!("{minutes}m {seconds}s")
    } else if minutes > 0 {
        format!("{minutes}m")
    } else {
        format!("{seconds}s")
    };
    format!("Worked for {duration}")
}

fn turn_has_ask(turn: &Turn, ask_id: &str) -> bool {
    turn.messages.iter().any(|message| {
        message.role == "ask_question"
            && message
                .payload
                .get("ask_id")
                .and_then(serde_json::Value::as_str)
                == Some(ask_id)
    })
}

fn call_id(message: &MessageRow) -> Option<String> {
    message
        .payload
        .get("call_id")
        .and_then(serde_json::Value::as_str)
        .filter(|call_id| !call_id.is_empty())
        .map(ToString::to_string)
}

fn turn_id(user_seq: i64) -> String {
    format!("turn-{user_seq}")
}

fn parse_turn_seq(turn_id: &str) -> Option<i64> {
    turn_id
        .strip_prefix("turn-")
        .and_then(|seq| seq.parse::<i64>().ok())
}

fn is_current_raw_status(status: &str) -> bool {
    matches!(status, "running" | "awaiting_question" | "failed")
}
