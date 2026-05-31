use crate::serve::state::AppState;
use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use serde_json::Value;
use tracing::info;
use uuid::Uuid;

#[derive(Debug, serde::Deserialize)]
pub struct AskQuestionRequest {
    pub ask_id: String,
    pub questions: Vec<Value>,
    pub conversation_id: String,
}

#[derive(Debug, serde::Serialize)]
pub struct AskStatusResponse {
    pub ask_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn post_ask_question(
    State(state): State<AppState>,
    Json(req): Json<AskQuestionRequest>,
) -> impl IntoResponse {
    if req.conversation_id.trim().is_empty() || req.questions.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(AskStatusResponse {
                ask_id: req.ask_id,
                status: "error".to_string(),
                error: Some("invalid_request".to_string()),
            }),
        );
    }

    let ask_id = resolve_ask_id(req.ask_id);
    let payload = serde_json::json!({
        "ask_id": ask_id,
        "questions": req.questions,
        "allow_freeform": false,
        "response_mode": "user_message",
    });
    let recorded = crate::serve::ask_question::record_ask_question_for_http(
        &state,
        &req.conversation_id,
        payload,
    );
    if !recorded {
        tracing::error!(
            conv_id = %req.conversation_id,
            ask_id = %ask_id,
            "ask_question_record_failed"
        );
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AskStatusResponse {
                ask_id,
                status: "error".to_string(),
                error: Some("record_failed".to_string()),
            }),
        );
    }

    info!(
        conv_id = %req.conversation_id,
        ask_id = %ask_id,
        question_count = req.questions.len(),
        source = "http",
        "ask_question_pending"
    );

    (
        StatusCode::OK,
        Json(AskStatusResponse {
            ask_id,
            status: "pending".to_string(),
            error: None,
        }),
    )
}

fn resolve_ask_id(ask_id: String) -> String {
    let trimmed = ask_id.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    let generated = Uuid::new_v4().to_string();
    info!(ask_id = %generated, "ask_question_auto_generated_id");
    generated
}
