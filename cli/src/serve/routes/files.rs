use axum::{
    extract::Query,
    http::{header::CONTENT_TYPE, StatusCode},
    response::Response,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct FileQuery {
    path: Option<String>,
}

/// GET /api/v1/files?path=<url-encoded-absolute-path>
///
/// Returns the raw bytes of an image file on the local filesystem.
/// Allowed extensions: png, jpg, jpeg, gif, webp.
pub async fn get_file(Query(params): Query<FileQuery>) -> Result<Response, StatusCode> {
    let path = params.path.unwrap_or_default();

    // Reject empty path
    if path.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Reject path traversal
    if path.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Reject non-absolute paths
    if !path.starts_with('/') {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Determine content-type from extension
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let content_type = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE),
    };

    // Read file asynchronously
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    })?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .body(axum::body::Body::from(bytes))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use std::io::Write;
    use tower::ServiceExt;

    fn make_app() -> Router {
        Router::new().route("/api/v1/files", get(get_file))
    }

    /// Percent-encode a path for use in a URI query string.
    /// Encodes each byte that is not unreserved (RFC 3986) or '/'.
    fn encode_path(path: &str) -> String {
        const HEX: &[u8] = b"0123456789ABCDEF";
        let mut out = String::with_capacity(path.len() * 3);
        for &b in path.as_bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                    out.push(b as char);
                }
                other => {
                    out.push('%');
                    out.push(HEX[(other >> 4) as usize] as char);
                    out.push(HEX[(other & 0xf) as usize] as char);
                }
            }
        }
        out
    }

    /// PNG bytes: request a real temp PNG file, expect 200 + image/png + correct bytes.
    ///
    /// Data construction:
    ///   temp_file = NamedTempFile with .png extension containing b"\x89PNG\r\n"
    ///   path      = absolute path to temp file (starts with /)
    ///
    /// Execution:
    ///   1. Write PNG magic bytes to temp file
    ///   2. GET /api/v1/files?path=<absolute_path> → handler reads file
    ///
    /// Expected:
    ///   - status == 200: file exists and extension is allowed
    ///   - content-type == "image/png": extension matched png branch
    ///   - body == b"\x89PNG\r\n": bytes returned verbatim
    #[tokio::test]
    async fn test_files_returns_png_bytes() {
        let mut tmp = tempfile::Builder::new().suffix(".png").tempfile().unwrap();
        let data = b"\x89PNG\r\n";
        tmp.write_all(data).unwrap();
        tmp.flush().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();

        let app = make_app();
        let uri = format!("/api/v1/files?path={}", encode_path(&path));
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK, "PNG file should return 200");
        let ct = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(ct, "image/png", "content-type should be image/png");
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), data, "response body should match file bytes");
    }

    /// JPEG bytes: request a real temp JPEG file, expect 200 + image/jpeg + correct bytes.
    ///
    /// Data construction:
    ///   temp_file = NamedTempFile with .jpg extension containing JPEG magic bytes
    ///   path      = absolute path to temp file
    ///
    /// Execution:
    ///   1. Write JPEG magic bytes to temp file
    ///   2. GET /api/v1/files?path=<absolute_path> → handler reads file
    ///
    /// Expected:
    ///   - status == 200: file exists and extension is allowed
    ///   - content-type == "image/jpeg": extension matched jpg branch
    ///   - body == JPEG magic bytes: bytes returned verbatim
    #[tokio::test]
    async fn test_files_returns_jpeg_bytes() {
        let mut tmp = tempfile::Builder::new().suffix(".jpg").tempfile().unwrap();
        let data = b"\xff\xd8\xff\xe0";
        tmp.write_all(data).unwrap();
        tmp.flush().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();

        let app = make_app();
        let uri = format!("/api/v1/files?path={}", encode_path(&path));
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK, "JPEG file should return 200");
        let ct = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert_eq!(ct, "image/jpeg", "content-type should be image/jpeg");
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(body.as_ref(), data, "response body should match JPEG bytes");
    }

    /// Path traversal: path containing ".." returns 400.
    ///
    /// Data construction:
    ///   path = "/tmp/foo%2F..%2Fetc%2Fpasswd" — ".." encoded in query value
    ///   raw  = "/tmp/foo/../etc/passwd" — contains ".." segment
    ///
    /// Execution:
    ///   1. GET /api/v1/files?path=/tmp/foo/../etc/passwd → validation rejects before fs access
    ///
    /// Expected:
    ///   - status == 400: path traversal detected and rejected
    #[tokio::test]
    async fn test_files_path_traversal_returns_400() {
        let app = make_app();
        // Encode ".." as %2E%2E so the URI itself is valid but the decoded path contains ".."
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/files?path=%2Ftmp%2Ffoo%2F..%2Fetc%2Fpasswd")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "path with '..' should return 400"
        );
    }

    /// Nonexistent file: path to a file that does not exist returns 404.
    ///
    /// Data construction:
    ///   path = "/tmp/multisoul_test_nonexistent_file_xyz.png" — guaranteed not to exist
    ///
    /// Execution:
    ///   1. GET /api/v1/files?path=<nonexistent_path> → fs read fails with NotFound
    ///
    /// Expected:
    ///   - status == 404: file not found on disk
    #[tokio::test]
    async fn test_files_nonexistent_returns_404() {
        let app = make_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/files?path=%2Ftmp%2Fmultisoul_test_nonexistent_xyz_12345.png")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::NOT_FOUND,
            "nonexistent file should return 404"
        );
    }

    /// Unsupported extension: .txt file returns 415.
    ///
    /// Data construction:
    ///   temp_file = NamedTempFile with .txt extension
    ///   path      = absolute path to temp file (file exists on disk)
    ///
    /// Execution:
    ///   1. Write some bytes to temp .txt file
    ///   2. GET /api/v1/files?path=<absolute_path> → extension check rejects before fs read
    ///
    /// Expected:
    ///   - status == 415: .txt is not in the allowed extension list
    #[tokio::test]
    async fn test_files_unsupported_type_returns_415() {
        let mut tmp = tempfile::Builder::new().suffix(".txt").tempfile().unwrap();
        tmp.write_all(b"hello").unwrap();
        tmp.flush().unwrap();
        let path = tmp.path().to_str().unwrap().to_string();

        let app = make_app();
        let uri = format!("/api/v1/files?path={}", encode_path(&path));
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(&uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ".txt extension should return 415"
        );
    }

    /// Empty path: missing or empty path query param returns 400.
    ///
    /// Data construction:
    ///   path = "" — empty string
    ///
    /// Execution:
    ///   1. GET /api/v1/files?path= → empty path check triggers immediately
    ///
    /// Expected:
    ///   - status == 400: empty path is rejected before any fs access
    #[tokio::test]
    async fn test_files_empty_path_returns_400() {
        let app = make_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/v1/files?path=")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "empty path should return 400"
        );
    }
}
