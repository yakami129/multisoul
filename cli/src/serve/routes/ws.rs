use crate::db::now_ms;
use crate::serve::interactive::AnswerPayload;
use crate::serve::state::{AnswerSendResult, AppState};
use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use tracing::{info, info_span, warn, Instrument};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, conv_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, conv_id: String) {
    let span = info_span!("ws_connection", conv_id = %conv_id);
    async move {
        info!("ws_connect");
        let (mut sender, mut receiver) = socket.split();
        let tx = state.get_or_create_sender(&conv_id);
        let mut rx = tx.subscribe();

        let mut send_task = tokio::spawn(async move {
            while let Ok(msg) = rx.recv().await {
                if sender.send(Message::Text(msg)).await.is_err() {
                    break;
                }
            }
        });

        let state2 = state.clone();
        let conv_id2 = conv_id.clone();
        let mut recv_task = tokio::spawn(async move {
            while let Some(Ok(msg)) = receiver.next().await {
                if let Message::Text(text) = msg {
                    handle_client_message(&state2, &conv_id2, &text).await;
                }
            }
        });

        tokio::select! {
            _ = &mut send_task => recv_task.abort(),
            _ = &mut recv_task => send_task.abort(),
        }
        info!("ws_disconnect");
    }
    .instrument(span)
    .await
}

pub(super) async fn handle_client_message(state: &AppState, conv_id: &str, text: &str) {
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(text) else {
        return;
    };
    match envelope.get("type").and_then(|t| t.as_str()) {
        Some("ping") => {
            let tx = state.get_or_create_sender(conv_id);
            let _ = tx.send(r#"{"type":"pong"}"#.to_string());
        }
        Some("answer") => {
            let ask_id = envelope
                .get("ask_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let choice_id = envelope
                .get("choice_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let freeform = envelope
                .get("freeform")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            // Multi-question answers: {"0": "optionId", "1": "optionId", ...}
            let choice_ids: Option<HashMap<String, String>> = envelope
                .get("choice_ids")
                .and_then(|v| v.as_object())
                .map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                });
            let answer = AnswerPayload {
                _ask_id: ask_id,
                choice_id,
                choice_ids,
                freeform,
            };
            match state.send_answer(conv_id, answer.clone()) {
                AnswerSendResult::Accepted => {
                    match persist_answer(state, conv_id, &answer) {
                        Ok(()) => send_answer_status(state, conv_id, &answer._ask_id, true, None),
                        Err(_) => send_answer_status(
                            state,
                            conv_id,
                            &answer._ask_id,
                            false,
                            Some("answer_persist_failed"),
                        ),
                    }
                    info!(conv_id = %conv_id, "answer_routed");
                }
                AnswerSendResult::NoSession => {
                    send_answer_status(
                        state,
                        conv_id,
                        &answer._ask_id,
                        false,
                        Some("no_waiting_session"),
                    );
                    warn!(conv_id = %conv_id, "answer_dropped_no_session");
                }
                AnswerSendResult::NoPendingAsk => {
                    send_answer_status(
                        state,
                        conv_id,
                        &answer._ask_id,
                        false,
                        Some("no_pending_ask"),
                    );
                    warn!(conv_id = %conv_id, "answer_dropped_no_pending_ask");
                }
                AnswerSendResult::AskMismatch { .. } => {
                    send_answer_status(
                        state,
                        conv_id,
                        &answer._ask_id,
                        false,
                        Some("ask_mismatch"),
                    );
                    warn!(conv_id = %conv_id, "answer_dropped_ask_mismatch");
                }
                AnswerSendResult::ChannelUnavailable => {
                    send_answer_status(
                        state,
                        conv_id,
                        &answer._ask_id,
                        false,
                        Some("answer_channel_unavailable"),
                    );
                    warn!(conv_id = %conv_id, "answer_dropped_channel_unavailable");
                }
            }
        }
        _ => {}
    }
}

fn persist_answer(state: &AppState, conv_id: &str, answer: &AnswerPayload) -> rusqlite::Result<()> {
    let choice_ids = answer
        .choice_ids
        .as_ref()
        .and_then(|ids| serde_json::to_string(ids).ok());
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO ask_answers
         (ask_id, conversation_id, answered_at, choice_id, choice_ids, freeform)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            answer._ask_id,
            conv_id,
            now_ms(),
            answer.choice_id,
            choice_ids,
            answer.freeform
        ],
    )?;
    db.execute(
        "UPDATE conversations SET status = 'running' WHERE id = ?1",
        [conv_id],
    )?;
    Ok(())
}

fn send_answer_status(
    state: &AppState,
    conv_id: &str,
    ask_id: &str,
    ok: bool,
    error: Option<&str>,
) {
    let payload = serde_json::json!({
        "type": "answer_status",
        "ask_id": ask_id,
        "ok": ok,
        "error": error,
    });
    let tx = state.get_or_create_sender(conv_id);
    let _ = tx.send(payload.to_string());
}
