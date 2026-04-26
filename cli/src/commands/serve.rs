use anyhow::Result;
use clap::Args;
use rand::Rng;
use std::net::SocketAddr;
use crate::{db, serve::{run_server, state::AppState}};

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
    let conn  = db::open()?;
    let state = AppState::new(conn, token.clone());

    let bind_addr: SocketAddr = if args.tailnet {
        format!("0.0.0.0:{}", args.port).parse()?
    } else {
        format!("127.0.0.1:{}", args.port).parse()?
    };

    if args.funnel {
        start_tailscale_funnel(args.port)?;
    }

    println!("Bearer token: {}", token);
    println!();
    print_qr(&token, &format!("http://{}:{}", bind_addr.ip(), args.port));

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

fn print_qr(token: &str, base_url: &str) {
    let pair_url = format!("multisoul://pair?url={}&token={}", base_url, token);
    println!("  Scan to add endpoint in MultiSoul App:");
    if let Ok(code) = qrcode::QrCode::new(pair_url.as_bytes()) {
        let image = code.render::<char>()
            .quiet_zone(false)
            .module_dimensions(2, 1)
            .build();
        println!("{}", image);
    }
    println!();
    println!("  Or paste: {}", pair_url);
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
}
