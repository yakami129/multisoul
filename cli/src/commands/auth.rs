use anyhow::Result;
use clap::Subcommand;
use crate::config::{Config, load_config, save_config};

#[derive(Subcommand)]
pub enum AuthCommands {
    /// Save a serve token to local config (used by msctl serve --token)
    Login {
        /// Bearer token (format: ms_v2_...)
        #[arg(long)]
        token: String,
    },
    /// Show current auth status
    Status,
}

pub fn handle(cmd: AuthCommands) -> Result<()> {
    match cmd {
        AuthCommands::Login { token } => login(&token),
        AuthCommands::Status => status(),
    }
}

fn login(token: &str) -> Result<()> {
    let config = Config { serve_token: token.to_string() };
    save_config(&config)?;
    println!("Token saved (prefix: {}...)", &token[..token.len().min(12)]);
    Ok(())
}

fn status() -> Result<()> {
    let config = load_config()?;
    if config.serve_token.is_empty() {
        println!("No token configured. Run 'msctl serve' to generate one.");
    } else {
        println!("Token: {}...", &config.serve_token[..config.serve_token.len().min(12)]);
    }
    Ok(())
}
