use crate::serve::interactive::AnswerPayload;
use crate::serve::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(conv_id): Path<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, conv_id))
}

async fn handle_socket(socket: WebSocket, state: AppState, conv_id: String) {
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
}

async fn handle_client_message(state: &AppState, conv_id: &str, text: &str) {
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
                ask_id,
                choice_id,
                choice_ids,
                freeform,
            };
            let sent = state.send_answer(conv_id, answer);
            eprintln!("[ws] answer routed conv_id={} sent={}", conv_id, sent);
        }
        _ => {}
    }
}
