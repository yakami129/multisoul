use anyhow::{Context, Result};
use std::path::PathBuf;

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

/// Returns cloudflared download URL for current platform
pub fn cloudflared_download_url() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64";
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
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

/// Ensures cloudflared exists, downloads if missing
pub async fn ensure_cloudflared() -> Result<PathBuf> {
    let bin_path = cloudflared_bin_path();
    if bin_path.exists() {
        return Ok(bin_path);
    }

    let url = cloudflared_download_url();
    if url.is_empty() {
        anyhow::bail!("Unsupported platform for cloudflared auto-download. Please install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    }

    println!("cloudflared not found. Downloading from Cloudflare...");
    tracing::info!(url = url, dest = %bin_path.display(), "downloading_cloudflared");

    if let Some(parent) = bin_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create dir: {}", parent.display()))?;
    }

    let url_owned = url.to_string();
    let bin_path_clone = bin_path.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let resp = reqwest::blocking::get(&url_owned)
            .with_context(|| format!("failed to download cloudflared from {}", url_owned))?;
        let bytes = resp
            .bytes()
            .context("failed to read cloudflared response body")?;
        std::fs::write(&bin_path_clone, &bytes).with_context(|| {
            format!(
                "failed to write cloudflared to {}",
                bin_path_clone.display()
            )
        })?;

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

/// Extracts tunnel URL from cloudflared stderr output line
pub fn parse_tunnel_url(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"https://[a-z0-9\-]+\.trycloudflare\.com").ok()?;
    re.find(line).map(|m| m.as_str().to_string())
}

/// Reports tunnel URL to Workers KV
async fn report_tunnel(relay_url: &str, user_token: &str, tunnel_url: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/tunnel", relay_url))
        .json(&serde_json::json!({
            "user_token": user_token,
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

/// Main relay entry: launch cloudflared, parse URL, report KV, heartbeat, cleanup on exit
pub async fn run_relay(relay_url: String, user_token: String, port: u16) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let bin = ensure_cloudflared().await?;

    tracing::info!(port = port, "starting_cloudflared");
    println!("Starting Cloudflare Tunnel for port {}...", port);

    let mut child = tokio::process::Command::new(&bin)
        .args(["tunnel", "--url", &format!("http://localhost:{}", port)])
        .stderr(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .spawn()
        .context("failed to spawn cloudflared")?;

    let stderr = child.stderr.take().context("no stderr from cloudflared")?;
    let mut reader = BufReader::new(stderr).lines();

    let tunnel_url = tokio::time::timeout(std::time::Duration::from_secs(60), async {
        while let Ok(Some(line)) = reader.next_line().await {
            tracing::debug!(line = %line, "cloudflared_stderr");
            if let Some(url) = parse_tunnel_url(&line) {
                return Ok::<String, anyhow::Error>(url);
            }
        }
        anyhow::bail!("cloudflared exited before providing tunnel URL")
    })
    .await
    .context("timed out waiting for cloudflared tunnel URL")??;

    println!("Cloudflare Tunnel ready: {}", tunnel_url);
    tracing::info!(tunnel_url = %tunnel_url, "relay_tunnel_ready");

    report_tunnel(&relay_url, &user_token, &tunnel_url).await?;

    let relay_url_hb = relay_url.clone();
    let token_hb = user_token.clone();
    let url_hb = tunnel_url.clone();
    tokio::spawn(async move {
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

    let _ = child.wait().await;
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
}
