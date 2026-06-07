use super::message_rows::MessageRow;
use super::transcript::{
    build_transcript_page, hidden_messages_for_turn, TranscriptItem, WorkedSummary,
};

#[test]
fn completed_transcript_keeps_prelude_and_summarizes_turn_boundaries() {
    let page = build_transcript_page(
        "conv-1",
        "completed",
        vec![
            row(1, "agent_text", 1, serde_json::json!({ "text": "prelude" })),
            row(2, "user_text", 2, serde_json::json!({ "text": "one" })),
            row(3, "tool_call", 3, tool_call("call-1")),
            row(
                4,
                "agent_text",
                4,
                serde_json::json!({ "text": "done one" }),
            ),
            row(10, "user_text", 10, serde_json::json!({ "text": "two" })),
            row(11, "ask_question", 11, ask("ask-2")),
            row(
                12,
                "agent_text",
                12,
                serde_json::json!({ "text": "done two" }),
            ),
        ],
        20,
        None,
        None,
    );

    assert_eq!(page.page_info.oldest_turn_id.as_deref(), Some("turn-2"));
    assert!(!page.page_info.has_older);
    assert_eq!(page.items.len(), 3);
    assert!(matches!(page.items[0], TranscriptItem::PreludeRaw { .. }));
    assert_eq!(summary_turn_id(&page.items[1]), Some("turn-2"));
    assert_eq!(summary_turn_id(&page.items[2]), Some("turn-10"));
}

#[test]
fn active_statuses_return_latest_turn_raw_and_older_turn_summaries() {
    for status in ["running", "awaiting_question", "failed"] {
        let page = build_transcript_page("conv-1", status, two_simple_turns(), 20, None, None);
        assert_eq!(page.items.len(), 2);
        assert_eq!(summary_turn_id(&page.items[0]), Some("turn-1"));
        match &page.items[1] {
            TranscriptItem::CurrentTurnRaw { current } => {
                assert_eq!(current.turn_id, "turn-10");
                assert_eq!(seqs(&current.messages), vec![10, 11]);
            }
            other => panic!("latest active turn should be raw, got {other:?}"),
        }
    }
}

#[test]
fn transcript_paginates_by_turn_and_can_focus_around_ask() {
    let messages = vec![
        row(10, "user_text", 10, serde_json::json!({ "text": "one" })),
        row(11, "agent_text", 11, serde_json::json!({ "text": "done" })),
        row(20, "user_text", 20, serde_json::json!({ "text": "two" })),
        row(21, "ask_question", 21, ask("ask-focus")),
        row(22, "agent_text", 22, serde_json::json!({ "text": "done" })),
        row(30, "user_text", 30, serde_json::json!({ "text": "three" })),
        row(31, "agent_text", 31, serde_json::json!({ "text": "done" })),
        row(40, "user_text", 40, serde_json::json!({ "text": "four" })),
        row(41, "agent_text", 41, serde_json::json!({ "text": "done" })),
    ];

    let latest = build_transcript_page("conv-1", "completed", messages.clone(), 2, None, None);
    assert_eq!(turn_ids(&latest.items), vec!["turn-30", "turn-40"]);
    assert_eq!(latest.page_info.oldest_turn_id.as_deref(), Some("turn-30"));
    assert!(latest.page_info.has_older);

    let before = build_transcript_page(
        "conv-1",
        "completed",
        messages.clone(),
        2,
        Some("turn-30"),
        None,
    );
    assert_eq!(turn_ids(&before.items), vec!["turn-10", "turn-20"]);
    assert!(!before.page_info.has_older);

    let around = build_transcript_page("conv-1", "completed", messages, 1, None, Some("ask-focus"));
    assert_eq!(turn_ids(&around.items), vec!["turn-20"]);
}

