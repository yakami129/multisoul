use axum::Json;
use serde_json::{json, Value};

pub async fn healthz() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    /// GET /api/v1/healthz returns 200 with ok:true.
    ///
    /// Expected:
    ///   - status == 200
    ///   - body.ok == true
    #[tokio::test]
    async fn test_healthz_returns_ok() {
        let app = axum::Router::new().route("/api/v1/healthz", axum::routing::get(healthz));
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "healthz must return 200");
        let bytes = axum::body::to_bytes(resp.into_body(), 4096).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["ok"], true, "healthz body must have ok:true");
    }
}
