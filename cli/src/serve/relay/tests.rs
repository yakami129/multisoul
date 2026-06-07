use super::*;

#[test]
fn test_cloudflared_bin_path_is_under_msctl_dir() {
    let path = cloudflared_bin_path();
    let path_str = path.to_string_lossy();
    assert!(
        path_str.contains("msctl"),
        "cloudflared should be stored under msctl config dir, got: {}",
        path_str
    );
}

#[test]
fn test_cloudflared_download_url_by_platform() {
    let url = cloudflared_download_url();
    assert!(
        url.contains("cloudflared"),
        "download URL should reference cloudflared binary, got: {}",
        url
    );
    assert!(!url.is_empty(), "download URL must not be empty");
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    assert!(
        url.ends_with(".tgz"),
        "macOS/Linux should download .tgz archive, got: {}",
        url
    );
}

#[test]
fn test_parse_tunnel_url_from_cloudflared_output() {
    let line = "2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+";
    assert_eq!(
        parse_tunnel_url(line),
        None,
        "non-URL line should return None"
    );

    let line_with_url = "2024-01-01T00:00:00Z INF  | https://example-tunnel.trycloudflare.com                                    |";
    let result = parse_tunnel_url(line_with_url);
    assert_eq!(
        result,
        Some("https://example-tunnel.trycloudflare.com".to_string()),
        "should extract trycloudflare.com URL from cloudflared output"
    );
}

#[test]
fn test_parse_tunnel_url_regex_compiled_once() {
    // Calling multiple times should not panic (OnceLock is safe)
    let _ = parse_tunnel_url("line 1");
    let _ = parse_tunnel_url("line 2 https://foo-bar.trycloudflare.com end");
    let result = parse_tunnel_url("https://my-tunnel.trycloudflare.com");
    assert_eq!(
        result,
        Some("https://my-tunnel.trycloudflare.com".to_string()),
        "regex should work correctly on repeated calls"
    );
}

