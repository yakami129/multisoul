use super::message_rows::{collect_message_rows, message_select_sql};
use crate::db;
use tempfile::tempdir;

fn seeded_conn() -> rusqlite::Connection {
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("message-rows.db")).unwrap();
    conn.execute(
        "INSERT INTO agents (id, name, project_path, runtime, created_at)
         VALUES ('agent-1', 'Agent One', '/tmp/project', 'claude-code', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations
         (id, agent_id, title, created_at, last_message_at, status)
         VALUES ('conv-1', 'agent-1', 'Deploy', 10, 60, 'completed')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
         VALUES
         ('msg-1', 'conv-1', 'user_text', '{\"text\":\"One\"}', 11, 1),
         ('msg-2', 'conv-1', 'ask_question',
          '{\"ask_id\":\"ask-1\",\"questions\":[{\"id\":\"0\",\"text\":\"Continue?\",\"options\":[{\"id\":\"yes\",\"label\":\"Yes\"}]}]}', 12, 2),
         ('msg-3', 'conv-1', 'agent_text', 'not json', 13, 3),
         ('msg-4', 'conv-1', 'tool_result', '{\"call_id\":\"call-1\",\"ok\":true,\"summary\":\"done\"}', 14, 4),
         ('msg-5', 'conv-1', 'ask_question',
          '{\"ask_id\":\"ask-2\",\"questions\":[{\"id\":\"0\",\"text\":\"Open?\",\"options\":[{\"id\":\"yes\",\"label\":\"Yes\"}]}]}', 15, 5)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ask_answers
         (ask_id, conversation_id, answered_at, choice_id, choice_ids, freeform)
         VALUES ('ask-1', 'conv-1', 20, 'yes', '{\"0\":\"yes\"}', NULL)",
        [],
    )
    .unwrap();
    conn
}

#[test]
fn collect_message_rows_hydrates_ask_answers_and_preserves_raw_shape() {
    let conn = seeded_conn();
    let mut stmt = conn
        .prepare(&message_select_sql(
            "m.conversation_id = ?1",
            "ORDER BY m.seq ASC",
        ))
        .unwrap();
    let rows = collect_message_rows(&mut stmt, ["conv-1"]).unwrap();

    let user = rows.iter().find(|row| row.seq == 1).unwrap();
    let answered = rows.iter().find(|row| row.seq == 2).unwrap();
    let invalid = rows.iter().find(|row| row.seq == 3).unwrap();
    let tool_result = rows.iter().find(|row| row.seq == 4).unwrap();
    let open = rows.iter().find(|row| row.seq == 5).unwrap();

    assert_eq!(
        user.answered, None,
        "non-ask rows must omit ask answer fields"
    );
    assert_eq!(
        answered.answered,
        Some(true),
        "answered ask_question rows must expose persisted answer state"
    );
    assert_eq!(answered.answered_choice_id.as_deref(), Some("yes"));
    assert_eq!(
        answered
            .answered_choice_ids
            .as_ref()
            .and_then(|ids| ids.get("0"))
            .map(String::as_str),
        Some("yes")
    );
    assert_eq!(
        invalid.payload,
        serde_json::Value::Null,
        "invalid JSON payloads must serialize as null to match raw /messages"
    );
    assert_eq!(tool_result.answered, None);
    assert_eq!(
        open.answered,
        Some(false),
        "open ask_question rows must be explicitly unanswered"
    );
}

#[test]
fn collect_message_rows_returns_ascending_windows_for_supported_queries() {
    let conn = seeded_conn();

    let latest_sql = format!(
        "SELECT * FROM ({}) ORDER BY seq ASC",
        message_select_sql("m.conversation_id = ?1", "ORDER BY m.seq DESC LIMIT ?2")
    );
    let latest = {
        let mut stmt = conn.prepare(&latest_sql).unwrap();
        collect_message_rows(&mut stmt, rusqlite::params!["conv-1", 3]).unwrap()
    };
    assert_eq!(seqs(&latest), vec![3, 4, 5]);

    let before_sql = format!(
        "SELECT * FROM ({}) ORDER BY seq ASC",
        message_select_sql(
            "m.conversation_id = ?1 AND m.seq < ?2",
            "ORDER BY m.seq DESC LIMIT ?3",
        )
    );
    let before = {
        let mut stmt = conn.prepare(&before_sql).unwrap();
        collect_message_rows(&mut stmt, rusqlite::params!["conv-1", 5, 2]).unwrap()
    };
    assert_eq!(seqs(&before), vec![3, 4]);

    let since = {
        let mut stmt = conn
            .prepare(&message_select_sql(
                "m.conversation_id = ?1 AND m.seq > ?2",
                "ORDER BY m.seq ASC",
            ))
            .unwrap();
        collect_message_rows(&mut stmt, rusqlite::params!["conv-1", 2]).unwrap()
    };
    assert_eq!(seqs(&since), vec![3, 4, 5]);

    let around = {
        let mut rows = Vec::new();
        let mut before_stmt = conn
            .prepare(&message_select_sql(
                "m.conversation_id = ?1 AND m.seq < ?2",
                "ORDER BY m.seq DESC LIMIT ?3",
            ))
            .unwrap();
        rows.extend(
            collect_message_rows(&mut before_stmt, rusqlite::params!["conv-1", 5, 2]).unwrap(),
        );
        let mut forward_stmt = conn
            .prepare(&message_select_sql(
                "m.conversation_id = ?1 AND m.seq >= ?2",
                "ORDER BY m.seq ASC LIMIT ?3",
            ))
            .unwrap();
        rows.extend(
            collect_message_rows(&mut forward_stmt, rusqlite::params!["conv-1", 5, 2]).unwrap(),
        );
        rows.sort_by_key(|row| row.seq);
        rows
    };
    assert_eq!(seqs(&around), vec![3, 4, 5]);
}

fn seqs(rows: &[super::message_rows::MessageRow]) -> Vec<i64> {
    rows.iter().map(|row| row.seq).collect()
}
