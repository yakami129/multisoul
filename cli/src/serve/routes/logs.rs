use crate::{commands, logging};
use axum::{
    extract::ws::{Message, WebSocket},
    extract::{Query, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::{
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::PathBuf,
    time::Duration,
};

#[derive(Deserialize)]
pub struct LogsWsQuery {
    pub tail: Option<usize>,
    pub level: Option<String>,
}

pub async fn logs_ws_handler(ws: WebSocketUpgrade, Query(query): Query<LogsWsQuery>) -> Response {
    let tail = query.tail.unwrap_or(200).clamp(1, 1_000);
    let level = query.level.unwrap_or_else(|| "trace".to_string());
    ws.on_upgrade(move |socket| handle_logs_socket(socket, tail, level))
}

async fn handle_logs_socket(socket: WebSocket, tail: usize, level: String) {
    let log_dir = logging::default_log_dir().unwrap_or_else(|_| PathBuf::from("."));
    let (mut sender, mut receiver) = socket.split();
    let (closed_tx, mut closed_rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        while let Some(Ok(message)) = receiver.next().await {
            if matches!(message, Message::Close(_)) {
                break;
            }
        }
        let _ = closed_tx.send(true);
    });

    if let Ok(lines) = commands::logs::formatted_tail_lines(&log_dir, tail, &level) {
        for line in lines {
            if sender.send(Message::Text(line)).await.is_err() {
                return;
            }
        }
    }

    let mut app_path = logging::current_log_path(&log_dir);
    let mut app_reader = open_reader(&app_path, true);
    let service_path = commands::logs::service_log_path();
    let mut service_reader = open_reader(&service_path, true);

    loop {
        if *closed_rx.borrow() {
            break;
        }

        let mut idle = true;

        if app_reader.is_none() {
            app_path = logging::current_log_path(&log_dir);
            app_reader = open_reader(&app_path, false);
        }
        if let Some(active_reader) = app_reader.as_mut() {
            let mut line = String::new();
            match active_reader.read_line(&mut line) {
                Ok(0) => {
                    let latest = logging::current_log_path(&log_dir);
                    if latest != app_path && latest.exists() {
                        app_path = latest;
                        app_reader = open_reader(&app_path, false);
                    }
                }
                Ok(_) => {
                    idle = false;
                    match commands::logs::format_log_line_for_stream(&line, &level) {
                        Ok(Some(rendered)) => {
                            if sender.send(Message::Text(rendered)).await.is_err() {
                                break;
                            }
                        }
                        Ok(None) => {}
                        Err(_) => break,
                    }
                }
                Err(_) => {
                    app_reader = None;
                }
            }
        }

        if service_reader.is_none() {
            service_reader = open_reader(&service_path, false);
        }
        if let Some(active_reader) = service_reader.as_mut() {
            let mut line = String::new();
            match active_reader.read_line(&mut line) {
                Ok(0) => {}
                Ok(_) => {
                    idle = false;
                    if let Some(rendered) =
                        commands::logs::format_service_log_line_for_stream(&line)
                    {
                        if sender.send(Message::Text(rendered)).await.is_err() {
                            break;
                        }
                    }
                }
                Err(_) => {
                    service_reader = None;
                }
            }
        }

        if idle {
            tokio::select! {
                _ = closed_rx.changed() => {}
                _ = tokio::time::sleep(Duration::from_millis(500)) => {}
            }
        }
    }
}

fn open_reader(path: &std::path::Path, seek_end: bool) -> Option<BufReader<std::fs::File>> {
    let mut file = std::fs::File::open(path).ok()?;
    if seek_end {
        file.seek(SeekFrom::End(0)).ok();
    }
    Some(BufReader::new(file))
}
