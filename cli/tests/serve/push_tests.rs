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

    fn agent_project_id(conn: &rusqlite::Connection, agent_id: &str) -> String {
        conn.query_row(
            "SELECT project_id FROM agents WHERE id = ?1",
            [agent_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
    }

    #[test]
    fn build_task_status_push_includes_conversation_and_endpoint_data() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "codex", "full-auto").unwrap();
        let project_id = agent_project_id(&conn, &agent_id);
        conn.execute(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, ?2, 'Deploy', 1, 1, 'completed')",
            [&agent_id, &project_id],
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

        assert_eq!(push.title, "p 任务完成");
        assert_eq!(push.body, "Build succeeded");
        assert_eq!(push.data["type"], "task_completed");
        assert_eq!(push.data["agentId"], agent_id);
        assert_eq!(push.data["agent_id"], agent_id);
        assert_eq!(push.data["resourceId"], agent_id);
        assert_eq!(push.data["resource_id"], agent_id);
        assert_eq!(push.data["resourceName"], "Deploy Bot");
        assert_eq!(push.data["resource_name"], "Deploy Bot");
        assert_eq!(push.data["projectId"], project_id);
        assert_eq!(push.data["project_id"], project_id);
        assert_eq!(push.data["projectName"], "p");
        assert_eq!(push.data["project_name"], "p");
        assert_eq!(push.data["projectPath"], "/p");
        assert_eq!(push.data["project_path"], "/p");
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

    /// 同一台 iPhone 在同一个 CLI 中有 3 条 endpoint 注册时，任务完成只能发 1 条手机通知。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   push-1 = ExponentPushToken[abc] + ep-1
    ///   push-2 = ExponentPushToken[abc] + ep-2
    ///   push-3 = ExponentPushToken[abc] + ep-3
    ///   唯一 Expo token 数 = 1，因此预期 payload 数 = 1
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 创建一个 completed conversation → completion push 是可发送状态
    ///   2. 插入 3 条相同 expo_push_token、不同 endpoint_id 的 push_tokens 行
    ///   3. 调用 build_task_status_push_payloads → 应按 expo_push_token 去重
    ///
    /// 预期结果：
    ///   - 正断言：只生成 1 个 payload，同一手机只收到 1 条通知
    ///   - 正断言：payload 目标 token 是 ExponentPushToken[abc]
    ///   - 负断言：不能生成 3 个 payload，否则同一手机会收到 3 条通知
    #[test]
    fn build_task_status_push_dedupes_same_expo_token_across_endpoints() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "codex", "full-auto").unwrap();
        let project_id = agent_project_id(&conn, &agent_id);
        conn.execute(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, ?2, 'Deploy', 1, 1, 'completed')",
            [&agent_id, &project_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
             VALUES ('push-1', 'ExponentPushToken[abc]', 'iPhone', 'ep-1', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
             VALUES ('push-2', 'ExponentPushToken[abc]', 'iPhone', 'ep-2', 2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO push_tokens (id, expo_push_token, device_label, endpoint_id, registered_at)
             VALUES ('push-3', 'ExponentPushToken[abc]', 'iPhone', 'ep-3', 3)",
            [],
        )
        .unwrap();

        let payloads =
            build_task_status_push_payloads(&conn, "conv-1", "completed", "Build succeeded")
                .unwrap();

        assert_eq!(
            payloads.len(),
            1,
            "same Expo token registered under multiple endpoint_ids must produce one push payload"
        );
        assert_eq!(
            payloads[0].to, "ExponentPushToken[abc]",
            "deduped payload must target the registered iPhone token"
        );
        assert_ne!(
            payloads.len(),
            3,
            "three payloads would reproduce the triple iOS notifications bug"
        );
    }

    #[test]
    fn build_ask_question_push_includes_pending_question_inbox_data() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "claude", "full-auto").unwrap();
        let project_id = agent_project_id(&conn, &agent_id);
        conn.execute(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, ?2, 'Deploy', 1, 1, 'awaiting_question')",
            [&agent_id, &project_id],
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

        assert_eq!(push.title, "p 需要你确认");
        assert_eq!(push.body, "Deploy now?");
        assert_eq!(push.data["type"], "ask_question");
        assert_eq!(push.data["kind"], "pending_question");
        assert_eq!(push.data["inbox_id"], "ask-1");
        assert_eq!(push.data["agentId"], agent_id);
        assert_eq!(push.data["agent_id"], agent_id);
        assert_eq!(push.data["resourceId"], agent_id);
        assert_eq!(push.data["resource_id"], agent_id);
        assert_eq!(push.data["projectId"], project_id);
        assert_eq!(push.data["project_id"], project_id);
        assert_eq!(push.data["convId"], "conv-1");
        assert_eq!(push.data["conversation_id"], "conv-1");
        assert_eq!(push.data["payload"], ask_payload.to_string());
    }

    #[test]
    fn build_task_status_push_skips_when_question_was_asked_in_same_turn() {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let agent_id = insert_agent(&conn, "Deploy Bot", "/p", "claude", "full-auto").unwrap();
        let project_id = agent_project_id(&conn, &agent_id);
        conn.execute(
            "INSERT INTO conversations (id, agent_id, project_id, title, created_at, last_message_at, status)
             VALUES ('conv-1', ?1, ?2, 'Deploy', 1, 1, 'awaiting_question')",
            [&agent_id, &project_id],
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
