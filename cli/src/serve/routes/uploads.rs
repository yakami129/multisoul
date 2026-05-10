use crate::serve::state::AppState;
use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use tracing::warn;
use uuid::Uuid;

#[derive(Serialize)]
pub struct UploadResponse {
    pub file_id: String,
}

/// POST /api/v1/uploads — accept a single image/jpeg or image/png file (≤4 MB).
/// Saves the file to `state.uploads_dir/<uuid>.<ext>` and returns the file_id.
pub async fn upload_image(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UploadResponse>), StatusCode> {
    let field = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .ok_or(StatusCode::BAD_REQUEST)?;

    let content_type = field.content_type().unwrap_or("").to_string();

    let ext = match content_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        _ => {
            warn!(content_type = %content_type, "upload_rejected_unsupported_type");
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
    };

    let data: Bytes = field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?;

    const MAX_BYTES: usize = 4 * 1024 * 1024; // 4 MB server-side limit
    if data.len() > MAX_BYTES {
        warn!(size = data.len(), "upload_rejected_too_large");
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let file_id = format!("{}.{}", Uuid::new_v4(), ext);
    let file_path = state.uploads_dir.join(&file_id);

    std::fs::create_dir_all(&state.uploads_dir).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    std::fs::write(&file_path, &data).map_err(|e| {
        warn!(error = %e, "upload_write_failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((StatusCode::CREATED, Json(UploadResponse { file_id })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use axum::{
        body::Body,
        extract::DefaultBodyLimit,
        http::{Request, StatusCode},
    };
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tower::ServiceExt;

    fn make_app(uploads_dir: PathBuf) -> axum::Router {
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(
            conn,
            "tok".to_string(),
            uploads_dir,
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
            ))),
        );
        axum::Router::new()
            .route("/api/v1/uploads", axum::routing::post(upload_image))
            .layer(DefaultBodyLimit::max(6 * 1024 * 1024))
            .with_state(state)
    }

    fn jpeg_multipart_body(data: &[u8]) -> (String, Vec<u8>) {
        let boundary = "testboundary123";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n",
                boundary
            )
            .as_bytes(),
        );
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", boundary), body)
    }

    fn png_multipart_body(data: &[u8]) -> (String, Vec<u8>) {
        let boundary = "testboundary456";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.png\"\r\nContent-Type: image/png\r\n\r\n",
                boundary
            )
            .as_bytes(),
        );
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
        (format!("multipart/form-data; boundary={}", boundary), body)
    }

    /// JPEG upload: 201 + file written to uploads_dir.
    ///
    /// 数据构造：4 字节 JPEG magic bytes
    /// 执行过程：POST /api/v1/uploads with multipart JPEG
    /// 预期结果：
    ///   - status == 201
    ///   - JSON.file_id ends with .jpg
    ///   - file exists at uploads_dir/file_id
    #[tokio::test]
    async fn test_upload_jpeg_returns_201_and_writes_file() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let (ct, body) = jpeg_multipart_body(b"\xff\xd8\xff\xe0");

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "JPEG upload should return 201"
        );

        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let file_id = json["file_id"]
            .as_str()
            .expect("file_id should be a string");
        assert!(
            file_id.ends_with(".jpg"),
            "file_id should end with .jpg, got: {}",
            file_id
        );

        let file_path = upload_dir.path().join(file_id);
        assert!(
            file_path.exists(),
            "uploaded file should exist at {}",
            file_path.display()
        );
    }

    /// PNG upload: 201 + file_id ends with .png.
    ///
    /// 预期结果：
    ///   - status == 201
    ///   - file_id ends with .png
    #[tokio::test]
    async fn test_upload_png_returns_201() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let (ct, body) = png_multipart_body(b"\x89PNG\r\n");

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::CREATED,
            "PNG upload should return 201"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(
            json["file_id"].as_str().unwrap_or("").ends_with(".png"),
            "file_id should end with .png"
        );
    }

    /// Files > 4 MB: 413.
    ///
    /// 数据构造：5 MB 全零 JPEG
    /// 预期结果：status == 413
    #[tokio::test]
    async fn test_upload_too_large_returns_413() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let big_data = vec![0u8; 5 * 1024 * 1024];
        let (ct, body) = jpeg_multipart_body(&big_data);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::PAYLOAD_TOO_LARGE,
            "files >4 MB should return 413"
        );
    }

    /// Non-JPEG/PNG (image/gif): 415.
    ///
    /// 预期结果：status == 415
    #[tokio::test]
    async fn test_upload_wrong_type_returns_415() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());
        let boundary = "testboundary789";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.gif\"\r\nContent-Type: image/gif\r\n\r\nGIF89a\r\n--{}--\r\n",
                boundary, boundary
            )
            .as_bytes(),
        );
        let ct = format!("multipart/form-data; boundary={}", boundary);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/uploads")
                    .header("content-type", ct)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "non JPEG/PNG should return 415"
        );
    }
}
