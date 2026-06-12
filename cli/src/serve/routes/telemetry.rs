use crate::serve::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct TelemetryBatch {
    pub events: Vec<TelemetryEvent>,
}

#[derive(Deserialize)]
pub struct TelemetryEvent {
    pub mobile_session_id: String,
    pub event_id: String,
    pub event_type: String,
    pub level: String,
    pub timestamp: String,
    pub data: serde_json::Value,
}

#[derive(Serialize)]
pub struct TelemetryAccepted {
    pub accepted: usize,
}

pub async fn post_telemetry(
    State(_state): State<AppState>,
    Json(batch): Json<TelemetryBatch>,
) -> Result<Json<TelemetryAccepted>, StatusCode> {
    let count = batch.events.len();
    for event in &batch.events {
        emit_telemetry_event(event);
    }
    Ok(Json(TelemetryAccepted { accepted: count }))
}

fn emit_telemetry_event(event: &TelemetryEvent) {
    let data_str = event.data.to_string();
    match event.level.to_ascii_uppercase().as_str() {
        "ERROR" => tracing::error!(
            target: "msctl::serve::mobile_telemetry",
            message = %event.event_type,
            source = "mobile",
            mobile_session_id = %event.mobile_session_id,
            event_id = %event.event_id,
            event_type = %event.event_type,
            timestamp = %event.timestamp,
            data = %data_str,
        ),
        "WARN" => tracing::warn!(
            target: "msctl::serve::mobile_telemetry",
            message = %event.event_type,
            source = "mobile",
            mobile_session_id = %event.mobile_session_id,
            event_id = %event.event_id,
            event_type = %event.event_type,
            timestamp = %event.timestamp,
            data = %data_str,
        ),
        _ => tracing::info!(
            target: "msctl::serve::mobile_telemetry",
            message = %event.event_type,
            source = "mobile",
            mobile_session_id = %event.mobile_session_id,
            event_id = %event.event_id,
            event_type = %event.event_type,
            timestamp = %event.timestamp,
            data = %data_str,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deserialisation: valid batch must round-trip and count events correctly
    ///
    /// 数据构造：2 条合法事件，level 分别为 info 和 error
    ///
    /// 预期结果：
    ///   - 断言 A：batch.events.len() == 2
    ///   - 断言 B：第一条 event_type 为 route_load
    #[test]
    fn telemetry_batch_deserialises_correctly() {
        let json = r#"{
            "events": [
                {
                    "mobile_session_id": "sess-001",
                    "event_id": "evt-001",
                    "event_type": "route_load",
                    "level": "info",
                    "timestamp": "2026-06-10T10:00:00Z",
                    "data": {"route": "/agent/[id]", "duration_ms": 500}
                },
                {
                    "mobile_session_id": "sess-001",
                    "event_id": "evt-002",
                    "event_type": "api_error",
                    "level": "error",
                    "timestamp": "2026-06-10T10:00:01Z",
                    "data": {"status_code": 500, "path": "/api/v1/messages"}
                }
            ]
        }"#;

        let batch: TelemetryBatch = serde_json::from_str(json).expect("valid batch should parse");
        assert_eq!(
            batch.events.len(),
            2,
            "batch should contain exactly 2 events"
        );
        assert_eq!(
            batch.events[0].event_type, "route_load",
            "first event type should be route_load"
        );
    }

    /// Deserialisation: missing 'events' key must return an error
    ///
    /// 数据构造：缺少 events 字段的 JSON 对象
    ///
    /// 预期结果：
    ///   - 断言 A：反序列化失败（is_err() == true）
    #[test]
    fn telemetry_batch_requires_events_field() {
        let json = r#"{"not_events": []}"#;
        let result: Result<TelemetryBatch, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "batch without 'events' field should fail to deserialise"
        );
    }
}