#[test]
fn turn_summary_keeps_visible_rows_and_computes_worked_metadata() {
    let page = build_transcript_page(
        "conv-1",
        "completed",
        vec![
            row(10, "user_text", 0, serde_json::json!({ "text": "ship" })),
            row(
                11,
                "agent_text",
                1_000,
                serde_json::json!({ "text": "working" }),
            ),
            row(12, "tool_call", 2_000, tool_call("call-1")),
            row(13, "ask_question", 3_000, ask("ask-1")),
            row(
                14,
                "task_status",
                4_000,
                serde_json::json!({ "status": "completed" }),
            ),
            row(
                15,
                "agent_text",
                5_000,
                serde_json::json!({ "text": "final" }),
            ),
            row(16, "tool_result", 6_000, tool_result("call-1")),
        ],
        20,
        None,
        None,
    );

    let summary = only_summary(&page.items);
    assert_eq!(summary.user.seq, 10);
    assert_eq!(seqs(&summary.asks), vec![13]);
    assert_eq!(summary.final_agent.as_ref().map(|row| row.seq), Some(15));
    assert_eq!(
        summary.worked,
        Some(WorkedSummary {
            id: "worked-turn-10".to_string(),
            label: "Worked for 3s".to_string(),
            duration_ms: 3_000,
            hidden_count: 3,
            first_hidden_seq: 11,
            last_hidden_seq: 14,
        })
    );
}

#[test]
fn tool_result_alone_does_not_create_worked_metadata() {
    let page = build_transcript_page(
        "conv-1",
        "completed",
        vec![
            row(1, "user_text", 1, serde_json::json!({ "text": "ship" })),
            row(2, "tool_result", 2, tool_result("orphan")),
            row(3, "agent_text", 3, serde_json::json!({ "text": "done" })),
        ],
        20,
        None,
        None,
    );

    assert_eq!(only_summary(&page.items).worked, None);
}

#[test]
fn hidden_messages_for_turn_excludes_visible_rows_and_adds_matching_tool_results() {
    let hidden = hidden_messages_for_turn(
        vec![
            row(
                10,
                "user_text",
                10,
                serde_json::json!({ "text": "turn one" }),
            ),
            row(
                11,
                "agent_text",
                11,
                serde_json::json!({ "text": "progress" }),
            ),
            row(12, "tool_call", 12, tool_call("call-1")),
            row(13, "ask_question", 13, ask("ask-1")),
            row(14, "agent_text", 14, serde_json::json!({ "text": "final" })),
            row(15, "tool_result", 15, tool_result("call-1")),
            row(
                20,
                "user_text",
                20,
                serde_json::json!({ "text": "turn two" }),
            ),
            row(21, "tool_call", 21, tool_call("call-2")),
            row(22, "tool_result", 22, tool_result("call-2")),
        ],
        "turn-10",
    );

    assert_eq!(seqs(&hidden), vec![11, 12, 15]);
}

fn two_simple_turns() -> Vec<MessageRow> {
    vec![
        row(1, "user_text", 1, serde_json::json!({ "text": "one" })),
        row(
            2,
            "agent_text",
            2,
            serde_json::json!({ "text": "done one" }),
        ),
        row(10, "user_text", 10, serde_json::json!({ "text": "two" })),
        row(11, "tool_call", 11, tool_call("call-2")),
    ]
}

fn row(seq: i64, role: &str, created_at: i64, payload: serde_json::Value) -> MessageRow {
    MessageRow {
        id: format!("msg-{seq}"),
        conversation_id: "conv-1".to_string(),
        role: role.to_string(),
        payload,
        created_at,
        seq,
        answered: None,
        answered_choice_id: None,
        answered_choice_ids: None,
    }
}

fn ask(ask_id: &str) -> serde_json::Value {
    serde_json::json!({ "ask_id": ask_id, "questions": [] })
}

fn tool_call(call_id: &str) -> serde_json::Value {
    serde_json::json!({ "call_id": call_id, "tool": "Bash", "args": "pwd" })
}

fn tool_result(call_id: &str) -> serde_json::Value {
    serde_json::json!({ "call_id": call_id, "ok": true, "summary": "done" })
}

fn only_summary(items: &[TranscriptItem]) -> &super::transcript::TurnSummary {
    match &items[0] {
        TranscriptItem::TurnSummary { summary } => summary,
        other => panic!("expected turn summary, got {other:?}"),
    }
}

fn summary_turn_id(item: &TranscriptItem) -> Option<&str> {
    match item {
        TranscriptItem::TurnSummary { summary } => Some(summary.turn_id.as_str()),
        _ => None,
    }
}

fn turn_ids(items: &[TranscriptItem]) -> Vec<&str> {
    items.iter().filter_map(summary_turn_id).collect()
}

fn seqs(rows: &[MessageRow]) -> Vec<i64> {
    rows.iter().map(|row| row.seq).collect()
}