/// Regression: `report_tunnel` must POST to `/tunnel/<token>` (token in path)
/// with a `{ "status": "active", "tunnel_url": ... }` body.
///
/// Before the fix it posted to `/tunnel` (no token segment) with a
/// `{ "user_token", "tunnel_url" }` body, which the deployed Worker did not
/// route, yielding `404 {"status":"not_found"}` and breaking Auto Tunnel.
/// The mock only matches the correct path + JSON body, so the old shape
/// would leave the mock unhit and fail `assert_async`.
#[tokio::test]
async fn report_tunnel_posts_to_token_path_with_active_status() {
    let mut server = mockito::Server::new_async().await;
    let token = "probe_token_123";
    let mock = server
        .mock("POST", "/tunnel/probe_token_123")
        .match_body(mockito::Matcher::Json(serde_json::json!({
            "status": "active",
            "tunnel_url": "https://probe.trycloudflare.com",
        })))
        .with_status(200)
        .with_body(r#"{"status":"ok"}"#)
        .create_async()
        .await;

    report_tunnel(&server.url(), token, "https://probe.trycloudflare.com")
        .await
        .expect("report_tunnel should succeed against the token-path endpoint");

    mock.assert_async().await;
}

/// Regression: `report_tunnel` surfaces a non-2xx response (e.g. the 404 the
/// deployed Worker returned) as an error so the caller can warn the user
/// instead of silently treating registration as successful.
#[tokio::test]
async fn report_tunnel_errors_on_not_found() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("POST", "/tunnel/probe_token_404")
        .with_status(404)
        .with_body(r#"{"status":"not_found"}"#)
        .create_async()
        .await;

    let err = report_tunnel(
        &server.url(),
        "probe_token_404",
        "https://probe.trycloudflare.com",
    )
    .await
    .expect_err("non-2xx KV response must be reported as an error");

    assert!(
        err.to_string().contains("KV report failed"),
        "error should explain the KV report failure, got: {}",
        err
    );
    mock.assert_async().await;
}

#[tokio::test]
async fn poll_tunnel_url_succeeds_when_kv_returns_active() {
    let mut server = mockito::Server::new_async().await;
    let mock = server
        .mock("GET", "/tunnel/ms_v2_abc")
        .with_status(200)
        .with_body(r#"{"status":"active","tunnel_url":"https://t.trycloudflare.com"}"#)
        .create_async()
        .await;

    let url = poll_tunnel_url(&server.url(), "ms_v2_abc", Duration::from_secs(5))
        .await
        .expect("poll_tunnel_url");

    assert_eq!(url, "https://t.trycloudflare.com");
    mock.assert_async().await;
}

#[tokio::test]
async fn poll_tunnel_url_times_out_when_kv_never_active() {
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("GET", "/tunnel/ms_v2_xyz")
        .with_status(404)
        .create_async()
        .await;

    let err = poll_tunnel_url(&server.url(), "ms_v2_xyz", Duration::from_millis(100))
        .await
        .expect_err("poll_tunnel_url should time out");

    assert!(
        err.to_string()
            .contains("timed out waiting for relay tunnel registration"),
        "unexpected: {err}"
    );
}

#[test]
fn tunnel_url_from_log_since_ignores_bytes_before_offset() {
    let dir = std::env::temp_dir().join(format!("msctl-log-since-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let path = dir.join("msctl.log");
    let old = "Cloudflare Tunnel ready: https://stale.trycloudflare.com\n";
    let new = "Cloudflare Tunnel ready: https://fresh.trycloudflare.com\n";
    std::fs::write(&path, format!("{old}{new}")).expect("write log");

    let offset = old.len() as u64;
    let url = tunnel_url_from_log_since(path.to_str().unwrap(), offset)
        .expect("tunnel url from new bytes");
    assert_eq!(url, "https://fresh.trycloudflare.com");

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(&dir);
}

#[tokio::test]
async fn tunnel_healthz_ok_checks_healthz_endpoint() {
    let mut server = mockito::Server::new_async().await;
    let _mock = server
        .mock("GET", "/api/v1/healthz")
        .with_status(200)
        .with_body(r#"{"ok":true}"#)
        .create_async()
        .await;

    assert!(tunnel_healthz_ok(&server.url()).await);
    assert!(!tunnel_healthz_ok("https://127.0.0.1:1").await);
}

#[tokio::test]
async fn poll_reachable_tunnel_url_prefers_log_when_kv_stale() {
    let mut kv = mockito::Server::new_async().await;
    let _kv_mock = kv
        .mock("GET", "/tunnel/ms_v2_abc")
        .with_status(200)
        .with_body(r#"{"status":"active","tunnel_url":"https://127.0.0.1:1"}"#)
        .create_async()
        .await;

    let mut tunnel = mockito::Server::new_async().await;
    let _health = tunnel
        .mock("GET", "/api/v1/healthz")
        .with_status(200)
        .with_body(r#"{"ok":true}"#)
        .create_async()
        .await;

    let dir = std::env::temp_dir().join(format!("msctl-reach-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let log_path = dir.join("msctl.log");
    std::fs::write(&log_path, "prefix\n").expect("write prefix");
    let offset = service_log_byte_len(log_path.to_str().unwrap());
    std::fs::write(
        &log_path,
        format!("prefix\nCloudflare Tunnel ready: {}\n", tunnel.url()),
    )
    .expect("append tunnel line");

    let url = poll_reachable_tunnel_url(
        &kv.url(),
        "ms_v2_abc",
        log_path.to_str().unwrap(),
        offset,
        Duration::from_secs(5),
    )
    .await
    .expect("poll_reachable_tunnel_url");

    assert_eq!(url, tunnel.url());

    let _ = std::fs::remove_file(&log_path);
    let _ = std::fs::remove_dir(&dir);
}
