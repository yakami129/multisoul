#[cfg(test)]
mod tests {
    use crate::{
        commands::agent::insert_agent,
        db,
        serve::push::{build_task_status_push, build_task_status_push_payloads},
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
        assert_eq!(push.data["convId"], "conv-1");

        let payloads =
            build_task_status_push_payloads(&conn, "conv-1", "completed", "Build succeeded")
                .unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].to, "ExponentPushToken[abc]");
        assert_eq!(payloads[0].data["endpointId"], "ep-1");
    }
}
