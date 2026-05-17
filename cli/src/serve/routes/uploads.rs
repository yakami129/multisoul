use crate::serve::state::AppState;
use axum::{
    body::Bytes,
    extract::{Multipart, Path as AxumPath, State},
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        StatusCode,
    },
    response::Response,
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

/// GET /api/v1/uploads/:file_id — return a previously uploaded image by id.
pub async fn get_uploaded_image(
    State(state): State<AppState>,
    AxumPath(file_id): AxumPath<String>,
) -> Result<Response, StatusCode> {
    if file_id.is_empty()
        || file_id.contains('/')
        || file_id.contains('\\')
        || file_id.contains("..")
    {
        return Err(StatusCode::BAD_REQUEST);
    }

    let ext = std::path::Path::new(&file_id)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let content_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    };

    let path = state.uploads_dir.join(&file_id);
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CACHE_CONTROL, "private, max-age=31536000, immutable")
        .body(axum::body::Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
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
            .route(
                "/api/v1/uploads/:file_id",
                axum::routing::get(get_uploaded_image),
            )
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

    /// 历史图片读取：通过 file_id 返回上传目录中的图片字节。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   uploads_dir      = tempdir()/uploads
    ///   file_id          = "abc.jpg"（无 slash / ".."，允许被 join 到 uploads_dir）
    ///   file bytes       = [0xFF, 0xD8, 0xFF, 0xE0]（4 字节 JPEG header）
    ///   path             = uploads_dir.join(file_id)
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. 写入 uploads_dir/abc.jpg → 服务端已有持久化上传文件
    ///   2. GET /api/v1/uploads/abc.jpg → get_uploaded_image 校验 file_id
    ///   3. 根据 .jpg 推导 Content-Type=image/jpeg
    ///   4. 从 uploads_dir.join(file_id) 读取字节并返回
    ///
    /// 预期结果：
    ///   - 断言 A：status == 200，说明合法 file_id 可被历史消息重新加载
    ///   - 断言 B：content-type == image/jpeg，说明移动端 Image 能按图片解码
    ///   - 断言 C：body 等于原始 4 字节，说明读取的是上传文件本体
    ///   - 断言 D：body 不为空，避免空响应被误判为成功
    ///   - 断言 E：cache-control 为 immutable，说明 iOS 可缓存历史图片
    #[tokio::test]
    async fn test_get_uploaded_image_returns_file_bytes_by_file_id() {
        let upload_dir = tempdir().unwrap();
        let uploads_path = upload_dir.path().to_path_buf();
        std::fs::write(uploads_path.join("abc.jpg"), b"\xff\xd8\xff\xe0").unwrap();
        let app = make_app(uploads_path);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/uploads/abc.jpg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "uploaded image GET should return 200 for an existing safe file_id"
        );
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok());
        assert_eq!(
            content_type,
            Some("image/jpeg"),
            "jpg upload should be served with image/jpeg content type"
        );
        let cache_control = resp
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok());
        assert_eq!(
            cache_control,
            Some("private, max-age=31536000, immutable"),
            "uploaded image responses should be cacheable so iOS does not redownload them"
        );
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            bytes.as_ref(),
            b"\xff\xd8\xff\xe0",
            "GET body should match the exact uploaded image bytes"
        );
        assert!(
            !bytes.is_empty(),
            "uploaded image GET body must not be empty for an existing file"
        );
    }

    /// 非法 file_id：拒绝路径穿越，不从 uploads_dir 外读取。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   file_id path segment = "..secret.jpg"
    ///   安全规则：contains("..") 或 contains("/") → BAD_REQUEST
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. GET /api/v1/uploads/..secret.jpg
    ///   2. get_uploaded_image 收到解码后的 file_id
    ///   3. 命中路径穿越校验，提前返回 400
    ///
    /// 预期结果：
    ///   - 断言 A：status == 400，说明路径穿越不会读取文件
    ///   - 断言 B：status != 200，说明非法 file_id 没有被当成正常图片
    #[tokio::test]
    async fn test_get_uploaded_image_rejects_path_traversal_file_id() {
        let upload_dir = tempdir().unwrap();
        let app = make_app(upload_dir.path().to_path_buf());

        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/uploads/..secret.jpg")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "path traversal file_id should be rejected with 400"
        );
        assert_ne!(
            resp.status(),
            StatusCode::OK,
            "path traversal file_id must not be served as an image"
        );
    }
}
