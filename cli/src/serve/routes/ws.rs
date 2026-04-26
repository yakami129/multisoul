use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::Response,
};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use crate::serve::state::AppState;

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
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let state2   = state.clone();
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
    let Ok(envelope) = serde_json::from_str::<serde_json::Value>(text) else { return };
    match envelope.get("type").and_then(|t| t.as_str()) {
        Some("ping") => {
            let tx = state.get_or_create_sender(conv_id);
            let _ = tx.send(r#"{"type":"pong"}"#.to_string());
        }
        Some("answer") => {
            {
                let db = state.db.lock().unwrap();
                let _ = db.execute(
                    "UPDATE conversations SET status = 'idle' WHERE id = ?1",
                    [conv_id],
                );
            }
            let tx = state.get_or_create_sender(conv_id);
            let _ = tx.send(text.to_string());
        }
        _ => {}
    }
}
