use crate::serve::state::AppState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

pub async fn bearer_auth(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let query_token = req.uri().query().and_then(|q| {
        q.split('&').find_map(|kv| {
            let mut parts = kv.splitn(2, '=');
            if parts.next() == Some("token") {
                parts.next().map(percent_decode_query_component)
            } else {
                None
            }
        })
    });

    let header_token = req
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let provided = query_token.as_deref().or(header_token);

    match provided {
        Some(t) if t == state.token => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

fn percent_decode_query_component(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                decoded.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = from_hex(bytes[i + 1]);
                let lo = from_hex(bytes[i + 2]);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    decoded.push((hi << 4) | lo);
                    i += 3;
                } else {
                    decoded.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                decoded.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn from_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    async fn make_app(token: &str) -> axum::Router {
        use crate::db;
        use crate::serve::state::AppState;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let conn = db::open_at(&dir.path().join("t.db")).unwrap();
        let state = AppState::new(
            conn,
            token.to_string(),
            std::path::PathBuf::from("/tmp/uploads"),
            crate::serve::plugin::PluginManager::empty(std::sync::Arc::new(std::sync::Mutex::new(
                crate::db::open_at(&dir.path().join("pm.db")).unwrap(),
            ))),
        );
        axum::Router::new()
            .route("/test", axum::routing::get(|| async { "ok" }))
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                bearer_auth,
            ))
            .with_state(state)
    }

    /// Missing Authorization header -> 401.
    ///
    /// Expected:
    ///   - status == 401
    #[tokio::test]
    async fn test_missing_token_returns_401() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "missing token should return 401"
        );
    }

    /// Wrong token -> 401.
    ///
    /// Expected:
    ///   - status == 401
    #[tokio::test]
    async fn test_wrong_token_returns_401() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("Authorization", "Bearer ms_v2_wrong")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "wrong token should return 401"
        );
    }

    /// Correct token -> 200.
    ///
    /// Expected:
    ///   - status == 200
    #[tokio::test]
    async fn test_correct_token_passes() {
        let app = make_app("ms_v2_secret").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header("Authorization", "Bearer ms_v2_secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "correct token should pass through"
        );
    }

    /// Query token URL 解码：React Native Image 无法带 Authorization header，只能用 ?token=。
    ///
    /// 数据构造（含关键数值的推导过程）：
    ///   state.token = "tok with/slash+plus"
    ///   query token = "tok%20with%2Fslash%2Bplus"
    ///   "%20" -> " "，"%2F" -> "/"，"%2B" -> "+"
    ///
    /// 执行过程（逐步说明系统如何处理）：
    ///   1. GET /test?token=tok%20with%2Fslash%2Bplus
    ///   2. bearer_auth 解析 query token
    ///   3. percent_decode_query_component 解码百分号编码
    ///   4. 与 state.token 比较，匹配后放行
    ///
    /// 预期结果：
    ///   - 断言 A：status == 200，说明图片 URL 中编码后的 token 可鉴权
    ///   - 断言 B：status != 401，说明不会因为 URL 编码误判未授权
    #[tokio::test]
    async fn test_query_token_is_percent_decoded() {
        let app = make_app("tok with/slash+plus").await;
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/test?token=tok%20with%2Fslash%2Bplus")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "percent-encoded query token should pass auth"
        );
        assert_ne!(
            resp.status(),
            StatusCode::UNAUTHORIZED,
            "percent-encoded query token must not be rejected as unauthorized"
        );
    }
}
