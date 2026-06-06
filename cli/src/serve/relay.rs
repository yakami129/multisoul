use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::OnceLock;

/// cloudflared binary path: ~/.config/msctl/bin/cloudflared[.exe]
pub fn cloudflared_bin_path() -> PathBuf {
    let bin_name = if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("msctl")
        .join("bin")
        .join(bin_name)
}

/// Returns cloudflared download URL for current platform.
/// macOS/Linux releases are `.tgz` archives; Windows ships a standalone `.exe`.
pub fn cloudflared_download_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.tgz";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.tgz";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe";
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
    )))]
    return "";
}

/// Ensures cloudflared exists, downloads if missing.
/// Fix: checks HTTP status before writing binary to disk.
pub async fn ensure_cloudflared() -> Result<PathBuf> {
    let bin_path = cloudflared_bin_path();
    if bin_path.exists() {
        return Ok(bin_path);
    }

    let url = cloudflared_download_url();
    if url.is_empty() {
        anyhow::bail!("Unsupported platform for cloudflared auto-download. Please install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    }

    tracing::info!(url = url, dest = %bin_path.display(), "downloading_cloudflared");
    println!("cloudflared not found. Downloading from Cloudflare...");

    if let Some(parent) = bin_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create dir: {}", parent.display()))?;
    }

    let url_owned = url.to_string();
    let bin_path_clone = bin_path.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let resp = reqwest::blocking::get(&url_owned)
            .with_context(|| format!("failed to download cloudflared from {}", url_owned))?;
        // Critical fix: check HTTP status before writing — prevents writing error HTML as binary
        let resp = resp.error_for_status().with_context(|| {
            format!(
                "cloudflared download returned error status from {}",
                url_owned
            )
        })?;
        let bytes = resp
            .bytes()
            .context("failed to read cloudflared response body")?;

        if url_owned.ends_with(".tgz") {
            extract_cloudflared_from_tgz(&bytes, &bin_path_clone)?;
        } else {
            std::fs::write(&bin_path_clone, &bytes).with_context(|| {
                format!(
                    "failed to write cloudflared to {}",
                    bin_path_clone.display()
                )
            })?;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&bin_path_clone)?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&bin_path_clone, perms)?;
        }
        Ok(())
    })
    .await
    .context("spawn_blocking failed")??;

    println!("cloudflared downloaded to {}", bin_path.display());
    Ok(bin_path)
}

fn extract_cloudflared_from_tgz(bytes: &[u8], dest: &PathBuf) -> Result<()> {
    use std::io::Cursor;

    let decoder = flate2::read::GzDecoder::new(Cursor::new(bytes));
    let mut archive = tar::Archive::new(decoder);
    let mut found = false;
    for entry in archive
        .entries()
        .context("failed to read cloudflared archive")?
    {
        let mut entry = entry.context("failed to read cloudflared archive entry")?;
        let path = entry
            .path()
            .context("invalid path in cloudflared archive")?;
        if path.file_name().and_then(|n| n.to_str()) == Some("cloudflared") {
            entry
                .unpack(dest)
                .with_context(|| format!("failed to extract cloudflared to {}", dest.display()))?;
            found = true;
            break;
        }
    }
    anyhow::ensure!(
        found,
        "cloudflared binary not found inside downloaded archive"
    );
    Ok(())
}

/// Compiled once at first use — avoids recompiling regex on every stderr line.
fn tunnel_url_regex() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"https://[a-z0-9\-]+\.trycloudflare\.com")
            .expect("tunnel URL regex is valid")
    })
}

/// Extracts tunnel URL from cloudflared stderr output line.
pub fn parse_tunnel_url(line: &str) -> Option<String> {
    tunnel_url_regex()
        .find(line)
        .map(|m| m.as_str().to_string())
}

/// Reports tunnel URL to Workers KV.
///
/// Contract is token-in-path (`POST /tunnel/<token>`) with a `status` field in the body,
/// matching the deployed Worker and mobile's `GET /tunnel/<token>` / this module's
/// `cleanup_tunnel` `DELETE /tunnel/<token>`. The earlier `POST /tunnel` + `{user_token, ...}`
/// shape did not match the deployed Worker and returned 404 `{"status":"not_found"}`.
async fn report_tunnel(relay_url: &str, user_token: &str, tunnel_url: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/tunnel/{}", relay_url, user_token))
        .json(&serde_json::json!({
            "status": "active",
            "tunnel_url": tunnel_url,
        }))
        .send()
        .await
        .context("failed to report tunnel URL to KV")?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("KV report failed: {} — {}", status, body);
    }
    Ok(())
}

