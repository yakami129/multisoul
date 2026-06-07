use crate::serve::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::{
    extract::{State, WebSocketUpgrade},
    response::Response,
};
use futures_util::StreamExt;
use serde::Serialize;
use tracing::{debug, info, info_span, Instrument};

pub const REASON_CONVERSATION_CREATED: &str = "conversation_created";
pub const REASON_USER_MESSAGE: &str = "user_message";
pub const REASON_AWAITING_QUESTION: &str = "awaiting_question";
pub const REASON_ANSWER_ACCEPTED: &str = "answer_accepted";
pub const REASON_TASK_TERMINAL: &str = "task_terminal";
pub const REASON_ABORTED: &str = "aborted";
pub const REASON_DELETED: &str = "deleted";
pub const REASON_READ_STATE_CHANGED: &str = "read_state_changed";
pub const REASON_WORKFLOW_CHANGED: &str = "workflow_changed";

#[derive(Serialize)]
struct ActivityChangedEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    conversation_id: &'a str,
    reason: &'a str,
    timestamp: i64,
}

#[derive(Serialize)]
struct SpecChangedEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    spec_id: &'a str,
    conversation_id: &'a str,
    timestamp: i64,
}

pub async fn activity_ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_activity_socket(socket, state))
}

async fn handle_activity_socket(socket: WebSocket, state: AppState) {
    let span = info_span!("activity_ws_connection");
    async move {
        info!("activity_ws_connect");
        let mut socket = socket;
        let mut rx = state.activity_bus.subscribe();

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Ok(msg) => {
                            if socket.send(Message::Text(msg)).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                incoming = socket.next() => {
                    match incoming {
                        Some(Ok(Message::Ping(payload))) => {
                            if socket.send(Message::Pong(payload)).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        Some(Ok(Message::Text(_)))
                        | Some(Ok(Message::Binary(_)))
                        | Some(Ok(Message::Pong(_))) => {}
                        Some(Err(_)) => break,
                    }
                }
            }
        }
        info!("activity_ws_disconnect");
    }
    .instrument(span)
    .await
}

pub fn emit_activity_changed(state: &AppState, conversation_id: &str, reason: &str) {
    let event = ActivityChangedEvent {
        kind: "activity_changed",
        conversation_id,
        reason,
        timestamp: crate::db::now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&event) {
        let receivers = state.activity_bus.send(json).unwrap_or(0);
        debug!(
            conversation_id,
            reason, receivers, "activity_changed_broadcast"
        );
    }
}

pub fn emit_spec_changed(state: &AppState, spec_id: &str, conversation_id: &str) {
    let event = SpecChangedEvent {
        kind: "spec_changed",
        spec_id,
        conversation_id,
        timestamp: crate::db::now_ms(),
    };
    if let Ok(json) = serde_json::to_string(&event) {
        let receivers = state.activity_bus.send(json).unwrap_or(0);
        debug!(
            spec_id,
            conversation_id, receivers, "spec_changed_broadcast"
        );
    }
}

#[cfg(test)]
mod tests;
