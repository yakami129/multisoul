use crate::serve::{
    interactive::AnswerPayload,
    state::{AppState, StoredAnswerCreateResult},
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, serde::Deserialize)]
pub struct AskQuestionRequest {
    pub ask_id: String,
    pub questions: Vec<Value>,
    pub conversation_id: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct AnswerQuery {
    pub conversation_id: String,
    pub timeout: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
pub struct AskStatusResponse {
    pub ask_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct AnswerResponse {
    pub ask_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn post_ask_question(
    State(state): State<AppState>,
    Json(req): Json<AskQuestionRequest>,
) -> impl IntoResponse {
    if req.ask_id.trim().is_empty()
        || req.conversation_id.trim().is_empty()
        || req.questions.is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(AskStatusResponse {
                ask_id: req.ask_id,
                status: "error".to_string(),
                error: Some("invalid_request".to_string()),
            }),
        );
    }

    let ask_id = req.ask_id;
    match state.create_stored_answer_channel(&req.conversation_id, &ask_id) {
        StoredAnswerCreateResult::Created => {}
        StoredAnswerCreateResult::AlreadyPendingHttp => {
            return (
                StatusCode::CONFLICT,
                Json(AskStatusResponse {
                    ask_id,
                    status: "error".to_string(),
                    error: Some("ask_already_pending".to_string()),
                }),
            );
        }
        StoredAnswerCreateResult::OwnedByRuntime => {
            return (
                StatusCode::CONFLICT,
                Json(AskStatusResponse {
                    ask_id,
                    status: "error".to_string(),
                    error: Some("ask_owned_by_runtime".to_string()),
                }),
            );
        }
    }
    let payload = serde_json::json!({
        "ask_id": ask_id,
        "questions": req.questions,
        "allow_freeform": false,
    });
    let recorded = crate::serve::ask_question::record_ask_question_for_http(
        &state,
        &req.conversation_id,
        payload,
    );
    if !recorded {
        state.remove_stored_answer_channel(&req.conversation_id, &ask_id);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AskStatusResponse {
                ask_id,
                status: "error".to_string(),
                error: Some("record_failed".to_string()),
            }),
        );
    }

    (
        StatusCode::OK,
        Json(AskStatusResponse {
            ask_id,
            status: "pending".to_string(),
            error: None,
        }),
    )
}

pub async fn get_answer(
    State(state): State<AppState>,
    Path(ask_id): Path<String>,
    Query(query): Query<AnswerQuery>,
) -> impl IntoResponse {
    if ask_id.trim().is_empty() || query.conversation_id.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(AnswerResponse {
                ask_id,
                status: "error".to_string(),
                answers: None,
                error: Some("invalid_request".to_string()),
            }),
        );
    }
    if !ask_exists(&state, &query.conversation_id, &ask_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(AnswerResponse {
                ask_id,
                status: "error".to_string(),
                answers: None,
                error: Some("ask_not_found".to_string()),
            }),
        );
    }

    let timeout_secs = query.timeout.unwrap_or(600).clamp(1, 3600);
    let Some(answer_rx) = state.take_stored_answer_receiver(&query.conversation_id, &ask_id) else {
        return (
            StatusCode::CONFLICT,
            Json(AnswerResponse {
                ask_id,
                status: "error".to_string(),
                answers: None,
                error: Some("answer_wait_unavailable".to_string()),
            }),
        );
    };
    let _cleanup = HttpAnswerWaiterCleanup::new(state.clone(), &query.conversation_id, &ask_id);
    let wait_result = tokio::task::spawn_blocking(move || {
        answer_rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
    })
    .await;

    match wait_result {
        Ok(Ok(answer)) => (
            StatusCode::OK,
            Json(AnswerResponse {
                ask_id,
                status: "answered".to_string(),
                answers: Some(answer_map(answer)),
                error: None,
            }),
        ),
        Ok(Err(std::sync::mpsc::RecvTimeoutError::Timeout)) => (
            StatusCode::REQUEST_TIMEOUT,
            Json(AnswerResponse {
                ask_id,
                status: "error".to_string(),
                answers: None,
                error: Some("timeout".to_string()),
            }),
        ),
        Ok(Err(std::sync::mpsc::RecvTimeoutError::Disconnected)) | Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AnswerResponse {
                ask_id,
                status: "error".to_string(),
                answers: None,
                error: Some("answer_channel_closed".to_string()),
            }),
        ),
    }
}

fn ask_exists(state: &AppState, conv_id: &str, ask_id: &str) -> bool {
    let db = state.db.lock().unwrap();
    db.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM messages
             WHERE conversation_id = ?1
               AND role = 'ask_question'
               AND json_extract(payload, '$.ask_id') = ?2
         )",
        rusqlite::params![conv_id, ask_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|exists| exists == 1)
    .unwrap_or(false)
}

fn answer_map(answer: AnswerPayload) -> HashMap<String, String> {
    if let Some(choice_ids) = answer.choice_ids {
        return choice_ids;
    }
    if let Some(freeform) = answer.freeform {
        return HashMap::from([("0".to_string(), freeform)]);
    }
    if let Some(choice_id) = answer.choice_id {
        return HashMap::from([("0".to_string(), choice_id)]);
    }
    HashMap::new()
}

struct HttpAnswerWaiterCleanup {
    state: AppState,
    conv_id: String,
    ask_id: String,
}

impl HttpAnswerWaiterCleanup {
    fn new(state: AppState, conv_id: &str, ask_id: &str) -> Self {
        Self {
            state,
            conv_id: conv_id.to_string(),
            ask_id: ask_id.to_string(),
        }
    }
}

impl Drop for HttpAnswerWaiterCleanup {
    fn drop(&mut self) {
        self.state
            .remove_stored_answer_channel(&self.conv_id, &self.ask_id);
    }
}