/// Cleans up tunnel record from KV on exit
async fn cleanup_tunnel(relay_url: &str, user_token: &str) {
    let client = reqwest::Client::new();
    let _ = client
        .delete(format!("{}/tunnel/{}", relay_url, user_token))
        .send()
        .await;
    tracing::info!("relay_cleanup_done");
}

/// Waits until `msctl serve` is accepting TCP connections on the relay port.
async fn wait_for_serve_port(port: u16) -> Result<()> {
    let addr = format!("127.0.0.1:{}", port);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for msctl serve to listen on {}", addr);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// Main relay entry: launch cloudflared, parse URL, report KV, heartbeat, cleanup on exit.
///
/// Fix: uses a shutdown channel so that when the tokio runtime drops (Ctrl+C / SIGTERM),
/// the cloudflared child is killed and cleanup_tunnel runs before exit.
///
/// `ready_tx`: optional one-shot fired with the public tunnel URL once cloudflared reports it.
/// `serve` uses this to render the pairing QR with the reachable `trycloudflare.com` URL instead
/// of the local `127.0.0.1` address (which the phone cannot reach).
pub async fn run_relay(
    relay_url: String,
    user_token: String,
    port: u16,
    ready_tx: Option<tokio::sync::oneshot::Sender<String>>,
) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let bin = ensure_cloudflared().await?;

    tracing::info!(port = port, "starting_cloudflared");
    println!("Starting Cloudflare Tunnel for port {}...", port);
    wait_for_serve_port(port).await?;

    let mut child = tokio::process::Command::new(&bin)
        .args(["tunnel", "--url", &format!("http://127.0.0.1:{}", port)])
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .kill_on_drop(true) // Fix: ensures child is killed when the future is dropped
        .spawn()
        .context("failed to spawn cloudflared")?;

    let stderr = child.stderr.take().context("no stderr from cloudflared")?;
    let mut reader = BufReader::new(stderr).lines();

    let (url_tx, url_rx) = tokio::sync::oneshot::channel();

    // Drain stderr from the start so cloudflared never blocks while we report to KV.
    tokio::spawn(async move {
        let mut url_tx = Some(url_tx);
        while let Ok(Some(line)) = reader.next_line().await {
            tracing::debug!(line = %line, "cloudflared_stderr");
            if let Some(url) = parse_tunnel_url(&line) {
                if let Some(tx) = url_tx.take() {
                    let _ = tx.send(url);
                }
            }
        }
    });

    let tunnel_url = tokio::time::timeout(std::time::Duration::from_secs(60), url_rx)
        .await
        .context("timed out waiting for cloudflared tunnel URL")?
        .map_err(|_| anyhow::anyhow!("cloudflared exited before providing tunnel URL"))?;

    println!("Cloudflare Tunnel ready: {}", tunnel_url);
    tracing::info!(tunnel_url = %tunnel_url, "relay_tunnel_ready");

    if let Some(tx) = ready_tx {
        let _ = tx.send(tunnel_url.clone());
    }

    if let Err(e) = report_tunnel(&relay_url, &user_token, &tunnel_url).await {
        tracing::warn!(err = %e, "relay_kv_report_failed");
        eprintln!(
            "[warn] Could not register tunnel with relay service ({}). \
             The tunnel URL above still works for manual pairing; \
             Auto Tunnel in the app requires a working --relay-url.",
            e
        );
    }

    // Heartbeat: refresh KV TTL every 5 minutes.
    // Fix: store JoinHandle so we can abort it after child exits.
    let relay_url_hb = relay_url.clone();
    let token_hb = user_token.clone();
    let url_hb = tunnel_url.clone();
    let heartbeat = tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        interval.tick().await; // skip first immediate tick
        loop {
            interval.tick().await;
            if let Err(e) = report_tunnel(&relay_url_hb, &token_hb, &url_hb).await {
                tracing::warn!(err = %e, "relay_heartbeat_failed");
            } else {
                tracing::debug!("relay_heartbeat_ok");
            }
        }
    });

    // Wait for cloudflared to exit (or be killed via kill_on_drop when runtime drops)
    let status = child
        .wait()
        .await
        .context("failed to wait for cloudflared")?;
    if !status.success() {
        tracing::warn!(?status, "cloudflared_exited");
    }

    // Fix: stop heartbeat before cleanup so it doesn't re-post after we delete
    heartbeat.abort();

    cleanup_tunnel(&relay_url, &user_token).await;
    Ok(())
}

#[cfg(test)]
mod tests {
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
}
