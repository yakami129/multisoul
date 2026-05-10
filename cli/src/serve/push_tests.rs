#[cfg(test)]
mod tests {
    use crate::{
        commands::agent::insert_agent,
        db,
        serve::push::{
            build_ask_question_push, build_task_status_push, build_task_status_push_payloads,
        },
    };
    use tempfile::tempdir;

    #[test]
    fn build_task_status_push_includes_conversation_and_endpoint_data() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "codex", "full-auto").unwrap();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, 'Deploy', 1, 1, 'completed')",
            [&agent_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
             VALUES ('push-1', 'ExponentPushToken[abc]', 'iPhone', 'ep-1', 1)",
            [],
        )
        .unwrap();

        let push = build_task_status_push(&conn, "conv-1", "completed", "Build succeeded")
            .expect("completed conversation should produce a push payload");
        let push = push.expect("completed status should be push-worthy");

        assert_eq!(push.title, "Deploy Bot 任务完成");
        assert_eq!(push.body, "Build succeeded");
        assert_eq!(push.data["type"], "task_completed");
        assert_eq!(push.data["agentId"], agent_id);
        assert_eq!(push.data["agent_id"], agent_id);
        assert_eq!(push.data["convId"], "conv-1");
        assert_eq!(push.data["conversation_id"], "conv-1");

        let payloads =
            build_task_status_push_payloads(&conn, "conv-1", "completed", "Build succeeded")
                .unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].to, "ExponentPushToken[abc]");
        assert_eq!(payloads[0].data["endpointId"], "ep-1");
        assert_eq!(payloads[0].data["endpoint_id"], "ep-1");
    }

    #[test]
    fn build_ask_question_push_includes_pending_question_inbox_data() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "claude", "full-auto").unwrap();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, 'Deploy', 1, 1, 'awaiting_question')",
            [&agent_id],
        )
        .unwrap();

        let ask_payload = serde_json::json!({
            "ask_id": "ask-1",
            "questions": [{
                "id": "0",
                "text": "Deploy now?",
                "options": [{ "id": "0", "label": "Yes" }],
                "multi_select": false
            }],
            "allow_freeform": false
        });

        let push = build_ask_question_push(&conn, "conv-1", &ask_payload)
            .expect("conversation should produce ask push payload");

        assert_eq!(push.title, "Deploy Bot 需要你确认");
        assert_eq!(push.body, "Deploy now?");
        assert_eq!(push.data["type"], "ask_question");
        assert_eq!(push.data["kind"], "pending_question");
        assert_eq!(push.data["inbox_id"], "ask-1");
        assert_eq!(push.data["agentId"], agent_id);
        assert_eq!(push.data["agent_id"], agent_id);
        assert_eq!(push.data["convId"], "conv-1");
        assert_eq!(push.data["conversation_id"], "conv-1");
        assert_eq!(push.data["payload"], ask_payload.to_string());
    }

    #[test]
    fn build_task_status_push_skips_when_question_was_asked_in_same_turn() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "claude", "full-auto").unwrap();
        conn.execute(
            "INSERT INTO conversations (id, agent_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, 'Deploy', 1, 1, 'awaiting_question')",
            [&agent_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES ('msg-user', 'conv-1', 'user_text', '{\"text\":\"deploy\"}', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES ('msg-ask', 'conv-1', 'ask_question', '{\"ask_id\":\"ask-1\"}', 2, 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, payload, created_at, seq)
             VALUES ('msg-answer', 'conv-1', 'tool_result', '{\"call_id\":\"ask-1\"}', 3, 3)",
            [],
        )
        .unwrap();

        let push = build_task_status_push(&conn, "conv-1", "completed", "Build succeeded")
            .expect("query should succeed");

        assert!(
            push.is_none(),
            "completion push must not compete with a pending ask_question push"
        );
    }
}
