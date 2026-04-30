use crate::{
    db,
    serve::{run_server, state::AppState},
};
use anyhow::Result;
use clap::Args;
use rand::Rng;
use serde::Deserialize;
use std::net::SocketAddr;

#[derive(Args)]
pub struct ServeArgs {
    /// Port to listen on
    #[arg(long, default_value = "8765")]
    pub port: u16,

    /// Bearer token (auto-generated if omitted)
    #[arg(long)]
    pub token: Option<String>,

    /// Expose via Tailscale Funnel
    #[arg(long)]
    pub funnel: bool,

    /// Bind to 0.0.0.0 instead of localhost
    #[arg(long)]
    pub tailnet: bool,
}

pub fn generate_token() -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();
    format!("ms_v2_{}", suffix)
}

pub async fn handle(args: ServeArgs) -> Result<()> {
    let token = args.token.unwrap_or_else(generate_token);
    let conn = db::open()?;
    let state = AppState::new(conn, token.clone());

    let bind_addr: SocketAddr = if args.tailnet {
        format!("0.0.0.0:{}", args.port).parse()?
    } else {
        format!("127.0.0.1:{}", args.port).parse()?
    };

    if args.funnel {
        start_tailscale_funnel(args.port)?;
    }

    let base_url = advertised_base_url(
        &bind_addr,
        args.port,
        args.tailnet || args.funnel,
        args.funnel,
    );

    println!("Bearer token: {}", token);
    println!();
    print_qr(&token, &base_url);

    run_server(state, bind_addr).await
}

fn start_tailscale_funnel(port: u16) -> Result<()> {
    let status = std::process::Command::new("tailscale")
        .args(["funnel", &port.to_string()])
        .status();
    match status {
        Ok(s) if s.success() => println!("Tailscale Funnel enabled on port {}", port),
        Ok(s) => eprintln!("[warn] tailscale funnel exited with: {}", s),
        Err(e) => eprintln!("[warn] Could not run tailscale: {}", e),
    }
    Ok(())
}

pub fn print_qr(token: &str, base_url: &str) {
    let pair_url = format!("multisoul://pair?url={}&token={}", base_url, token);
    println!("  Scan to add endpoint in MultiSoul App:");
    if let Ok(code) = qrcode::QrCode::new(pair_url.as_bytes()) {
        let image = code
            .render::<char>()
            .quiet_zone(false)
            .module_dimensions(2, 1)
            .build();
        println!("{}", image);
    }
    println!();
    println!("  Or paste: {}", pair_url);
}

pub fn advertised_base_url(
    bind_addr: &SocketAddr,
    port: u16,
    prefer_tailscale: bool,
    funnel: bool,
) -> String {
    if prefer_tailscale {
        let use_https = funnel || is_tailscale_serve_active();
        if let Some(base_url) = tailscale_base_url(port, use_https) {
            return base_url;
        }
    }

    format!("http://{}:{}", bind_addr.ip(), port)
}

fn is_tailscale_serve_active() -> bool {
    std::process::Command::new("tailscale")
        .args(["serve", "status"])
        .output()
        .ok()
        .map(|o| {
            o.status.success() && !String::from_utf8_lossy(&o.stdout).contains("No serve config")
        })
        .unwrap_or(false)
}

fn tailscale_base_url(port: u16, funnel: bool) -> Option<String> {
    let output = std::process::Command::new("tailscale")
        .args(["status", "--json"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_tailscale_base_url(&stdout, port, funnel)
}

fn parse_tailscale_base_url(status_json: &str, port: u16, funnel: bool) -> Option<String> {
    #[derive(Deserialize)]
    struct TailscaleStatus {
        #[serde(rename = "Self")]
        me: Option<TailscaleSelf>,
    }

    #[derive(Deserialize)]
    struct TailscaleSelf {
        #[serde(rename = "DNSName")]
        dns_name: Option<String>,
        #[serde(rename = "TailscaleIPs")]
        tailscale_ips: Option<Vec<String>>,
    }

    let status: TailscaleStatus = serde_json::from_str(status_json).ok()?;
    let me = status.me?;

    if let Some(dns_name) = me
        .dns_name
        .as_deref()
        .map(|name| name.trim_end_matches('.'))
    {
        if !dns_name.is_empty() {
            return Some(format_base_url(dns_name, port, funnel));
        }
    }

    me.tailscale_ips
        .as_ref()
        .and_then(|ips| ips.first())
        .map(|ip| format_base_url(ip, port, funnel))
}

fn format_base_url(host: &str, port: u16, use_https: bool) -> String {
    let host = format_host_for_url(host);
    if use_https {
        format!("https://{}", host)
    } else {
        format!("http://{}:{}", host, port)
    }
}

fn format_host_for_url(host: &str) -> String {
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V6(_)) => format!("[{}]", host),
        _ => host.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// generate_token produces a 32-char alphanumeric string prefixed with "ms_v2_".
    ///
    /// Expected:
    ///   - starts with "ms_v2_"
    ///   - total length == 38 (6 prefix + 32 random)
    #[test]
    fn test_generate_token_format() {
        let token = generate_token();
        assert!(token.starts_with("ms_v2_"), "token must start with ms_v2_");
        assert_eq!(token.len(), 38, "token must be 38 chars total");
    }

    /// Two calls to generate_token produce different tokens.
    ///
    /// Expected:
    ///   - token1 != token2
    #[test]
    fn test_generate_token_is_random() {
        let t1 = generate_token();
        let t2 = generate_token();
        assert_ne!(t1, t2, "consecutive tokens must differ");
    }

    #[test]
    fn test_parse_tailscale_base_url_prefers_dns_name_for_tailnet() {
        let status = r#"{
            "Self": {
                "DNSName": "alan-mac.tailnet-ab12.ts.net.",
                "TailscaleIPs": ["100.64.1.2"]
            }
        }"#;

        let base_url = parse_tailscale_base_url(status, 8765, false);

        assert_eq!(
            base_url.as_deref(),
            Some("http://alan-mac.tailnet-ab12.ts.net:8765")
        );
    }

    #[test]
    fn test_parse_tailscale_base_url_uses_https_for_funnel() {
        let status = r#"{
            "Self": {
                "DNSName": "alan-mac.tailnet-ab12.ts.net."
            }
        }"#;

        let base_url = parse_tailscale_base_url(status, 443, true);

        assert_eq!(
            base_url.as_deref(),
            Some("https://alan-mac.tailnet-ab12.ts.net")
        );
    }

    #[test]
    fn test_parse_tailscale_base_url_falls_back_to_ip() {
        let status = r#"{
            "Self": {
                "TailscaleIPs": ["100.64.1.2"]
            }
        }"#;

        let base_url = parse_tailscale_base_url(status, 8765, false);

        assert_eq!(base_url.as_deref(), Some("http://100.64.1.2:8765"));
    }
}
