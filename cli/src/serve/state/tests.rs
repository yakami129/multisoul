use super::*;
use tempfile::tempdir;

/// AppState::new accepts uploads_dir and stores it correctly.
///
/// 执行：构造 AppState，验证 uploads_dir 字段被保留。
///
/// 预期结果：
///   - uploads_dir 与传入路径相同
#[test]
fn test_app_state_stores_uploads_dir() {
    use crate::db;
    let dir = tempdir().unwrap();
    let uploads_dir = dir.path().join("uploads");
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    let state = AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        uploads_dir.clone(),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    );
    assert_eq!(
        state.uploads_dir, uploads_dir,
        "uploads_dir should be stored in AppState"
    );
}

/// SessionMessage carries user_text, file_id, model_id, and seq.
///
/// 数据构造（含关键数值的推导过程）：
///   user_text = "hello"（用户输入）
///   file_id   = Some("abc.jpg")（上传图片 id）
///   model_id  = Some("claude-sonnet-4-6")（conversation 级模型选择）
///   seq       = 1（用户消息入库后的消息序号）
///
/// 执行过程：
///   1. 构造带图片和模型的 SessionMessage
///   2. 构造纯文本 Default 模型的 SessionMessage
///
/// 预期结果：
///   - user_text/file_id/model_id/seq 都能正确读取
///   - text_only.model_id 为 None，说明 Default 不会被编码成字符串
#[test]
fn test_session_message_fields() {
    let msg = SessionMessage {
        user_text: "hello".to_string(),
        file_id: Some("abc.jpg".to_string()),
        model_id: Some("claude-sonnet-4-6".to_string()),
        seq: 1,
    };
    assert_eq!(msg.user_text, "hello", "user_text should match");
    assert_eq!(
        msg.file_id.as_deref(),
        Some("abc.jpg"),
        "file_id should match"
    );
    assert_eq!(
        msg.model_id.as_deref(),
        Some("claude-sonnet-4-6"),
        "model_id should match the selected runtime model"
    );

    let text_only = SessionMessage {
        user_text: "text only".to_string(),
        file_id: None,
        model_id: None,
        seq: 2,
    };
    assert!(
        text_only.file_id.is_none(),
        "file_id should be None for text-only"
    );
    assert!(
        text_only.model_id.is_none(),
        "model_id should be None for Default model selection"
    );
    assert_eq!(
        text_only.seq, 2,
        "seq should carry the user_text message seq"
    );
}

/// Helper: build a minimal AppState backed by a temp DB.
fn make_state() -> AppState {
    use crate::db;
    let dir = tempdir().unwrap();
    let conn = db::open_at(&dir.path().join("t.db")).unwrap();
    AppState::new(
        conn,
        "ms_v2_tok".to_string(),
        dir.path().join("uploads"),
        crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
            db::open_at(&dir.path().join("pm.db")).unwrap(),
        ))),
    )
}

fn make_payload(ask_id: &str) -> crate::serve::interactive::AnswerPayload {
    crate::serve::interactive::AnswerPayload {
        _ask_id: ask_id.to_string(),
        choice_id: Some("opt1".to_string()),
        choice_ids: None,
        freeform: None,
    }
}

/// Runtime ask 进行中时，UserMessage ask 的回答不会干扰 Runtime channel。
///
/// 执行过程：
///   1. 创建 AnswerChannel，注册为 Runtime 模式（ask_id = "ask-runtime"）
///   2. 向同一 conv_id 发送 answer，_ask_id = "ask-runtime"
///   3. pending_mode 是 Runtime，所以通道接受（Accepted）
///   4. 另构造一个 _ask_id = "ask-user" 来模拟 UserMessage 回答尝试
///      实际上在此路径下会 AskMismatch，而非 WrongMode；但验证
///      WrongMode 场景需要把 mode 设为 UserMessage 后再回答。
///
/// 专项：当 channel 处于 UserMessage 模式，send_answer 应返回 WrongMode { UserMessage }。
///
/// 预期结果：
///   - Runtime 模式回答正确的 ask_id → Accepted
///   - UserMessage 模式回答正确的 ask_id → WrongMode { actual_mode: UserMessage }
#[test]
fn test_send_answer_wrong_mode_user_message() {
    let state = make_state();
    let conv_id = "conv-abc";

    let rx = state.create_answer_channel(conv_id);

    state.begin_waiting_answer(conv_id, "ask-rt");
    let result = state.send_answer(conv_id, make_payload("ask-rt"));
    assert_eq!(result, AnswerSendResult::Accepted);
    let _ = rx.try_recv().unwrap();

    state.begin_waiting_answer_user_message(conv_id, "ask-um");
    let result = state.send_answer(conv_id, make_payload("ask-um"));
    assert_eq!(
        result,
        AnswerSendResult::WrongMode {
            actual_mode: AnswerMode::UserMessage
        },
        "Runtime send_answer path must return WrongMode when channel is in UserMessage mode"
    );
}

/// UserMessage ask 进行中时，用错误的 ask_id 来回答 → AskMismatch。
///
/// 执行过程：
///   1. 注册 UserMessage ask（ask_id = "ask-um"）
///   2. 用 ask_id = "ask-wrong" 调用 send_answer
///
/// 预期结果：AskMismatch { expected: "ask-um", actual: "ask-wrong" }
#[test]
fn test_send_answer_mismatch_during_user_message_ask() {
    let state = make_state();
    let conv_id = "conv-def";

    let _rx = state.create_answer_channel(conv_id);
    state.begin_waiting_answer_user_message(conv_id, "ask-um");

    let result = state.send_answer(conv_id, make_payload("ask-wrong"));
    assert_eq!(
        result,
        AnswerSendResult::AskMismatch {
            expected: "ask-um".to_string(),
            actual: "ask-wrong".to_string(),
        },
        "Mismatched ask_id should return AskMismatch regardless of mode"
    );
}

/// NoSession 回退：无 AnswerChannel 时 send_answer 返回 NoSession。
///
/// 执行过程：
///   1. 不创建 AnswerChannel，直接 send_answer
///
/// 预期结果：NoSession
#[test]
fn test_send_answer_no_session() {
    let state = make_state();
    let result = state.send_answer("conv-nosession", make_payload("ask-x"));
    assert_eq!(
        result,
        AnswerSendResult::NoSession,
        "send_answer must return NoSession when no AnswerChannel is registered"
    );
}
